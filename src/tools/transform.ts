import type { AffineTransform } from '../contexts/affine-transform.ts';
import {
  MAX_AFFINE_COORDINATE,
  MAX_AFFINE_PIXELS,
  getAffineBounds,
  transformToolArgsToAffine,
} from '../contexts/affine-transform.ts';
import type { BitmapSource, Point, Pos, Size } from '../contexts/general-types.ts';
import { invertHomography, solveHomography } from '../util/homography.ts';
import { resampleThroughHomographyRowByRow } from '../util/homography-resample.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type TransformToolArgs = {
  rotate: number;
  mirrorH: boolean;
  mirrorV: boolean;
  skewX: number;
  skewY: number;
  trapezoid: number;
  resizeX: number;
  resizeY: number;

  toolName: 'transform';
};
export function getTransformDrawMatrix(transform: AffineTransform, bounds: Pos): AffineTransform {
  return Object.freeze({
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    e: transform.e - bounds.x,
    f: transform.f - bounds.y,
  });
}

function sourceRectCorners(size: Size): Point[] {
  return [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ];
}

export function getTrapezoidQuad(size: Size, trapezoid: number): Point[] {
  const factor = trapezoid / 100;

  return sourceRectCorners(size).map((corner) => {
    const progress = corner.y / size.height;
    const rowScale = factor > 0 ? 1 - factor * progress : 1 + factor * (1 - progress);
    return {
      x: corner.x * rowScale + (size.width - size.width * rowScale) / 2,
      y: corner.y,
    };
  });
}

function boundsOfPoints(points: readonly Point[]): Pos {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function rasterizeBounds(bounds: Pos): Size {
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_AFFINE_COORDINATE ||
    height > MAX_AFFINE_COORDINATE ||
    width * height > MAX_AFFINE_PIXELS
  ) {
    throw new Error('Raster transform exceeds supported bounds');
  }
  return { width, height };
}

function renderAffine(bitmap: BitmapSource, size: Size, args: TransformToolArgs): ToolResult {
  const transform = transformToolArgsToAffine(args, size);
  if (!transform) throw new Error('Trapezoid cannot be combined with retained affine transforms');

  const bounds = getAffineBounds(transform, size);
  const { width, height } = rasterizeBounds(bounds);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const draw = getTransformDrawMatrix(transform, bounds);
  ctx.setTransform(draw.a, draw.b, draw.c, draw.d, draw.e, draw.f);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  if (width === size.width && height === size.height) return [canvas];
  return [canvas, { width, height }];
}

function renderTrapezoid(bitmap: BitmapSource, size: Size, trapezoid: number): ToolResult {
  if (Math.abs(trapezoid) >= 100) throw new Error('Trapezoid taper must stay within 100 percent');

  const quad = getTrapezoidQuad(size, trapezoid);
  const { width, height } = rasterizeBounds(boundsOfPoints(quad));

  const forward = solveHomography(sourceRectCorners(size), quad);
  if (!forward) throw new Error('Trapezoid geometry is not invertible');
  const inverse = invertHomography(forward);
  if (!inverse) throw new Error('Trapezoid geometry is not invertible');

  const sourceCanvas = new OffscreenCanvas(size.width, size.height);
  const sourceContext = sourceCanvas.getContext('2d')!;
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = 'high';
  sourceContext.drawImage(bitmap, 0, 0);
  const sourceImage = sourceContext.getImageData(0, 0, size.width, size.height);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  resampleThroughHomographyRowByRow(sourceImage, ctx, width, height, inverse);

  if (width === size.width && height === size.height) return [canvas];
  return [canvas, { width, height }];
}

export const transform =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({
    rotate = 0,
    mirrorH = false,
    mirrorV = false,
    skewX = 0,
    skewY = 0,
    trapezoid = 0,
    resizeX = 100,
    resizeY = 100,
  }: TransformToolArgs): ToolResult => {
    if (
      ![size.width, size.height, rotate, mirrorH, mirrorV, skewX, skewY, trapezoid, resizeX, resizeY].every(
        (value) => typeof value === 'boolean' || Number.isFinite(value)
      ) ||
      size.width < 1 ||
      size.height < 1
    ) {
      throw new Error('Invalid raster transform dimensions or values');
    }
    if (
      trapezoid !== 0 &&
      (rotate !== 0 || mirrorH || mirrorV || skewX !== 0 || skewY !== 0 || resizeX !== 100 || resizeY !== 100)
    ) {
      throw new Error('Trapezoid cannot be combined with retained affine transforms');
    }

    const args: TransformToolArgs = {
      rotate,
      mirrorH,
      mirrorV,
      skewX,
      skewY,
      trapezoid,
      resizeX,
      resizeY,
      toolName: 'transform',
    };

    if (trapezoid === 0) return renderAffine(bitmap, size, args);
    return renderTrapezoid(bitmap, size, trapezoid);
  };
