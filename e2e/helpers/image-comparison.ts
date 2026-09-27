import { expect, type Page, type TestInfo } from '@playwright/test';
import path from 'node:path';
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

export const DEFAULT_THRESHOLD = 0.2;

/**
 * Saves an image artifact to the test output dir and attaches it to the report.
 * This gives the visual tests a real on-disk artifact even when they are not using repository snapshots.
 */
export async function saveScreenshotArtifact(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { clip?: { x: number; y: number; width: number; height: number } } = {}
): Promise<Buffer> {
  const screenshotPath = path.join(testInfo.outputDir, `${name}.png`);
  const screenshot = await page.screenshot({
    path: screenshotPath,
    animations: 'disabled',
    ...(options.clip ? { clip: options.clip } : {}),
  });

  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  });

  return screenshot;
}

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
  const maxDiffPixels = options.maxDiffPixels ?? 100;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? 0.01;

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

/**
 * Compare canvas content to expected image.
 * Uses Playwright's built-in visual comparison via expect().toHaveScreenshot()
 * This is the recommended approach for visual regression.
 */
export async function expectCanvasToMatch(
  page: Page,
  canvas: ReturnType<Page['getByTestId']>,
  snapshotName: string,
  options: {
    threshold?: number;
    maxDiffPixels?: number;
    maxDiffPixelRatio?: number;
    mask?: ReturnType<Page['getByTestId']>[];
  } = {}
) {
  await expect(canvas).toHaveScreenshot(snapshotName, {
    threshold: options.threshold ?? 0.2,
    maxDiffPixels: options.maxDiffPixels ?? 100,
    maxDiffPixelRatio: options.maxDiffPixelRatio ?? 0.01,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    ...options,
  });
}
