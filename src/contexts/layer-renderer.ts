import type { BitmapSource, Pos, Size } from './general-types.ts';
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
import { drawShape, normalizeFigure, setShapeCtx, type ShapeToolArgs } from '../tools/shape.ts';

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
const rasterPreviewCanvases = new WeakSet<object>();
const sourceOnlyShapeBitmapCache = new WeakMap<object, { source: object; isSourceOnly: boolean }>();
const SHAPE_BITMAP_COMPARE_TILE_SIZE = 256;
const MAX_SHAPE_BITMAP_COMPARE_PIXELS = 16_777_216;

function outputScale(ctx: CanvasRenderingContext2D): number {
  const getTransform = (ctx as CanvasRenderingContext2D & { getTransform?: () => DOMMatrix }).getTransform;
  const transform = getTransform?.call(ctx);
  if (!transform) return 1;

  const trace = transform.a ** 2 + transform.b ** 2 + transform.c ** 2 + transform.d ** 2;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  const scale = Math.sqrt((trace + Math.sqrt(Math.max(0, trace ** 2 - 4 * determinant ** 2))) / 2);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function validShapeGeometry(
  args: ShapeToolArgs | null,
  sourcePos: Pos | undefined,
  position: Pos
): { args: ShapeToolArgs; sourcePos: Pos } | null {
  const start = args?.start;
  const end = args?.end;
  if (
    !args ||
    !sourcePos ||
    !start ||
    !end ||
    !Number.isFinite(sourcePos.x) ||
    !Number.isFinite(sourcePos.y) ||
    !Number.isFinite(sourcePos.width) ||
    !Number.isFinite(sourcePos.height) ||
    sourcePos.width <= 0 ||
    sourcePos.height <= 0 ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.width) ||
    !Number.isFinite(position.height) ||
    position.width <= 0 ||
    position.height <= 0 ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    return null;
  }
  return { args, sourcePos };
}

function createShapeSurface(size: Size): {
  surface: SnapshotSurface;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} | null {
  let surface: SnapshotSurface | null = null;
  try {
    surface = createSnapshotSurface(size);
    let context = surface.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context || typeof context.drawImage !== 'function') {
      releaseShapeSurface(surface);
      const fallback = document.createElement('canvas');
      fallback.width = size.width;
      fallback.height = size.height;
      surface = fallback;
      context = fallback.getContext('2d');
    }
    if (!context) {
      releaseShapeSurface(surface);
      return null;
    }
    return { surface, context };
  } catch {
    if (surface) releaseShapeSurface(surface);
    return null;
  }
}

function releaseShapeSurface(surface: SnapshotSurface): void {
  surface.width = 0;
  surface.height = 0;
}

function hasUsableRaster(bitmap: BitmapSource | null): bitmap is BitmapSource {
  return Boolean(
    bitmap && Number.isFinite(bitmap.width) && Number.isFinite(bitmap.height) && bitmap.width > 0 && bitmap.height > 0
  );
}

function bitmapMatchesShapeSource(bitmap: BitmapSource, source: object, args: ShapeToolArgs, sourcePos: Pos): boolean {
  if (bitmap.width > MAX_SHAPE_BITMAP_COMPARE_PIXELS / bitmap.height) return false;

  const bitmapKey = bitmap as object;
  // Only ImageBitmap exposes close(); unlike canvases and image elements, its
  // pixels cannot change while retaining the same object identity.
  const immutableBitmap = typeof (bitmap as { close?: unknown }).close === 'function';
  const cached = immutableBitmap ? sourceOnlyShapeBitmapCache.get(bitmapKey) : undefined;
  if (cached?.source === source) return cached.isSourceOnly;

  let sourceSurface: ReturnType<typeof createShapeSurface> = null;
  let compareSurface: ReturnType<typeof createShapeSurface> = null;
  let isSourceOnly = false;
  try {
    const cacheSize = { width: bitmap.width, height: bitmap.height };
    sourceSurface = createShapeSurface(cacheSize);
    compareSurface = createShapeSurface({
      width: Math.min(bitmap.width, SHAPE_BITMAP_COMPARE_TILE_SIZE),
      height: Math.min(bitmap.height, SHAPE_BITMAP_COMPARE_TILE_SIZE),
    });
    if (!sourceSurface || !compareSurface) return false;

    const renderArgs = scaleVectorArgs(
      args as unknown as Record<string, unknown>,
      sourcePos,
      sourcePos
    ) as unknown as ShapeToolArgs;
    const normalizedArgs: ShapeToolArgs = {
      ...renderArgs,
      toolName: 'shape',
      figure: normalizeFigure(renderArgs.figure),
    };
    const sourceContext = sourceSurface.context as CanvasRenderingContext2D;
    sourceContext.setTransform(1, 0, 0, 1, 0, 0);
    sourceContext.globalAlpha = 1;
    sourceContext.globalCompositeOperation = 'source-over';
    sourceContext.filter = 'none';
    setShapeCtx(sourceContext, normalizedArgs);
    drawShape(sourceContext, normalizedArgs);

    const compareContext = compareSurface.context as CanvasRenderingContext2D;
    compareContext.setTransform(1, 0, 0, 1, 0, 0);
    compareContext.globalAlpha = 1;
    compareContext.globalCompositeOperation = 'source-over';
    compareContext.filter = 'none';
    isSourceOnly = true;
    for (let y = 0; y < bitmap.height && isSourceOnly; y += SHAPE_BITMAP_COMPARE_TILE_SIZE) {
      for (let x = 0; x < bitmap.width && isSourceOnly; x += SHAPE_BITMAP_COMPARE_TILE_SIZE) {
        const tileWidth = Math.min(SHAPE_BITMAP_COMPARE_TILE_SIZE, bitmap.width - x);
        const tileHeight = Math.min(SHAPE_BITMAP_COMPARE_TILE_SIZE, bitmap.height - y);
        const sourcePixels = sourceContext.getImageData(x, y, tileWidth, tileHeight).data;
        compareContext.clearRect(0, 0, compareSurface.surface.width, compareSurface.surface.height);
        compareContext.drawImage(bitmap, -x, -y, bitmap.width, bitmap.height);
        const cachedPixels = compareContext.getImageData(0, 0, tileWidth, tileHeight).data;
        isSourceOnly = sourcePixels.length === cachedPixels.length;
        for (let index = 0; isSourceOnly && index < sourcePixels.length; index += 1) {
          if (sourcePixels[index] !== cachedPixels[index]) isSourceOnly = false;
        }
      }
    }
  } catch {
    isSourceOnly = false;
  } finally {
    if (sourceSurface) releaseShapeSurface(sourceSurface.surface);
    if (compareSurface) releaseShapeSurface(compareSurface.surface);
  }

  if (immutableBitmap) sourceOnlyShapeBitmapCache.set(bitmapKey, { source, isSourceOnly });
  return isSourceOnly;
}

function getLayerBitmap(layer: Layer, position: Pos) {
  if (hasUsableRaster(layer.tmpCanvas)) return layer.tmpCanvas;
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
  documentFrame?: DocumentFrame,
  preferCachedSource = false
): boolean {
  const presentationBounds = layer.presentationBounds;
  const hasBakedPresentation =
    presentationBounds !== null &&
    presentationBounds !== undefined &&
    (hasUsableRaster(layer.tmpCanvas) || (layer.tmpCanvas === null && hasUsableRaster(layer.bitmap)));
  const effectivePosition = hasBakedPresentation ? presentationBounds : position;
  if (effectivePosition.width === 0 || effectivePosition.height === 0) return false;

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

  const source = layer.source;
  const isRetainedVectorSource = source?.kind === 'tool' && vectorToolNames.has(source.args.toolName);
  const shapeSourcePos = source?.kind === 'tool' && 'pos' in source ? source.pos : undefined;
  const shapeSourceArgs =
    source?.kind === 'tool' && 'figure' in source.args ? (source.args as unknown as ShapeToolArgs) : null;
  const shapeGeometry = isRetainedVectorSource ? validShapeGeometry(shapeSourceArgs, shapeSourcePos, position) : null;
  const bitmapIsSourceOnly = Boolean(
    layer.bitmap &&
    !preferCachedSource &&
    isRetainedVectorSource &&
    source?.kind === 'tool' &&
    shapeGeometry &&
    bitmapMatchesShapeSource(layer.bitmap, source, shapeGeometry.args, shapeGeometry.sourcePos)
  );
  if (
    isRetainedVectorSource &&
    shapeGeometry &&
    operations.length === 0 &&
    (presentationBounds === null || presentationBounds === undefined) &&
    (layer.bitmap === null || bitmapIsSourceOnly) &&
    !preferCachedSource &&
    (shapeGeometry.args.toolMode === undefined || shapeGeometry.args.toolMode === 'shape')
  ) {
    const scaledArgs = scaleVectorArgs(
      shapeGeometry.args as unknown as Record<string, unknown>,
      shapeGeometry.sourcePos,
      position
    ) as unknown as ShapeToolArgs;
    const shapeArgs: ShapeToolArgs = {
      ...scaledArgs,
      toolName: 'shape',
      figure: normalizeFigure(scaledArgs.figure),
    };

    const scale = outputScale(ctx);
    const surfaceSize = {
      width: Math.max(1, Math.ceil(position.width * scale)),
      height: Math.max(1, Math.ceil(position.height * scale)),
    };
    const shapeSurface = createShapeSurface(surfaceSize);
    if (shapeSurface) {
      let rendered = false;
      try {
        const shapeCtx = shapeSurface.context as CanvasRenderingContext2D;
        shapeCtx.save();
        try {
          shapeCtx.setTransform(surfaceSize.width / position.width, 0, 0, surfaceSize.height / position.height, 0, 0);
          shapeCtx.filter = 'none';
          shapeCtx.globalAlpha = 1;
          shapeCtx.globalCompositeOperation = 'source-over';
          setShapeCtx(shapeCtx, shapeArgs);
          drawShape(shapeCtx, shapeArgs);
        } finally {
          shapeCtx.restore();
        }

        ctx.save();
        try {
          ctx.filter = 'none';
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            shapeSurface.surface,
            position.x - (documentFrame?.x ?? 0),
            position.y - (documentFrame?.y ?? 0),
            position.width,
            position.height
          );
        } finally {
          ctx.restore();
        }
        rendered = true;
      } catch {
        // Failure in this optional sharp-render path must not hide a valid cached raster.
      } finally {
        releaseShapeSurface(shapeSurface.surface);
      }
      if (rendered) return true;
    }
  }

  const cachedRaster = isRetainedVectorSource
    ? preferCachedSource
      ? hasUsableRaster(layer.tmpCanvas)
        ? layer.tmpCanvas
        : hasUsableRaster(layer.bitmap)
          ? layer.bitmap
          : null
      : hasUsableRaster(layer.tmpCanvas)
        ? layer.tmpCanvas
        : hasUsableRaster(layer.bitmap)
          ? layer.bitmap
          : null
    : hasUsableRaster(layer.tmpCanvas)
      ? layer.tmpCanvas
      : hasBakedPresentation && hasUsableRaster(layer.bitmap)
        ? layer.bitmap
        : null;
  const bitmap =
    cachedRaster ??
    (source?.kind === 'tool' && source.args.toolName === 'shape' && 'figure' in source.args && !shapeGeometry
      ? null
      : getLayerBitmap(layer, position));
  if (!hasUsableRaster(bitmap)) return false;

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

export function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  documentFrame?: DocumentFrame,
  preferCachedSource = false
): boolean {
  ctx.save();
  try {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    return drawLayerSource(ctx, layer, layer.pos, documentFrame, preferCachedSource);
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
  previewLayerIds?: ReadonlySet<string>,
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
        const isPreview = previewLayerIds?.has(layer.id) ?? false;
        if (isPreview && layer.tmpCanvas) rasterPreviewCanvases.add(layer.tmpCanvas as object);
        const hasRasterPreview = layer.tmpCanvas !== null && rasterPreviewCanvases.has(layer.tmpCanvas as object);
        if (!drawLayer(stagingContext, layer, documentFrame, isPreview || hasRasterPreview)) {
          if (requireVisibleLayerBitmaps) return false;
          if (!isPreview) {
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
