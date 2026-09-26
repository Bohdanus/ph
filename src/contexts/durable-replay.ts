import type { DocumentFrame } from './document-frame.ts';
import {
  cloneDurableDocument,
  cloneLayerSnapshot,
  type DurableDocument,
  type DurableLayerSnapshot,
  type DurableOperation,
  type SelectionSnapshot,
} from './history-model.ts';
import type { LayerId } from './layer-types.ts';
import type { Selection } from './general-types.ts';

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
  layers: Readonly<Record<LayerId, DurableReplayLayer>>;
  selections: SelectionSnapshot;
  activeLayerId: LayerId | null;
}>;

function cloneSelectionSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({
    selections: Object.freeze(
      snapshot.selections.map((selection: Selection) =>
        Object.freeze({
          ...selection,
          points: Object.freeze(selection.points.map((point) => Object.freeze({ ...point }))),
          pos: Object.freeze({ ...selection.pos }),
        })
      )
    ),
    activeSelectionId: snapshot.activeSelectionId,
  }) as unknown as SelectionSnapshot;
}

function layerWithSnapshot(layer: DurableReplayLayer, snapshot: DurableLayerSnapshot): DurableReplayLayer {
  return Object.freeze({ snapshot: cloneLayerSnapshot(snapshot), operations: Object.freeze([...layer.operations]) });
}

function addOperation(layer: DurableReplayLayer, operation: DurableOperation): DurableReplayLayer {
  return Object.freeze({ snapshot: layer.snapshot, operations: Object.freeze([...layer.operations, operation]) });
}

/** Pure logical reducer. It never resolves an asset and never creates a canvas. */
export function replayDurableDocument(document: DurableDocument, targetCursor = document.cursor): DurableReplayResult {
  const normalizedCursor = Math.max(-1, Math.min(targetCursor, document.history.length - 1));
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
      case 'rasterize-layer':
        layers.delete(operation.layerId);
        layers.set(
          operation.result.id,
          Object.freeze({ snapshot: cloneLayerSnapshot(operation.result), operations: Object.freeze([]) })
        );
        break;
      case 'set-document-frame':
        frame = Object.freeze({ ...operation.next });
        break;
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
