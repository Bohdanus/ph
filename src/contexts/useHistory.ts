import { useStore } from './StoreContext.tsx';
import type { LayersRecord } from './layer-types.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import { createLayerSource, getSortedLayersArray } from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { replayHistory } from './history-replay.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../util/constants.ts';
import { createHistoryItem } from './history-utils.ts';
import { updateHistoryTimeline } from './history-timeline.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';
import type { MigrationDiagnostic } from './history-adapter.ts';

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
  const [
    {
      canvasRef,
      history,
      historyIndex,
      deletedLayers,
      activeLayerId,
      totalSize: currentSize,
      documentFrame: currentDocumentFrame,
      branchRevision = 0,
      clearPreviewLayers,
    },
    dispatch,
  ] = useStore();

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

  function drawReplay(layers: LayersRecord, frame: DocumentFrame) {
    const canvas = canvasRef.current;
    return !canvas || drawLayersToCanvas(canvas, getSortedLayersArray(layers), frame);
  }

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history, _branchRevision = branchRevision) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return Promise.resolve();
    // Durable replay remains a diagnostic shadow until every pixel consumer
    // uses the same materialization contract. Navigation therefore replays the
    // legacy runtime representation and lets StoreContext rebuild the sidecar.
    clearPreviewLayers?.();
    try {
      const initialFrame = currentDocumentFrame ?? documentFrameFromSize(currentSize);
      const replay = replayHistory(
        _history,
        targetIndex,
        currentSize,
        {
          // Replay layers keep their tmpCanvas: a cache is promoted only when the
          // user commits an edit, and the renderer draws from the canvas.
          createLayer: ({ layerId, layers, source }) => createLayerSource({ layerId, layers, source }),
          applyRasterTool: (layer, args) => {
            const bitmap = layer.tmpCanvas ?? layer.bitmap;
            if (!bitmap) return layer;
            const [canvas, patch] = toolProcessors[args.toolName].imageProcessor({ bitmap, size: layer.pos })(args);
            return {
              ...layer,
              pos: patch ? { ...layer.pos, ...patch } : layer.pos,
              source: undefined,
              tmpCanvas: canvas,
            };
          },
        },
        initialFrame
      );
      const sortedLayers = getSortedLayersArray(replay.layers);
      const nextActiveLayerId =
        activeLayerId && replay.layers[activeLayerId]
          ? activeLayerId
          : (sortedLayers[sortedLayers.length - 1]?.id ?? null);
      if (!drawReplay(replay.layers, replay.documentFrame)) {
        throw new Error('Unable to publish replayed history presentation');
      }

      dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            layers: replay.layers,
            deletedLayers: { ...deletedLayers },
            activeLayerId: nextActiveLayerId,
            totalSize: replay.totalSize,
            documentFrame: replay.documentFrame,
            selections: replay.selections,
            activeSelectionId: replay.activeSelectionId,
          },
          timeline: { entries: _history, cursor: targetIndex, branchRevision: _branchRevision },
        },
      });
    } catch (error) {
      const item = _history[targetIndex];
      const reason = error instanceof Error ? error.message : String(error);
      const diagnostic: MigrationDiagnostic = {
        historyId: item?.id,
        actionName: item?.actionName,
        severity: 'error',
        code: 'conversion-failed',
        message: reason,
      };
      console.error('History replay is unavailable', error);
      dispatch({ type: 'SET_DURABLE_STATUS', payload: { status: 'unavailable', diagnostics: [diagnostic] } });
    }

    return Promise.resolve();
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
