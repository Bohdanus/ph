import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from './StoreContext.tsx';
import type {
  BlankLayerSource,
  ImageLayerSource,
  Layer,
  LayerId,
  LayerOperationArgs,
  LayersRecord,
  ToolLayerSource,
} from './layer-types.ts';
import {
  createLayerOperation,
  createAffineLayerOperation,
  createLayerSource,
  getSortedLayersArray,
  reorderLayers,
  saveLayerCanvas,
} from './layer-utils.ts';
import { drawLayer } from './layer-renderer.ts';
import { resizeCanvas } from '../util/canvas.ts';
import type { BlankImageParams, FileImageParams, FullArgs, ToolArgs } from './tool-types.ts';
import { type CreatorToolParams, type ProcessorToolParams, toolProcessors } from '../tools/toolProcessors.ts';
import { reduceRect, sortRect, sortedRectToPos, trimRect } from '../util/rect.ts';
import type { Optional } from '../util/type-utils.ts';
import {
  type ActionType,
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';
import {
  canvasRectToDocumentFrame,
  canvasToDocumentPos,
  documentFrameEquals,
  documentFrameFromSize,
  documentFrameSize,
  isValidDocumentFrame,
} from './document-frame.ts';
import {
  isIdentityAffineTransform,
  isTrapezoidOnlyTransform,
  normalizeTransformHistoryArgs,
  transformToolArgsToAffine,
} from './affine-transform.ts';

export type LayerEditParams = {
  id?: LayerId | null;
  toolArgs: ToolArgs;
};

function isTransformArgs(args: ToolArgs): args is TransformToolArgs {
  return args.toolName === 'transform';
}

function normalizeCommittedToolArgs(layer: Layer, args: ToolArgs): ToolArgs | object | null {
  if (!isTransformArgs(args)) return args;
  const retained = normalizeTransformHistoryArgs(args, layer.pos);
  if (retained && isIdentityAffineTransform(retained.transform)) return null;
  return retained ?? args;
}

async function immutableRaster(bitmap: ImageLayerSource['bitmap']): Promise<ImageLayerSource['bitmap']> {
  if (typeof (bitmap as { close?: unknown }).close === 'function') return bitmap;
  if (!globalThis.createImageBitmap) {
    throw new Error('createImageBitmap is required to import a mutable raster source');
  }
  return globalThis.createImageBitmap(bitmap as CanvasImageSource);
}

export const useLayers = () => {
  const [
    {
      canvasRef,
      toolOverlayRef,
      layers,
      deletedLayers,
      activeLayerId,
      totalSize,
      documentFrame: currentDocumentFrame,
      toolName,
      currentArgs: currentArgsRef,
      previewLayers: previewLayersRef,
    },
    dispatch,
  ] = useStore();
  const documentFrame = currentDocumentFrame ?? documentFrameFromSize(totalSize);

  function clearOverlay() {
    const overlayCtx = toolOverlayRef.current?.getContext('2d');
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, totalSize.width, totalSize.height);
  }

  const _addLayer = (
    layer: Layer,
    historyItem: NewHistoryItem,
    newDocument?: { size: { width: number; height: number }; hasUnsavedChanges: boolean },
    currentLayers: LayersRecord = layers
  ) => {
    const entry = createHistoryItem(historyItem);
    if (newDocument) {
      previewLayersRef.current = {};
      dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: uuidv4(),
          history: [entry],
          updates: {
            layers: { [layer.id]: layer },
            activeLayerId: layer.id,
            deletedLayers: {},
            totalSize: { ...newDocument.size },
            documentFrame: documentFrameFromSize(newDocument.size),
            hasImage: true,
            hasUnsavedChanges: newDocument.hasUnsavedChanges,
            isToolDirty: false,
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: null,
            selectionClipboard: null,
          },
        },
      });
      return;
    }

    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: { ...currentLayers, [layer.id]: layer }, activeLayerId: layer.id },
        historyItem: entry,
      },
    });
  };

  const createBlankLayer = (params: BlankImageParams, replaceDocument = false) => {
    const currentLayers = replaceDocument ? {} : commitDirtyTool();

    const source: BlankLayerSource = { kind: 'blank', ...params };
    const newLayer = createLayerSource({ layers: currentLayers, source });

    _addLayer(
      newLayer,
      {
        layerId: newLayer.id,
        actionName: NEW_LAYER_ACTION,
        layerSource: source,
      },
      replaceDocument ? { size: params.size, hasUnsavedChanges: true } : undefined,
      currentLayers
    );
  };

  const createLayerFromBitmap = async (params: FileImageParams, replaceDocument = false) => {
    const currentLayers = replaceDocument ? {} : commitDirtyTool();

    const source: ImageLayerSource = {
      kind: 'image',
      ...params,
      bitmap: await immutableRaster(params.bitmap),
    };
    const newLayer = createLayerSource({ layers: currentLayers, source });

    _addLayer(
      newLayer,
      {
        layerId: newLayer.id,
        actionName: NEW_LAYER_ACTION,
        layerSource: source,
      },
      replaceDocument
        ? {
            size: params.isBedrock ? params.size : { width: params.pos.width, height: params.pos.height },
            hasUnsavedChanges: false,
          }
        : undefined,
      currentLayers
    );
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
      const localPos = sortedRectToPos(args.rect);
      const newPos = canvasToDocumentPos(localPos, documentFrame);
      const worldRect = {
        x1: args.rect.x1 + documentFrame.x,
        y1: args.rect.y1 + documentFrame.y,
        x2: args.rect.x2 + documentFrame.x,
        y2: args.rect.y2 + documentFrame.y,
      };
      const newRect = reduceRect(worldRect, newPos);

      source = { kind: 'tool', ...sourceArgs, args: { ...args, rect: newRect }, pos: newPos };
    } else {
      source = {
        kind: 'tool',
        ...sourceArgs,
        args: { ...args },
        pos: canvasToDocumentPos(pos, documentFrame),
      } as ToolLayerSource; // clone args anyway
    }

    const newLayer = createLayerSource({ layers, source });

    _addLayer(newLayer, {
      layerId: newLayer.id,
      actionName: NEW_LAYER_ACTION,
      layerSource: source,
    });

    clearOverlay();
    return newLayer;
  };

  const updateLayerByTool = async ({ id = activeLayerId, toolArgs }: LayerEditParams) => {
    const toolArgsToolName = (toolArgs as ToolArgs).toolName;
    const processor = toolProcessors[toolArgsToolName];
    if (!id || !layers[id]) return;
    if (processor.commit === 'document-operation') return;

    // Check if tool requires flattening layers
    if (processor.flattenRequired) {
      const mergedLayer = await mergeAllLayers();
      if (!mergedLayer?.bitmap) return;

      const [canvas, positionPatch] = processor.imageProcessor({ bitmap: mergedLayer.bitmap, size: mergedLayer.pos })(
        toolArgs
      );
      const updatedLayer = {
        ...mergedLayer,
        pos: positionPatch ? { ...mergedLayer.pos, ...positionPatch } : mergedLayer.pos,
        tmpCanvas: canvas,
      };
      dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { [mergedLayer.id]: updatedLayer }, activeLayerId: mergedLayer.id },
          historyItem: createHistoryItem({ layerId: mergedLayer.id, actionName: TOOL_ACTION, args: toolArgs }),
        },
      });
      return;
    }

    // should mark layer dirty
    tempUpdateLayer({ id, toolArgs });
    // should pick that dirty later and do all hardening
    const committedLayers = commitDirtyTool(true);
    const committedArgs = normalizeCommittedToolArgs(committedLayers[id] ?? layers[id], toolArgs);
    if (!committedArgs) return;
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: committedLayers },
        historyItem: createHistoryItem({
          layerId: id!,
          actionName: TOOL_ACTION,
          args: committedArgs,
        }),
      },
    });
  };

  // honestly, the only dirty tool that needs saving is text and maybe crop
  const commitDirtyTool = (deferDispatch = false) => {
    // can be run safely if no dirty layer

    // special case
    if (toolName === 'text' /* || toolName === 'crop'*/) {
      const args = currentArgsRef.current as TextToolArgs & ToolArgs;
      if (!args.text || !args.rect) return layers;

      const layer = createLayerFromTool({ args });
      currentArgsRef.current = { ...args, text: '' };
      return { ...layers, [layer.id]: layer };
    }

    const committedLayers = { ...layers } as LayersRecord;
    let hasPreviewLayers = false;

    const pendingToolEdits: Array<{ layerId: LayerId; args: ToolArgs | object }> = [];
    for (const [id, preview] of Object.entries(previewLayersRef.current)) {
      const layer = { ...preview.layer, pos: { ...preview.layer.pos }, operations: [...preview.layer.operations] };
      committedLayers[id] = layer;
      hasPreviewLayers = true;
      if (preview.toolArgs) {
        const committedArgs = normalizeCommittedToolArgs(layer, preview.toolArgs);
        if (committedArgs) pendingToolEdits.push({ layerId: id, args: committedArgs });
      }
      if (layer.tmpCanvas) {
        saveLayerCanvas(layer);
      }
    }
    previewLayersRef.current = {};

    // Find any remaining dirty layer and save a detached copy.
    for (const layer of Object.values(committedLayers)) {
      if (layer.tmpCanvas) {
        const detachedLayer = { ...layer, pos: { ...layer.pos } };
        saveLayerCanvas(detachedLayer);
        committedLayers[layer.id] = detachedLayer;
        hasPreviewLayers = true;
        break;
      }
    }

    if (hasPreviewLayers && !deferDispatch) {
      if (!pendingToolEdits.length) {
        dispatch({ type: 'UPDATE_LAYERS', payload: committedLayers });
      } else {
        for (const [index, pendingEdit] of pendingToolEdits.entries()) {
          dispatch({
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: {
              ...(index === 0 ? { updates: { layers: committedLayers } } : {}),
              historyItem: createHistoryItem({
                layerId: pendingEdit.layerId,
                actionName: TOOL_ACTION,
                args: pendingEdit.args,
              }),
            },
          });
        }
      }
    }
    return committedLayers;
  };

  const removeLayer = (id: LayerId) => {
    const layer = layers[id];
    if (!layer) return;

    const { [id]: removedLayer, ...remainingLayers } = layers;
    const deletedLayer = { ...removedLayer, bitmap: null, tmpCanvas: null };
    delete previewLayersRef.current[id];
    const newDeletedLayers = { ...deletedLayers, [id]: deletedLayer };

    const sorted = getSortedLayersArray(remainingLayers);
    const nextActiveLayerId =
      activeLayerId === id ? (sorted.length > 0 ? sorted[sorted.length - 1].id : null) : activeLayerId;

    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: remainingLayers,
          deletedLayers: newDeletedLayers,
          activeLayerId: nextActiveLayerId,
        },
        historyItem: createHistoryItem({
          layerId: id,
          actionName: REMOVE_ACTION,
          args: {},
        }),
      },
    });

    const ctx = toolOverlayRef.current!.getContext('2d')!;
    ctx.clearRect(0, 0, totalSize.width, totalSize.height);
  };

  const updateLayer = (id: LayerId, patch: Partial<Layer>, actionName: ActionType) => {
    const layer = layers[id];
    if (!layer) return;
    const newLayers = { ...layers, [id]: { ...layer, ...patch } } as LayersRecord;
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: newLayers },
        historyItem: createHistoryItem({
          layerId: id,
          actionName,
          args: patch,
        }),
      },
    });
    drawAllLayers();
  };

  const moveLayerAfter = (layerToMoveId: LayerId, afterWhichLayerId?: LayerId | null) => {
    const reorderedLayers = Object.fromEntries(
      Object.entries(layers).map(([id, layer]) => [id, { ...layer, pos: { ...layer.pos } }])
    ) as LayersRecord;
    reorderLayers({ layers: reorderedLayers, layerToMoveId, afterWhichLayerId });

    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: reorderedLayers },
        historyItem: createHistoryItem({
          layerId: layerToMoveId,
          actionName: REORDER_ACTION,
          args: { layerToMoveId, afterWhichLayerId },
        }),
      },
    });
    drawAllLayers();
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

    const { toolName: toolArgsToolName } = toolArgs;
    const processor = toolProcessors[toolArgsToolName];

    if (isTransformArgs(toolArgs) && toolArgs.trapezoid !== 0) {
      try {
        if (!isTrapezoidOnlyTransform(toolArgs)) return;
      } catch (error) {
        console.error(error);
        return;
      }
    }

    if (isTransformArgs(toolArgs) && toolArgs.trapezoid === 0) {
      try {
        const transform = transformToolArgsToAffine(toolArgs, layer.pos);
        if (!transform) return;
        const previewLayer = {
          ...layer,
          operations: [...layer.operations, createAffineLayerOperation(transform)],
          tmpCanvas: null,
        };
        previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
        drawAllLayers();
        return;
      } catch (error) {
        console.error(error);
        return;
      }
    }

    if (processor.commit === 'layer-operation') {
      const previewLayer = {
        ...layer,
        operations: [...layer.operations, createLayerOperation(toolArgs as LayerOperationArgs)],
        tmpCanvas: null,
      };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return;
    }

    if (processor.commit === 'geometry') {
      const { move, resize } = toolArgs as RepositionToolArgs;
      const positionPatch = resize ?? move;
      if (!positionPatch) return;
      const previewLayer = { ...layer, pos: { ...layer.pos, ...positionPatch }, tmpCanvas: null };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return;
    }

    const bitmap = layer.tmpCanvas ?? layer.bitmap;
    if (!bitmap && !processor.creator) {
      console.error('No active layer or bitmap to update preview');
      return;
    }

    const [canvas, positionPatch] = processor.imageProcessor({ bitmap, size: layer.pos } as
      CreatorToolParams | ProcessorToolParams)(toolArgs);

    const previewLayer = {
      ...layer,
      pos: positionPatch ? { ...layer.pos, ...positionPatch } : { ...layer.pos },
      ...(processor.commit === 'raster' || (isTransformArgs(toolArgs) && toolArgs.trapezoid !== 0)
        ? { source: undefined }
        : {}),
      tmpCanvas: canvas,
    };
    previewLayersRef.current[id] = { layer: previewLayer, toolArgs };

    drawAllLayers();
  }

  function cancelLayerPreview(id = activeLayerId) {
    if (id) delete previewLayersRef.current[id];
    drawAllLayers();
  }

  const drawAllLayers = useCallback(() => {
    if (!canvasRef.current) return;
    resizeCanvas(canvasRef.current, totalSize.width, totalSize.height);
    const ctx = canvasRef.current.getContext('2d')!;

    ctx.clearRect(0, 0, totalSize.width, totalSize.height);

    const renderLayers = Object.keys(previewLayersRef.current).length
      ? ({
          ...layers,
          ...Object.fromEntries(Object.entries(previewLayersRef.current).map(([id, preview]) => [id, preview.layer])),
        } as LayersRecord)
      : layers;
    const sorted = getSortedLayersArray(renderLayers);

    for (const layer of sorted) {
      if (!layer.visible) continue;

      if (!drawLayer(ctx, layer, documentFrame)) {
        console.error('skipped layer without bitmap', layer.id);
      } // todo should not happen, but just in case
    }
  }, [canvasRef, documentFrame, layers, previewLayersRef, totalSize]);

  const applyDocumentCrop = (rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
    const { x, y, width, height } = trimRect(sortRect(rect), totalSize);
    if (width <= 0 || height <= 0) return false;

    const nextFrame = canvasRectToDocumentFrame({ x, y, width, height }, documentFrame);
    if (!isValidDocumentFrame(nextFrame) || documentFrameEquals(documentFrame, nextFrame)) return false;

    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { documentFrame: nextFrame, totalSize: documentFrameSize(nextFrame) },
        historyItem: createHistoryItem({
          layerId: 'document',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          args: { previousFrame: documentFrame, nextFrame },
        }),
      },
    });
    return true;
  };

  async function mergeAllLayers(): Promise<Layer | null> {
    const currentLayers = commitDirtyTool();

    // getBitmap of the canvas
    if (!canvasRef.current) return null;
    const canvasBitmap = await createImageBitmap(canvasRef.current);
    const source = {
      kind: 'image',
      bitmap: canvasBitmap,
      name: 'Merged Layer',
      pos: { x: documentFrame.x, y: documentFrame.y, ...totalSize },
      isBedrock: false,
    } satisfies ImageLayerSource;

    const layer = createLayerSource({
      layers: currentLayers,
      source,
    });

    const newLayers = { [layer.id]: layer } as LayersRecord;
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: newLayers, activeLayerId: layer.id },
        historyItem: createHistoryItem({
          layerId: layer.id,
          actionName: MERGE_ACTION,
          args: source,
        }),
      },
    });
    return layer;
  }

  return {
    createBlankLayer,
    createLayerFromBitmap,
    createLayerFromTool,

    tempUpdateLayer,
    updateLayerByTool,
    commitDirtyTool,
    cancelLayerPreview,

    removeLayer,

    updateLayer,
    setActiveLayer,
    toggleVisibility,
    moveLayerAfter,

    drawAllLayers,
    mergeAllLayers,
    applyDocumentCrop,
  };
};
