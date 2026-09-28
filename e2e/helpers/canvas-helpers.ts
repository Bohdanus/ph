import { type Page, type Locator, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
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

/**
 * The document the app opens by default, and the size the export baselines describe.
 */
export const DEFAULT_DOCUMENT_WIDTH = 800;
export const DEFAULT_DOCUMENT_HEIGHT = 600;

/**
 * Map a point in DOCUMENT space to an offset within the canvas box.
 *
 * The canvas element is `w-full h-full` of its grid area, and `usePointerPosition` fits the
 * document into that box and centres it, so a document point lands at a different offset
 * for every canvas size. A gesture specified in canvas offsets is therefore specified
 * relative to the window, and the document it actually touches changes whenever the canvas
 * resizes — which is what coupled the export visual-regression baselines to the shell's
 * layout. Fixing a desktop overflow that changed the canvas from 974x890 to 974x583 moved
 * the export by 459 pixels with no change to the export path.
 *
 * This mirrors the app's own mapping exactly (`src/hooks/usePointerPosition.ts:72-89`:
 * `scale = min(outerW/imageW, outerH/imageH)`, then the leftover split evenly as the
 * offset), so a caller can name a document point and get the same pixel whatever the
 * viewport.
 */
export function documentToCanvasOffset(
  box: { width: number; height: number },
  documentX: number,
  documentY: number
): { x: number; y: number } {
  const scale = Math.min(box.width / DEFAULT_DOCUMENT_WIDTH, box.height / DEFAULT_DOCUMENT_HEIGHT);
  const offsetX = (box.width - DEFAULT_DOCUMENT_WIDTH * scale) / 2;
  const offsetY = (box.height - DEFAULT_DOCUMENT_HEIGHT * scale) / 2;

  return { x: offsetX + documentX * scale, y: offsetY + documentY * scale };
}

/**
 * The same mapping read off the live app, for asserting that `documentToCanvasOffset`
 * still agrees with it.
 *
 * Returns the document point the app believes a given canvas offset refers to, which is
 * `usePointerPosition`'s own inverse. If these two ever disagree, a document-space gesture
 * is landing somewhere other than where the helper said, and every document-space spec is
 * silently measuring the wrong pixel.
 */
export function canvasOffsetToDocument(
  box: { width: number; height: number },
  canvasX: number,
  canvasY: number
): { x: number; y: number } {
  const scale = Math.min(box.width / DEFAULT_DOCUMENT_WIDTH, box.height / DEFAULT_DOCUMENT_HEIGHT);
  const offsetX = (box.width - DEFAULT_DOCUMENT_WIDTH * scale) / 2;
  const offsetY = (box.height - DEFAULT_DOCUMENT_HEIGHT * scale) / 2;

  return { x: (canvasX - offsetX) / scale, y: (canvasY - offsetY) / scale };
}

/**
 * The Draw tool's stroke width, in document pixels.
 *
 * Sourced from `src/tools/settings.ts:25` — `savedDrawPerPen.pen = { alpha: 0.9, lineWidth: 10 }`
 * — which `defaultSettings.draw` (line 56) spreads, so the Draw tool's pen preset strokes at
 * 10. It is written out here rather than imported because `vitest.e2e.config.ts` records a
 * deliberate boundary: "nothing under `e2e/` imports app source. The e2e suite drives the
 * real application through a browser, so it must not reach into `src/`." Reaching in for one
 * number would break that rule and pull the app's module graph into every e2e helper unit
 * test.
 *
 * Two things keep the copy honest, and neither is this comment: the docblock on
 * `documentStrokeBoundaryMargin` states where the number is used, and
 * `document-mapping.unit.test.ts` asserts it is 10 and that the margin is computed from it — so
 * the copy cannot drift from what the rule is measured against without a failing unit test. A
 * pixel-thickness assertion in the browser would additionally catch a change to the app's own
 * preset, at the cost of a threshold that is itself not robust for an odd width (a stroke of
 * odd width centred between two rows has one fewer fully-covered row than it has pixels), so
 * it is not shipped.
 */
export const DRAW_TOOL_STROKE_WIDTH = 10;

/**
 * Smallest acceptable distance from a stroke boundary to an integer document pixel.
 *
 * WHY A NUMBER AND NOT A RULE. A stroke rasterised into the document canvas has boundaries at
 * its two endpoints and at `lineWidth/2` beyond each of them in every direction; the pen is
 * `moveTo` + `bezierSmoothedLine` + `stroke` with a ROUND cap (`src/tools/draw.ts:56`), and
 * the layer is composited at float x/y (`src/contexts/layer-renderer.ts:81`). A boundary that
 * lands exactly on an integer document pixel therefore sits on a Skia anti-aliasing rounding
 * tie, and the SIGN of a sub-pixel error decides an 8-bit coverage value.
 *
 * WHY THAT MATTERS FOR A LAYOUT-INDEPENDENT ORACLE. The app never rounds: `getLocalCoords`
 * is bare float64 arithmetic (`src/hooks/usePointerPosition.ts:183`). The only quantisation
 * is upstream of it, in the transport. Measured on this host's Chrome: a `pointermove` from
 * `Input.dispatchMouseEvent` carries `Math.fround(sent)` and nothing more, so the delivered
 * `clientX` differs from the sent one by up to half a float32 ulp. Over viewport widths
 * 768-1920 and heights 560/720, the resulting error in the ACHIEVED DOCUMENT coordinate of
 * `EXPORT_LINE_START` measured at most 4.1e-5 doc px, and it VARIES with `offsetX` and
 * `scale` — that is, with the frame, which is the whole problem.
 *
 * (Only the `pointermove` is float32. The `mousemove` Blink synthesises alongside it carries
 * INTEGER coordinates — 400.75 arrives as 400 — but the app listens to pointer events, so
 * that second, far larger quantisation never reaches the stroke.)
 *
 * THE THRESHOLD, and why it is 0.05 rather than a round 0.1 or 0.2. It is set from the
 * measured stability boundary, not from taste: sweeping both endpoints across viewport widths
 * 1024-1140 step 4 (plus 1280/1366/1600/1920) x both sidebar states, a boundary margin of 0
 * doc px — which is what "tidy 123.203285 to 123" produces — splits the export into 2
 * distinct byte-strings, and the split is periodic in viewport WIDTH, so a height-only test
 * cannot see it. A margin of 0.02 doc px is 97x the measured 4.1e-5 transport error; 0.05 is
 * what the sweep found stable with headroom over the largest margin it could still split at,
 * and it sits 4x below the shipped constants' own 0.203285 so the invariant has room to move
 * before it starts biting.
 *
 * WHAT BREAKS IF IT IS IGNORED. `EXPORT_LINE_START`/`EXPORT_LINE_END` are six-decimal magic
 * numbers whose only recorded property is the round trip through `documentToCanvasOffset`.
 * Nothing states that they must be clear of the pixel grid, so rounding them to integers
 * reintroduces a layout-dependent oracle that stays green at 1280 wide and is wrong at 1024.
 */
export const MIN_STROKE_BOUNDARY_MARGIN_DOC_PX = 0.05;

/**
 * Distance from the nearest stroke boundary to an integer document pixel.
 *
 * A stroke from `start` to `end` with a round cap and width `lineWidth` reaches `lineWidth/2`
 * beyond each endpoint in every direction, so its extremes are the eight coordinates below.
 * (For a horizontal stroke these are the two cap centres on x and the two long edges on y; the
 * endpoint form is also the conservative answer for a diagonal one.)
 *
 * Returns 0 when a boundary sits exactly on the grid — the AA-tie case — and a larger value
 * the further every boundary is from an integer. Pure and browser-free by design: it is the
 * rule `EXPORT_LINE_START`/`EXPORT_LINE_END` have to satisfy, and it must be checkable
 * without a browser so the check runs in `npm run test:e2e:unit` and in `tsc -b`.
 */
export function documentStrokeBoundaryMargin(
  start: { x: number; y: number },
  end: { x: number; y: number },
  lineWidth: number
): number {
  const half = lineWidth / 2;
  const offGrid = (value: number) => Math.abs(value - Math.round(value));
  return Math.min(
    offGrid(start.x - half),
    offGrid(start.x + half),
    offGrid(end.x - half),
    offGrid(end.x + half),
    offGrid(start.y - half),
    offGrid(start.y + half),
    offGrid(end.y - half),
    offGrid(end.y + half)
  );
}

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

  // Selection detection (getSelectionBounds, tuned for the app's selection colour)
  SELECTION_RED_MAX: 80, // For getSelectionBounds: red <= 80 (low red)
  SELECTION_GREEN_MIN: 80, // For getSelectionBounds: green >= 80 (medium green)
  SELECTION_BLUE_MIN: 180, // For getSelectionBounds: blue >= 180 (high blue)

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
 * Returns the workspace canvas locator.
 *
 * `data-testid="workspace-canvas"` is the only selector. An earlier version paired it
 * with `page.locator('canvas').nth(1)` via `.or()`, which was never a priority: `.or()`
 * returns the union of both sides, so as soon as the test id existed the locator
 * resolved to 2 elements and every `boundingBox()` call raised a strict mode
 * violation. The fallback was a document index anyway, and it was a wrong one - the
 * Draw toolbar mounts a preview canvas ahead of the workspace, and unmounting it when
 * another tool is selected shifted the index onto a hidden overlay.
 *
 * The app publishes the test id, so the fallback has no remaining job.
 */
export function getWorkspaceCanvas(page: Page): Locator {
  return page.getByTestId('workspace-canvas');
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

  const outputDir = testInfo.outputDir;
  if (typeof outputDir !== 'string' || outputDir === '') {
    throw new Error('takeLineScreenshot: testInfo.outputDir is required to capture and attach a screenshot');
  }
  const screenshotPath = path.join(outputDir, `${name}.png`);
  await fs.mkdir(outputDir, { recursive: true });
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
  /**
   * Interpolated mouse moves between the endpoints. Omit for a single jump.
   *
   * `0` is a real instruction meaning "do not interpolate", so `drawLine` acts on it - but
   * it does not forward it, because Playwright reads a `steps` below 1 as "no move at all".
   * See `interpolationSteps` below. Anything larger than 1 reaches `page.mouse.move` as given.
   */
  steps?: number;
}

/**
 * The `steps` value `drawLine` actually hands to Playwright.
 *
 * Playwright's server `Mouse.move` is `const { steps = 1 } = options` followed by
 * `for (let i = 1; i <= steps; i++)`, so forwarding a `steps` below 1 dispatches zero moves:
 * the endpoint is never reached and the press/release pair collapses into a zero-length
 * stroke. Its client validator answers a non-integer with
 * `steps: expected integer, got float <value>`, so a miscomputed `NaN`, `Infinity` or
 * fractional count throws between `mousedown` and `mouseup`, leaving the button down.
 * Both collapse to 1, which is Playwright's own default and the one move that lands on the
 * endpoint.
 */
function interpolationSteps(steps: number): number {
  return Number.isInteger(steps) && steps > 1 ? steps : 1;
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
  if (options.steps === undefined) {
    await page.mouse.move(box.x + endX, box.y + endY);
  } else {
    await page.mouse.move(box.x + endX, box.y + endY, { steps: interpolationSteps(options.steps) });
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
  const redMax = colorThresholds?.redMax ?? STROKE_ANALYSIS.SELECTION_RED_MAX;
  const greenMin = colorThresholds?.greenMin ?? STROKE_ANALYSIS.SELECTION_GREEN_MIN;
  const blueMin = colorThresholds?.blueMin ?? STROKE_ANALYSIS.SELECTION_BLUE_MIN;

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

/**
 * Averages the opaque pixels within `radius` of the point, ignoring near-white ones when
 * `ignoreNearWhite` is set. Returns null when the point is outside the image or every
 * sampled pixel was skipped.
 *
 * `radius` is a sampling window, so it is clamped to 0 rather than rejected: a negative
 * window used to select no pixels at all, which reads as "nothing at this point" — a
 * legitimate miss — rather than as the misconfigured constant it is. A clamped radius
 * still returns null when the centre pixel itself is transparent.
 */
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
  const sampleRadius = Math.max(0, radius);
  const nearWhiteThreshold = options?.nearWhiteThreshold ?? STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD;
  for (let y = pointY - sampleRadius; y <= pointY + sampleRadius; y++) {
    for (let x = pointX - sampleRadius; x <= pointX + sampleRadius; x++) {
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
