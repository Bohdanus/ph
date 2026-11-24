import type { BitmapSource, Pos, Size } from './general-types.ts';
import {
  isToolSourceRematerializedAtBounds,
  RETAINED_VECTOR_TOOL_NAMES,
  type Layer,
  type LayerOperation,
  type ToolLayerSource,
} from './layer-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { findToolProcessor, type CreatorToolParams } from '../tools/toolProcessors.ts';
import { documentFrameSize, type DocumentFrame } from './document-frame.ts';
import { recordLayerRenderTelemetry, type LayerRenderOutcome } from './render-telemetry.ts';
import {
  CanvasFilterUnsupportedError,
  FilterArgumentUnrenderableError,
  requireCanvasFilter,
} from '../util/canvas-filter.ts';
import { clearCanvasBackingStore, resizeCanvas } from '../util/canvas.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentationForDraw,
  getPresentationFilter,
  scaleTextArgs,
  scaleVectorArgs,
  type PresentationDrawTarget,
  type PresentationOperation,
} from './presentation-evaluator.ts';
import { drawLine } from '../util/draw.ts';
import { setupDrawCtx, type DrawToolArgs } from '../tools/draw.ts';
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

const vectorToolNames = RETAINED_VECTOR_TOOL_NAMES;
const rasterPreviewCanvases = new WeakSet<object>();
const sourceOnlyShapeBitmapCache = new WeakMap<object, { source: object; isSourceOnly: boolean }>();
const SHAPE_BITMAP_COMPARE_TILE_SIZE = 256;
const MAX_SHAPE_BITMAP_COMPARE_PIXELS = 16_777_216;

function isPositionedDrawSource(source: Layer['source']): source is ToolLayerSource & { args: DrawToolArgs; pos: Pos } {
  return source?.kind === 'tool' && 'pos' in source && source.args.toolName === 'draw';
}

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
  if (!isToolSourceRematerializedAtBounds(toolName)) return layer.bitmap;
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
  preferCachedSource = false,
  backingScale = 1
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
  if (
    isPositionedDrawSource(source) &&
    !source.args.blockStamp &&
    source.args.composite !== 'destination-out' &&
    // Spray stamps overlap; any transparency must composite the cached stroke as a group.
    (source.args.penType !== 'spray' || (layer.opacity === 1 && (layer.fillOpacity ?? 1) === 1)) &&
    operations.length === 0 &&
    (presentationBounds === null || presentationBounds === undefined) &&
    layer.blendMode === 'source-over' &&
    source.pos.width === position.width &&
    source.pos.height === position.height &&
    !preferCachedSource &&
    // If the layer has a tmpCanvas from a creator tool, use it instead of re-drawing.
    // The tmpCanvas has the stroke drawn at the correct HiDPI resolution.
    !hasUsableRaster(layer.tmpCanvas)
  ) {
    const x = position.x - (documentFrame?.x ?? 0);
    const y = position.y - (documentFrame?.y ?? 0);
    ctx.save();
    try {
      ctx.filter = 'none';
      ctx.beginPath();
      ctx.rect(x, y, position.width, position.height);
      ctx.clip();
      ctx.translate(x, y);
      const layerOpacity = ctx.globalAlpha;
      setupDrawCtx(ctx, source.args);
      if (source.args.penType !== 'spray') ctx.globalAlpha = source.args.alpha * layerOpacity;
      drawLine({ args: source.args, ctx });
    } finally {
      ctx.restore();
    }
    return true;
  }

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

  // Use the bitmap's actual pixel dimensions as sourceSize when drawing to a HiDPI canvas
  // (backingScale > 1). For 1x canvases, use the effectivePosition (CSS pixels) so that
  // HiDPI bitmaps are scaled down to CSS size.
  const sourceSize =
    backingScale > 1
      ? { width: bitmap.width, height: bitmap.height }
      : { width: effectivePosition.width, height: effectivePosition.height };

  const target: PresentationDrawTarget = { kind: 'document', frame: documentFrame };
  const evaluation = evaluatePresentationForDraw(
    {
      position: effectivePosition,
      sourceSize,
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
  preferCachedSource = false,
  backingScale = 1
): boolean {
  ctx.save();
  try {
    ctx.globalAlpha = layer.opacity * (layer.fillOpacity ?? 1);
    ctx.globalCompositeOperation = layer.blendMode;
    return drawLayerSource(ctx, layer, layer.pos, documentFrame, preferCachedSource, backingScale);
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

type MutableLayerRenderTelemetry = {
  documentWidth: number;
  documentHeight: number;
  visibleLayerCount: number;
  skippedLayerCount: number;
  failedLayerId: string | null;
  outcome: LayerRenderOutcome;
};

function monotonicNow(): number {
  const now = typeof performance !== 'undefined' ? performance.now : undefined;
  return typeof now === 'function' ? now.call(performance) : Date.now();
}

/**
 * Puts the previous presentation back after a publish may have partially changed the target.
 *
 * Resizing resets the canvas to transparent, and the clear issued during publish empties it
 * even when dimensions already match. Restore therefore blits the snapshot back after either
 * kind of partial write.
 */
function restoreVisibleCanvas(
  canvas: HTMLCanvasElement,
  backingSize: Size,
  backingScale: number,
  snapshot: SnapshotSurface | null
): boolean {
  try {
    if (!snapshot) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    // Check the source and destination before resizing, which clears the visible canvas.
    canvas.width = backingSize.width;
    canvas.height = backingSize.height;
    if (backingScale !== 1) {
      canvas.setAttribute('data-hidpi-ratio', String(backingScale));
    } else {
      canvas.removeAttribute('data-hidpi-ratio');
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(snapshot, 0, 0);
    context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    return true;
  } catch (error) {
    console.error('Unable to restore runtime layer presentation', error);
    return false;
  }
}

function drawLayersToCanvasAttempt(
  canvas: HTMLCanvasElement,
  layers: readonly Layer[],
  documentFrame: DocumentFrame,
  previewLayerIds: ReadonlySet<string> | undefined,
  backingScale: number,
  requireVisibleLayerBitmaps: boolean,
  telemetry: MutableLayerRenderTelemetry | null
): boolean {
  const size = documentFrameSize(documentFrame);
  if (telemetry) {
    telemetry.documentWidth = size.width;
    telemetry.documentHeight = size.height;
  }
  const stagingCanvas = document.createElement('canvas');
  resizeCanvas(stagingCanvas, size.width, size.height, backingScale);
  const stagingContext = stagingCanvas.getContext('2d');
  if (!stagingContext) {
    if (telemetry) telemetry.outcome = 'staging-context-missing';
    return false;
  }

  try {
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (telemetry) telemetry.visibleLayerCount += 1;
      // A filter unsupported by this browser, or arguments that cannot be rendered, only skips
      // this layer. The staging canvas is discarded on failure, preserving the current display.
      try {
        const isPreview = previewLayerIds?.has(layer.id) ?? false;
        if (isPreview && layer.tmpCanvas) rasterPreviewCanvases.add(layer.tmpCanvas as object);
        const hasRasterPreview = layer.tmpCanvas !== null && rasterPreviewCanvases.has(layer.tmpCanvas as object);
        if (!drawLayer(stagingContext, layer, documentFrame, isPreview || hasRasterPreview, backingScale)) {
          if (requireVisibleLayerBitmaps) {
            if (telemetry) {
              telemetry.failedLayerId = layer.id;
              telemetry.outcome = 'required-layer-bitmap-missing';
            }
            return false;
          }
          if (telemetry) telemetry.skippedLayerCount += 1;
          if (!isPreview) {
            console.error('skipped layer without bitmap', layer.id);
          }
        }
      } catch (error) {
        if (error instanceof FilterArgumentUnrenderableError) {
          if (telemetry) telemetry.skippedLayerCount += 1;
          console.error('skipped layer whose filter arguments cannot be rendered', layer.id, error);
          continue;
        }
        if (!(error instanceof CanvasFilterUnsupportedError)) {
          if (telemetry) telemetry.failedLayerId = layer.id;
          throw error;
        }
        if (telemetry) telemetry.skippedLayerCount += 1;
        console.error('skipped layer whose filter this browser cannot apply', layer.id, error);
      }
    }
  } catch (error) {
    if (telemetry) telemetry.outcome = 'composition-failed';
    console.error('Unable to compose runtime layer presentation', error);
    return false;
  }

  const previousSize = { width: canvas.width, height: canvas.height };
  const previousBackingScale = Number(canvas.getAttribute('data-hidpi-ratio')) || 1;
  // Publish resizes and clears the target before blitting. Keep the old pixels aside in every
  // case so a failure midway through the write can restore the last complete presentation.
  // The canvas publication sequence is covered by the publish and restore expectations in
  // useHistory.test.tsx; changing it belongs with that owning contract.
  let snapshot: SnapshotSurface | null = null;
  let needsRestore = false;
  let targetPhase: 'validate' | 'snapshot' = 'validate';
  try {
    // Validate the target before any work so a missing context fails without resizing it.
    const validationContext = canvas.getContext('2d');
    if (!validationContext) {
      if (telemetry) telemetry.outcome = 'target-context-missing';
      return false;
    }
    targetPhase = 'snapshot';
    snapshot = snapshotVisibleCanvas(canvas, previousSize);
    if (!snapshot) {
      if (telemetry) telemetry.outcome = 'snapshot-failed';
      return false;
    }
    needsRestore = true;
    resizeCanvas(canvas, size.width, size.height, backingScale);
    const context = canvas.getContext('2d');
    if (!context) {
      // Resizing reset the old pixels, so attempt to restore them even though publish cannot proceed.
      const restored = restoreVisibleCanvas(canvas, previousSize, previousBackingScale, snapshot);
      if (telemetry) telemetry.outcome = restored ? 'target-context-missing-restored' : 'restore-failed';
      return false;
    }
    clearCanvasBackingStore(context);
    // Staging already contains device pixels. Reset the target transform so the blit copies them
    // 1:1 instead of applying backingScale a second time.
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(stagingCanvas, 0, 0);
    if (telemetry) {
      telemetry.outcome = telemetry.skippedLayerCount > 0 ? 'published-with-skips' : 'published';
    }
    return true;
  } catch (error) {
    if (needsRestore) {
      const restored = restoreVisibleCanvas(canvas, previousSize, previousBackingScale, snapshot);
      if (telemetry) telemetry.outcome = restored ? 'publish-failed-restored' : 'restore-failed';
    } else if (telemetry) {
      telemetry.outcome = targetPhase === 'snapshot' ? 'snapshot-failed' : 'target-context-missing';
    }
    console.error('Unable to publish runtime layer presentation', error);
    return false;
  }
}

/**
 * Composes an isolated runtime presentation and only publishes it after the visible layers draw.
 * Development telemetry records outcomes outside editor state and does not affect rendering.
 */
export function drawLayersToCanvas(
  canvas: HTMLCanvasElement,
  layers: readonly Layer[],
  documentFrame: DocumentFrame,
  previewLayerIds?: ReadonlySet<string>,
  backingScale = 1,
  requireVisibleLayerBitmaps = false
): boolean {
  // Server-side rendering has no canvas attempt to measure; preserve the existing no-op result.
  if (typeof document === 'undefined') return true;

  let startedAt = 0;
  let telemetry: MutableLayerRenderTelemetry | null = null;
  if (import.meta.env.DEV) {
    try {
      const start = monotonicNow();
      telemetry = {
        documentWidth: 0,
        documentHeight: 0,
        visibleLayerCount: 0,
        skippedLayerCount: 0,
        failedLayerId: null,
        outcome: 'uncaught-error',
      };
      startedAt = start;
    } catch {
      // Diagnostics setup must not prevent the renderer from running.
    }
  }

  try {
    return drawLayersToCanvasAttempt(
      canvas,
      layers,
      documentFrame,
      previewLayerIds,
      backingScale,
      requireVisibleLayerBitmaps,
      telemetry
    );
  } catch (error) {
    if (telemetry) telemetry.outcome = 'uncaught-error';
    throw error;
  } finally {
    if (telemetry) {
      try {
        const completedAt = monotonicNow();
        recordLayerRenderTelemetry({
          recordedAtEpochMs: Date.now(),
          durationMs: Math.max(0, completedAt - startedAt),
          documentWidth: telemetry.documentWidth,
          documentHeight: telemetry.documentHeight,
          backingScale,
          visibleLayerCount: telemetry.visibleLayerCount,
          skippedLayerCount: telemetry.skippedLayerCount,
          failedLayerId: telemetry.failedLayerId,
          outcome: telemetry.outcome,
        });
      } catch {
        // Diagnostic collection must never change rendering or document behavior.
      }
    }
  }
}
