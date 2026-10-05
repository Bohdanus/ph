import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import type { Point, Pos } from '../contexts/general-types.ts';

export type BlurToolArgs = {
  radius: number;
  points?: Point[];
  rasterBounds?: Pos;
  toolName: 'blur';
};

const STROKE_BRUSH_SIZE = 40;

const maskFilteredRaster = (
  source: ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas,
  filtered: OffscreenCanvas,
  size: { width: number; height: number },
  points: readonly Point[]
): OffscreenCanvas => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  if (points.length === 0) return canvas;

  ctx.save();
  ctx.beginPath();
  if (points.length === 1) {
    ctx.arc(points[0]!.x, points[0]!.y, STROKE_BRUSH_SIZE / 2, 0, Math.PI * 2);
  } else {
    for (const point of points) ctx.arc(point.x, point.y, STROKE_BRUSH_SIZE / 2, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.drawImage(filtered, 0, 0);
  ctx.restore();
  return canvas;
};

export const blur =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ radius, points }: BlurToolArgs) => {
    requireCanvasFilter('blur');

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    // The legacy no-points form remains a whole-layer filter for old history and slider
    // entries.  A stroke is the Photoshop tool form and is composited only under its tip.
    ctx.filter = `blur(${points?.length ? Math.max(1, radius) : radius}px)`;
    ctx.drawImage(bitmap, 0, 0);

    return [points?.length ? maskFilteredRaster(bitmap, canvas, size, points) : canvas];
  };
