import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from './StoreContext.tsx';
import { useSetToolArgs } from './useCurrentTool.tsx';
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
} from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import type { BlankImageParams, FileImageParams, FullArgs, ToolArgs } from './tool-types.ts';
import {
  type CreatorToolParams,
  type ProcessorToolParams,
  type ToolResult,
  toolProcessors,
} from '../tools/toolProcessors.ts';
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
import { planHistoryAppend } from './history-append.ts';
import type { LayerPresentationRequest } from './layer-presentation.ts';
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
      history,
      historyIndex,
      branchRevision = 0,
      currentArgs: currentArgsRef,
      previewLayers: previewLayersRef,
      promoteLayerPresentation,
    },
    dispatch,
  ] = useStore();
  const setToolArgs = useSetToolArgs();
  const documentFrame = currentDocumentFrame ?? documentFrameFromSize(totalSize);

  /**
   * Presentation caches are materialized after the layer is published. The store
   * owns the promotion, so a layer record the caller already dispatched is never
   * mutated from a late async callback. One call per commit keeps the
   * publication to a single store transition.
   */
  const requestPresentations = (candidates: Iterable<Layer>) => {
    const requests: LayerPresentationRequest[] = [];
    for (const layer of candidates) {
      if (layer.tmpCanvas) requests.push({ layerId: layer.id, canvas: layer.tmpCanvas });
    }
    if (requests.length) promoteLayerPresentation(requests);
  };
  const requestPresentation = (layer: Layer) => requestPresentations([layer]);

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
      requestPresentation(layer);
      return;
    }

    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: { ...currentLayers, [layer.id]: layer }, activeLayerId: layer.id },
        historyItem: entry,
      },
    });
    requestPresentation(layer);
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

    // `_addLayer` publishes the layer and requests its presentation cache.
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

      // No shipped processor sets `flattenRequired`, but the flag is part of the
      // processor contract and this branch runs it, so it gets the same guard as the
      // `imageProcessor` call in `tempUpdateLayer` rather than trusting the current
      // registry to stay exception-free.
      let result: ToolResult;
      try {
        result = processor.imageProcessor({ bitmap: mergedLayer.bitmap, size: mergedLayer.pos })(toolArgs);
      } catch (error) {
        console.error(error);
        return;
      }
      const [canvas, positionPatch] = result;
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
      requestPresentation(updatedLayer);
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
  const commitDirtyTool = (deferDispatch = false): LayersRecord => {
    // can be run safely if no dirty layer

    // special case
    if (toolName === 'text' /* || toolName === 'crop'*/) {
      const args = currentArgsRef.current as TextToolArgs & ToolArgs;
      if (!args.text || !args.rect) return layers;

      const layer = createLayerFromTool({ args });
      const cleared = { ...args, text: '', rect: null };
      if (setToolArgs) {
        setToolArgs(cleared);
      } else {
        currentArgsRef.current = cleared;
      }
      return { ...layers, [layer.id]: layer };
    }

    const committedLayers = { ...layers } as LayersRecord;
    let hasPreviewLayers = false;
    // Keyed by layer id so the record that is actually published is the one that
    // asks for a cache promotion.
    const pendingPresentations = new Map<LayerId, Layer>();

    const pendingToolEdits: Array<{ layerId: LayerId; args: ToolArgs | object }> = [];
    for (const [id, preview] of Object.entries(previewLayersRef.current)) {
      const layer = { ...preview.layer, pos: { ...preview.layer.pos }, operations: [...preview.layer.operations] };
      committedLayers[id] = layer;
      hasPreviewLayers = true;
      if (preview.toolArgs) {
        const committedArgs = normalizeCommittedToolArgs(layer, preview.toolArgs);
        if (committedArgs) pendingToolEdits.push({ layerId: id, args: committedArgs });
      }
      if (layer.tmpCanvas) pendingPresentations.set(id, layer);
    }
    previewLayersRef.current = {};

    // Find any remaining dirty layer and save a detached copy.
    for (const layer of Object.values(committedLayers)) {
      if (layer.tmpCanvas) {
        const detachedLayer = { ...layer, pos: { ...layer.pos } };
        pendingPresentations.set(detachedLayer.id, detachedLayer);
        committedLayers[layer.id] = detachedLayer;
        hasPreviewLayers = true;
        break;
      }
    }

    if (hasPreviewLayers && !deferDispatch) {
      if (!pendingToolEdits.length) {
        // No logical change to record: publish the already-known layer records so
        // their promoted cache can land through the presentation boundary.
        dispatch({ type: 'PUBLISH_RUNTIME_PRESENTATION', payload: { layers: committedLayers } });
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
    // Promotion is requested after publication. A deferred caller publishes the
    // same records in this tick, and the store re-checks the canvas identity
    // before a promotion can reach a layer.
    requestPresentations(pendingPresentations.values());
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

    clearOverlay();
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

    // This is the call every live pointer move reaches, so it is the one that has to be
    // guarded. A trapezoid-only transform satisfies `commit: 'affine-operation'`, so it
    // falls past both early returns above and lands here, and `transform` throws for
    // several argument shapes (`src/tools/transform.ts`: a non-finite or over-tapered
    // trapezoid, a non-invertible homography, degenerate affine bounds). Without the
    // guard the throw escapes `tempUpdateLayer` into a React event handler.
    let result: ToolResult;
    try {
      result = processor.imageProcessor({ bitmap, size: layer.pos } as CreatorToolParams | ProcessorToolParams)(
        toolArgs
      );
    } catch (error) {
      console.error(error);
      return;
    }

    const [canvas, positionPatch] = result;

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

    const renderLayers = Object.keys(previewLayersRef.current).length
      ? ({
          ...layers,
          ...Object.fromEntries(Object.entries(previewLayersRef.current).map(([id, preview]) => [id, preview.layer])),
        } as LayersRecord)
      : layers;
    const sorted = getSortedLayersArray(renderLayers);
    drawLayersToCanvas(canvasRef.current, sorted, documentFrame);
  }, [canvasRef, documentFrame, layers, previewLayersRef]);

  const applyDocumentCrop = (rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
    const { x, y, width, height } = trimRect(sortRect(rect), totalSize);
    if (width <= 0 || height <= 0) return false;

    const nextFrame = canvasRectToDocumentFrame({ x, y, width, height }, documentFrame);
    if (!isValidDocumentFrame(nextFrame) || documentFrameEquals(documentFrame, nextFrame)) return false;

    // Document-frame changes are the first appends planned through the Phase 1
    // boundary. The planned durable entry is not published yet: the store still
    // rebuilds its diagnostic shadow from the legacy timeline, and that shadow is
    // the only durable signal the UI reports, so the plan's own diagnostics are
    // deliberately not surfaced here.
    const { entry, durableEntry } = planHistoryAppend({
      item: {
        layerId: 'document',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: { previousFrame: documentFrame, nextFrame },
      },
      timeline: { entries: history, cursor: historyIndex, branchRevision },
      currentFrame: documentFrame,
    });
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { documentFrame: nextFrame, totalSize: documentFrameSize(nextFrame) },
        historyItem: entry,
        durableEntry,
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
