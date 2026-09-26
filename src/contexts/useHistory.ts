import { useStore } from './StoreContext.tsx';
import type { Layer, LayersRecord } from './layer-types.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../util/constants.ts';
import { createHistoryItem } from './history-utils.ts';
import { updateHistoryTimeline } from './history-timeline.ts';
import { freezeDurableDocument } from './history-model.ts';
import { convertLegacyHistorySafely } from './history-adapter.ts';
import { replayDurableDocument } from './durable-replay.ts';
import { materializeDocument, type MaterializedDocument } from './materialization.ts';
import { getAssetRegistry } from './asset-registry.ts';
import { replayTokensEqual } from './replay-coordinator.ts';
import { useRef } from 'react';

export function getHistoryItemTitle(item: HistoryItem) {
  const { actionName, args, layerSource } = item;

  if (layerSource?.kind === 'tool') {
    return layerSource.args.toolName;
  }

  if (actionName === TOOL_ACTION) {
    return (args as ToolArgs).toolName;
  }

  if (actionName === SET_DOCUMENT_FRAME_ACTION) return 'crop';

  return actionName;
}

export const useHistory = () => {
  const [store, dispatch] = useStore();
  const {
    history,
    historyIndex,
    deletedLayers,
    totalSize: currentSize,
    documentFrame: currentDocumentFrame,
    branchRevision = 0,
    clearPreviewLayers,
    documentId,
    documentRevision,
    durableDocument,
    replayCoordinator,
    getReplayRevisionToken,
  } = store;
  const presentationMaterialization = useRef<MaterializedDocument | null>(null);

  const setHistoryIndex = (index: number) => {
    resetHistoryTo(index);
  };

  const addHistoryEntry = (inputItem: NewHistoryItem) => {
    dispatch({ type: 'COMMIT_DOCUMENT_EDIT', payload: { historyItem: createHistoryItem(inputItem) } });
  };

  function canUndo() {
    return historyIndex > 0;
  }

  function undo() {
    if (!canUndo()) return Promise.resolve();
    return resetHistoryTo(historyIndex - 1);
  }

  function canRedo() {
    return historyIndex < history.length - 1;
  }

  function redo() {
    if (!canRedo()) return Promise.resolve();
    return resetHistoryTo(historyIndex + 1);
  }
  //
  // function getLayerHistory(layerId: LayerId) {
  //   return history.filter((item) => item.layerId === layerId);
  // }

  function runtimeLayersFromMaterialization(materialized: MaterializedDocument): LayersRecord {
    return Object.fromEntries(
      Object.values(materialized.replay.layers).map(({ snapshot, operations }) => {
        const layer = materialized.layers[snapshot.id];
        if (!layer) throw new Error(`Missing materialization for layer ${snapshot.id}`);
        const runtimeLayer: Layer = {
          id: snapshot.id,
          name: snapshot.name,
          isBedrock: snapshot.isBedrock,
          visible: snapshot.visible,
          opacity: snapshot.opacity,
          locked: snapshot.locked,
          blendMode: snapshot.blendMode,
          order: snapshot.order,
          // The bitmap already includes retained operations, so rendering it
          // must not reapply its logical source or operation stack.
          pos: { ...layer.bounds },
          operations: [],
          bitmap: layer.bitmap,
          tmpCanvas: null,
          ...(operations.length ? { lastHistoryId: undefined } : {}),
        };
        return [snapshot.id, runtimeLayer];
      })
    );
  }

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history, _branchRevision = branchRevision) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return Promise.resolve();
    // Navigation cancels transient previews before creating the immutable
    // durable snapshot that will be the sole materialization input.
    clearPreviewLayers?.();
    const converted = convertLegacyHistorySafely(_history, {
      documentId,
      documentRevision,
      branchRevision: _branchRevision,
      durableRevision: (durableDocument?.durableRevision ?? 0) + 1,
      initialSize: currentSize,
      initialFrame: currentDocumentFrame,
    });
    const diagnostics = converted.diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`);
    if (!converted.document) {
      // Keep the currently published canvas rather than replacing it with a
      // replay that omitted an unsupported history entry.
      console.error('Durable history replay is unavailable', diagnostics);
      dispatch({ type: 'SET_DURABLE_STATUS', payload: { status: 'unavailable', diagnostics } });
      return Promise.resolve();
    }

    const durableCursor = converted.legacyCursorToDurableCursor[targetIndex] ?? -1;
    const document = freezeDurableDocument({ ...converted.document, cursor: durableCursor });
    const replay = replayDurableDocument(document);
    const token = getReplayRevisionToken();

    return replayCoordinator.current
      .request({
        token,
        isStillValid: (snapshot) => replayTokensEqual(snapshot, getReplayRevisionToken()),
        materialize: async ({ signal }) =>
          materializeDocument(replay, {
            documentId,
            baselineAssetGeneration: getAssetRegistry().getDocumentGeneration(documentId),
            operationSetRevision: document.durableRevision,
            assetRegistry: getAssetRegistry(),
            signal,
          }),
        publish: (materialized) => {
          const previous = presentationMaterialization.current;

          presentationMaterialization.current = materialized;
          dispatch({
            type: 'PUBLISH_DURABLE_REPLAY',
            payload: {
              updates: {
                layers: runtimeLayersFromMaterialization(materialized),
                deletedLayers: { ...deletedLayers },
                activeLayerId: materialized.replay.activeLayerId,
                documentFrame: materialized.replay.frame,
                selections: [...materialized.replay.selections.selections],
                activeSelectionId: materialized.replay.selections.activeSelectionId,
              },
              timeline: { entries: _history, cursor: targetIndex, branchRevision: _branchRevision },
              durableDocument: document,
              durableStatus: 'current',
              durableDiagnostics: diagnostics,
            },
          });
          previous?.release();
        },
        release: (materialized) => materialized.release(),
      })
      .then((outcome) => {
        if (outcome.state === 'failed') console.error('Durable history materialization failed', outcome.error);
      });
  }

  function toggleDisabled(historyId: string) {
    // todo commit dirty tool
    const timeline = updateHistoryTimeline(
      { entries: history, cursor: historyIndex, branchRevision },
      { type: 'toggle-disabled', entryId: historyId }
    );
    if (timeline.entries === history) return Promise.resolve();

    // recalculate current state
    return resetHistoryTo(historyIndex, [...timeline.entries], timeline.branchRevision);
  }

  return {
    addHistoryEntry,
    canUndo,
    undo,
    canRedo,
    redo,
    resetHistoryTo,
    setHistoryIndex,
    toggleDisabled,
  };
};
