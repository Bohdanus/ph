import type { Pos } from './general-types.ts';
import type { Layer, LayerOperation, ToolLayerSource } from './layer-types.ts';
import type { ToolArgs, ToolName } from './tool-types.ts';
import { buildColorsFilter, buildLevelsFilter } from '../tools/functions.ts';
import { findToolProcessor, type CreatorToolParams } from '../tools/toolProcessors.ts';
import { documentFrameSize, type DocumentFrame } from './document-frame.ts';
import { getLayerAffineTransform, isIdentityAffineTransform } from './affine-transform.ts';
import { resizeCanvas } from '../util/canvas.ts';

function filterForOperation(operation: Extract<LayerOperation, { args: unknown }>): string {
  const { args } = operation;
  switch (args.toolName) {
    case 'blur':
      return `blur(${args.radius}px)`;
    case 'color':
      return buildColorsFilter(args);
    case 'levels':
      return buildLevelsFilter(args);
  }
}

export function getLayerFilter(operations: readonly LayerOperation[]): string {
  const filters = operations
    .filter(
      (operation): operation is Extract<LayerOperation, { args: unknown }> =>
        operation.enabled && operation.kind !== 'affine-transform' && 'args' in operation
    )
    .map(filterForOperation);
  return filters.length ? filters.join(' ') : 'none';
}

const vectorToolNames = new Set<ToolName>(['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line']);

function isVectorSource(source: Layer['source']): source is ToolLayerSource {
  return !!source && source.kind === 'tool' && vectorToolNames.has(source.args.toolName);
}

function scaleVectorArgs(args: ToolArgs, source: ToolLayerSource, position: Pos): ToolArgs {
  if (!('pos' in source) || !('start' in args) || !args.start || !args.end) return args;
  const scaleX = position.width / source.pos.width;
  const scaleY = position.height / source.pos.height;
  const lineWidth = 'lineWidth' in args ? args.lineWidth * Math.sqrt(Math.abs(scaleX * scaleY)) : undefined;
  return {
    ...args,
    start: { x: args.start.x * scaleX, y: args.start.y * scaleY },
    end: { x: args.end.x * scaleX, y: args.end.y * scaleY },
    ...(lineWidth === undefined ? {} : { lineWidth }),
  } as ToolArgs;
}

function getLayerBitmap(layer: Layer, position: Pos) {
  if (layer.tmpCanvas) return layer.tmpCanvas;
  if (!isVectorSource(layer.source)) return layer.bitmap;

  const args = scaleVectorArgs(layer.source.args, layer.source, position);
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
  if (!bitmap || bitmap.width === 0 || bitmap.height === 0) return false;

  ctx.save();
  try {
    const affine = getLayerAffineTransform(layer);
    ctx.filter = getLayerFilter(layer.operations);
    const x = position.x - (documentFrame?.x ?? 0);
    const y = position.y - (documentFrame?.y ?? 0);
    if (isIdentityAffineTransform(affine)) {
      ctx.drawImage(bitmap, x, y, position.width, position.height);
    } else {
      // Product ordering is deliberate: retained affine operations compose in
      // source order, then the filter stack is applied to that transformed
      // presentation. Arbitrary affine/filter interleaving is not represented
      // by the current canvas filter API.
      ctx.translate(x, y);
      ctx.transform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
      ctx.drawImage(bitmap, 0, 0, position.width, position.height);
    }
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

/**
 * Keeps the last visible canvas intact when a source or processor fails while
 * composing a new runtime presentation. The target changes only after every
 * layer has drawn successfully to an isolated staging canvas.
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
      if (!drawLayer(stagingContext, layer, documentFrame)) console.error('skipped layer without bitmap', layer.id);
    }
  } catch (error) {
    console.error('Unable to compose runtime layer presentation', error);
    return false;
  }

  try {
    resizeCanvas(canvas, size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(stagingCanvas, 0, 0);
    return true;
  } catch (error) {
    console.error('Unable to publish runtime layer presentation', error);
    return false;
  }
}
