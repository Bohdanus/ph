import type { Point } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type RedEyeToolArgs = {
  pupilSize: number;
  darkenAmount: number;
  point: Point | null;
  toolName: 'red-eye';
};

export type RedEyeToolSettings = Omit<RedEyeToolArgs, 'point'>;

export const RED_EYE_PUPIL_SIZE_MIN = 0;
export const RED_EYE_PUPIL_SIZE_MAX = 100;
export const RED_EYE_DARKEN_AMOUNT_MIN = 0;
export const RED_EYE_DARKEN_AMOUNT_MAX = 100;
export const RED_EYE_DEFAULT_PUPIL_SIZE = 50;
export const RED_EYE_DEFAULT_DARKEN_AMOUNT = 50;
export const RED_EYE_MAX_PIXELS = 50_000;

export type RedEyeCorrection = { status: 'changed' | 'unchanged' | 'too-large'; pixelsChanged: number };
type RgbaImage = Pick<ImageData, 'width' | 'height' | 'data'>;

const clampPercent = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);

const isRedEyePixel = (data: Uint8ClampedArray, offset: number): boolean => {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return data[offset + 3] > 0 && red >= 40 && red - Math.max(green, blue) >= 24;
};

/**
 * Correct the connected red region around a click. `Pupil Size` scales the bounded search
 * radius with the image dimensions; only red-dominant pixels are changed, so nearby skin and
 * whites of the eye remain intact.
 */
export const correctRedEyePixels = (
  image: RgbaImage,
  point: Point,
  pupilSize: number,
  darkenAmount: number
): RedEyeCorrection => {
  const { width, height, data } = image;
  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= width ||
    point.y >= height
  ) {
    return { status: 'unchanged', pixelsChanged: 0 };
  }

  const size = clampPercent(pupilSize);
  const radius = Math.max(2, Math.round(Math.min(width, height) * (0.005 + (size / 100) * 0.025)));
  const radiusSquared = radius * radius;
  const centerX = Math.round(point.x);
  const centerY = Math.round(point.y);
  const seedRadius = Math.min(3, radius);
  let seed = -1;
  let bestRedDifference = -1;

  for (let y = Math.max(0, centerY - seedRadius); y <= Math.min(height - 1, centerY + seedRadius); y++) {
    for (let x = Math.max(0, centerX - seedRadius); x <= Math.min(width - 1, centerX + seedRadius); x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > seedRadius * seedRadius) continue;
      const offset = (y * width + x) * 4;
      if (!isRedEyePixel(data, offset)) continue;
      const difference = data[offset] - Math.max(data[offset + 1], data[offset + 2]);
      if (difference > bestRedDifference) {
        seed = y * width + x;
        bestRedDifference = difference;
      }
    }
  }

  if (seed < 0) return { status: 'unchanged', pixelsChanged: 0 };

  const queue = [seed];
  const region = new Set<number>([seed]);
  for (let index = 0; index < queue.length; index++) {
    const pixel = queue[index];
    const x = pixel % width;
    const y = Math.floor(pixel / width);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (
          nextX < 0 ||
          nextY < 0 ||
          nextX >= width ||
          nextY >= height ||
          (nextX - centerX) ** 2 + (nextY - centerY) ** 2 > radiusSquared
        ) {
          continue;
        }

        const next = nextY * width + nextX;
        if (region.has(next) || !isRedEyePixel(data, next * 4)) continue;
        if (region.size >= RED_EYE_MAX_PIXELS) return { status: 'too-large', pixelsChanged: 0 };
        region.add(next);
        queue.push(next);
      }
    }
  }

  const darken = clampPercent(darkenAmount) / 100;
  let pixelsChanged = 0;

  for (const pixel of region) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const neutralRed = Math.max(green, blue);
    const correctedRed = Math.round(neutralRed + (Math.min(red, neutralRed) - neutralRed) * darken);
    const correctedGreen = Math.round(green * (1 - darken));
    const correctedBlue = Math.round(blue * (1 - darken));
    if (red === correctedRed && green === correctedGreen && blue === correctedBlue) continue;

    data[offset] = correctedRed;
    data[offset + 1] = correctedGreen;
    data[offset + 2] = correctedBlue;
    pixelsChanged++;
  }

  return { status: pixelsChanged ? 'changed' : 'unchanged', pixelsChanged };
};

export const redEye =
  ({ size, bitmap }: ProcessorToolParams) =>
  (args: RedEyeToolArgs): ToolResult => {
    if (!args.point) return [bitmap];

    const width = Math.max(0, Math.floor(size.width));
    const height = Math.max(0, Math.floor(size.height));
    if (!width || !height) return [bitmap];

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Red Eye could not create a 2D canvas context');

    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const correction = correctRedEyePixels(image, args.point, args.pupilSize, args.darkenAmount);
    if (correction.status === 'too-large') {
      throw new Error(`Red Eye region exceeds ${RED_EYE_MAX_PIXELS} pixels`);
    }
    if (correction.status === 'unchanged') return [bitmap];

    context.putImageData(image, 0, 0);
    return [canvas];
  };
