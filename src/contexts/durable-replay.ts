import { documentFrameSize, type DocumentFrame } from './document-frame.ts';
import {
  cloneDurableDocument,
  cloneLayerSnapshot,
  cloneSelectionSnapshot,
  type DurableDocument,
  type DurableLayerSnapshot,
  type DurableOperation,
  type SelectionSnapshot,
} from './history-model.ts';
import type { LayerId } from './layer-types.ts';
import type { Size } from './general-types.ts';

export type DurableReplayLayer = Readonly<{
  snapshot: DurableLayerSnapshot;
  /**
   * The layer's pixel-changing edits, in timeline order, interleaved with the
   * reposition markers {@link isDurableFoldOrigin} and
   * {@link isDurablePixelOperation} classify.
   *
   * A reposition that PRECEDES the first pixel operation is not here: it is
   * already folded into `snapshot.pos`, which is the box the producer starts
   * from. One that FOLLOWS a pixel operation has to be, because after a raster
   * operation the snapshot's box is no longer the box the timeline was in — the
   * fold in `materialization.ts` is — and a move the fold never saw leaves the
   * stroke's frame published where the layer no longer is.
   */
  operations: readonly DurableOperation[];
}>;

export type DurableReplayResult = Readonly<{
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  durableRevision: number;
  cursor: number;
  frame: DocumentFrame;
  /**
   * `documentFrameSize(frame)`, so a cross-replay oracle can read the same field
   * off this result and off `HistoryReplayResult`. `Math.max(1, Math.ceil(…))` is
   * the legacy rule and is deliberately the same one.
   */
  totalSize: Size;
  layers: Readonly<Record<LayerId, DurableReplayLayer>>;
  selections: SelectionSnapshot;
  activeLayerId: LayerId | null;
}>;

function layerWithSnapshot(layer: DurableReplayLayer, snapshot: DurableLayerSnapshot): DurableReplayLayer {
  return Object.freeze({ snapshot: cloneLayerSnapshot(snapshot), operations: Object.freeze([...layer.operations]) });
}

function addOperation(layer: DurableReplayLayer, operation: DurableOperation): DurableReplayLayer {
  return Object.freeze({ snapshot: layer.snapshot, operations: Object.freeze([...layer.operations, operation]) });
}

/**
 * Whether an operation changes a layer's PIXELS, and so moves the box its
 * presentation is evaluated against.
 *
 * Shared with `materialization.ts` rather than restated there, because the rule
 * is a CONTRACT between the two: this module emits a reposition marker only
 * where a pixel operation says the snapshot's box stopped being the box, and
 * the producer's fold refuses a list whose markers and pixel operations are not
 * in the order this classification implies. Two definitions would drift, and the
 * drift would be a layer published at a box the timeline never held.
 */
export function isDurablePixelOperation(operation: DurableOperation): boolean {
  return (
    operation.kind === 'apply-affine-transform' ||
    operation.kind === 'apply-filter' ||
    operation.kind === 'apply-raster-processor'
  );
}

/**
 * A `reposition-layer` that states a whole box and nothing else, which is what a
 * fold origin is: `move` alone would be an origin with no size, and a marker
 * that carried both would be a `resize` by `reposition`'s own `resize ?? move`.
 */
export type DurableFoldOrigin = Extract<DurableOperation, { kind: 'reposition-layer' }> &
  Readonly<{ resize: Readonly<{ x: number; y: number; width: number; height: number }> }>;

/**
 * The box a layer held when its first pixel operation was recorded, stated as a
 * `reposition-layer` box patch and placed at the HEAD of the retained list.
 *
 * DERIVED, not recorded: no entry in the document says it, and none can, because
 * a reposition is recorded as the box the layer moved TO and every earlier box
 * is overwritten by the next one. The reducer holds the answer for exactly one
 * moment — while it appends the layer's first pixel operation, where its own
 * snapshot is still the box the timeline was in — so it is written down there.
 *
 * The producer's fold cannot start without it, and a layer carrying a stroke's
 * frame cannot be placed from the snapshot alone: the frame is absolute, the
 * box the source is padded into it from is not, and the difference is the whole
 * offset of the published layer.
 */
export function isDurableFoldOrigin(operation: DurableOperation | undefined): operation is DurableFoldOrigin {
  return operation?.kind === 'reposition-layer' && operation.resize !== undefined && operation.move === undefined;
}

function foldOriginMarker(snapshot: DurableLayerSnapshot): DurableOperation {
  return Object.freeze({
    kind: 'reposition-layer' as const,
    layerId: snapshot.id,
    resize: Object.freeze({ ...snapshot.pos }),
  });
}

/** Pure logical reducer. It never resolves an asset and never creates a canvas. */
export function replayDurableDocument(document: DurableDocument, targetCursor = document.cursor): DurableReplayResult {
  /**
   * Total cursor clamp: a non-finite or non-integer index has no position in the
   * timeline and refuses to `-1`; a finite integer is clamped into `[-1, tip]`.
   * Kept byte-identical in `history-model.ts` and `durable-replay.ts`;
   * `setDurableCursor` refuses with the same `Number.isInteger` predicate.
   */
  const normalizedCursor = Number.isInteger(targetCursor)
    ? Math.max(-1, Math.min(targetCursor, document.history.length - 1))
    : -1;
  const layers = new Map<LayerId, DurableReplayLayer>();
  for (const snapshot of document.baseline.layers) {
    layers.set(snapshot.id, Object.freeze({ snapshot: cloneLayerSnapshot(snapshot), operations: Object.freeze([]) }));
  }
  let frame = Object.freeze({ ...document.baseline.frame });
  let selections = cloneSelectionSnapshot(document.baseline.selections);
  let activeLayerId = document.baseline.activeLayerId;

  for (let index = 0; index <= normalizedCursor; index += 1) {
    const entry = document.history[index];
    if (!entry?.enabled) continue;
    const operation = entry.operation;
    switch (operation.kind) {
      case 'create-layer':
        layers.set(
          operation.layer.id,
          Object.freeze({ snapshot: cloneLayerSnapshot(operation.layer), operations: Object.freeze([]) })
        );
        activeLayerId = operation.layer.id;
        break;
      case 'remove-layer':
        layers.delete(operation.layerId);
        if (activeLayerId === operation.layerId) {
          activeLayerId =
            [...layers.values()].sort((left, right) => right.snapshot.order - left.snapshot.order)[0]?.snapshot.id ??
            null;
        }
        break;
      case 'set-layer-properties': {
        const layer = layers.get(operation.layerId);
        if (!layer) break;
        const patch = operation.patch;
        const snapshot = cloneLayerSnapshot({
          ...layer.snapshot,
          ...patch,
          pos: patch.pos ? { ...patch.pos } : layer.snapshot.pos,
        });
        layers.set(operation.layerId, layerWithSnapshot(layer, snapshot));
        break;
      }
      case 'reposition-layer': {
        const layer = layers.get(operation.layerId);
        if (!layer) break;
        const pos = {
          ...layer.snapshot.pos,
          ...(operation.move ? { x: operation.move.x, y: operation.move.y } : {}),
          ...(operation.resize ? { ...operation.resize } : {}),
        };
        const snapshot = cloneLayerSnapshot({ ...layer.snapshot, pos });
        // The fold, not the snapshot, owns the box from the layer's first pixel
        // operation onward: a stroke republishes the layer at a frame the
        // snapshot never learns. So a reposition that comes after one is
        // retained as an ordered marker, and the box the fold started from is
        // written at the head of the list for it to start at. A reposition
        // before the first pixel operation is already in the snapshot, and
        // emitting a marker for it would ask the fold to re-assert the box it
        // was handed.
        const hasPixelOperation = layer.operations.some(isDurablePixelOperation);
        const operations = hasPixelOperation
          ? Object.freeze([
              ...(isDurableFoldOrigin(layer.operations[0])
                ? layer.operations
                : [foldOriginMarker(layer.snapshot), ...layer.operations]),
              operation,
            ])
          : layer.operations;
        layers.set(operation.layerId, Object.freeze({ snapshot, operations }));
        break;
      }
      case 'reorder-layers': {
        for (const [id, order] of Object.entries(operation.orderByLayerId)) {
          const layer = layers.get(id);
          if (!layer) continue;
          layers.set(id, layerWithSnapshot(layer, cloneLayerSnapshot({ ...layer.snapshot, order })));
        }
        break;
      }
      case 'apply-filter':
      case 'apply-affine-transform':
      case 'apply-raster-processor': {
        const layer = layers.get(operation.layerId);
        if (layer) layers.set(operation.layerId, addOperation(layer, operation));
        break;
      }
      case 'set-document-frame':
        frame = Object.freeze({ ...operation.next });
        break;
      case 'replace-layer-source': {
        const layer = layers.get(operation.layerId);
        // Absent layer is a no-op, the same answer `remove-layer`,
        // `set-layer-properties` and `reposition-layer` give for an id the
        // document does not hold.
        if (!layer) break;
        // The retained operations SURVIVE a source rewrite. A source edit is an
        // edit of the layer's arguments, not of the edits already applied to it:
        // Photoshop keeps a live filter or transform on a type layer whose text is
        // retyped, and `materializeLayer` renders the new source and then applies
        // `layer.operations`, which is what makes the two agree. Clearing them
        // would drop a user's blur on the next edit to their type.
        layers.set(
          operation.layerId,
          layerWithSnapshot(
            layer,
            cloneLayerSnapshot({ ...layer.snapshot, pos: { ...operation.pos }, source: operation.source })
          )
        );
        break;
      }
      case 'merge-document':
        for (const id of operation.removedLayerIds) layers.delete(id);
        layers.set(
          operation.result.id,
          Object.freeze({ snapshot: cloneLayerSnapshot(operation.result), operations: Object.freeze([]) })
        );
        activeLayerId = operation.result.id;
        break;
      case 'set-selection':
        selections = cloneSelectionSnapshot(operation.after);
        break;
      default:
        // This switch is the durable replay authority's whole reading of an
        // operation, so a kind it does not name is an operation the replay
        // SILENTLY SKIPS — the layer never receives it and the document renders
        // as though it were never committed. That is a wrong answer with no
        // diagnostic, which is the worst shape a gap can take here, so adding a
        // kind to `DurableOperation` without giving it a replay arm is a
        // typecheck error rather than a silent divergence.
        const _exhaustive: never = operation;
        void _exhaustive;
    }
  }

  const layerRecord = Object.freeze(Object.fromEntries(layers.entries()));
  const activeSelectionId =
    selections.activeSelectionId &&
    selections.selections.some((selection) => selection.id === selections.activeSelectionId)
      ? selections.activeSelectionId
      : null;
  return Object.freeze({
    documentId: document.documentId,
    documentRevision: document.documentRevision,
    branchRevision: document.branchRevision,
    durableRevision: document.durableRevision,
    cursor: normalizedCursor,
    frame,
    totalSize: documentFrameSize(frame),
    layers: layerRecord,
    selections: Object.freeze({ ...selections, activeSelectionId }),
    activeLayerId:
      activeLayerId && layerRecord[activeLayerId]
        ? activeLayerId
        : ([...layers.values()].sort((left, right) => right.snapshot.order - left.snapshot.order)[0]?.snapshot.id ??
          null),
  });
}

export function replayDurableAtCursor(document: DurableDocument, cursor: number): DurableReplayResult {
  return replayDurableDocument(cloneDurableDocument(document), cursor);
}
