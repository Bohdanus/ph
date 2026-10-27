import {
  BRUSH_SPACING_DEFAULT,
  brushDabCenters,
  clampBrushTipSettings,
  tipAlphaAt,
  type BrushTipSettings,
} from '../util/brush-engine.ts';
import { blendPixel, clampPointToSize, forEachPixelInRect, readRgba } from '../util/pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type SpotHealingToolArgs = {
  size: number;
  hardness: number;
  opacity: number;
  points: Point[];
  toolName: 'spot-healing';
};

export type SpotHealingToolSettings = Omit<SpotHealingToolArgs, 'points'>;

export const SPOT_HEALING_SPACING_PERCENT = BRUSH_SPACING_DEFAULT;

type PixelSpan = { left: number; top: number; right: number; bottom: number };

const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

const dabSpan = (center: Point, radius: number, width: number, height: number): PixelSpan | null => {
  const left = Math.max(0, Math.ceil(center.x - radius));
  const right = Math.min(width - 1, Math.floor(center.x + radius));
  const top = Math.max(0, Math.ceil(center.y - radius));
  const bottom = Math.min(height - 1, Math.floor(center.y + radius));
  return left > right || top > bottom ? null : { left, top, right, bottom };
};

const proximitySample = (
  sourceData: Uint8ClampedArray,
  raster: Size,
  center: Point,
  x: number,
  y: number,
  radius: number
) => {
  const dx = x - center.x;
  const dy = y - center.y;
  const distance = Math.hypot(dx, dy);
  const direction = distance > 0 ? { x: dx / distance, y: dy / distance } : { x: 0, y: -1 };
  const sampleDistance = Math.max(radius + 1, distance + radius * 0.75);
  const sample = clampPointToSize(
    { x: Math.round(center.x + direction.x * sampleDistance), y: Math.round(center.y + direction.y * sampleDistance) },
    raster
  );
  return readRgba(sourceData, sample.x, sample.y, raster.width);
};

const healDab = (
  sourceData: Uint8ClampedArray,
  outputData: Uint8ClampedArray,
  raster: Size,
  center: Point,
  settings: BrushTipSettings
): void => {
  const radius = settings.size / 2;
  const span = dabSpan(center, radius, raster.width, raster.height);
  if (!span) return;

  forEachPixelInRect(raster, span, (x, y, byteOffset) => {
    const weight = tipAlphaAt(Math.hypot(x - center.x, y - center.y), radius, settings.hardness) * settings.opacity;
    if (!(weight > 0)) return;
    blendPixel(outputData, byteOffset, proximitySample(sourceData, raster, center, x, y, radius), weight);
  });
};

const healStroke = (
  ctx: OffscreenCanvasRenderingContext2D,
  size: Size,
  points: Point[],
  settings: BrushTipSettings
): void => {
  if (points.length === 0 || !(settings.opacity > 0) || settings.size <= 0) return;
  const raster: Size = { width: extent(size.width), height: extent(size.height) };
  if (raster.width === 0 || raster.height === 0) return;
  const centers = brushDabCenters(points, settings.size, settings.spacing);
  if (centers.length === 0) return;

  const image = ctx.getImageData(0, 0, raster.width, raster.height);
  const sourceData = new Uint8ClampedArray(image.data);
  for (const center of centers) healDab(sourceData, image.data, raster, center, settings);
  ctx.putImageData(image, 0, 0);
};

export const spotHealing =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ size: tipSize, hardness, opacity, points }: SpotHealingToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    if (!points.length || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function')
      return [canvas];

    const settings = clampBrushTipSettings({
      size: tipSize,
      hardness,
      opacity,
      spacing: SPOT_HEALING_SPACING_PERCENT,
    });
    healStroke(ctx, size, points, settings);
    return [canvas];
  };
