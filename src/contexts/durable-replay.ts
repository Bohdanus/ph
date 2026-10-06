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
        layers.set(operation.layerId, layerWithSnapshot(layer, cloneLayerSnapshot({ ...layer.snapshot, pos })));
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
