import { brushDabCenters, clampBrushTipSettings, tipAlphaAt, type BrushTipSettings } from '../util/brush-engine.ts';
import { blendPixel, clampPointToSize, forEachPixelInRect, readRgba } from '../util/pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type HealingBrushToolArgs = {
  size: number;
  hardness: number;
  opacity: number;
  source: Point | null;
  aligned: boolean;
  points: Point[];
  toolName: 'healing-brush';
};

export const HEALING_BRUSH_SPACING_PERCENT = 25;

const luminance = (red: number, green: number, blue: number): number => 0.299 * red + 0.587 * green + 0.114 * blue;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const cloneOffset = (source: Point, points: Point[], aligned: boolean): Point => {
  const anchor = aligned ? points[0] : points[points.length - 1];
  return { x: source.x - anchor.x, y: source.y - anchor.y };
};

const dabSpan = (center: Point, radius: number, size: Size) => ({
  left: Math.max(0, Math.ceil(center.x - radius)),
  top: Math.max(0, Math.ceil(center.y - radius)),
  right: Math.min(size.width - 1, Math.floor(center.x + radius)),
  bottom: Math.min(size.height - 1, Math.floor(center.y + radius)),
});

const healDab = (
  sourceData: Uint8ClampedArray,
  outputData: Uint8ClampedArray,
  raster: Size,
  target: Point,
  offset: Point,
  settings: BrushTipSettings
) => {
  const radius = settings.size / 2;
  const span = dabSpan(target, radius, raster);
  if (span.left > span.right || span.top > span.bottom) return;

  forEachPixelInRect(raster, span, (x, y, byteOffset) => {
    const weight = tipAlphaAt(Math.hypot(x - target.x, y - target.y), radius, settings.hardness) * settings.opacity;
    if (!(weight > 0)) return;
    const sourcePoint = clampPointToSize({ x: Math.round(x + offset.x), y: Math.round(y + offset.y) }, raster);
    const source = readRgba(sourceData, sourcePoint.x, sourcePoint.y, raster.width);
    const destination = readRgba(outputData, x, y, raster.width);
    const correction = luminance(destination.r, destination.g, destination.b) - luminance(source.r, source.g, source.b);
    blendPixel(
      outputData,
      byteOffset,
      {
        r: clampChannel(source.r + correction),
        g: clampChannel(source.g + correction),
        b: clampChannel(source.b + correction),
        a: source.a,
      },
      weight
    );
  });
};

export const healingBrush =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ size: tipSize, hardness, opacity, source, aligned, points }: HealingBrushToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    if (
      !source ||
      points.length === 0 ||
      typeof ctx.getImageData !== 'function' ||
      typeof ctx.putImageData !== 'function'
    )
      return [canvas];

    const settings = clampBrushTipSettings({
      size: tipSize,
      hardness,
      opacity,
      spacing: HEALING_BRUSH_SPACING_PERCENT,
    });
    const centers = brushDabCenters(points, settings.size, settings.spacing);
    if (centers.length === 0) return [canvas];
    const image = ctx.getImageData(0, 0, size.width, size.height);
    const sourceData = new Uint8ClampedArray(image.data);
    const offset = cloneOffset(source, centers, aligned);
    for (const center of centers) healDab(sourceData, image.data, size, center, offset, settings);
    ctx.putImageData(image, 0, 0);
    return [canvas];
  };
