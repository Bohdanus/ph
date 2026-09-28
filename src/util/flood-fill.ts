import type { Point, Pos } from '../contexts/general-types.ts';

/**
 * The largest RGBA Euclidean distance two pixels can ever be apart: opaque black against
 * opaque white differs by 255 on all four channels, so `sqrt(255 * 255 * 4)` is the ceiling
 * of the whole colour space. Tolerance is expressed as a fraction of it, which is what makes
 * a slider reading of 100 mean "every colour that can possibly match" rather than an
 * arbitrary number that happens to be big enough today.
 */
const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 4);

export type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type FloodFillOptions = {
  /** 0-100, mapped internally exactly as the Magic Wand maps it. */
  tolerance: number;
  /** true = 4-neighbour region grow from the seed; false = global match over the whole image. */
  contiguous: boolean;
};

export type FloodFillBounds = {
  /** Inclusive: the first column of the region. */
  left: number;
  /** Inclusive: the first row of the region. */
  top: number;
  /** Inclusive: the last column of the region, so a single pixel wide box has right === left. */
  right: number;
  /** Inclusive: the last row of the region, so a single pixel tall box has bottom === top. */
  bottom: number;
};

export type FloodFillResult = {
  mask: Uint8Array;
  width: number;
  height: number;
  bounds: FloodFillBounds;
  pixelCount: number;
};

/**
 * The intermediate the mask builders hand back. Kept in `Pos` bounds rather than
 * `FloodFillBounds` because the Magic Wand's polygon tracer is the original consumer of
 * these, and it indexes its contour sweep with `bounds.x + bounds.width - 1`; converting
 * at the call site instead of here is what keeps this extraction behaviour-preserving.
 */
export type MaskResult = {
  mask: Uint8Array;
  selectedPixelCount: number;
  sampleColor: RgbaColor;
  bounds: Pos;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Row-major pixel index, the single indexing convention shared by the RGBA buffer, the
 * mask, the visited set and the BFS queue. Computing it once per dequeue is what lets the
 * BFS neighbours be plain arithmetic (`index +/- 1`, `index +/- width`) guarded only by the
 * row/column bounds the dequeue already has to compute.
 */
export function getIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

export function getPixelColor(data: Uint8ClampedArray, pixelIndex: number): RgbaColor {
  const dataIndex = pixelIndex * 4;

  return {
    r: data[dataIndex],
    g: data[dataIndex + 1],
    b: data[dataIndex + 2],
    a: data[dataIndex + 3],
  };
}

/**
 * Euclidean distance over all four channels, alpha included. Alpha is deliberately not
 * excluded: `getImageData` hands back un-premultiplied RGBA, so a fully transparent pixel
 * and an opaque black one are genuinely different data, and treating them as equal would
 * let a fill leak out of the transparent regions a PNG cut-out leaves behind.
 */
export function getMagicWandColorDistance(a: RgbaColor, b: RgbaColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = a.a - b.a;

  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

/**
 * Maps the 0-100 slider onto the colour space's own maximum. Exported because the fill's
 * threshold is the one thing a caller re-seeding a growth along a stroke has to reproduce
 * exactly: a Quick Selection stroke re-grows the same region per sample point, and a
 * recomputed threshold that drifted by a rounding step would make the stroke flicker.
 */
export const getToleranceDistance = (tolerance: number): number => {
  return (clamp(tolerance, 0, 100) / 100) * MAX_COLOR_DISTANCE;
};

function isPixelWithinTolerance(
  data: Uint8ClampedArray,
  pixelIndex: number,
  sampleColor: RgbaColor,
  tolerance: number
) {
  return getMagicWandColorDistance(getPixelColor(data, pixelIndex), sampleColor) <= tolerance;
}

function createEmptyBounds(): Pos {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * The non-finite guard is not defensive noise: a zero-sized image, or a pixel buffer too
 * short to read a channel from, leaves the min/max accumulators at their initial sentinels,
 * and the resulting `Pos` is what the Magic Wand's caller sees instead of a crash.
 */
function finalizeBounds(minX: number, minY: number, maxX: number, maxY: number): Pos {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return createEmptyBounds();
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * The global (non-contiguous) branch: a single row-major sweep, no queue and no visited set.
 * It exists because a region's connectivity is a property of the region, not of where the
 * user happened to click -- every matching pixel anywhere in the image is one selection.
 */
export function createAllMatchingMask(imageData: ImageData, sampleColor: RgbaColor, tolerance: number): MaskResult {
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

  return { mask, selectedPixelCount, sampleColor, bounds: finalizeBounds(minX, minY, maxX, maxY) };
}

/**
 * The 4-neighbour region grow, and the reason this module exists: it is the flood fill that
 * used to be private to the Magic Wand, which only ever exposed its traced polygon and
 * refused to return anything at all for a region with an enclosed hole. A Paint Bucket needs
 * the mask itself, and a Quick Selection needs to re-seed the same growth along a stroke, and
 * neither can express its result as a single closed outline.
 *
 * Two invariants are load-bearing and were verified rather than assumed. The queue is an
 * `Int32Array` of exactly `width * height` entries, so `visited` is not an optimisation but
 * the only thing keeping the queue from overflowing: a pixel is enqueued the first time it is
 * reached and never again, which also bounds the fill at one visit per pixel. And the
 * out-of-tolerance check runs on dequeue rather than on enqueue, so a mismatching seed pixel
 * expands to nothing at all instead of poisoning its whole neighbourhood.
 */
export function createContiguousMask(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  sampleColor: RgbaColor,
  tolerance: number
): MaskResult {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  let selectedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const seedIndex = getIndex(seedX, seedY, width);

  queue[queueEnd++] = seedIndex;
  visited[seedIndex] = 1;

  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    if (!isPixelWithinTolerance(data, index, sampleColor, tolerance)) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    mask[index] = 1;
    selectedPixelCount += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    if (x > 0) queueEnd = enqueuePixel(index - 1, visited, queue, queueEnd);
    if (x < width - 1) queueEnd = enqueuePixel(index + 1, visited, queue, queueEnd);
    if (y > 0) queueEnd = enqueuePixel(index - width, visited, queue, queueEnd);
    if (y < height - 1) queueEnd = enqueuePixel(index + width, visited, queue, queueEnd);
  }

  return { mask, selectedPixelCount, sampleColor, bounds: finalizeBounds(minX, minY, maxX, maxY) };
}

function enqueuePixel(index: number, visited: Uint8Array, queue: Int32Array, queueEnd: number): number {
  if (visited[index]) return queueEnd;

  visited[index] = 1;
  queue[queueEnd] = index;
  return queueEnd + 1;
}

/**
 * The mask itself, which is what the Magic Wand's polygon tracer is built on top of and
 * cannot be asked for: it returns a traced outline, and it returns `null` outright for a
 * region with an enclosed hole, because a `Selection` carries a single point path and
 * committing the outer contour alone would cover pixels the mask reported as unselected.
 *
 * `null` is the one failure mode, and it covers both "there is no such seed" and "nothing
 * matched" -- the two are indistinguishable to a caller, which is what makes it safe for a
 * bucket to read as a no-op. Note that a hole is *not* a failure here: the mask keeps the
 * hole bytes at 0 and reports the full region, which is precisely the result the polygon
 * entry point has to throw away.
 */
export const floodFill = (imageData: ImageData, seed: Point, options: FloodFillOptions): FloodFillResult | null => {
  const { width, height } = imageData;
  if (width <= 0 || height <= 0) return null;

  const seedX = Math.floor(seed.x);
  const seedY = Math.floor(seed.y);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return null;

  const sampleColor = getPixelColor(imageData.data, getIndex(seedX, seedY, width));
  const tolerance = getToleranceDistance(options.tolerance);
  const result = options.contiguous
    ? createContiguousMask(imageData, seedX, seedY, sampleColor, tolerance)
    : createAllMatchingMask(imageData, sampleColor, tolerance);

  // A non-zero count is also what guarantees `result.bounds` is a real box, so the inclusive
  // conversion below never has to defend against the zero-sized `Pos` `finalizeBounds` returns
  // for a region that matched nothing.
  if (result.selectedPixelCount === 0) return null;

  return {
    mask: result.mask,
    width,
    height,
    bounds: {
      left: result.bounds.x,
      top: result.bounds.y,
      right: result.bounds.x + result.bounds.width - 1,
      bottom: result.bounds.y + result.bounds.height - 1,
    },
    pixelCount: result.selectedPixelCount,
  };
};
