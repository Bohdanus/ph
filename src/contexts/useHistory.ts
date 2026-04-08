import { v4 as uuidv4 } from 'uuid';

import { useStore } from './StoreContext.tsx';
import type { LayerId, LayerSource, LayersRecord } from './layer-types.ts';
import type { HistoryItem } from './history-types.ts';
import type { NewBedrockSize, ToolArgs, ToolName } from './tool-types.ts';
import { toolsMap } from '../tools/toolsMap.ts';
import { createLayerSource, getSortedLayersArray, reorderLayers, saveLayerCanvas } from './layer-utils.ts';
import {
  HIDE_LAYER_ACTION,
  MAX_HISTORY_IMAGE_COUNT,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  NO_BMP_UPDATE_ACTIONS,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SHOW_LAYER_ACTION,
} from '../util/constants.ts';
import type { Size } from './general-types.ts';

export type HistoryEntry = {
  layerId: LayerId;
  toolName: ToolName;
  args: ToolArgs | LayerSource | object;
};

export const useHistory = () => {
  const [{ canvasRef, history, historyIndex, layers: oldLayers, deletedLayers }, dispatch] = useStore();

  const setHistoryIndex = (index: number) => {
    dispatch({ type: 'SET_HISTORY_INDEX', payload: index });
  };

  const addHistoryEntry = ({ layerId, toolName, args }: HistoryEntry) => {
    const historyItemId = uuidv4();
    const imagePromise = NO_BMP_UPDATE_ACTIONS.includes(toolName)
      ? history[historyIndex - 1].imagePromise
      : new Promise<ImageBitmap>((resolve) => {
          setTimeout(() => {
            resolve(createImageBitmap(canvasRef.current!));
          });
        });

    const newHistoryItem: HistoryItem = { id: historyItemId, layerId, toolName, args, imagePromise };

    if (historyIndex < history.length - 1) {
      const trimmedHistory = history.slice(0, historyIndex + 1);
      trimmedHistory.push(newHistoryItem);
      dispatch({ type: 'REPLACE_HISTORY', payload: trimmedHistory });
    } else {
      dispatch({ type: 'ADD_HISTORY_ITEM', payload: newHistoryItem });

      // maintain memory size
      if (history.length > MAX_HISTORY_IMAGE_COUNT) {
        history[historyIndex - MAX_HISTORY_IMAGE_COUNT].imagePromise = Promise.resolve(null);
      }
    }
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
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    const sorted = getSortedLayersArray(layers);

    for (const layer of sorted) {
      if (!layer.visible) continue;

      const { blendMode, opacity, pos } = layer;
      const bmp = layer.tmpCanvas;
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

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history) {
    // async commitDirtyTool(); todo
    let newLayers: LayersRecord = {};
    let totalSize: Size | null = null;

    for (let i = 0; i <= targetIndex; i++) {
      const { disabled, layerId, toolName, args } = _history[i];
      if ((args as LayerSource).isBedrock) {
        totalSize = (args as NewBedrockSize).size;
      }
      if (disabled) continue;

      if (toolName === NEW_LAYER_ACTION) {
        const source = args as LayerSource;
        const newLayer = createLayerSource({ layerId, layers: newLayers, source });
        newLayers[newLayer.id] = newLayer;
      } else if (toolName === SHOW_LAYER_ACTION) {
        newLayers[layerId].visible = true;
      } else if (toolName === HIDE_LAYER_ACTION) {
        newLayers[layerId].visible = false;
      } else if (toolName === RENAME_LAYER_ACTION) {
        newLayers[layerId].name = (args as any).name;
      } else if (toolName === REORDER_ACTION) {
        const { layerToMoveId, afterWhichLayerId } = args as any;
        reorderLayers({ layers: newLayers, layerToMoveId, afterWhichLayerId });
      } else if (toolName === MERGE_ACTION) {
        const mergedLayer = createLayerSource({ layerId, layers: newLayers, source: args as LayerSource });
        newLayers = {};
        newLayers[layerId] = mergedLayer;
      } else if (toolName === REMOVE_ACTION) {
        delete newLayers[layerId];
      } else if (toolsMap[toolName].creator) {
        // Creation tools
        const newLayer = createLayerSource({ layerId, layers: newLayers, source: args as LayerSource });
        newLayers[newLayer.id] = newLayer;
      } else if (newLayers[layerId]) {
        // layer can be mentioned in history, but disabled history item causes disruption
        // Processing tools
        const layer = newLayers[layerId];
        const bitmap = layer.tmpCanvas!;

        const [canvas, patch] = toolsMap[toolName].imageProcessor({
          bitmap,
          size: layer.pos,
        })(args as ToolArgs);

        if (patch) {
          layer.pos = { ...layer.pos, ...patch };
        }
        layer.tmpCanvas = canvas;
      }
    }

    for (const layerId in newLayers) {
      const layer = newLayers[layerId];
      saveLayerCanvas(layer);
    }

    for (const layerId in oldLayers) {
      deletedLayers[layerId as LayerId] = oldLayers[layerId];
    }

    dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers: newLayers,
        deletedLayers: { ...deletedLayers },
        totalSize,
        historyIndex: targetIndex,
      },
    });

    _drawAllLayers(newLayers, totalSize!);
  }

  function toggleDisabled(historyId: string) {
    // todo commit dirty tool
    const itemIndex = history.findIndex((item) => item.id === historyId);
    if (itemIndex === -1) return;

    const newHistory = [...history];
    newHistory[itemIndex] = { ...newHistory[itemIndex], disabled: !newHistory[itemIndex].disabled };

    dispatch({ type: 'REPLACE_HISTORY', payload: newHistory });

    // recalculate current state
    resetHistoryTo(historyIndex, newHistory);
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
