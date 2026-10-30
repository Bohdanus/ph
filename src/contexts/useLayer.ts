import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from './StoreContext.tsx';
import type { BitmapSource } from './general-types.ts';
import { useSetToolArgs } from './set-tool-args.ts';
import {
  isLayerBlendMode,
  type BlankLayerSource,
  type ImageLayerSource,
  type Layer,
  type LayerId,
  type LayerOperationArgs,
  type LayersRecord,
  type ToolLayerSource,
} from './layer-types.ts';
import {
  createLayerOperation,
  createAffineLayerOperation,
  createLayerSource,
  getSortedLayersArray,
} from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.ts';
import { assertWithinDocumentPixelBudget } from './raster-utils.ts';

import type { BlankImageParams, FileImageParams, FullArgs, ToolArgs, ToolName } from './tool-types.ts';
import {
  type CreatorToolParams,
  findToolProcessor,
  type ProcessorToolParams,
  type ToolResult,
} from '../tools/toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import { calculateNewRect, reduceRect, sortRect, sortRoundRect, sortedRectToPos } from '../util/rect.ts';
import type { Optional } from '../util/type-utils.ts';
import { isTextToolArgs } from '../util/typeGuards.ts';
import { isValidTextLayerGeometry } from './text-layer-edit.ts';
import { selectionPointPathsToContours } from '../util/selection.ts';
import {
  type ActionType,
  HIDE_LAYER_ACTION,
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  UNLOCK_LAYER_ACTION,
} from '../util/constants.ts';
import { clearTextDraftArgs, type TextToolArgs } from '../tools/text.ts';
import { normalizeColorsToolArgs } from '../tools/colors.ts';
import { normalizeLevelsToolArgs } from '../tools/levels.ts';
import { canvasRectToLocal } from '../util/rect.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { EraserToolArgs } from '../tools/eraser.ts';
import type { DodgeBurnToolArgs } from '../tools/dodgeBurn.ts';
import type { SpongeToolArgs } from '../tools/sponge.ts';
import type { NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';
import { planHistoryAppend } from './history-append.ts';
import { derivedLayerPropertyPatch, isSetLayerPropertiesAction } from './history-adapter.ts';
import type { LayerPresentationRequest } from './layer-presentation.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  operationsRetainedAfterBake,
  stageProcessorInputForTool,
} from './presentation-evaluator.ts';
import {
  canvasRectToDocumentFrame,
  canvasToDocumentPos,
  documentFrameEquals,
  documentFrameFromSize,
  documentFrameSize,
  isValidDocumentFrame,
} from './document-frame.ts';
import {
  documentAffineToLayerLocal,
  isIdentityAffineTransform,
  isTrapezoidOnlyTransform,
  normalizeTransformHistoryArgs,
  rotationAffineAroundPoint,
  rasterizeBounds,
  transformToolArgsToAffine,
  validateAffineTransform,
} from './affine-transform.ts';

export type LayerEditParams = {
  id?: LayerId | null;
  toolArgs: ToolArgs;
};

function createPresentationCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(safeWidth, safeHeight);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    return canvas;
  }
  throw new Error('No canvas implementation is available for a document transform');
}

function transformLayerForDocument(
  layer: Layer,
  transform: ReturnType<typeof rotationAffineAroundPoint>,
  operationId: string
): Layer {
  const layerTransform = validateAffineTransform(documentAffineToLayerLocal(transform, layer.pos), {
    width: layer.pos.width,
    height: layer.pos.height,
  });
  const operations = [...layer.operations, createAffineLayerOperation(layerTransform, operationId)];
  if (!layer.tmpCanvas) {
    return { ...layer, operations, tmpCanvas: null, presentationBounds: null };
  }

  const position = layer.presentationBounds ?? layer.pos;
  const sourceSize = { width: layer.tmpCanvas.width, height: layer.tmpCanvas.height };
  const cacheTransform = validateAffineTransform(documentAffineToLayerLocal(transform, position), sourceSize);
  const evaluation = evaluatePresentation({
    position,
    sourceSize,
    operations: [createAffineLayerOperation(cacheTransform, operationId)],
  });
  const rasterSize = rasterizeBounds(evaluation.localBounds);
  const canvas = createPresentationCanvas(rasterSize.width, rasterSize.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create a canvas context for a document transform');
  drawEvaluatedPresentation(context, layer.tmpCanvas, evaluation, { kind: 'bounds' });
  return { ...layer, operations, tmpCanvas: canvas, presentationBounds: evaluation.bounds };
}

type EditableToolLayerSource = {
  kind: 'tool';
  args: ToolArgs;
  pos: Layer['pos'];
  isBedrock?: false;
};

/**
 * Extend only a stroked draw path or block-stamp path from the previous preview.
 *
 * A stroked segment needs the previous endpoint as its first point to stay connected;
 * a block stamp deposits an independent square at each point, so re-stamping the shared
 * endpoint would double-deposit it. Stroked paths therefore keep the shared endpoint
 * in the delta, while block-stamp paths return only the newly added points.
 *
 * A spray stroke keeps the full-raster fallback: each point carries a time-tagged dab
 * and the delta contract does not generalise to it.
 */
export const getIncrementalStrokeArgs = (toolArgs: ToolArgs, previousToolArgs?: ToolArgs): DrawToolArgs | null => {
  if (toolArgs.toolName !== 'draw' || !previousToolArgs || previousToolArgs.toolName !== 'draw') return null;

  const drawArgs = toolArgs as DrawToolArgs;
  const previousDrawArgs = previousToolArgs as DrawToolArgs;
  if (drawArgs.penType === 'spray') return null;
  if (previousDrawArgs.penType !== drawArgs.penType || previousDrawArgs.blockStamp !== drawArgs.blockStamp) return null;

  const currentPoints = drawArgs.points;
  const previousPoints = previousDrawArgs.points;
  if (
    !currentPoints ||
    !previousPoints ||
    previousPoints.length === 0 ||
    currentPoints.length <= previousPoints.length
  ) {
    return null;
  }
  if (
    !previousPoints.every((point, index) => point.x === currentPoints[index]?.x && point.y === currentPoints[index]?.y)
  ) {
    return null;
  }

  // Block stamps deposit an independent square at every point, so re-stamping the shared
  // endpoint would double-deposit it: return only the newly added points. A stroked segment
  // needs the previous endpoint as its first point to remain connected.
  const deltaStart = drawArgs.blockStamp ? previousPoints.length : previousPoints.length - 1;
  return { ...drawArgs, points: currentPoints.slice(deltaStart) };
};

/**
 * Extend only an eraser brush-mode stroke from the previous preview.
 *
 * Incremental is allowed ONLY when:
 * - Both current and previous are eraser brush-mode (not pencil, not block)
 * - All raster-affecting settings are identical (lineWidth, alpha, hardness, spacing, color)
 * - Previous points are an exact prefix of current points
 * The shared endpoint is preserved so brush spacing/falloff remains continuous.
 * Any mismatch falls back to full processing.
 */
export const getIncrementalEraserArgs = (toolArgs: ToolArgs, previousToolArgs?: ToolArgs): EraserToolArgs | null => {
  if (toolArgs.toolName !== 'eraser' || !previousToolArgs || previousToolArgs.toolName !== 'eraser') return null;

  const current = toolArgs as EraserToolArgs;
  const previous = previousToolArgs as EraserToolArgs;

  // Only brush mode supports incremental
  if (current.mode !== 'brush' || previous.mode !== 'brush') return null;

  // All raster-affecting settings must be identical
  if (
    current.lineWidth !== previous.lineWidth ||
    current.alpha !== previous.alpha ||
    current.hardness !== previous.hardness ||
    current.spacing !== previous.spacing ||
    current.color !== previous.color
  ) {
    return null;
  }

  const currentSelection = current.selection;
  const previousSelection = previous.selection;
  if ((currentSelection === undefined) !== (previousSelection === undefined)) return null;
  if (currentSelection && previousSelection) {
    const currentContours = selectionPointPathsToContours(currentSelection.points);
    const previousContours = selectionPointPathsToContours(previousSelection.points);
    const currentMask = currentSelection.rasterMask;
    const previousMask = previousSelection.rasterMask;
    if (
      currentSelection.featherRadius !== previousSelection.featherRadius ||
      currentSelection.antiAlias !== previousSelection.antiAlias ||
      (currentMask === undefined) !== (previousMask === undefined) ||
      (currentMask !== undefined &&
        previousMask !== undefined &&
        (currentMask.x !== previousMask.x ||
          currentMask.y !== previousMask.y ||
          currentMask.width !== previousMask.width ||
          currentMask.height !== previousMask.height ||
          currentMask.data !== previousMask.data)) ||
      currentContours.length !== previousContours.length ||
      !currentContours.every(
        (contour, contourIndex) =>
          contour.length === previousContours[contourIndex]?.length &&
          contour.every(
            (point, pointIndex) =>
              point.x === previousContours[contourIndex]?.[pointIndex]?.x &&
              point.y === previousContours[contourIndex]?.[pointIndex]?.y
          )
      )
    ) {
      return null;
    }
  }

  const currentPoints = current.points;
  const previousPoints = previous.points;
  if (
    !currentPoints ||
    !previousPoints ||
    previousPoints.length === 0 ||
    currentPoints.length <= previousPoints.length
  ) {
    return null;
  }
  if (
    !previousPoints.every((point, index) => point.x === currentPoints[index]?.x && point.y === currentPoints[index]?.y)
  ) {
    return null;
  }

  // Preserve the shared endpoint (previousPoints.length - 1) so spacing/falloff is continuous
  return { ...current, points: currentPoints.slice(previousPoints.length - 1) };
};

function isTransformArgs(args: ToolArgs): args is TransformToolArgs {
  return args.toolName === 'transform';
}

function normalizeToolArgs(args: ToolArgs): ToolArgs {
  if (args.toolName === 'color') return normalizeColorsToolArgs(args);
  if (args.toolName === 'levels') return normalizeLevelsToolArgs(args);
  return args;
}

function normalizeCommittedToolArgs(layer: Layer, args: ToolArgs): ToolArgs | object | null {
  args = normalizeToolArgs(args);
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

/**
 * The refusal as a value, so a caller decides what to do with it rather than unwinding through
 * `requireCanvasFilter` itself: `tempUpdateLayer` runs on every pointer move, where a throw would
 * escape into a React event handler.
 */
function canvasFilterRefusal(candidateToolName: ToolName): Error | null {
  if (!findToolProcessor(candidateToolName)?.requiresCanvasFilter) return null;
  try {
    requireCanvasFilter(candidateToolName);
    return null;
  } catch (error) {
    return error as Error;
  }
}

/**
 * Whether a layer's own protection forbids a tool writing to it.
 *
 * PSD import maps protection flags to `locked` and export maps it back to composite + position
 * protection. Tool and layer-property mutation entry points consult this predicate so they share
 * one lock policy.
 *
 * `=== true` rather than a truthiness test, so a future flag-shaped value is a compile error
 * rather than a layer that silently locks itself.
 */
const isLayerLocked = (layer: Layer): boolean => layer.locked === true;

/**
 * Returns the appended Dodge/Burn args only when tool name, exposure, range, size, hardness, and
 * the exact point prefix are unchanged. The shared endpoint is preserved to maintain continuity.
 */
function getIncrementalDodgeBurnArgs(prevArgs: ToolArgs | undefined, currArgs: ToolArgs): DodgeBurnToolArgs | null {
  if (!prevArgs || prevArgs.toolName !== currArgs.toolName) return null;
  if (!isDodgeBurnToolArgs(prevArgs) || !isDodgeBurnToolArgs(currArgs)) return null;

  const prev = prevArgs as DodgeBurnToolArgs;
  const curr = currArgs as DodgeBurnToolArgs;

  if (prev.exposure !== curr.exposure) return null;
  if (prev.range !== curr.range) return null;
  if (prev.size !== curr.size) return null;
  if (prev.hardness !== curr.hardness) return null;

  const prevPoints = prev.points;
  const currPoints = curr.points;

  if (!Array.isArray(prevPoints) || !Array.isArray(currPoints)) return null;
  if (prevPoints.length === 0) return null;

  // Current points must start with the previous points as a prefix
  if (currPoints.length <= prevPoints.length) return null;

  // Check exact point prefix match
  for (let i = 0; i < prevPoints.length; i++) {
    const pp = prevPoints[i];
    const cp = currPoints[i];
    if (pp.x !== cp.x || pp.y !== cp.y) return null;
  }

  // Preserve shared endpoint: last point of prev === first new point of curr
  // This is already enforced by the prefix check above since the prefix includes the last point

  return { ...curr, points: currPoints.slice(prevPoints.length - 1) };
}

function isDodgeBurnToolArgs(args: ToolArgs): args is DodgeBurnToolArgs {
  return args.toolName === 'dodge' || args.toolName === 'burn';
}

/**
 * Returns the appended Sponge args only when tool name, mode, flow, vibrance, size, hardness, and
 * the exact point prefix are unchanged. The shared endpoint is preserved to maintain continuity.
 */
function getIncrementalSpongeArgs(prevArgs: ToolArgs | undefined, currArgs: ToolArgs): SpongeToolArgs | null {
  if (!prevArgs || prevArgs.toolName !== currArgs.toolName) return null;
  if (currArgs.toolName !== 'sponge') return null;

  const prev = prevArgs as SpongeToolArgs;
  const curr = currArgs as SpongeToolArgs;

  if (prev.mode !== curr.mode) return null;
  if (prev.flow !== curr.flow) return null;
  if (prev.vibrance !== curr.vibrance) return null;
  if (prev.size !== curr.size) return null;
  if (prev.hardness !== curr.hardness) return null;

  const prevPoints = prev.points;
  const currPoints = curr.points;

  if (!Array.isArray(prevPoints) || !Array.isArray(currPoints)) return null;
  if (prevPoints.length === 0) return null;

  // Current points must start with the previous points as a prefix
  if (currPoints.length <= prevPoints.length) return null;

  // Check exact point prefix match
  for (let i = 0; i < prevPoints.length; i++) {
    const pp = prevPoints[i];
    const cp = currPoints[i];
    if (pp.x !== cp.x || pp.y !== cp.y) return null;
  }

  // Preserve shared endpoint: last point of prev === first new point of curr
  // This is already enforced by the prefix check above since the prefix includes the last point

  return { ...curr, points: currPoints.slice(prevPoints.length - 1) };
}

// A frame allocates SIX surfaces at its own size — the staging canvas `drawLayersToCanvas`
// composites into (`layer-renderer.ts:195`), the visible canvas it resizes to (`:238`), the
// snapshot it restores from (`:136`, `:236`), and the tool, rect and selection-ant overlays
// (`Main.tsx:142,169,177`) — so the ceiling that matters is the LOWEST any target browser
// imposes, not the highest. That is 2^24, iOS Safari's maximum canvas AREA, and it fails
// SILENTLY there: `getContext('2d')` still returns a context and every draw becomes a no-op, so
// an over-area document renders blank with nothing to catch. This app ships mobile surfaces.
// At 4 bytes per RGBA pixel 2^24 is 64MiB per surface and 384MiB for the six; Chrome's 2^28
// would have been 1GiB each, 6GiB for one commit.
//
// SIDE is sqrt(AREA) rather than a browser constant, because an area ceiling bounds how many
// PIXELS a surface holds and says nothing about its longest edge, and a crop rect can be dragged
// arbitrarily far past an edge at low zoom. Since 4096 * 4096 IS the area ceiling, SIDE subsumes
// AREA: the area arm can never refuse what the side arm would not. It is kept as the statement
// of the budget and the arm that names the pixel count in the warning.
//
// Crop-local, and NOT a document-size limit: nothing else in the stack caps a frame, so a PSD
// open or a canvas resize bypasses both ceilings here entirely.
export const MAX_DOCUMENT_FRAME_SIDE = 4096;
export const MAX_DOCUMENT_FRAME_AREA = 16777216;

export type ArrangeLayerCommand = 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back';

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
      documentId,
      documentRevision,
      durablePresentation,
      durableRenderProjection,
      renderSelector,
      currentArgs: currentArgsRef,
      previewLayers: previewLayersRef,
      promoteLayerPresentation,
      publishRuntimePresentation,
      adoptLayerBitmaps: storeAdoptLayerBitmaps,
    },
    dispatch,
  ] = useStore();

  const setToolArgs = useSetToolArgs();
  const documentFrame = currentDocumentFrame ?? documentFrameFromSize(totalSize);
  const dpr = useDevicePixelRatio();

  /**
   * Hands adopted rasters to the presentation scope. It has to run *after* the
   * action that published them: the scope is keyed by the document that owns the
   * bitmap, so an import registered before its `REPLACE_DOCUMENT` would be filed
   * under the outgoing document id and closed by that document's release.
   */
  const adoptLayerBitmaps = (bitmaps: readonly BitmapSource[]) => {
    const distinct = [...new Set(bitmaps)];
    if (!distinct.length) return;
    storeAdoptLayerBitmaps(distinct);
  };

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
    newDocument?: {
      size: { width: number; height: number };
      hasUnsavedChanges: boolean;
      fileName: string;
    },
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
            fileName: newDocument.fileName,
            hasImage: true,
            hasUnsavedChanges: newDocument.hasUnsavedChanges,
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
    if ('size' in params && params.size.width > 0 && params.size.height > 0) {
      assertWithinDocumentPixelBudget(params.size, 'Document');
    }
    const currentLayers = replaceDocument ? {} : commitDirtyTool();
    if (currentLayers === null) return;

    const source: BlankLayerSource = { kind: 'blank', ...params };
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
            size: 'size' in params ? params.size : { width: params.pos.width, height: params.pos.height },
            hasUnsavedChanges: true,
            fileName: '',
          }
        : undefined,
      currentLayers
    );
  };

  const createLayerFromBitmap = async (
    params: FileImageParams,
    replaceDocument = false,
    isCurrentRequest?: () => boolean
  ) => {
    const currentLayers = replaceDocument ? {} : commitDirtyTool();
    if (currentLayers === null) return false;

    const ownsMaterializedBitmap = typeof (params.bitmap as { close?: unknown }).close !== 'function';
    const bitmap = await immutableRaster(params.bitmap);
    if (isCurrentRequest && !isCurrentRequest()) {
      if (ownsMaterializedBitmap) (bitmap as ImageBitmap).close();
      return false;
    }
    const source: ImageLayerSource = {
      kind: 'image',
      ...params,
      bitmap,
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
            fileName: params.name ?? '',
          }
        : undefined,
      currentLayers
    );
    // One registration covers all three aliases the raster now has: `layer.bitmap`,
    // `layer.source.bitmap` (the `source` object is stored verbatim on the layer) and
    // the live history entry's `layerSource.bitmap`. They are the same object, and
    // `trackPublished` keys on a `Set`.
    adoptLayerBitmaps([source.bitmap]);
    return true;
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
      const rect = sortRect(args.rect);
      const localPos = sortedRectToPos(rect);
      const newPos = canvasToDocumentPos(localPos, documentFrame);
      const worldRect = {
        x1: rect.x1 + documentFrame.x,
        y1: rect.y1 + documentFrame.y,
        x2: rect.x2 + documentFrame.x,
        y2: rect.y2 + documentFrame.y,
      };
      const newRect = reduceRect(worldRect, newPos);

      source = { kind: 'tool', ...sourceArgs, args: { ...args, rect: newRect }, pos: newPos };
    } else {
      // Shape and draw callers derive `pos` from document-space points. The
      // no-pos branch above is the only path that converts canvas geometry;
      // subtracting the frame here would move a cropped layer twice.
      source = {
        kind: 'tool',
        ...sourceArgs,
        args: { ...args },
        pos: { ...pos },
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

  const replaceLayerSource = (id: LayerId, source: EditableToolLayerSource): Layer | null => {
    const layer = layers[id];
    if (!layer || source.kind !== 'tool') return null;
    if (isLayerLocked(layer)) return null;
    const nextSource = { ...source, args: { ...source.args }, pos: { ...source.pos } };
    const currentArgs = layer.source?.kind === 'tool' ? layer.source.args : null;
    const nextArgs = nextSource.args as ToolArgs & { editingLayerId?: unknown };
    if (
      currentArgs &&
      JSON.stringify({ ...currentArgs, editingLayerId: undefined }) ===
        JSON.stringify({ ...nextArgs, editingLayerId: undefined }) &&
      layer.pos.x === nextSource.pos.x &&
      layer.pos.y === nextSource.pos.y
    ) {
      delete previewLayersRef.current[id];
      drawAllLayers();
      return layer;
    }
    // Render the replacement before recording it so the live layer's source and raster advance
    // together; otherwise the canvas, export, or merge could retain the previous text pixels.
    let rebuilt: Layer;
    try {
      rebuilt = createLayerSource({ layerId: id, layers, source: nextSource });
    } catch (error) {
      console.error('Unable to render a replacement layer source', error);
      return null;
    }
    delete previewLayersRef.current[id];
    const nextLayer: Layer = {
      ...layer,
      name: rebuilt.name,
      source: rebuilt.source,
      pos: { ...rebuilt.pos },
      bitmap: rebuilt.bitmap,
      tmpCanvas: rebuilt.tmpCanvas,
      presentationBounds: null,
    };
    const item = {
      layerId: id,
      actionName: REPLACE_LAYER_SOURCE_ACTION,
      args: { source: nextLayer.source },
    } as const;
    let planned: ReturnType<typeof planHistoryAppend> | undefined;
    try {
      planned = planHistoryAppend({
        item,
        timeline: { entries: history, cursor: historyIndex, branchRevision },
        currentFrame: documentFrame,
        currentLayer: layer,
      });
    } catch (error) {
      console.error('Unable to plan durable history for a layer source edit', error);
    }
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: { ...layers, [id]: nextLayer } },
        historyItem: planned?.entry ?? createHistoryItem(item),
        durableEntry: planned?.durableEntry,
        ...(planned ? { durableDiagnostics: planned.diagnostics } : {}),
      },
    });
    return nextLayer;
  };

  const updateLayerByTool = async ({ id = activeLayerId, toolArgs: inputToolArgs }: LayerEditParams) => {
    const toolArgs = normalizeToolArgs(inputToolArgs);
    const toolArgsToolName = toolArgs.toolName;
    const processor = findToolProcessor(toolArgsToolName);
    // Statically enforced, not by convention: a tool with no processor (`PIXEL_FREE_TOOLS`) has no
    // pixel operation, so it is not reachable through this path at all.
    if (!processor) return;
    if (!id || !layers[id]) return;
    // Before `tempUpdateLayer`, not only inside it: this is the function that appends the
    // `TOOL_ACTION` history entry, so a locked layer refused only at the pixel write would still
    // get a history state with no pixel change behind it. Undo would then restore nothing, look
    // broken, and leave the user with a state they cannot reason about.
    if (isLayerLocked(layers[id])) return;
    if (processor.commit === 'document-operation') return;

    // Same reason as the lock above, and checked here for the same reason: `updateLayerByTool` is
    // the function that appends the `TOOL_ACTION` history entry, so a tool refused only at the
    // pixel write would still get a history state with no pixel change behind it.
    const refusal = canvasFilterRefusal(toolArgsToolName);
    if (refusal) {
      console.error(refusal);
      return;
    }

    // Whole-document merging is not a transparent step inside a tool, and there is
    // no processor flag that asks for one: `mergeAllLayers` below is reached by the
    // user pressing `Merge all` in `ToolbarsRight/Move/Reposition.tsx` or
    // `ToolbarsRight/Colors/Color.tsx`, and a tool that genuinely needs the
    // flattened raster calls it explicitly. What was removed here was a branch that
    // only two tests could reach, by mutating the `toolProcessors` record at
    // runtime — a branch nothing verified.

    // should mark layer dirty
    if (!tempUpdateLayer({ id, toolArgs })) return;
    // should pick that dirty later and do all hardening. `id` is the ownership scope: this
    // function records ONE `TOOL_ACTION` entry, for ONE layer, so no other layer's pixels may
    // ride out in the record it is about to publish.
    //
    // That scope is safe for the whole window because NOTHING between `tempUpdateLayer` and the
    // dispatch below awaits. This function is `async`, but the window is straight-line — no
    // `await`, no promise — so it runs to completion inside the tick the pixel write happened in.
    // No removal, no second document and no other commit can be dispatched into the store in
    // between, so the `layers` this scope was chosen from is the same record `commitDirtyTool`
    // reads, and the layer it publishes is the layer whose pixels were written.
    const committedLayers = commitDirtyTool(true, id);
    if (committedLayers === null) return;
    const committedArgs = normalizeCommittedToolArgs(committedLayers[id] ?? layers[id], toolArgs);
    if (!committedArgs) return;
    const item = { layerId: id, actionName: TOOL_ACTION, args: committedArgs } as const;
    let planned: ReturnType<typeof planHistoryAppend> | undefined;
    try {
      planned = planHistoryAppend({
        item,
        timeline: { entries: history, cursor: historyIndex, branchRevision },
        currentFrame: documentFrame,
        // The closure's layer can be stale after a pointer move. The committed
        // record is the one the store is about to publish and the one affine
        // validation must grade.
        currentLayer: committedLayers[id],
      });
    } catch (error) {
      console.error('Unable to plan durable history for a tool commit', error);
    }
    // The scope re-validated here, so it is never published out of a record this function can see
    // has lost the layer. A TRIPWIRE rather than the protection the window above claims: `layers` is
    // the snapshot this invocation destructured at its last render, and a resumed continuation keeps
    // that snapshot, so an `await` in the window would hide a removal from this check as surely as
    // from the guards above. `useLayers` reading live store state instead is what would make it
    // load-bearing; until then it costs one lookup and breaks nothing.
    if (!layers[id]) return;
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: committedLayers },
        historyItem: planned?.entry ?? createHistoryItem(item),
        durableEntry: planned?.durableEntry,
        ...(planned ? { durableDiagnostics: planned.diagnostics } : {}),
      },
    });
  };

  // honestly, the only dirty tool that needs saving is text and maybe crop
  /**
   * `ownedLayerId` is the ownership scope, and `undefined` is "every preview the map holds".
   * It is `LayerId | undefined` and not `LayerId | null | undefined` so an absent scope has ONE
   * spelling: the type can no longer be read as "null means unscoped", which would be a second
   * way to say the same thing that a call site could use by accident. The one scoped caller
   * narrows its id to `LayerId` before it gets here (`updateLayerByTool` returns above unless
   * `id` is truthy), so nothing has to pass `null`.
   *
   * The tool switch, the merge, the new-document and the export paths own no single layer and
   * must land all of them, which is what an unscoped call means. A caller committing ONE layer's
   * edit — only `updateLayerByTool` does, and it appends exactly one `TOOL_ACTION` entry for
   * exactly one layer — names that layer instead. Folding the rest of the preview map into the
   * record it publishes would put another layer's draft pixels into committed state that no
   * history entry reproduces, and clearing that preview would make them unrecoverable: a later
   * navigation clears the drafts and rebuilds every layer from the timeline, which names no
   * change to the layer whose pixels were published. So a scoped call leaves every preview and
   * every dirty cache it does not own exactly where it found them.
   */
  const commitDirtyTool = (deferDispatch = false, ownedLayerId?: LayerId): LayersRecord | null => {
    // can be run safely if no dirty layer

    // special case
    if (toolName === 'text' /* || toolName === 'crop'*/) {
      const args = currentArgsRef.current as TextToolArgs & ToolArgs;
      // Successful sources capture angle before their clear path. Angle is per-layer geometry;
      // character formatting remains reusable for the next text draft.
      // An empty existing edit is a source replacement, not a new empty layer. Keep its original
      // geometry and position so deleting all characters does not shrink the raster origin.
      if (!args.text && args.rect && args.editingLayerId) {
        const activeLayer = layers[args.editingLayerId];
        const activeTextArgs =
          activeLayer?.source?.kind === 'tool' && isTextToolArgs(activeLayer.source.args)
            ? activeLayer.source.args
            : null;
        const originalRect = activeTextArgs?.rect;
        const originalPos = activeLayer?.pos;
        if (!activeLayer || !activeTextArgs || !originalPos || !isValidTextLayerGeometry(originalRect, originalPos)) {
          return null;
        }

        const replacementArgs = { ...args, text: '', rect: originalRect, placeholderUntouched: false };
        delete replacementArgs.editingLayerId;
        const replaced = replaceLayerSource(activeLayer.id, {
          kind: 'tool',
          args: replacementArgs,
          pos: { ...originalPos },
        });
        if (!replaced) return null;

        const { editingLayerId: _editingLayerId, ...persistedArgs } = args;
        const cleared = clearTextDraftArgs(persistedArgs);
        if (setToolArgs) setToolArgs(cleared);
        else currentArgsRef.current = cleared;
        clearOverlay();
        return { ...layers, [activeLayer.id]: replaced };
      }

      // An emptied new draft has no source to replace. Close it on implicit commit rather than
      // leaving an editor open that cannot create a valid raster.
      if (!args.text && args.rect) {
        const { editingLayerId: _editingLayerId, ...persistedArgs } = args;
        const closed = clearTextDraftArgs(persistedArgs);
        if (args.editingLayerId) cancelLayerPreview(args.editingLayerId);
        if (setToolArgs) setToolArgs(closed);
        else currentArgsRef.current = closed;
        clearOverlay();
        return layers;
      }
      if (!args.text || !args.rect) return layers;
      // An UNTOUCHED placeholder is discarded, not committed. This is the implicit path — a tool
      // switch, or a click elsewhere on the canvas — and a box the user never typed into is not a
      // layer: clicking with the Type tool and then clicking away in Photoshop leaves the document
      // unchanged, and the placeholder is a preview of the font rather than content. The explicit
      // Commit button deliberately still commits it, because there the user has said "take this".
      // The flag is the whole of the test: a string comparison would discard real content that
      // happens to be those words, which is the defect the flag replaced.
      if (args.placeholderUntouched === true) {
        const { editingLayerId: _editingLayerId, ...persistedArgs } = args;
        const discarded = clearTextDraftArgs(persistedArgs);
        if (args.editingLayerId) cancelLayerPreview(args.editingLayerId);
        if (setToolArgs) setToolArgs(discarded);
        else currentArgsRef.current = discarded;
        clearOverlay();
        return layers;
      }

      const requestedLayerId = (args as TextToolArgs).editingLayerId;
      const activeLayer = requestedLayerId
        ? layers[requestedLayerId]
        : activeLayerId
          ? layers[activeLayerId]
          : undefined;
      if (
        requestedLayerId &&
        (!activeLayer || activeLayer.source?.kind !== 'tool' || activeLayer.source.args.toolName !== 'text')
      ) {
        const cleared = clearTextDraftArgs(args);
        delete cleared.editingLayerId;
        cancelLayerPreview(requestedLayerId);
        if (setToolArgs) setToolArgs(cleared);
        else currentArgsRef.current = cleared;
        clearOverlay();
        return layers;
      }
      if (activeLayer?.source?.kind === 'tool' && activeLayer.source.args.toolName === 'text') {
        const measuredRect = calculateNewRect(args, canvasRef, totalSize) ?? args.rect;
        const pos = canvasToDocumentPos(sortedRectToPos(sortRect(measuredRect)), documentFrame);
        // A new drag on a different origin creates a new text layer. Selection hydration
        // preserves the active layer's origin, which is the explicit in-place-edit signal.
        if (requestedLayerId || (pos.x === activeLayer.pos.x && pos.y === activeLayer.pos.y)) {
          const replacementArgs = { ...args };
          delete replacementArgs.editingLayerId;
          const source: ToolLayerSource = {
            kind: 'tool',
            // Layer-LOCAL, because that is what the create arm stores and what `createLayerSource`
            // renders from: the creator builds a `pos`-sized canvas and draws at the rect's own
            // coordinates. An unreduced canvas-space rect puts the ink outside that canvas whenever
            // the document frame is not the origin — MEASURED on a crop with `documentFrame.x` at
            // -100, a replace armed rendered an EMPTY layer at the right position. The origin
            // comparison above still uses the un-reduced rect, so the guard is unaffected.
            args: {
              ...replacementArgs,
              rect: canvasRectToLocal(measuredRect, pos, documentFrame),
              placeholderUntouched: false,
            },
            pos,
          };
          const replaced = replaceLayerSource(activeLayer.id, source);
          if (!replaced) return null;

          const { editingLayerId: _editingLayerId, ...persistedArgs } = args;
          const cleared = clearTextDraftArgs(persistedArgs);
          if (setToolArgs) setToolArgs(cleared);
          else currentArgsRef.current = cleared;
          clearOverlay();
          return { ...layers, [activeLayer.id]: replaced };
        }
      }
      if (requestedLayerId) return null;

      const { editingLayerId: _editingLayerId, ...persistedArgs } = args;
      const layer = createLayerFromTool({ args: { ...persistedArgs, placeholderUntouched: false } });
      const cleared = clearTextDraftArgs(persistedArgs);
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
      // The ownership scope, ahead of the publication boundary below: a preview the caller does
      // not own is still a draft, and a draft the caller did not stage must not become published
      // state on this caller's history entry.
      if (ownedLayerId && id !== ownedLayerId) continue;
      // The publication boundary, not a second copy of the preview guard: `commitDirtyTool` is
      // reached from the tool switch, the merge and the new-document paths as well as from
      // `updateLayerByTool`, so this is where a preview that no longer renders stops becoming a
      // published layer and a history state.
      const previewToolName = (preview.toolArgs as ToolArgs | undefined)?.toolName;
      const previewRefusal = previewToolName ? canvasFilterRefusal(previewToolName) : null;
      if (previewRefusal) {
        console.error(previewRefusal);
        continue;
      }
      const layer = { ...preview.layer, pos: { ...preview.layer.pos }, operations: [...preview.layer.operations] };
      committedLayers[id] = layer;
      hasPreviewLayers = true;
      if (preview.toolArgs) {
        const committedArgs = normalizeCommittedToolArgs(layer, preview.toolArgs);
        if (committedArgs) pendingToolEdits.push({ layerId: id, args: committedArgs });
      }
      if (layer.tmpCanvas) pendingPresentations.set(id, layer);
    }
    // Only the previews this call consumed leave the map. A scoped commit must not discard a
    // draft it declined to publish, or the pixels are gone from both the record and the map.
    if (ownedLayerId) delete previewLayersRef.current[ownedLayerId];
    else previewLayersRef.current = {};

    // Find every remaining dirty layer and save detached copies. A document-scoped
    // commit can carry more than one staged cache; stopping at the first one leaves
    // later layers dirty and makes their promotion depend on an unrelated layer order.
    for (const layer of Object.values(committedLayers)) {
      if (ownedLayerId && layer.id !== ownedLayerId) continue;
      if (layer.tmpCanvas) {
        const detachedLayer = { ...layer, pos: { ...layer.pos } };
        pendingPresentations.set(detachedLayer.id, detachedLayer);
        committedLayers[layer.id] = detachedLayer;
        hasPreviewLayers = true;
      }
    }

    if (hasPreviewLayers && !deferDispatch) {
      if (!pendingToolEdits.length) {
        // No logical change to record: publish the already-known layer records so
        // their promoted cache can land through the presentation boundary.
        publishRuntimePresentation(committedLayers);
      } else {
        for (const [index, pendingEdit] of pendingToolEdits.entries()) {
          const item = {
            layerId: pendingEdit.layerId,
            actionName: TOOL_ACTION,
            args: pendingEdit.args,
          } as const;
          let planned: ReturnType<typeof planHistoryAppend> | undefined;
          try {
            planned = planHistoryAppend({
              item,
              timeline: { entries: history, cursor: historyIndex, branchRevision },
              currentFrame: documentFrame,
              currentLayer: committedLayers[pendingEdit.layerId],
            });
          } catch (error) {
            console.error('Unable to plan durable history for a tool commit', error);
          }
          dispatch({
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: {
              ...(index === 0 ? { updates: { layers: committedLayers } } : {}),
              historyItem: planned?.entry ?? createHistoryItem(item),
              durableEntry: planned?.durableEntry,
              ...(planned ? { durableDiagnostics: planned.diagnostics } : {}),
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

  const activeTextEditArgs = () => {
    const args = currentArgsRef.current;
    return toolName === 'text' && args?.toolName === 'text' && args.rect ? args : null;
  };

  const removeLayer = (id: LayerId) => {
    const layer = layers[id];
    if (!layer) return;
    if (activeTextEditArgs()?.editingLayerId === id) return;

    const { [id]: removedLayer, ...remainingLayers } = layers;
    const deletedLayer = { ...removedLayer, bitmap: null, tmpCanvas: null };
    delete previewLayersRef.current[id];
    const newDeletedLayers = { ...deletedLayers, [id]: deletedLayer };

    const sorted = getSortedLayersArray(remainingLayers);
    const nextActiveLayerId =
      activeLayerId === id ? (sorted.length > 0 ? sorted[sorted.length - 1].id : null) : activeLayerId;
    const updates = {
      layers: remainingLayers,
      deletedLayers: newDeletedLayers,
      activeLayerId: nextActiveLayerId,
    };
    const item = { layerId: id, actionName: REMOVE_ACTION, args: {} } as const;

    try {
      const { entry, durableEntry, diagnostics } = planHistoryAppend({
        item,
        timeline: { entries: history, cursor: historyIndex, branchRevision },
        currentFrame: documentFrame,
      });
      dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates, historyItem: entry, durableEntry, durableDiagnostics: diagnostics },
      });
    } catch (error) {
      // The plan is a projection, so a failure in it must not reject a valid
      // removal. Re-dispatch the same edit with no durable plan, exactly as the
      // selection writers do; the store rebuilds durable state from the legacy
      // timeline instead. Nothing has been appended and no layer has left the
      // record yet, so this is the whole edit rather than a repair of it.
      console.error('Unable to plan durable history for a layer removal', error);
      dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates, historyItem: createHistoryItem(item), durableEntry: undefined },
      });
    }

    clearOverlay();
  };

  const updateLayer = (id: LayerId, patch: Partial<Layer>, actionName: ActionType) => {
    const layer = layers[id];
    if (!layer) return;
    if (
      (actionName === SET_LAYER_OPACITY_ACTION || actionName === SET_LAYER_BLEND_MODE_ACTION) &&
      (layer.isBedrock || isLayerLocked(layer))
    ) {
      return;
    }
    if (actionName === SET_LAYER_BLEND_MODE_ACTION && !isLayerBlendMode(patch.blendMode)) return;
    if (
      (actionName === LOCK_LAYER_ACTION && patch.locked !== true) ||
      (actionName === UNLOCK_LAYER_ACTION && patch.locked !== false) ||
      ((actionName === LOCK_LAYER_ACTION || actionName === UNLOCK_LAYER_ACTION) && layer.isBedrock)
    ) {
      return;
    }
    if (actionName === LOCK_LAYER_ACTION && activeTextEditArgs()) {
      return;
    }
    const item = { layerId: id, actionName, args: patch };
    const planned = isSetLayerPropertiesAction(actionName)
      ? planHistoryAppend({
          item,
          timeline: { entries: history, cursor: historyIndex, branchRevision },
          currentFrame: documentFrame,
        })
      : null;
    // The runtime layer takes the DERIVED patch, not the caller's: the durable
    // entry is what the store will publish, and letting a caller reach the live
    // layer with fields legacy replay would ignore makes the layer change on
    // commit and not revert. Falls back to the caller's patch only when the
    // derivation refused, which keeps the pre-derivation behaviour for a
    // malformed rename.
    const runtimePatch = derivedLayerPropertyPatch(planned?.durableEntry) ?? patch;
    const newLayers = { ...layers, [id]: { ...layer, ...runtimePatch } } as LayersRecord;
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: newLayers },
        historyItem: planned?.entry ?? createHistoryItem(item),
        ...(planned ? { durableEntry: planned.durableEntry } : {}),
        ...(planned ? { durableDiagnostics: planned.diagnostics } : {}),
      },
    });
    drawAllLayers();
  };

  const moveLayerAfter = (layerToMoveId: LayerId, afterWhichLayerId?: LayerId | null) => {
    const layerToMove = layers[layerToMoveId];
    if (!layerToMove || layerToMove.isBedrock || isLayerLocked(layerToMove)) return;
    dispatch({
      type: 'REORDER_LAYERS',
      payload: { layerToMoveId, afterWhichLayerId },
    });
    drawAllLayers();
  };

  const arrangeLayer = (command: ArrangeLayerCommand) => {
    if (!activeLayerId) return;
    const layerToMove = layers[activeLayerId];
    if (!layerToMove || layerToMove.isBedrock || isLayerLocked(layerToMove)) return;

    const sortedLayers = getSortedLayersArray(layers);
    const currentIndex = sortedLayers.findIndex((layer) => layer.id === activeLayerId);
    if (currentIndex < 0) return;

    const bedrockIndex = sortedLayers.findIndex((layer) => layer.isBedrock);
    const bedrockId = bedrockIndex >= 0 ? sortedLayers[bedrockIndex]!.id : null;
    let afterWhichLayerId: LayerId | null | undefined;

    switch (command) {
      case 'bring-to-front':
        if (currentIndex === sortedLayers.length - 1) return;
        afterWhichLayerId = sortedLayers.at(-1)!.id;
        break;
      case 'bring-forward':
        if (currentIndex === sortedLayers.length - 1) return;
        afterWhichLayerId = sortedLayers[currentIndex + 1]!.id;
        break;
      case 'send-backward':
        if (currentIndex <= bedrockIndex + 1) return;
        afterWhichLayerId = sortedLayers[currentIndex - 2]?.id ?? bedrockId;
        break;
      case 'send-to-back':
        if (currentIndex <= bedrockIndex + 1) return;
        afterWhichLayerId = bedrockId;
        break;
    }

    moveLayerAfter(activeLayerId, afterWhichLayerId);
  };

  const setActiveLayer = (id?: LayerId | null) => dispatch({ type: 'SET_ACTIVE_LAYER', payload: id ?? null });

  const toggleVisibility = (id: LayerId) => {
    const isVisible = layers[id]?.visible;
    updateLayer(id, { visible: !isVisible }, isVisible ? HIDE_LAYER_ACTION : SHOW_LAYER_ACTION);
  };

  // THE MAIN POINT IS THAT THIS method does not leave any trace in history and REACT lifecycle
  //
  // The `boolean` is load-bearing: `updateLayerByTool` appends the `TOOL_ACTION` history entry
  // only after this succeeds. Colors and Levels args are normalized before the operation is
  // rendered, and the same normalized args are what their history entries record.
  function tempUpdateLayer({ id = activeLayerId, toolArgs: inputToolArgs }: LayerEditParams): boolean {
    const toolArgs = normalizeToolArgs(inputToolArgs);
    if (!id) return false;

    const layer = layers[id];
    if (!layer) return false;

    // The ONE place a tool's pixels or geometry reach a layer, which is what makes this the guard
    // for all thirteen `commit: 'raster'` tools at once rather than thirteen copies of the check.
    // Above every `commit` branch below it, because the flag a PSD round-trips is composite AND
    // position protection — see `isLayerLocked`.
    if (isLayerLocked(layer)) return false;

    const { toolName: toolArgsToolName } = toolArgs;
    const processor = findToolProcessor(toolArgsToolName);
    if (!processor) return false;

    // A `ctx.filter` assignment the engine discards leaves the layer unchanged, so the tool is
    // refused here rather than previewed as a no-op that `commitDirtyTool` later records. Above
    // the `commit` branches because the flag belongs to the tool, not to how it commits, and the
    // live-slider bars (Blur, Colors, Levels) reach the preview through this function alone.
    if (processor.requiresCanvasFilter) {
      const refusal = canvasFilterRefusal(toolArgsToolName);
      if (refusal) {
        console.error(refusal);
        return false;
      }
    }

    if (isTransformArgs(toolArgs) && toolArgs.trapezoid !== 0) {
      try {
        if (!isTrapezoidOnlyTransform(toolArgs)) return false;
      } catch (error) {
        console.error(error);
        return false;
      }
    }

    if (isTransformArgs(toolArgs) && toolArgs.trapezoid === 0) {
      try {
        const transform = transformToolArgsToAffine(toolArgs, layer.pos);
        if (!transform) return false;
        const previewLayer = {
          ...layer,
          operations: [...layer.operations, createAffineLayerOperation(transform)],
          tmpCanvas: null,
          presentationBounds: null,
        };
        previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
        drawAllLayers();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    }

    if (processor.commit === 'layer-operation') {
      const previewLayer = {
        ...layer,
        operations: [...layer.operations, createLayerOperation(toolArgs as LayerOperationArgs)],
        tmpCanvas: null,
        presentationBounds: null,
      };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return true;
    }

    if (processor.commit === 'geometry') {
      const { move, resize } = toolArgs as RepositionToolArgs;
      const positionPatch = resize ?? move;
      if (!positionPatch) return false;
      const previewLayer = {
        ...layer,
        pos: { ...layer.pos, ...positionPatch },
        tmpCanvas: null,
        presentationBounds: null,
      };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return true;
    }

    const preview = previewLayersRef.current[id];
    const processorArgs = preview?.layer.tmpCanvas ? getIncrementalStrokeArgs(toolArgs, preview.toolArgs) : null;
    const canAppendStroke = processorArgs !== null;

    // Check for incremental eraser brush-mode
    let incrementalEraserArgs: EraserToolArgs | null = null;
    let canIncrementalEraser = false;
    if (!canAppendStroke && toolArgs.toolName === 'eraser' && preview?.layer.tmpCanvas) {
      incrementalEraserArgs = getIncrementalEraserArgs(toolArgs, preview.toolArgs);
      canIncrementalEraser = incrementalEraserArgs !== null;
    }

    // Check for incremental dodge/burn
    let incrementalDodgeBurnArgs: DodgeBurnToolArgs | null = null;
    if (
      !canAppendStroke &&
      !canIncrementalEraser &&
      (toolArgs.toolName === 'dodge' || toolArgs.toolName === 'burn') &&
      preview?.layer.tmpCanvas
    ) {
      incrementalDodgeBurnArgs = getIncrementalDodgeBurnArgs(preview.toolArgs, toolArgs);
    }
    const canIncrementalDodgeBurn = incrementalDodgeBurnArgs !== null;

    // Check for incremental sponge
    let incrementalSpongeArgs: SpongeToolArgs | null = null;
    if (
      !canAppendStroke &&
      !canIncrementalEraser &&
      !canIncrementalDodgeBurn &&
      toolArgs.toolName === 'sponge' &&
      preview?.layer.tmpCanvas
    ) {
      incrementalSpongeArgs = getIncrementalSpongeArgs(preview.toolArgs, toolArgs);
    }
    const canIncrementalSponge = incrementalSpongeArgs !== null;

    const processorLayer =
      canAppendStroke || canIncrementalEraser || canIncrementalDodgeBurn || canIncrementalSponge
        ? preview!.layer
        : layer;
    const bitmap =
      canAppendStroke || canIncrementalEraser || canIncrementalDodgeBurn || canIncrementalSponge
        ? preview!.layer.tmpCanvas
        : (layer.tmpCanvas ?? layer.bitmap);
    if (!bitmap && (processor.commit === 'raster' || !processor.creator)) {
      console.error('No active layer or bitmap to update preview');
      return false;
    }

    // This is the call every live pointer move reaches, so it is the one that has to be
    // guarded. A trapezoid-only transform satisfies `commit: 'affine-operation'`, so it
    // falls past both early returns above and lands here, and `transform` throws for
    // several argument shapes (`src/tools/transform.ts`: a non-finite or over-tapered
    // trapezoid, a non-invertible homography, degenerate affine bounds). Without the
    // guard the throw escapes `tempUpdateLayer` into a React event handler.
    let result: ToolResult;
    let input: ReturnType<typeof stageProcessorInputForTool> | null = null;
    try {
      input = bitmap ? stageProcessorInputForTool(processorLayer, bitmap, processor) : null;
      const processorParams: ProcessorToolParams | CreatorToolParams = input
        ? ({ bitmap: input.bitmap, size: input.rasterSize } as ProcessorToolParams)
        : ({ size: layer.pos } as CreatorToolParams);
      // Pass previousCanvas for incremental eraser brush-mode
      if (canIncrementalEraser && preview?.layer.tmpCanvas) {
        (processorParams as ProcessorToolParams).previousCanvas = preview.layer.tmpCanvas;
      }
      // Pass previousCanvas for incremental dodge/burn
      if (canIncrementalDodgeBurn && preview?.layer.tmpCanvas) {
        (processorParams as ProcessorToolParams).previousCanvas = preview.layer.tmpCanvas;
      }
      // Pass previousCanvas for incremental sponge
      if (canIncrementalSponge && preview?.layer.tmpCanvas) {
        (processorParams as ProcessorToolParams).previousCanvas = preview.layer.tmpCanvas;
      }
      result = processor.imageProcessor(processorParams)(
        processorArgs ?? incrementalEraserArgs ?? incrementalDodgeBurnArgs ?? incrementalSpongeArgs ?? toolArgs
      );
    } catch (error) {
      console.error(error);
      return false;
    }

    const [canvas, positionPatch] = result;

    // Trapezoid transforms use the same raster boundary as pixel processors even though the
    // shared processor registry labels them `affine-operation` for ordinary transforms. Replay
    // already routes this branch through `applyRasterTool`; the live preview must publish the
    // same baked bounds and drop the retained operations or undo/redo will diverge.
    const rasterBoundary = processor.commit === 'raster' || (isTransformArgs(toolArgs) && toolArgs.trapezoid !== 0);
    const bakedPresentation = rasterBoundary && input !== null && input.presentationIsBaked;
    const publishedPosition = bakedPresentation && input ? input.bounds : layer.pos;
    const previewLayer = {
      ...layer,
      pos: positionPatch ? { ...publishedPosition, ...positionPatch } : { ...publishedPosition },
      ...(bakedPresentation ? { operations: operationsRetainedAfterBake(layer) } : {}),
      ...(processor.commit === 'raster' || (isTransformArgs(toolArgs) && toolArgs.trapezoid !== 0)
        ? { source: undefined }
        : {}),
      tmpCanvas: canvas,
      presentationBounds: null,
    };
    previewLayersRef.current[id] = { layer: previewLayer, toolArgs };

    drawAllLayers();
    return true;
  }

  function cancelLayerPreview(id = activeLayerId) {
    if (id) delete previewLayersRef.current[id];
    drawAllLayers();
  }

  const beginTextLayerEdit = (id: LayerId) => {
    const layer = layers[id];
    if (!layer || isLayerLocked(layer)) return;
    previewLayersRef.current[id] = {
      // Remove only the runtime raster from this preview. The contenteditable overlay is the sole
      // visible representation while the source is being edited; the marker is never persisted.
      layer: {
        ...layer,
        bitmap: null,
        tmpCanvas: null,
        presentationBounds: null,
      },
      toolArgs: undefined,
    };
    drawAllLayers();
  };

  const drawAllLayers = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setDevPaintState = (source: 'pending' | 'rendering' | 'durable' | 'legacy' | 'failed', cursor: number) => {
      if (!import.meta.env.DEV) return;
      if (canvas.dataset.presentationPaintSource !== source) canvas.dataset.presentationPaintSource = source;
      const cursorValue = String(cursor);
      if (canvas.dataset.presentationPaintCursor !== cursorValue) canvas.dataset.presentationPaintCursor = cursorValue;
    };

    // Navigation has moved logical state but no complete presentation authority
    // has been accepted yet. Keep the prior canvas intact until then.
    if (renderSelector.source === 'pending') {
      setDevPaintState('pending', historyIndex);
      return;
    }
    setDevPaintState('rendering', historyIndex);

    const previewLayerIds = Object.keys(previewLayersRef.current);
    const hasPreview = previewLayerIds.length > 0;
    // Live gestures stay on the legacy base: incremental tools depend on the
    // preview layer's temporary canvas and are published only after commit.
    const durableProjection =
      !hasPreview &&
      renderSelector.source === 'durable' &&
      renderSelector.historyCursor === historyIndex &&
      durablePresentation.status === 'durable' &&
      durablePresentation.cursor !== null &&
      durableRenderProjection &&
      durableRenderProjection.documentId === documentId &&
      durableRenderProjection.documentRevision === documentRevision &&
      durableRenderProjection.branchRevision === branchRevision &&
      durableRenderProjection.historyCursor === durablePresentation.cursor &&
      documentFrameEquals(durableRenderProjection.frame, documentFrame) &&
      documentFrameEquals(renderSelector.frame, documentFrame)
        ? durableRenderProjection
        : null;
    const durableLayers = durableProjection?.layers ?? null;
    const renderLayers = hasPreview
      ? ({
          ...layers,
          ...Object.fromEntries(Object.entries(previewLayersRef.current).map(([id, preview]) => [id, preview.layer])),
        } as LayersRecord)
      : (durableLayers ?? layers);
    const sorted = getSortedLayersArray(renderLayers);
    const renderFrame = durableProjection ? durableProjection.frame : documentFrame;
    try {
      if (drawLayersToCanvas(canvas, sorted, renderFrame, new Set(previewLayerIds), dpr)) {
        setDevPaintState(durableProjection ? 'durable' : 'legacy', durableProjection?.historyCursor ?? historyIndex);
      } else {
        setDevPaintState('failed', durableProjection?.historyCursor ?? historyIndex);
        console.error('Unable to publish runtime layer presentation');
      }
    } catch (error) {
      setDevPaintState('failed', durableProjection?.historyCursor ?? historyIndex);
      // Pointer-move callers must not receive renderer failures through React's
      // event boundary. The renderer already preserves the last good canvas.
      console.error('Unable to publish runtime layer presentation', error);
    }
  }, [
    branchRevision,
    canvasRef,
    documentFrame,
    documentId,
    documentRevision,
    dpr,
    durablePresentation,
    durableRenderProjection,
    historyIndex,
    layers,
    previewLayersRef,
    renderSelector,
  ]);

  const applyDocumentCrop = (rect: { x1: number; y1: number; x2: number; y2: number }, angle = 0): boolean => {
    if (![rect.x1, rect.y1, rect.x2, rect.y2, angle].every((value) => Number.isFinite(value))) {
      console.warn('applyDocumentCrop refused a non-finite crop rectangle');
      return false;
    }

    // Unclamped on purpose, and that is the whole feature: Photoshop's crop box may be dragged
    // past the image edge, which extends the canvas. `sortRoundRect` sorts, rounds each edge once
    // and derives the extent from the rounded edges, so a rect reaching past an edge grows the
    // frame and a rect reaching before the origin anchors the frame negatively. A rect that
    // overlaps nothing is accepted too — Photoshop hands back an empty canvas, and undo restores
    // this one because a crop here keeps the pixels instead of discarding them.
    const { x, y, width, height } = sortRoundRect(rect);
    if (width <= 0 || height <= 0) return false;
    if (
      width > MAX_DOCUMENT_FRAME_SIDE ||
      height > MAX_DOCUMENT_FRAME_SIDE ||
      width * height > MAX_DOCUMENT_FRAME_AREA
    ) {
      // Refused silently this would read as a crop that did nothing, which is indistinguishable
      // from a broken tool; the refusal names the size and the pixel count that were refused, and
      // the ceiling it is measured against, rather than claiming a single canvas gave up.
      console.warn(
        `applyDocumentCrop refused ${width}x${height} (${width * height}px): past the ${MAX_DOCUMENT_FRAME_SIDE}px per-side or ${MAX_DOCUMENT_FRAME_AREA}px area frame ceiling, and a frame allocates six canvas surfaces at that size`
      );
      return false;
    }

    const nextFrame = canvasRectToDocumentFrame({ x, y, width, height }, documentFrame);
    if (!isValidDocumentFrame(nextFrame)) return false;
    const transform =
      angle === 0
        ? undefined
        : rotationAffineAroundPoint((-angle * Math.PI) / 180, {
            x: nextFrame.x + nextFrame.width / 2,
            y: nextFrame.y + nextFrame.height / 2,
          });
    const documentTransform = transform && !isIdentityAffineTransform(transform) ? transform : undefined;
    if (!documentTransform && documentFrameEquals(documentFrame, nextFrame)) return false;

    // The append boundary derives the same durable entry as the adapter. The
    // store publishes it only when its preconditions prove the durable shadow
    // still describes this legacy append; otherwise it rebuilds the shadow.
    const { entry, durableEntry, diagnostics } = planHistoryAppend({
      item: {
        layerId: 'document',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: {
          previousFrame: documentFrame,
          nextFrame,
          ...(documentTransform ? { transform: documentTransform } : {}),
        },
      },
      timeline: { entries: history, cursor: historyIndex, branchRevision },
      currentFrame: documentFrame,
    });
    let nextLayers = layers;
    if (documentTransform) {
      try {
        nextLayers = Object.fromEntries(
          Object.values(layers).map((layer) => [
            layer.id,
            transformLayerForDocument(layer, documentTransform, `${entry.id}:${layer.id}`),
          ])
        );
      } catch (error) {
        console.warn('applyDocumentCrop refused a document rotation that exceeds layer transform limits', error);
        return false;
      }
    }
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          documentFrame: nextFrame,
          totalSize: documentFrameSize(nextFrame),
          ...(documentTransform ? { layers: nextLayers } : {}),
        },
        historyItem: entry,
        durableEntry,
        durableDiagnostics: diagnostics,
      },
    });
    return true;
  };

  async function mergeLayers(name: string): Promise<Layer | null> {
    const currentLayers = commitDirtyTool();
    if (currentLayers === null) return null;

    // getBitmap of the canvas
    if (!canvasRef.current) return null;
    const canvasBitmap = await createImageBitmap(canvasRef.current);
    const source = {
      kind: 'image',
      bitmap: canvasBitmap,
      name,
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
    // The merged raster is created by a bare `createImageBitmap`, so this is the only
    // registration it will ever get. It is aliased by `layer.bitmap`,
    // `layer.source.bitmap` and the merge entry's `args` at once.
    adoptLayerBitmaps([source.bitmap]);
    return layer;
  }

  async function mergeAllLayers(): Promise<Layer | null> {
    return mergeLayers('Merged Layer');
  }

  /**
   * The explicit Layer-from-Background action: turn the document's backing image
   * into an ordinary editable layer, so the tools that refuse a bedrock layer can
   * be used. It is one deliberate click, never a side effect of a refused gesture.
   *
   * NOT `mergeLayers()` above. That command collapses the whole stack into the
   * composited canvas, which is Flatten's job and a separate explicit command;
   * reusing it here would destroy every layer above the backing image instead of
   * unlocking the one the user was refused on.
   *
   * `NEW_LAYER_ACTION` is the smallest existing seam that replays a raster source:
   * `replayHistory`'s create arm installs whatever `source` the entry names, and
   * naming the bedrock layer's OWN id makes that arm replace the record rather than
   * add a second one. So the panel keeps the same row, `activeLayerId` stays valid,
   * and an undo replays past the entry and rebuilds the backing layer from the
   * document's own first entry. The durable shadow derives the same `create-layer`
   * operation from the same entry (`history-adapter.ts`'s create arm registers the
   * raster as an asset), so both models describe the same document.
   *
   * `pos` is copied verbatim from the bedrock layer and the document frame is never
   * touched, which is what preserves the pixels: a non-bedrock source is positioned
   * by `pos` alone, where `createLayerSource` re-pins a bedrock one to the origin.
   *
   * Refused unless the backing layer is the entire stack. Both layer constructors
   * place a created layer at `maxOrder + 1` (`createLayerSource` in the live path,
   * `sourceToRuntimeLayer` in the durable one), so converting under any other layer
   * would stack an opaque copy of the whole frame on top of it — and do so
   * identically on every replay, which is what makes this a rule rather than a
   * nicety. Widening it needs a stacking seam this one action does not have: either
   * a second `REORDER_ACTION` entry, or a source-edit operation that admits a
   * raster, which `replace-layer-source` deliberately does not.
   */
  async function convertBedrockLayer(id?: LayerId | null): Promise<Layer | null> {
    const bedrockId = id ?? activeLayerId ?? undefined;
    // Every refusal is decided before anything is committed or dispatched, so a
    // conversion that cannot be done leaves the document exactly as it was.
    if (!bedrockId) return null;
    const bedrock = layers[bedrockId];
    if (!bedrock?.isBedrock) return null;
    if (Object.keys(layers).length !== 1) return null;

    const pixels = bedrock.bitmap ?? bedrock.tmpCanvas;
    if (!pixels) return null;

    const currentLayers = commitDirtyTool();
    if (currentLayers === null) return null;

    // Through `immutableRaster`, so the editable layer can never alias a mutable
    // surface: a `File > New` backing image is an OffscreenCanvas, and aliasing it
    // would let a later pixel edit write through the layer that replaced it. An
    // ImageBitmap is immutable already and is shared, which is the aliasing
    // `createLayerFromBitmap` already performs against a document's first entry.
    const bitmap = await immutableRaster(pixels);

    const source: ImageLayerSource = {
      kind: 'image',
      bitmap,
      name: bedrock.name,
      pos: { ...bedrock.pos },
      isBedrock: false,
    };

    const converted = createLayerSource({ layerId: bedrockId, layers: currentLayers, source });

    _addLayer(
      converted,
      { layerId: bedrockId, actionName: NEW_LAYER_ACTION, layerSource: source },
      undefined,
      currentLayers
    );
    // One registration covers all three aliases the raster now has:
    // `layer.bitmap`, `layer.source.bitmap` and the entry's `layerSource.bitmap`.
    adoptLayerBitmaps([bitmap]);
    drawAllLayers();
    return converted;
  }

  return {
    createBlankLayer,
    createLayerFromBitmap,
    createLayerFromTool,
    replaceLayerSource,

    tempUpdateLayer,
    updateLayerByTool,
    commitDirtyTool,
    cancelLayerPreview,
    beginTextLayerEdit,

    removeLayer,

    updateLayer,
    setActiveLayer,
    toggleVisibility,
    moveLayerAfter,
    arrangeLayer,

    drawAllLayers,
    mergeAllLayers,
    convertBedrockLayer,
    applyDocumentCrop,
  };
};
