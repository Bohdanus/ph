import type { Pos, Size } from './general-types.ts';
import type { Layer, LayerOperation, ToolLayerSource } from './layer-types.ts';
import type { ToolArgs, ToolName } from './tool-types.ts';
import { findToolProcessor, type CreatorToolParams } from '../tools/toolProcessors.ts';
import { documentFrameSize, type DocumentFrame } from './document-frame.ts';
import {
  CanvasFilterUnsupportedError,
  FilterArgumentUnrenderableError,
  requireCanvasFilter,
} from '../util/canvas-filter.ts';
import { resizeCanvas } from '../util/canvas.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentationForDraw,
  getPresentationFilter,
  scaleVectorArgs,
  type PresentationDrawTarget,
  type PresentationOperation,
} from './presentation-evaluator.ts';

function enabledFilterOperations(
  operations: readonly LayerOperation[]
): Array<Extract<LayerOperation, { args: unknown }>> {
  return operations.filter(
    (operation): operation is Extract<LayerOperation, { args: unknown }> =>
      operation.enabled && operation.kind !== 'affine-transform' && 'args' in operation
  );
}

export function getLayerFilter(operations: readonly LayerOperation[]): string {
  return getPresentationFilter(
    enabledFilterOperations(operations).map((operation) => ({
      kind: 'filter',
      toolName: operation.args.toolName,
      args: operation.args as unknown as Readonly<Record<string, unknown>>,
    }))
  );
}

/**
 * Assigning `ctx.filter` on an engine that ignores the write leaves the layer drawn unfiltered,
 * so the refusal happens before the assignment rather than after it. The label names the tool,
 * not the composed CSS string, because the string is what the user cannot act on.
 */
function requireLayerFilterSupport(operations: readonly LayerOperation[]): void {
  for (const operation of enabledFilterOperations(operations)) {
    const toolName = operation.args.toolName;
    if (findToolProcessor(toolName)?.requiresCanvasFilter) {
      requireCanvasFilter(`Layer filter tool "${toolName}"`);
    }
  }
}

const vectorToolNames = new Set<ToolName>(['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line']);

function isVectorSource(source: Layer['source']): source is ToolLayerSource {
  return !!source && source.kind === 'tool' && vectorToolNames.has(source.args.toolName);
}

function getLayerBitmap(layer: Layer, position: Pos) {
  if (layer.tmpCanvas) return layer.tmpCanvas;
  if (!isVectorSource(layer.source)) return layer.bitmap;

  const args = ('pos' in layer.source
    ? scaleVectorArgs(layer.source.args as unknown as Record<string, unknown>, layer.source.pos, position)
    : layer.source.args) as unknown as ToolArgs;
  const processor = findToolProcessor(args.toolName);
  // A vector source is only ever created by a creator tool, and a tool with no processor
  // (`PIXEL_FREE_TOOLS`) is never one, so this is unreachable — and falls back to the layer's own
  // bitmap rather than throwing on a lookup that produced nothing.
  if (!processor) return layer.bitmap;
  const [canvas] = processor.imageProcessor({ size: position } as CreatorToolParams)(args);
  return canvas;
}

export function drawLayerSource(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  position: Pos = layer.pos,
  documentFrame?: DocumentFrame
): boolean {
  const bitmap = getLayerBitmap(layer, position);
  if (!bitmap || bitmap.width === 0 || bitmap.height === 0 || position.width === 0 || position.height === 0)
    return false;

  const operations: PresentationOperation[] = [];
  for (const operation of layer.operations) {
    if (!operation.enabled) continue;
    if (operation.kind === 'affine-transform') {
      operations.push({ kind: 'affine-transform', transform: operation.transform });
    } else {
      operations.push({
        kind: 'filter',
        toolName: operation.args.toolName,
        args: operation.args as unknown as Readonly<Record<string, unknown>>,
      });
    }
  }
  const target: PresentationDrawTarget = { kind: 'document', frame: documentFrame };
  const evaluation = evaluatePresentationForDraw(
    {
      position,
      sourceSize: { width: position.width, height: position.height },
      operations,
      mode: 'layer-bounds',
    },
    // The `document` target is what makes the uncapped bounds safe here, and it is the same
    // object the draw below uses, so the two cannot drift apart.
    target
  );
  if (evaluation.filter !== 'none') requireLayerFilterSupport(layer.operations);

  ctx.save();
  try {
    drawEvaluatedPresentation(ctx, bitmap, evaluation, target);
  } finally {
    ctx.restore();
  }
  return true;
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, documentFrame?: DocumentFrame): boolean {
  ctx.save();
  try {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    return drawLayerSource(ctx, layer, layer.pos, documentFrame);
  } finally {
    ctx.restore();
  }
}

type SnapshotSurface = OffscreenCanvas | HTMLCanvasElement;

function createSnapshotSurface(size: Size): SnapshotSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size.width, size.height);
  const snapshot = document.createElement('canvas');
  resizeCanvas(snapshot, size.width, size.height);
  return snapshot;
}

function snapshotVisibleCanvas(canvas: HTMLCanvasElement, size: Size): SnapshotSurface | null {
  try {
    let snapshot = createSnapshotSurface(size);
    let context = snapshot.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context || typeof context.drawImage !== 'function') {
      const fallback = document.createElement('canvas');
      resizeCanvas(fallback, size.width, size.height);
      snapshot = fallback;
      context = fallback.getContext('2d') as CanvasRenderingContext2D | null;
    }
    if (!context) return null;
    context.drawImage(canvas, 0, 0);
    return snapshot;
  } catch (error) {
    console.error('Unable to snapshot the visible runtime layer presentation', error);
    return null;
  }
}

/**
 * Puts the previous presentation back after a publish that had already written to the target.
 *
 * The resize alone is not the restore: assigning `width` or `height` RESETS a canvas to fully
 * transparent, and the `clearRect` the publish issues empties one whatever its dimensions were.
 * So this runs whenever the target was written at all, and blits the snapshot back even when
 * the dimensions already matched — the wipe it reverses then is the clear, not a resize.
 */
function restoreVisibleCanvas(canvas: HTMLCanvasElement, size: Size, snapshot: SnapshotSurface | null): void {
  try {
    resizeCanvas(canvas, size.width, size.height);
    if (!snapshot) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(snapshot, 0, 0);
  } catch (error) {
    console.error('Unable to restore runtime layer presentation', error);
  }
}

/**
 * Keeps the last visible canvas intact when a source or processor fails while
 * composing a new runtime presentation. The target changes only after every
 * layer has drawn successfully to an isolated staging canvas, and the pixels it
 * held are restored when that change fails partway through.
 */
export function drawLayersToCanvas(
  canvas: HTMLCanvasElement,
  layers: readonly Layer[],
  documentFrame: DocumentFrame
): boolean {
  if (typeof document === 'undefined') return true;
  const size = documentFrameSize(documentFrame);
  const stagingCanvas = document.createElement('canvas');
  resizeCanvas(stagingCanvas, size.width, size.height);
  const stagingContext = stagingCanvas.getContext('2d');
  if (!stagingContext) return false;

  try {
    for (const layer of layers) {
      if (!layer.visible) continue;
      // Per layer, not per composition: one layer carrying a filter this browser refuses, or
      // carrying a filter argument that cannot be rendered at all, must not cost the document
      // the other layers. The staging canvas is discarded by the return below, so the visible
      // canvas keeps the presentation it already had.
      try {
        if (!drawLayer(stagingContext, layer, documentFrame)) console.error('skipped layer without bitmap', layer.id);
      } catch (error) {
        if (error instanceof FilterArgumentUnrenderableError) {
          console.error('skipped layer whose filter arguments cannot be rendered', layer.id, error);
          continue;
        }
        if (!(error instanceof CanvasFilterUnsupportedError)) throw error;
        console.error('skipped layer whose filter this browser cannot apply', layer.id, error);
      }
    }
  } catch (error) {
    console.error('Unable to compose runtime layer presentation', error);
    return false;
  }

  const previousSize = { width: canvas.width, height: canvas.height };
  // The publish WRITES the target, and it writes it in two steps: `resizeCanvas` resets a
  // resized canvas to transparent, and the `clearRect` empties one whose dimensions already
  // matched. A `drawImage` that threw between them left the document blank with nothing to put
  // back, and the caller flattened whatever was left. So the previous pixels are held aside in
  // EVERY case, not only when a resize has to be reversed — the snapshot is what makes the
  // clear-then-blit sequence recoverable, and the alternative (a single `copy` composite, which
  // is atomic and allocates nothing) is pinned to a different observable sequence by
  // `useHistory.test.tsx:455` and belongs to whoever owns that file.
  let snapshot: SnapshotSurface | null = null;
  let wrote = false;
  try {
    const context = canvas.getContext('2d');
    if (!context) return false;
    snapshot = snapshotVisibleCanvas(canvas, previousSize);
    if (!snapshot) return false;
    resizeCanvas(canvas, size.width, size.height);
    wrote = true;
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(stagingCanvas, 0, 0);
    return true;
  } catch (error) {
    if (wrote) restoreVisibleCanvas(canvas, previousSize, snapshot);
    console.error('Unable to publish runtime layer presentation', error);
    return false;
  }
}
