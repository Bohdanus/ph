import { useStore } from './StoreContext.tsx';
import type { Layer, LayersRecord } from './layer-types.ts';
import type { HistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';
import { createLayerSource, getSortedLayersArray } from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { replayHistory } from './history-replay.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../util/constants.ts';
import { updateHistoryTimeline } from './history-timeline.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';
import type { MigrationDiagnostic } from './history-adapter.ts';
import type { BitmapSource, Pos } from './general-types.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  type PresentationOperation,
} from './presentation-evaluator.ts';

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

/**
 * The buffer and size a pixel replay has to hand its processor, evaluated the way the live
 * pointer move evaluates them (`useLayer.ts:730`). A processor is handed ONE buffer and its
 * extents and never learns which layer it belongs to (`src/util/layer-space.ts:14-19`), so a
 * layer carrying a retained affine or filter has to be rasterized at its evaluated extent
 * first. Reading the raw raster with `layer.pos` instead replayed a transformed layer at the
 * untransformed geometry, so undo put pixels somewhere the screen never showed.
 *
 * A copy rather than an import: the live rule is module-private (`useLayer.ts:140`) and
 * `useLayer.ts` is not this file's to edit. It is stated from the same evaluator the renderer
 * and the durable materializer state it from (`layer-renderer.ts:94-99`,
 * `materialization.ts:207-212`), so the arithmetic has one implementation; what is repeated
 * here is the staging surface, which each of the three paths allocates for itself.
 */
function replayProcessorInput(layer: Layer, bitmap: BitmapSource): { bitmap: BitmapSource; size: Pos } {
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
  if (!context) throw new Error('A 2D canvas context is required for a transformed replay input');
  context.save();
  try {
    drawEvaluatedPresentation(context, bitmap, evaluation, { kind: 'bounds' });
  } finally {
    context.restore();
  }
  return { bitmap: surface as BitmapSource, size: evaluation.bounds };
}

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
            // A tool with no processor (see `PIXEL_FREE_TOOLS`) rasterizes nothing, so the layer is
            // left exactly as it was rather than replaced with an empty canvas.
            const processor = findToolProcessor(args.toolName);
            if (!processor) return layer;
            // Evaluated presentation, not the raw raster. An evaluator throw here fails the
            // navigation closed through the `catch` below, exactly as one from the
            // publication does — `drawReplay` runs the same evaluation over the same layer
            // (`layer-renderer.ts:94`) — so it adds no failure class, only an earlier failure.
            const input = replayProcessorInput(layer, bitmap);
            const [canvas, patch] = processor.imageProcessor({ bitmap: input.bitmap, size: input.size })(args);
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
    canUndo,
    undo,
    canRedo,
    redo,
    resetHistoryTo,
    toggleDisabled,
  };
};
