import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from './StoreContext.tsx';
import type { BitmapSource } from './general-types.ts';
import { useSetToolArgs } from './set-tool-args.ts';
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
} from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import type { BlankImageParams, FileImageParams, FullArgs, ToolArgs, ToolName } from './tool-types.ts';
import {
  type CreatorToolParams,
  findToolProcessor,
  type ProcessorToolParams,
  type ToolResult,
} from '../tools/toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import { reduceRect, sortRect, sortedRectToPos, trimRect } from '../util/rect.ts';
import type { Optional } from '../util/type-utils.ts';
import {
  type ActionType,
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
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
import { derivedLayerPropertyPatch, isSetLayerPropertiesAction } from './history-adapter.ts';
import type { LayerPresentationRequest } from './layer-presentation.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  type PresentationOperation,
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
 * `src/util/psd-utils.ts:160` reads the flag off an imported PSD and `:267-268` writes it back
 * out as composite + position protection, so `locked` is exactly "this layer's PIXELS and POSITION
 * may not change" — every `commit` kind the processors declare, which is why the check belongs
 * above them all rather than in the raster branch alone. Nothing consulted it: `psd-utils.ts` is
 * the only place that ever sets it true, every other construction path writes `false`, and no
 * panel renders a lock control, so a layer a PSD protected was freely overwritten by every tool.
 *
 * `=== true` rather than a truthiness test, so a future flag-shaped value is a compile error
 * rather than a layer that silently locks itself.
 */
const isLayerLocked = (layer: Layer): boolean => layer.locked === true;

/** Map retained layer operations to the shared presentation evaluator's input. */
function presentationOperations(layer: Layer): PresentationOperation[] {
  return layer.operations
    .filter((operation) => operation.enabled)
    .map((operation) =>
      operation.kind === 'affine-transform'
        ? { kind: 'affine-transform', transform: operation.transform }
        : {
            kind: 'filter',
            toolName: operation.args.toolName,
            args: operation.args as unknown as Readonly<Record<string, unknown>>,
          }
    );
}

/** Rasterizes retained presentation operations before a pixel processor reads the layer. */
function transformedProcessorInput(layer: Layer, bitmap: BitmapSource): { bitmap: BitmapSource; size: Layer['pos'] } {
  const operations = presentationOperations(layer);
  if (operations.length === 0) return { bitmap, size: layer.pos };

  const evaluation = evaluatePresentation({
    position: layer.pos,
    sourceSize: { width: layer.pos.width, height: layer.pos.height },
    operations,
    mode: 'layer-bounds',
  });
  const width = Math.max(1, Math.ceil(evaluation.localBounds.width));
  const height = Math.max(1, Math.ceil(evaluation.localBounds.height));
  const surface =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (() => {
          if (typeof document === 'undefined') throw new Error('No canvas implementation is available');
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        })();
  const context = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error('A 2D canvas context is required for transformed tool input');
  context.save();
  try {
    drawEvaluatedPresentation(context, bitmap, evaluation, { kind: 'bounds' });
  } finally {
    context.restore();
  }
  return { bitmap: surface as BitmapSource, size: evaluation.bounds };
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
      publishRuntimePresentation,
      adoptLayerBitmaps: storeAdoptLayerBitmaps,
    },
    dispatch,
  ] = useStore();

  const setToolArgs = useSetToolArgs();
  const documentFrame = currentDocumentFrame ?? documentFrameFromSize(totalSize);

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
      replaceDocument
        ? {
            size: 'size' in params ? params.size : { width: params.pos.width, height: params.pos.height },
            hasUnsavedChanges: true,
          }
        : undefined,
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
    // One registration covers all three aliases the raster now has: `layer.bitmap`,
    // `layer.source.bitmap` (the `source` object is stored verbatim on the layer) and
    // the live history entry's `layerSource.bitmap`. They are the same object, and
    // `trackPublished` keys on a `Set`.
    adoptLayerBitmaps([source.bitmap]);
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

  const updateLayerByTool = async ({ id = activeLayerId, toolArgs }: LayerEditParams) => {
    const toolArgsToolName = (toolArgs as ToolArgs).toolName;
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
    // should pick that dirty later and do all hardening
    const committedLayers = commitDirtyTool(true);
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
    dispatch({
      type: 'REORDER_LAYERS',
      payload: { layerToMoveId, afterWhichLayerId },
    });
    drawAllLayers();
  };

  const setActiveLayer = (id?: LayerId | null) => dispatch({ type: 'SET_ACTIVE_LAYER', payload: id ?? null });

  const toggleVisibility = (id: LayerId) => {
    const isVisible = layers[id]?.visible;
    updateLayer(id, { visible: !isVisible }, isVisible ? HIDE_LAYER_ACTION : SHOW_LAYER_ACTION);
  };

  // THE MAIN POINT IS THAT THIS method does not leave any trace in history and REACT lifecycle
  //
  // The `boolean` is load-bearing: `updateLayerByTool` appends the `TOOL_ACTION` history entry
  // right after calling this, and `normalizeCommittedToolArgs` returns a non-transform tool's args
  // unchanged, so a `false` here that the caller ignored would still record a history state with
  // no layer change behind it.
  function tempUpdateLayer({ id = activeLayerId, toolArgs }: LayerEditParams): boolean {
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
      };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return true;
    }

    if (processor.commit === 'geometry') {
      const { move, resize } = toolArgs as RepositionToolArgs;
      const positionPatch = resize ?? move;
      if (!positionPatch) return false;
      const previewLayer = { ...layer, pos: { ...layer.pos, ...positionPatch }, tmpCanvas: null };
      previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
      drawAllLayers();
      return true;
    }

    const bitmap = layer.tmpCanvas ?? layer.bitmap;
    if (!bitmap && !processor.creator) {
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
    try {
      const input = bitmap ? transformedProcessorInput(layer, bitmap) : null;
      result = processor.imageProcessor(
        input
          ? ({ bitmap: input.bitmap, size: input.size } as ProcessorToolParams)
          : ({ size: layer.pos } as CreatorToolParams)
      )(toolArgs);
    } catch (error) {
      console.error(error);
      return false;
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
    return true;
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
    try {
      if (!drawLayersToCanvas(canvasRef.current, sorted, documentFrame)) {
        console.error('Unable to publish runtime layer presentation');
      }
    } catch (error) {
      // Pointer-move callers must not receive renderer failures through React's
      // event boundary. The renderer already preserves the last good canvas.
      console.error('Unable to publish runtime layer presentation', error);
    }
  }, [canvasRef, documentFrame, layers, previewLayersRef]);

  const applyDocumentCrop = (rect: { x1: number; y1: number; x2: number; y2: number }): boolean => {
    const { x, y, width, height } = trimRect(sortRect(rect), totalSize);
    if (width <= 0 || height <= 0) return false;

    const nextFrame = canvasRectToDocumentFrame({ x, y, width, height }, documentFrame);
    if (!isValidDocumentFrame(nextFrame) || documentFrameEquals(documentFrame, nextFrame)) return false;

    // The append boundary derives the same durable entry as the adapter. The
    // store publishes it only when its preconditions prove the durable shadow
    // still describes this legacy append; otherwise it rebuilds the shadow.
    const { entry, durableEntry, diagnostics } = planHistoryAppend({
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
        durableDiagnostics: diagnostics,
      },
    });
    return true;
  };

  /**
   * **This flattens, it does not merge.** `canvasRef.current` is the composited canvas and
   * `layer-renderer.ts` skips every `!layer.visible` layer, so a hidden layer's pixels are already
   * composited out of what is read here; the result then REPLACES the whole stack with one layer
   * (`newLayers` below is a single-entry record). Adobe's name for that is `Flatten Image`, and
   * its `Merge Visible` keeps the invisible layers. The durable operation kind stays
   * `merge-document` — it is the historical name and renaming it would churn the replay
   * verifiers and four test files — so the CONTROL is named `Flatten Image` and this is the home
   * of the distinction.
   *
   * The one product it produces is `isBedrock: false`, which is what makes every pixel-editing
   * tool usable on it: a document a user opens is one `isBedrock` backing image, and each tool
   * area refuses the gesture on one (`SpongeToolArea.tsx` and its seven siblings).
   */
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
    // The merged raster is created by a bare `createImageBitmap`, so this is the only
    // registration it will ever get. It is aliased by `layer.bitmap`,
    // `layer.source.bitmap` and the merge entry's `args` at once.
    adoptLayerBitmaps([source.bitmap]);
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
