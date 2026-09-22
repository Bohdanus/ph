import { useStore } from './StoreContext.tsx';
import type { LayerSource, LayersRecord } from './layer-types.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import type { NewBedrockSize, ToolArgs } from './tool-types.ts';
import { toolsMap } from '../tools/toolsMap.ts';
import { createLayerSource, getSortedLayersArray, reorderLayers, saveLayerCanvas } from './layer-utils.ts';
import { resizeCanvas } from '../util/canvas.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import type { Selection, Size } from './general-types.ts';
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

    const currentItem = history[historyIndex];
    if (currentItem?.actionName === SELECTION_ACTION) {
      const previousSelectionState = (
        currentItem.args as {
          previousSelectionState?: { selections: Selection[]; activeSelectionId: string | null };
        }
      ).previousSelectionState ?? { selections: [], activeSelectionId: null };
      dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            selections: previousSelectionState.selections,
            activeSelectionId: previousSelectionState.activeSelectionId,
          },
          timeline: updateHistoryTimeline(
            { entries: history, cursor: historyIndex, branchRevision },
            { type: 'set-cursor', cursor: historyIndex - 1 }
          ),
        },
      });
      return;
    }

    resetHistoryTo(historyIndex - 1);
  }

  function canRedo() {
    return historyIndex < history.length - 1;
  }

  function redo() {
    if (!canRedo()) return;

    const nextItem = history[historyIndex + 1];
    if (nextItem?.actionName === SELECTION_ACTION) {
      const nextSelectionState = (
        nextItem.args as {
          nextSelectionState?: { selections: Selection[]; activeSelectionId: string | null };
        }
      ).nextSelectionState ?? { selections: [], activeSelectionId: null };
      dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            selections: nextSelectionState.selections,
            activeSelectionId: nextSelectionState.activeSelectionId,
          },
          timeline: updateHistoryTimeline(
            { entries: history, cursor: historyIndex, branchRevision },
            { type: 'set-cursor', cursor: historyIndex + 1 }
          ),
        },
      });
      return;
    }

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

      const { blendMode, opacity, pos } = layer;
      const bmp = layer.tmpCanvas ?? layer.bitmap;
      if (!bmp || bmp.width === 0 || bmp.height === 0) {
        console.error('skipped layer without bitmap', layer.id);
        continue;
      } // todo should not happen, but just in case

      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = blendMode;

      const { x, y, width, height } = pos;
      ctx.drawImage(bmp, x, y, width, height);
    }
  }

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history, _branchRevision = branchRevision) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return;
    // async commitDirtyTool(); todo
    let newLayers: LayersRecord = {};
    let totalSize = currentSize;

    for (let i = 0; i <= targetIndex; i++) {
      const { disabled, layerId, actionName, args, layerSource, documentSource } = _history[i];
      const source = layerSource ?? (args as LayerSource | undefined);

      if (disabled) continue;
      if (documentSource) {
        newLayers = Object.fromEntries(
          Object.values(documentSource.layers).map((layer) => [layer.id, { ...layer, pos: { ...layer.pos } }])
        );
        totalSize = { ...documentSource.size };
        continue;
      }
      if (source?.isBedrock) {
        totalSize = source.size;
      } else if ((args as NewBedrockSize | undefined)?.isBedrock) {
        totalSize = (args as NewBedrockSize).size;
      }

      if (actionName === NEW_LAYER_ACTION || (actionName === TOOL_ACTION && layerSource?.kind === 'tool')) {
        if (!source) {
          console.error('skipped history item without layer source', _history[i]);
          continue;
        }

        const newLayer = createLayerSource({ layerId, layers: newLayers, source, deferSave: true });
        newLayers[newLayer.id] = newLayer;
      } else if (actionName === SHOW_LAYER_ACTION) {
        if (newLayers[layerId]) newLayers[layerId].visible = true;
      } else if (actionName === HIDE_LAYER_ACTION) {
        if (newLayers[layerId]) newLayers[layerId].visible = false;
      } else if (actionName === RENAME_LAYER_ACTION) {
        if (newLayers[layerId]) newLayers[layerId].name = (args as { name: string }).name;
      } else if (actionName === REORDER_ACTION) {
        const { layerToMoveId, afterWhichLayerId } = args as {
          layerToMoveId: string;
          afterWhichLayerId?: string | null;
        };
        if (!newLayers[layerToMoveId] || (afterWhichLayerId && !newLayers[afterWhichLayerId])) continue;
        reorderLayers({ layers: newLayers, layerToMoveId, afterWhichLayerId });
      } else if (actionName === MERGE_ACTION) {
        if (!source) {
          console.error('skipped merge history item without layer source', _history[i]);
          continue;
        }

        const mergedLayer = createLayerSource({ layerId, layers: newLayers, source, deferSave: true });
        newLayers = {};
        newLayers[layerId] = mergedLayer;
      } else if (actionName === REMOVE_ACTION) {
        delete newLayers[layerId];
      } else if (actionName === TOOL_ACTION) {
        // if a previous history entry has been disabled than the layer could have not be created at the first place
        if (newLayers[layerId]) {
          const layer = newLayers[layerId];
          const bitmap = (layer.tmpCanvas ?? layer.bitmap)!;

          const [canvas, patch] = toolsMap[(args as ToolArgs).toolName].imageProcessor({
            bitmap,
            size: layer.pos,
          })(args as ToolArgs);

          if (patch) {
            layer.pos = { ...layer.pos, ...patch };
          }
          layer.tmpCanvas = canvas;
        }
      }
    }

    for (const layerId in newLayers) {
      const layer = newLayers[layerId];
      saveLayerCanvas(layer);
    }

    const sortedLayers = getSortedLayersArray(newLayers);
    const nextActiveLayerId =
      activeLayerId && newLayers[activeLayerId] ? activeLayerId : (sortedLayers[sortedLayers.length - 1]?.id ?? null);

    dispatch({
      type: 'APPLY_HISTORY_REPLAY',
      payload: {
        updates: {
          layers: newLayers,
          deletedLayers: { ...deletedLayers },
          activeLayerId: nextActiveLayerId,
          totalSize,
        },
        timeline: { entries: _history, cursor: targetIndex, branchRevision: _branchRevision },
      },
    });

    _drawAllLayers(newLayers, totalSize);
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
