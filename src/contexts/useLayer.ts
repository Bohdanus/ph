import { useStore } from './StoreContext.tsx';
import type {
  BlankLayerSource,
  ImageLayerSource,
  Layer,
  LayerId,
  LayersRecord,
  ToolLayerSource,
} from './layer-types.ts';
import { createLayerSource, getSortedLayersArray, reorderLayers, saveLayerCanvas } from './layer-utils.ts';
import type { BlankImageParams, FileImageParams, FullArgs, ToolArgs } from './tool-types.ts';
import { type CreatorToolParams, type ProcessorToolParams, toolsMap } from '../tools/toolsMap.ts';
import { type HistoryEntry, useHistory } from './useHistory.ts';
import { reduceRect, sortedRectToPos } from '../util/rect.ts';
import type { Optional } from '../util/type-utils.ts';
import {
  type ActionType,
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import type { TextToolArgs } from '../tools/text.ts';

export type LayerEditParams = {
  id?: LayerId | null;
  toolArgs: ToolArgs;
};

export const useLayers = () => {
  const [
    { canvasRef, toolOverlayRef, layers, deletedLayers, activeLayerId, totalSize, toolName, currentArgs },
    dispatch,
  ] = useStore();
  const { addHistoryEntry } = useHistory();

  function clearOverlay() {
    const overlayCtx = toolOverlayRef.current?.getContext('2d')!;
    overlayCtx.clearRect(0, 0, totalSize.width, totalSize.height);
  }

  const _addLayer = (layer: Layer, historyEntry: HistoryEntry) => {
    const newLayers = { ...layers, [layer.id]: layer } as LayersRecord;
    dispatch({ type: 'ADD_LAYER', payload: { layers: newLayers, activeLayerId: layer.id } });

    addHistoryEntry(historyEntry);
  };

  const createBlankLayer = (params: BlankImageParams) => {
    commitDirtyTool();

    const source: BlankLayerSource = { kind: 'blank', ...params };
    const newLayer = createLayerSource({ layers, source });

    _addLayer(newLayer, {
      layerId: newLayer.id,
      actionName: NEW_LAYER_ACTION,
      args: source,
    });
  };

  const createLayerFromBitmap = (params: FileImageParams) => {
    commitDirtyTool();

    const source: ImageLayerSource = {
      kind: 'image',
      ...params,
    };
    const newLayer = createLayerSource({ layers, source });

    _addLayer(newLayer, {
      layerId: newLayer.id,
      actionName: NEW_LAYER_ACTION,
      args: source,
    });
  };

  const createLayerFromTool = (sourceArgs: Optional<FullArgs, 'pos'>) => {
    // commented out because causes infinite recursion
    // commitDirtyTool();

    const { args, pos } = sourceArgs;
    let source: ToolLayerSource;

    if (!pos) {
      if (!('rect' in args) || !args.rect) {
        throw new Error('Missing rect in args');
      }
      const newPos = sortedRectToPos(args.rect);
      const newRect = reduceRect(args.rect, newPos);

      source = { kind: 'tool', ...sourceArgs, args: { ...args, rect: newRect }, pos: newPos };
    } else {
      source = { kind: 'tool', ...sourceArgs, args: { ...args } } as ToolLayerSource; // clone args anyway
    }

    const newLayer = createLayerSource({ layers, source });

    _addLayer(newLayer, {
      layerId: newLayer.id,
      actionName: TOOL_ACTION,
      args: source,
    });

    clearOverlay();
  };

  const updateLayerByTool = ({ id = activeLayerId, toolArgs }: LayerEditParams) => {
    // should mark layer dirty
    tempUpdateLayer({ id, toolArgs });
    // should pick that dirty later and do all hardening
    commitDirtyTool();

    addHistoryEntry({
      layerId: id!,
      actionName: TOOL_ACTION,
      args: toolArgs,
    });
  };

  // honestly, the only dirty tool that needs saving is text and maybe crop
  const commitDirtyTool = () => {
    // can be run safely if no dirty layer

    // special case
    if (toolName === 'text' /* || toolName === 'crop'*/) {
      const args = currentArgs.current as TextToolArgs & ToolArgs;
      if (!args.text || !args.rect) return;

      createLayerFromTool({ args });
      return;
    }

    // Find dirty layer and save it
    for (const layer of Object.values(layers)) {
      if (layer.tmpCanvas) {
        saveLayerCanvas(layer);
        break;
      }
    }
  };

  const removeLayer = (id: LayerId) => {
    const layer = layers[id];
    if (!layer) return;

    const { [id]: removedLayer, ...remainingLayers } = layers;
    removedLayer.bitmap = null; // clean memory
    removedLayer.tmpCanvas = null;
    const newDeletedLayers = { ...deletedLayers, [id]: removedLayer };

    dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers: remainingLayers,
        deletedLayers: newDeletedLayers,
        hasUnsavedChanges: true,
      },
    });

    if (activeLayerId === id) {
      const sorted = getSortedLayersArray(remainingLayers);
      const newActive = sorted.length > 0 ? sorted[sorted.length - 1].id : null;
      dispatch({ type: 'SET_ACTIVE_LAYER', payload: newActive });
    }

    addHistoryEntry({
      layerId: id!,
      actionName: REMOVE_ACTION,
      args: {},
    });

    const ctx = toolOverlayRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, totalSize.width, totalSize.height);
  };

  const updateLayer = (id: LayerId, patch: Partial<Layer>, actionName: ActionType) => {
    const layer = layers[id];
    if (!layer) return;
    const newLayers = { ...layers, [id]: { ...layer, ...patch } } as LayersRecord;
    dispatch({ type: 'UPDATE_LAYERS', payload: newLayers });
    drawAllLayers();

    addHistoryEntry({
      layerId: id!,
      actionName,
      args: patch,
    });
  };

  const moveLayerAfter = (layerToMoveId: LayerId, afterWhichLayerId?: LayerId | null) => {
    reorderLayers({ layers, layerToMoveId, afterWhichLayerId });

    dispatch({ type: 'UPDATE_LAYERS', payload: { ...layers } });
    drawAllLayers();

    addHistoryEntry({
      layerId: layerToMoveId,
      actionName: REORDER_ACTION,
      args: { layerToMoveId, afterWhichLayerId } as any as ToolArgs,
    });
  };

  const setActiveLayer = (id?: LayerId | null) => dispatch({ type: 'SET_ACTIVE_LAYER', payload: id ?? null });

  const toggleVisibility = (id: LayerId) => {
    const isVisible = layers[id]?.visible;
    updateLayer(id, { visible: !isVisible }, isVisible ? HIDE_LAYER_ACTION : SHOW_LAYER_ACTION);
  };

  // THE MAIN POINT IS THAT THIS method does not leave any trace in history and REACT lifecycle
  function tempUpdateLayer({ id = activeLayerId, toolArgs }: LayerEditParams) {
    if (!id) return;

    const layer = layers[id];
    if (!layer) return;

    const { toolName } = toolArgs;
    const bitmap = layer.bitmap;
    if (!bitmap && !toolsMap[toolName].creator) {
      console.error('No active layer or bitmap to update preview');
      return;
    }

    const [canvas, positionPatch] = toolsMap[toolName].imageProcessor({ bitmap, size: layer.pos } as
      | CreatorToolParams
      | ProcessorToolParams)(toolArgs);

    if (positionPatch) {
      layer.pos = { ...layer.pos, ...positionPatch };
    }

    // attention, this is skipping react render, but it's intentional for performance reasons, since this is only a temporary preview!
    layer.tmpCanvas = canvas;

    drawAllLayers();
  }

  function drawAllLayers() {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;

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

  async function mergeAllLayers() {
    commitDirtyTool();

    // getBitmap of the canvas
    const canvasBitmap = await createImageBitmap(canvasRef.current!);
    const source = {
      kind: 'image',
      bitmap: canvasBitmap,
      name: 'Merged Layer',
      size: { ...totalSize },
      isBedrock: true,
    } satisfies ImageLayerSource;

    const layer = createLayerSource({
      layers,
      source,
    });

    const newLayers = { [layer.id]: layer } as LayersRecord;
    dispatch({ type: 'UPDATE_LAYERS', payload: newLayers });
    dispatch({ type: 'SET_ACTIVE_LAYER', payload: layer.id });

    addHistoryEntry({
      layerId: layer.id,
      actionName: MERGE_ACTION,
      args: source,
    });
  }

  return {
    createBlankLayer,
    createLayerFromBitmap,
    createLayerFromTool,

    tempUpdateLayer,
    updateLayerByTool,
    commitDirtyTool,

    removeLayer,

    updateLayer,
    setActiveLayer,
    toggleVisibility,
    moveLayerAfter,

    drawAllLayers,
    mergeAllLayers,
  };
};
