import type { Point } from '../contexts/general-types.ts';
import type { RgbaColor } from './magicWand.ts';
import { isRasterSelectionSizeWithinBudget } from './selection-mask.ts';

/**
 * RGBA flood fill behind the Paint Bucket and Magic Eraser. It is separate from the RGBA region
 * mask used by `magicWand.ts` and Quick Selection: those selection tools trace and retain every
 * boundary loop, while fill processors need a pixel mask. The tolerance scales differ: the wand
 * uses 0-100, while this fill uses 0-255. The fill compares squared RGBA distances, so a
 * 4000x4000 operation costs no `Math.sqrt` and creates no per-pixel color object.
 */
const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 4);
const MAX_TOLERANCE = 255;
const DEFAULT_TOLERANCE = 32;

export type FloodFillOptions = {
  /** Adobe's tolerance scale, 0-255. Clamped. Default 32, which is Adobe's default for the bucket and the magic eraser. */
  tolerance?: number;
  /** true = 4-connected flood from the seed (Adobe's Contiguous, on by default). false = every matching pixel anywhere in the image. */
  contiguous?: boolean;
};

export type FloodFillResult = {
  /** 1 = inside the filled region. Same length as `imageData.data.length / 4`. */
  mask: Uint8Array;
  /** The colour sampled at the seed. */
  sampleColor: RgbaColor;
  /** How many pixels the mask selects. 0 means the fill would be a no-op. */
  selectedPixelCount: number;
  /** The tight bounding box of the selection, in image coordinates. Null when nothing was selected. */
  bounds: { left: number; top: number; right: number; bottom: number } | null;
};

type MaskScan = {
  mask: Uint8Array;
  selectedPixelCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function getPixelColor(data: Uint8ClampedArray, pixelIndex: number): RgbaColor {
  const dataIndex = pixelIndex * 4;

  return {
    r: data[dataIndex],
    g: data[dataIndex + 1],
    b: data[dataIndex + 2],
    a: data[dataIndex + 3],
  };
}

function getToleranceDistance(tolerance: number): number {
  const resolved = Number.isFinite(tolerance) ? tolerance : DEFAULT_TOLERANCE;

  return (clamp(resolved, 0, MAX_TOLERANCE) / MAX_TOLERANCE) * MAX_COLOR_DISTANCE;
}

function isPixelWithinTolerance(
  data: Uint8ClampedArray,
  pixelIndex: number,
  sampleColor: RgbaColor,
  tolerance: number
): boolean {
  const dataIndex = pixelIndex * 4;
  const dr = data[dataIndex] - sampleColor.r;
  const dg = data[dataIndex + 1] - sampleColor.g;
  const db = data[dataIndex + 2] - sampleColor.b;
  const da = data[dataIndex + 3] - sampleColor.a;

  return dr * dr + dg * dg + db * db + da * da <= tolerance * tolerance;
}

function createAllMatchingScan(imageData: ImageData, sampleColor: RgbaColor, tolerance: number): MaskScan {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let selectedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = getIndex(x, y, width);
      if (!isPixelWithinTolerance(data, index, sampleColor, tolerance)) continue;

      mask[index] = 1;
      selectedPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { mask, selectedPixelCount, minX, minY, maxX, maxY };
}

function createContiguousScan(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  sampleColor: RgbaColor,
  tolerance: number
): MaskScan {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  // Grow with the pending worklist instead of reserving one slot per image pixel.
  let stack = new Int32Array(Math.min(pixelCount, 1_024));
  let stackLength = 0;
  let selectedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const seedIndex = getIndex(seedX, seedY, width);
  const toleranceSquared = tolerance * tolerance;

  const growStack = () => {
    if (stack.length >= pixelCount) {
      throw new RangeError('Flood-fill worklist exceeded the raster pixel budget');
    }

    const nextStack = new Int32Array(Math.min(pixelCount, stack.length * 2));
    nextStack.set(stack);
    stack = nextStack;
  };

  stack[stackLength++] = seedIndex;
  visited[seedIndex] = 1;

  while (stackLength > 0) {
    const index = stack[--stackLength];
    const dataIndex = index * 4;
    const dr = data[dataIndex] - sampleColor.r;
    const dg = data[dataIndex + 1] - sampleColor.g;
    const db = data[dataIndex + 2] - sampleColor.b;
    const da = data[dataIndex + 3] - sampleColor.a;
    if (!(dr * dr + dg * dg + db * db + da * da <= toleranceSquared)) continue;

    const y = (index / width) | 0;
    const x = index - y * width;
    mask[index] = 1;
    selectedPixelCount += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    // Inline the four neighbor checks; a call per edge dominates large contiguous fills.
    if (x > 0) {
      const neighbor = index - 1;
      if (!visited[neighbor]) {
        visited[neighbor] = 1;
        if (stackLength === stack.length) growStack();
        stack[stackLength++] = neighbor;
      }
    }
    if (x < width - 1) {
      const neighbor = index + 1;
      if (!visited[neighbor]) {
        visited[neighbor] = 1;
        if (stackLength === stack.length) growStack();
        stack[stackLength++] = neighbor;
      }
    }
    if (y > 0) {
      const neighbor = index - width;
      if (!visited[neighbor]) {
        visited[neighbor] = 1;
        if (stackLength === stack.length) growStack();
        stack[stackLength++] = neighbor;
      }
    }
    if (y < height - 1) {
      const neighbor = index + width;
      if (!visited[neighbor]) {
        visited[neighbor] = 1;
        if (stackLength === stack.length) growStack();
        stack[stackLength++] = neighbor;
      }
    }
  }

  return { mask, selectedPixelCount, minX, minY, maxX, maxY };
}

/**
 * Selects every pixel within `tolerance` of the seed's RGBA value, 4-connected from the seed
 * unless `contiguous` is false, and returns the unreduced mask. Including alpha keeps transparent
 * pixels from crossing opaque, anti-aliased boundaries that share their RGB values. Returns null
 * when the seed is outside the image or nothing matched, so a caller never has to distinguish
 * "no region here" from "no region because the tolerance was nonsense".
 */
export function createFloodFillMask(
  imageData: ImageData,
  seed: Point,
  options: FloodFillOptions = {}
): FloodFillResult | null {
  const { width, height } = imageData;
  if (width <= 0 || height <= 0 || !isRasterSelectionSizeWithinBudget(width, height)) return null;

  const { data } = imageData;

  const seedX = Math.floor(seed.x);
  const seedY = Math.floor(seed.y);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return null;

  const sampleColor = getPixelColor(data, getIndex(seedX, seedY, width));
  const tolerance = getToleranceDistance(options.tolerance ?? DEFAULT_TOLERANCE);
  const scan =
    options.contiguous === false
      ? createAllMatchingScan(imageData, sampleColor, tolerance)
      : createContiguousScan(imageData, seedX, seedY, sampleColor, tolerance);

  if (scan.selectedPixelCount === 0) return null;

  return {
    mask: scan.mask,
    sampleColor,
    selectedPixelCount: scan.selectedPixelCount,
    bounds: { left: scan.minX, top: scan.minY, right: scan.maxX, bottom: scan.maxY },
  };
}
