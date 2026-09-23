import type { Pos } from './general-types.ts';
import type { Layer, LayerOperation, ToolLayerSource } from './layer-types.ts';
import type { ToolArgs, ToolName } from './tool-types.ts';
import { exp1_1 } from '../tools/functions.ts';
import { toolProcessors, type CreatorToolParams } from '../tools/toolProcessors.ts';
import type { DocumentFrame } from './document-frame.ts';

function filterForOperation(operation: LayerOperation): string {
  const { args } = operation;
  switch (args.toolName) {
    case 'blur':
      return `blur(${args.radius}px)`;
    case 'color':
      return `grayscale(${args.grayscale}%) sepia(${args.sepia}%) saturate(${exp1_1(args.saturation, 2.1)})`;
    case 'levels':
      return `brightness(${exp1_1(args.brightness, 1.9)}) contrast(${exp1_1(args.contrast, 2.2)})`;
  }
}

export function getLayerFilter(operations: readonly LayerOperation[]): string {
  const filters = operations.filter((operation) => operation.enabled).map(filterForOperation);
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
  const [canvas] = toolProcessors[args.toolName].imageProcessor({ size: position } as CreatorToolParams)(args);
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
    ctx.filter = getLayerFilter(layer.operations);
    ctx.drawImage(
      bitmap,
      position.x - (documentFrame?.x ?? 0),
      position.y - (documentFrame?.y ?? 0),
      position.width,
      position.height
    );
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
