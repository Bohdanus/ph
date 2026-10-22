import type { Pos, Size } from './general-types.ts';
import type { Layer, LayerOperation } from './layer-types.ts';
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
  scaleTextArgs,
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

function getLayerBitmap(layer: Layer, position: Pos) {
  if (layer.tmpCanvas) return layer.tmpCanvas;
  const source = layer.source;
  if (!source || source.kind !== 'tool') return layer.bitmap;

  const toolName = source.args.toolName;
  if (toolName !== 'text' && !vectorToolNames.has(toolName)) return layer.bitmap;
  const sourceArgs = source.args as unknown as Record<string, unknown>;
  const sourcePos = 'pos' in source ? source.pos : undefined;
  const args =
    toolName === 'text'
      ? (scaleTextArgs(sourceArgs, sourcePos, position) as unknown as ToolArgs)
      : (scaleVectorArgs(sourceArgs, sourcePos, position) as unknown as ToolArgs);
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
  const effectivePosition = layer.presentationBounds ?? position;
  const bitmap = layer.tmpCanvas ?? getLayerBitmap(layer, position);
  if (
    !bitmap ||
    bitmap.width === 0 ||
    bitmap.height === 0 ||
    effectivePosition.width === 0 ||
    effectivePosition.height === 0
  )
    return false;

  const hasBakedPresentation = layer.tmpCanvas !== null && layer.presentationBounds !== null;
  const operations: PresentationOperation[] = [];
  for (const operation of hasBakedPresentation ? [] : layer.operations) {
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
      position: effectivePosition,
      sourceSize: { width: effectivePosition.width, height: effectivePosition.height },
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

function createSnapshotSurface(backingSize: Size): SnapshotSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(backingSize.width, backingSize.height);
  const snapshot = document.createElement('canvas');
  snapshot.width = backingSize.width;
  snapshot.height = backingSize.height;
  return snapshot;
}

function snapshotVisibleCanvas(canvas: HTMLCanvasElement, backingSize: Size): SnapshotSurface | null {
  try {
    let snapshot = createSnapshotSurface(backingSize);
    let context = snapshot.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context || typeof context.drawImage !== 'function') {
      const fallback = document.createElement('canvas');
      fallback.width = backingSize.width;
      fallback.height = backingSize.height;
      snapshot = fallback;
      context = fallback.getContext('2d') as CanvasRenderingContext2D | null;
    }
    if (!context) return null;
    // `backingSize` and both surfaces are measured in backing pixels, at any DPR. Copy those
    // pixels 1:1 into the snapshot; the source canvas transform is irrelevant to drawImage and
    // must not be mutated.
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(canvas, 0, 0);
    return snapshot;
  } catch (error) {
    console.error('Unable to snapshot the visible runtime layer presentation', error);
    return null;
  }
}

/**
 * Puts the previous presentation back after a publish may have partially changed the target.
 *
 * The resize alone is not the restore: assigning `width` or `height` RESETS a canvas to fully
 * transparent, and the `clearRect` the publish issues empties one whatever its dimensions were.
 * So this runs as soon as a target write is attempted, and blits the snapshot back even when the
 * dimensions already matched — the wipe it reverses then is the clear, not a resize.
 */
function restoreVisibleCanvas(
  canvas: HTMLCanvasElement,
  backingSize: Size,
  backingScale: number,
  snapshot: SnapshotSurface | null
): void {
  try {
    // The saved dimensions came from canvas.width/height, which are backing pixels already.
    // Applying resizeCanvas's logical DPR scale here would scale the previous dimensions twice.
    canvas.width = backingSize.width;
    canvas.height = backingSize.height;
    if (backingScale !== 1) {
      canvas.getContext('2d')?.setTransform(backingScale, 0, 0, backingScale, 0, 0);
      canvas.setAttribute('data-hidpi-ratio', String(backingScale));
    } else {
      canvas.removeAttribute('data-hidpi-ratio');
    }
    if (!snapshot) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    // Both surfaces have the same raw backing dimensions. Reset the destination transform for a
    // 1:1 restore, then restore the target's normal logical-to-backing transform.
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(snapshot, 0, 0);
    context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
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
  documentFrame: DocumentFrame,
  silentMissingLayerIds?: ReadonlySet<string>,
  backingScale = 1,
  requireVisibleLayerBitmaps = false
): boolean {
  if (typeof document === 'undefined') return true;
  const size = documentFrameSize(documentFrame);
  const stagingCanvas = document.createElement('canvas');
  resizeCanvas(stagingCanvas, size.width, size.height, backingScale);
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
        if (!drawLayer(stagingContext, layer, documentFrame)) {
          if (requireVisibleLayerBitmaps) return false;
          if (!silentMissingLayerIds?.has(layer.id)) {
            console.error('skipped layer without bitmap', layer.id);
          }
        }
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
  const previousBackingScale = Number(canvas.getAttribute('data-hidpi-ratio')) || 1;
  // The publish WRITES the target, and it writes it in two steps: `resizeCanvas` resets a
  // resized canvas to transparent, and the `clearRect` empties one whose dimensions already
  // matched. A `drawImage` that threw between them left the document blank with nothing to put
  // back, and the caller flattened whatever was left. So the previous pixels are held aside in
  // EVERY case, not only when a resize has to be reversed — the snapshot is what makes the
  // clear-then-blit sequence recoverable, and the alternative (a single `copy` composite, which
  // is atomic and allocates nothing) is pinned to a different observable sequence by
  // `useHistory.test.tsx:455` and belongs to whoever owns that file.
  let snapshot: SnapshotSurface | null = null;
  let needsRestore = false;
  try {
    // Validate that the target canvas has a 2d context before doing any work.
    // This preserves the behavior that a missing context fails early without
    // resizing the canvas.
    const validationContext = canvas.getContext('2d');
    if (!validationContext) return false;
    snapshot = snapshotVisibleCanvas(canvas, previousSize);
    if (!snapshot) return false;
    needsRestore = true;
    resizeCanvas(canvas, size.width, size.height, backingScale);
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, size.width, size.height);
    // The staging canvas was rendered with a context scaled by backingScale, so its backing store
    // already holds device pixels. The target context is also scaled by backingScale, so a direct
    // drawImage would double-scale. Reset to identity for the blit, then the staging pixels copy 1:1.
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(stagingCanvas, 0, 0);
    return true;
  } catch (error) {
    if (needsRestore) restoreVisibleCanvas(canvas, previousSize, previousBackingScale, snapshot);
    console.error('Unable to publish runtime layer presentation', error);
    return false;
  }
}
