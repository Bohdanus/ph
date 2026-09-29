import compare from 'pixelmatch';
import sharp from 'sharp';

/**
 * Image comparison helper for custom visual checks.
 * For regression snapshots, prefer expect(locator).toHaveScreenshot() when a fixture exists.
 */
export interface CompareOptions {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
}

export interface CompareResult {
  matches: boolean;
  diffPixels: number;
  diffRatio: number;
}

/**
 * The comparison defaults, in one place. `compareScreenshots` is their only reader, and
 * must read them from here: a literal written into a second function looks equal today
 * and silently becomes a different budget the day it drifts.
 */
export const DEFAULT_THRESHOLD = 0.2;
export const DEFAULT_MAX_DIFF_PIXELS = 100;
export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01;

/**
 * Compare two PNG buffers using Node.js (sharp + pixelmatch).
 * Runs entirely in Node.js - no browser round-trip needed.
 * Much faster and more reliable than browser-based comparison.
 */
export async function compareScreenshots(
  actual: Buffer,
  expected: Buffer,
  options: CompareOptions = {}
): Promise<CompareResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxDiffPixels = options.maxDiffPixels ?? DEFAULT_MAX_DIFF_PIXELS;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;

  // Decode both images to raw RGBA using sharp (handles DPR, color space, etc.)
  const [actualDecoded, expectedDecoded] = await Promise.all([
    sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const { data: actualData, info: actualInfo } = actualDecoded;
  const { data: expectedData, info: expectedInfo } = expectedDecoded;

  if (actualInfo.width !== expectedInfo.width || actualInfo.height !== expectedInfo.height) {
    return {
      matches: false,
      diffPixels: Number.MAX_SAFE_INTEGER,
      diffRatio: 1,
    };
  }

  const diff = Buffer.alloc(actualData.length);
  const diffPixels = compare(actualData, expectedData, diff, actualInfo.width, actualInfo.height, {
    threshold,
    includeAA: true,
  });

  const diffRatio = diffPixels / (actualInfo.width * actualInfo.height);
  return {
    matches: diffPixels <= maxDiffPixels && diffRatio <= maxDiffPixelRatio,
    diffPixels,
    diffRatio,
  };
}
