import { type Page, type Locator, type TestInfo } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { imageBoundsToCss } from './screenshot-scale';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CssBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScreenshotBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  imageWidth: number;
  imageHeight: number;
}

export function screenshotBoundsToCss(bounds: ScreenshotBounds, box: BoundingBox): CssBounds {
  return imageBoundsToCss(
    { width: bounds.imageWidth, height: bounds.imageHeight },
    { x: box.x, y: box.y, width: box.width, height: box.height },
    { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
  );
}

export const DEFAULT_LINE_CLIP = { x: 120, y: 120, width: 260, height: 80 };

/**
 * Region of the workspace canvas, relative to the canvas box, that contains the
 * standard test line drawn by `drawLine`. Used as the default sampling area when
 * waiting for a stroke to reach the backing store.
 */
export const CANVAS_REDRAW_CLIP: Required<ClipOptions> = { x: 100, y: 100, width: 300, height: 100 };

/** Standard test-line endpoints, relative to the canvas box. */
export const LINE_START_X = 150;
export const LINE_START_Y = 150;
export const LINE_END_X = 350;
export const LINE_END_Y = 150;

export const CANVAS_REDRAW_TIMEOUT_MS = 10_000;
export const CANVAS_REDRAW_POLL_INTERVAL_MS = 100;

export interface DominantColor {
  red: number;
  green: number;
  blue: number;
  count: number;
}

export interface ClipOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function buildClip(clip: ClipOptions | undefined, defaultClip: Required<ClipOptions>): Required<ClipOptions> {
  return {
    x: clip?.x ?? defaultClip.x,
    y: clip?.y ?? defaultClip.y,
    width: clip?.width ?? defaultClip.width,
    height: clip?.height ?? defaultClip.height,
  };
}

export interface ImageDataResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function isBuffer(value: Buffer | ImageDataResult): value is Buffer {
  return Buffer.isBuffer(value);
}

export type PixelPredicate = (red: number, green: number, blue: number, alpha: number) => boolean;

export interface BoundsResult {
  left: number;
  top: number;
  right: number;
  bottom: number;
  found: boolean;
}

export async function scanPixelsForBounds(
  imageData: ImageDataResult,
  predicate: PixelPredicate
): Promise<BoundsResult> {
  const { width, height, data } = imageData;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let found = false;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (predicate(red, green, blue, alpha)) {
      found = true;
      const pixel = index / 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  return { left, top, right, bottom, found };
}

// Stroke analysis constants - extracted from magic numbers for clarity and tuning
export const STROKE_ANALYSIS = {
  // Color thresholds
  DARK_THRESHOLD: 50, // RGB < 50 = dark pixel
  NEAR_WHITE_THRESHOLD: 250, // RGB > 250 = near white (background)
  DARK_PIXEL_THRESHOLD: 60, // For hasDarkPixels (slightly more permissive)
  RED_DOMINANCE_FACTOR: 2, // For dominantRed: red > green*2 && red > blue*2
  RED_PIXEL_RED_MIN: 180, // For hasRedPixels
  RED_PIXEL_GREEN_MAX: 100, // For hasRedPixels
  RED_PIXEL_BLUE_MAX: 100, // For hasRedPixels

  // Spray detection
  SPRAY_LUMINANCE_THRESHOLD: 200, // Luminance > 200 = bright spray
  SPRAY_SATURATION_THRESHOLD: 30, // Saturation < 30 = grayscale spray

  // Classification thresholds
  SPRAY_VERTICAL_SPREAD_THRESHOLD: 30, // Vertical spread > 30 = spray (fills most of clip)

  // Segment gap thresholds (anti-aliasing bridges small gaps)
  SPRAY_GAP_THRESHOLD: 3, // Spray: smaller gaps due to anti-aliasing
  PEN_GAP_THRESHOLD: 5, // Pen/Dashed: clearer gaps between segments

  // Color sampling
  COLOR_SAMPLE_RADIUS: 5, // Default radius for getColorAtPoint
} as const;

/**
 * Loads a PNG screenshot buffer into an ImageData object using sharp.
 * Replaces browser-based decode to eliminate round-trip, memory pressure, and serialization issues.
 */
export async function loadImageData(screenshot: Buffer): Promise<ImageDataResult> {
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  };
}

/**
 * Returns the workspace canvas locator with fallback selectors.
 * Primary: data-testid="workspace-canvas"
 * Fallback: second canvas element (nth(1)) - first is usually the color picker canvas
 */
export function getWorkspaceCanvas(page: Page): Locator {
  return page.getByTestId('workspace-canvas').or(page.locator('canvas').nth(1));
}

export async function takeLineScreenshot(
  page: Page,
  box: BoundingBox,
  name: string,
  testInfo: TestInfo,
  clip?: ClipOptions
): Promise<Buffer> {
  const defaultClip: Required<ClipOptions> = {
    x: box.x + DEFAULT_LINE_CLIP.x,
    y: box.y + DEFAULT_LINE_CLIP.y,
    width: DEFAULT_LINE_CLIP.width,
    height: DEFAULT_LINE_CLIP.height,
  };
  const actualClip = buildClip(clip, defaultClip);

  const screenshotPath = path.join(testInfo.outputDir, `${name}.png`);
  const fs = await import('node:fs/promises');
  await fs.mkdir(testInfo.outputDir, { recursive: true });
  const screenshot = await page.screenshot({
    path: screenshotPath,
    clip: actualClip,
  });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
  return screenshot;
}

export async function dominantRed(screenshot: Buffer | ImageDataResult): Promise<DominantColor | null> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const { data } = imageData;

  const colors = new Map<string, { red: number; green: number; blue: number; count: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (
      alpha === 0 ||
      red <= green * STROKE_ANALYSIS.RED_DOMINANCE_FACTOR ||
      red <= blue * STROKE_ANALYSIS.RED_DOMINANCE_FACTOR
    )
      continue;

    const key = `${red},${green},${blue}`;
    const color = colors.get(key) ?? { red, green, blue, count: 0 };
    color.count += 1;
    colors.set(key, color);
  }
  return [...colors.values()].sort((first, second) => second.count - first.count)[0] ?? null;
}

export async function hasDarkPixels(screenshot: Buffer | ImageDataResult): Promise<boolean> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    if (
      red < STROKE_ANALYSIS.DARK_PIXEL_THRESHOLD &&
      green < STROKE_ANALYSIS.DARK_PIXEL_THRESHOLD &&
      blue < STROKE_ANALYSIS.DARK_PIXEL_THRESHOLD
    )
      return true;
  }
  return false;
}

export async function hasRedPixels(screenshot: Buffer | ImageDataResult): Promise<boolean> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    if (
      red > STROKE_ANALYSIS.RED_PIXEL_RED_MIN &&
      green < STROKE_ANALYSIS.RED_PIXEL_GREEN_MAX &&
      blue < STROKE_ANALYSIS.RED_PIXEL_BLUE_MAX
    )
      return true;
  }
  return false;
}

export interface DrawLineOptions {
  /** Interpolated mouse moves between the endpoints. Omit for a single jump. */
  steps?: number;
}

/**
 * Draws a straight stroke on the canvas at box-relative coordinates.
 * Pair with `waitForCanvasRedraw` instead of a fixed timeout to synchronize.
 */
export async function drawLine(
  page: Page,
  box: BoundingBox,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  options: DrawLineOptions = {}
): Promise<void> {
  await page.mouse.move(box.x + startX, box.y + startY);
  await page.mouse.down();
  if (options.steps) {
    await page.mouse.move(box.x + endX, box.y + endY, { steps: options.steps });
  } else {
    await page.mouse.move(box.x + endX, box.y + endY);
  }
  await page.mouse.up();
}

/**
 * Clip region of the standard test line, relative to `box`. Use it as the `clip`
 * argument of `waitForCanvasPixels` when waiting for that line to reach the backing store.
 */
export function canvasRedrawClip(box: BoundingBox): Required<ClipOptions> {
  return {
    x: box.x + CANVAS_REDRAW_CLIP.x,
    y: box.y + CANVAS_REDRAW_CLIP.y,
    width: CANVAS_REDRAW_CLIP.width,
    height: CANVAS_REDRAW_CLIP.height,
  };
}

/**
 * Reads one clipped screenshot and reports whether the pixels the caller cares about
 * are in it. Kept as a predicate so a single poll loop serves every read below.
 */
export type CanvasPixelPredicate = (screenshot: Buffer) => Promise<boolean>;

export interface WaitForCanvasPixelsOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Named in the timeout error, e.g. 'red pixels' -> "Canvas did not render red pixels within 10000ms". */
  description?: string;
}

/**
 * Polls a clipped canvas screenshot until `predicate` accepts it, replacing fixed
 * post-draw timeouts: a one-shot screenshot can land before the repaint and make a
 * pixel assertion flaky. Throws with a descriptive message if it never does.
 *
 * The single poll loop: every redraw wait below is a specialization of it, so the
 * timeout, the interval and the error wording can only be changed in one place.
 */
export async function waitForCanvasPixels(
  page: Page,
  clip: Required<ClipOptions>,
  predicate: CanvasPixelPredicate,
  options: WaitForCanvasPixelsOptions = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CANVAS_REDRAW_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? CANVAS_REDRAW_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await predicate(await page.screenshot({ clip }))) return;
    if (Date.now() >= deadline) {
      throw new Error(`Canvas did not render ${options.description ?? 'the expected pixels'} within ${timeoutMs}ms`);
    }
    await page.waitForTimeout(pollIntervalMs);
  }
}

/**
 * Replaces fixed post-draw timeouts: polls a clipped canvas screenshot until the
 * stroke reaches the backing store, then returns. Throws if it never renders.
 * Dark-pixel special case of `waitForCanvasPixels`, so specs can keep calling it.
 */
export async function waitForCanvasRedraw(
  page: Page,
  box: BoundingBox,
  options: { clip?: ClipOptions; timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<void> {
  await waitForCanvasPixels(page, buildClip(options.clip, canvasRedrawClip(box)), hasDarkPixels, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    description: 'dark pixels',
  });
}

export async function getDarkPixelBounds(screenshot: Buffer | ImageDataResult): Promise<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
} | null> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const bounds = await scanPixelsForBounds(
    imageData,
    (r, g, b, a) =>
      a !== 0 &&
      r < STROKE_ANALYSIS.DARK_THRESHOLD &&
      g < STROKE_ANALYSIS.DARK_THRESHOLD &&
      b < STROKE_ANALYSIS.DARK_THRESHOLD
  );

  if (!bounds.found) return null;

  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: bounds.right - bounds.left + 1,
    height: bounds.bottom - bounds.top + 1,
    imageWidth: imageData.width,
    imageHeight: imageData.height,
  };
}

export interface StrokeAnalysis {
  type: 'solid' | 'dashed' | 'spray';
  segments: number;
  verticalSpread: number;
  pixelCount: number;
}

export interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  imageWidth: number;
  imageHeight: number;
  centerX: number;
  centerY: number;
}

export async function getSelectionBounds(
  screenshot: Buffer | ImageDataResult,
  colorThresholds?: { redMax: number; greenMin: number; blueMin: number }
): Promise<SelectionBounds | null> {
  /**
   * Detects selection bounds (blue resize handles).
   * Default thresholds tuned for the app's selection color: RGB ≈ (0, 120, 255)
   * - redMax: 80 (low red)
   * - greenMin: 80 (medium green)
   * - blueMin: 180 (high blue)
   */
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const redMax = colorThresholds?.redMax ?? 80;
  const greenMin = colorThresholds?.greenMin ?? 80;
  const blueMin = colorThresholds?.blueMin ?? 180;

  const bounds = await scanPixelsForBounds(
    imageData,
    (r, g, b, a) => a !== 0 && r <= redMax && g >= greenMin && b >= blueMin
  );

  if (!bounds.found) return null;

  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    imageWidth: imageData.width,
    imageHeight: imageData.height,
    centerX: Math.round((bounds.left + bounds.right) / 2),
    centerY: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

export async function getColorAtPoint(
  screenshot: Buffer | ImageDataResult,
  pointX: number,
  pointY: number,
  radius: number = STROKE_ANALYSIS.COLOR_SAMPLE_RADIUS,
  options?: { ignoreNearWhite?: boolean; nearWhiteThreshold?: number }
): Promise<{ red: number; green: number; blue: number } | null> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const { width, height, data } = imageData;

  if (pointX < 0 || pointX >= width || pointY < 0 || pointY >= height) return null;

  const colors = { red: 0, green: 0, blue: 0, count: 0 };
  const nearWhiteThreshold = options?.nearWhiteThreshold ?? STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD;
  for (let y = pointY - radius; y <= pointY + radius; y++) {
    for (let x = pointX - radius; x <= pointX + radius; x++) {
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      if (alpha === 0) continue;
      if (
        options?.ignoreNearWhite &&
        red > nearWhiteThreshold &&
        green > nearWhiteThreshold &&
        blue > nearWhiteThreshold
      )
        continue;
      colors.red += red;
      colors.green += green;
      colors.blue += blue;
      colors.count++;
    }
  }
  if (colors.count === 0) return null;
  return {
    red: Math.round(colors.red / colors.count),
    green: Math.round(colors.green / colors.count),
    blue: Math.round(colors.blue / colors.count),
  };
}

export async function getStrokeAnalysis(screenshot: Buffer | ImageDataResult): Promise<StrokeAnalysis | null> {
  const imageData = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const { width, height, data } = imageData;

  const occupiedColumns = new Set<number>();
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  let darkCount = 0;
  let sprayCount = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    if (a === 0) continue;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);

    const isDark =
      r < STROKE_ANALYSIS.DARK_THRESHOLD && g < STROKE_ANALYSIS.DARK_THRESHOLD && b < STROKE_ANALYSIS.DARK_THRESHOLD;
    // Exclude pure white background (255,255,255) and near-white
    const isNearWhite =
      r > STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD &&
      g > STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD &&
      b > STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD;
    const isSpray =
      !isDark &&
      !isNearWhite &&
      luminance > STROKE_ANALYSIS.SPRAY_LUMINANCE_THRESHOLD &&
      saturation < STROKE_ANALYSIS.SPRAY_SATURATION_THRESHOLD;

    if (isDark || isSpray) {
      const x = (index / 4) % width;
      const y = Math.floor(index / 4 / width);
      occupiedColumns.add(x);
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
      if (isDark) darkCount++;
      if (isSpray) sprayCount++;
    }
  }

  if (occupiedColumns.size === 0 || bottom < 0) {
    return null;
  }

  const verticalSpread = bottom - top + 1;
  const columns = [...occupiedColumns].sort((a, b) => a - b);
  const isSpray = verticalSpread > STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD;
  const gapThreshold = isSpray ? STROKE_ANALYSIS.SPRAY_GAP_THRESHOLD : STROKE_ANALYSIS.PEN_GAP_THRESHOLD;
  let segments = 0;
  let prev = -10;
  for (const col of columns) {
    if (col - prev > gapThreshold) segments++;
    prev = col;
  }

  // Spray: large vertical spread in clip (fills most of clip height)
  // Pen/Dashed: small vertical spread (~3-5px)
  const type = isSpray ? 'spray' : segments > 1 ? 'dashed' : 'solid';

  return { type, segments, verticalSpread: bottom - top + 1, pixelCount: darkCount + sprayCount };
}
