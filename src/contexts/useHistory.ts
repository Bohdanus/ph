import { useStore } from './StoreContext.tsx';
import type { LayersRecord } from './layer-types.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import { createLayerSource, getSortedLayersArray } from './layer-utils.ts';
import { drawLayer } from './layer-renderer.ts';
import { replayHistory } from './history-replay.ts';
import { resizeCanvas } from '../util/canvas.ts';
import { TOOL_ACTION } from '../util/constants.ts';
import type { Size } from './general-types.ts';
import { createHistoryItem } from './history-utils.ts';
import { updateHistoryTimeline } from './history-timeline.ts';

export function getHistoryItemTitle(item: HistoryItem) {
  const { actionName, args, layerSource } = item;

  if (layerSource?.kind === 'tool') {
    return layerSource.args.toolName;
  }

  if (actionName === TOOL_ACTION) {
    return (args as ToolArgs).toolName;
  }

  return actionName;
}

export const useHistory = () => {
  const [
    { canvasRef, history, historyIndex, deletedLayers, activeLayerId, totalSize: currentSize, branchRevision = 0 },
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
    if (!canUndo()) return;
    resetHistoryTo(historyIndex - 1);
  }

  function canRedo() {
    return historyIndex < history.length - 1;
  }

  function redo() {
    if (!canRedo()) return;
    resetHistoryTo(historyIndex + 1);
  }
  //
  // function getLayerHistory(layerId: LayerId) {
  //   return history.filter((item) => item.layerId === layerId);
  // }

  function _drawAllLayers(layers: LayersRecord, totalSize: Size) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resizeCanvas(canvas, totalSize.width, totalSize.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    const sorted = getSortedLayersArray(layers);

    for (const layer of sorted) {
      if (!layer.visible) continue;

      if (!drawLayer(ctx, layer)) {
        console.error('skipped layer without bitmap', layer.id);
      } // todo should not happen, but just in case
    }
  }

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history, _branchRevision = branchRevision) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return;
    const replay = replayHistory(_history, targetIndex, currentSize, {
      createLayer: ({ layerId, layers, source }) => createLayerSource({ layerId, layers, source, deferSave: true }),
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
    });

    const sortedLayers = getSortedLayersArray(replay.layers);
    const nextActiveLayerId =
      activeLayerId && replay.layers[activeLayerId]
        ? activeLayerId
        : (sortedLayers[sortedLayers.length - 1]?.id ?? null);

    dispatch({
      type: 'APPLY_HISTORY_REPLAY',
      payload: {
        updates: {
          layers: replay.layers,
          deletedLayers: { ...deletedLayers },
          activeLayerId: nextActiveLayerId,
          totalSize: replay.totalSize,
          selections: replay.selections,
          activeSelectionId: replay.activeSelectionId,
        },
        timeline: { entries: _history, cursor: targetIndex, branchRevision: _branchRevision },
      },
    });

    _drawAllLayers(replay.layers, replay.totalSize);
  }

  function toggleDisabled(historyId: string) {
    // todo commit dirty tool
    const timeline = updateHistoryTimeline(
      { entries: history, cursor: historyIndex, branchRevision },
      { type: 'toggle-disabled', entryId: historyId }
    );
    if (timeline.entries === history) return;

    // recalculate current state
    resetHistoryTo(historyIndex, [...timeline.entries], timeline.branchRevision);
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
