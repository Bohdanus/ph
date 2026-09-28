import { type Page, type Locator, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { imageBoundsToCss, viewportRectToPageRect } from './screenshot-scale';

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

/** The document's own size, which every export baseline is recorded at. */
export const DOCUMENT_WIDTH = 800;
export const DOCUMENT_HEIGHT = 600;

/**
 * Maps a DOCUMENT point to a point inside the canvas box, inverting the `object-contain`
 * letterbox the app renders the document into (`src/components/Main/Main.tsx:241`).
 *
 * `page.mouse` speaks viewport pixels, so a stroke has to be aimed at where the document
 * actually landed inside the box. Doing that by hardcoding box-relative numbers makes every
 * recorded baseline a pin on the TOOLBAR's height, not on the export: the export fixture
 * drew at box y=150, and the document row that lands on depends on
 * `(boxHeight - DOCUMENT_HEIGHT * scale) / 2`, which is a property of the surrounding chrome.
 * That is how a sidebar layout change invalidated seven image baselines
 * (`e2e/OPEN_PROBLEMS.md` P1). Aiming in document space removes the coupling: the same call
 * produces the same export whatever the toolbar does.
 *
 * The scale is width-limited whenever the box is wider than the document's aspect, which is
 * what `min()` selects here; the letterbox offsets then centre the result on the other axis.
 */
export function documentToBoxPoint(
  box: Pick<BoundingBox, 'width' | 'height'>,
  point: { x: number; y: number }
): { x: number; y: number } {
  const scale = Math.min(box.width / DOCUMENT_WIDTH, box.height / DOCUMENT_HEIGHT);
  return {
    x: (box.width - DOCUMENT_WIDTH * scale) / 2 + point.x * scale,
    y: (box.height - DOCUMENT_HEIGHT * scale) / 2 + point.y * scale,
  };
}

export const CANVAS_REDRAW_TIMEOUT_MS = 10_000;
export const CANVAS_REDRAW_POLL_INTERVAL_MS = 100;

/**
 * Slack around a stroke when asking whether it fits on screen. It only decides how much of
 * the page has to be scrollable for a stroke to count as in view, never where the stroke
 * lands, so it is deliberately not a measurement of anything.
 */
const STROKE_VIEWPORT_MARGIN_PX = 40;

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

/**
 * The window's scroll offset, read at the moment a caller needs it.
 *
 * The one place in the helpers that reads page state rather than deriving geometry from a
 * box, and shaped like `getDevicePixelRatio` (cdp-helpers.ts): a page function, read at the
 * call site. Caching it would be wrong rather than merely stale — `clickToolButton` scrolls
 * the window by 440px in this build, so an offset read once is wrong by a different amount
 * before and after any tool click.
 */
export async function getPageScroll(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
}

/**
 * A clip positioned so the region it names is actually rendered, plus the undo for
 * whatever scrolling that took.
 */
interface OnScreenClip {
  clip: Required<ClipOptions>;
  restore: () => Promise<void>;
}

/** Viewport size and the page's scrollable extent, read together so they cannot disagree. */
interface PageViewport {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  maxScrollY: number;
}

async function readPageViewport(page: Page): Promise<PageViewport> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Returns a `page.screenshot`-ready clip for a region that is not currently in view, and
 * puts the window back when the caller is done with it.
 *
 * `page.screenshot({ clip })` can only photograph what is on screen: Playwright trims the
 * clip against the viewport, and a region that is entirely above or below it collapses to
 * zero height and throws `Clipped area is either empty or outside the resulting image`.
 * That is a real outcome, not a misconfiguration — this app is 1177px tall in Playwright's
 * 720px window, and `paint-options.spec.ts` reads its 60px stroke from 0.7 of the canvas
 * box height, which measures to y=748: measured, the clip throws as given and captures
 * correctly once the window is scrolled to 448. A spec cannot express that scroll, because
 * the clip it built is a viewport rect and the page may move under it, so the read does it
 * itself and gives the scroll back.
 *
 * The scroll is restored rather than left in place because a caller's later
 * `page.mouse` coordinates are viewport-relative and were built against the window it
 * expects to still be in — `select-move.spec.ts` drags from a box it measured earlier, and
 * a capture that quietly left the page scrolled would move that drag by the same 440px.
 */
async function onScreenClip(page: Page, clip: Required<ClipOptions>): Promise<OnScreenClip> {
  const viewport = await readPageViewport(page);
  const pageRect = viewportRectToPageRect(clip, { x: viewport.scrollX, y: viewport.scrollY });
  const alreadyVisible =
    pageRect.y >= viewport.scrollY && pageRect.y + pageRect.height <= viewport.scrollY + viewport.height;

  if (alreadyVisible) return { clip, restore: async () => undefined };

  // Centre the region in the viewport, then let the page clamp it — near the top or the
  // bottom of a tall document the ideal position is not reachable, and a request the
  // browser cannot satisfy must not be sent as if it had been.
  const targetY = clamp(pageRect.y - Math.round((viewport.height - pageRect.height) / 2), 0, viewport.maxScrollY);
  await page.evaluate((y) => window.scrollTo(0, y), targetY);
  const scrolledTo = await page.evaluate(() => window.scrollY);

  return {
    clip: { ...clip, y: pageRect.y - scrolledTo },
    restore: async () => {
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x: viewport.scrollX, y: viewport.scrollY });
    },
  };
}

/**
 * Captures the `clip` region and attaches it under `name`.
 *
 * `box` and `clip` are viewport-relative, and that is the space `page.screenshot` wants:
 * Playwright trims the clip against the viewport and adds `window.scrollX/Y` itself before
 * it reaches CDP. Do NOT run this clip through `viewportRectToPageRect` — see the note
 * there. `captureCanvasScreenshot` in cdp-helpers.ts is the one that DOES need it, because
 * it bypasses Playwright and speaks CDP directly. A region that is off screen is scrolled
 * to for the capture and scrolled back afterwards, on the same terms as `waitForCanvasPixels`.
 */
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
  const onScreen = await onScreenClip(page, actualClip);
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({
      path: screenshotPath,
      clip: onScreen.clip,
    });
  } finally {
    await onScreen.restore();
  }
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
  const from = { x: box.x + startX, y: box.y + startY };
  const to = { x: box.x + endX, y: box.y + endY };
  // A stroke outside the window is not drawn at all: `page.mouse` is viewport-relative
  // and Chrome never delivers an event below the fold, so the app never sees the pointer
  // and the read that follows waits out its timeout on a region nothing was painted into.
  // `paint-options.spec.ts` measures its 60px stroke to y=880 in a 720px window for exactly
  // this reason. Scrolling the stroke into view and back keeps the point on the canvas in
  // the same place — only the window moves — and `onScreenClip` returns the SAME rect when
  // it is already in view, so every stroke that draws today is dispatched identically.
  const strokeRect: Required<ClipOptions> = {
    x: Math.min(from.x, to.x) - STROKE_VIEWPORT_MARGIN_PX,
    y: Math.min(from.y, to.y) - STROKE_VIEWPORT_MARGIN_PX,
    width: Math.abs(to.x - from.x) + STROKE_VIEWPORT_MARGIN_PX * 2,
    height: Math.abs(to.y - from.y) + STROKE_VIEWPORT_MARGIN_PX * 2,
  };
  const onScreen = await onScreenClip(page, strokeRect);
  const shiftX = onScreen.clip.x - strokeRect.x;
  const shiftY = onScreen.clip.y - strokeRect.y;

  try {
    await page.mouse.move(from.x + shiftX, from.y + shiftY);
    await page.mouse.down();
    if (options.steps === undefined) {
      await page.mouse.move(to.x + shiftX, to.y + shiftY);
    } else {
      await page.mouse.move(to.x + shiftX, to.y + shiftY, { steps: interpolationSteps(options.steps) });
    }
    await page.mouse.up();
  } finally {
    await onScreen.restore();
  }
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
 *
 * `clip` is viewport-relative — the space `boundingBox()` reports and the space
 * `page.screenshot` takes, because Playwright applies the scroll offset itself. It is
 * forwarded unconverted on purpose; see `viewportRectToPageRect` for the measurement that
 * says so and for the one capture path that needs the opposite. What it does need is for
 * the region to be ON SCREEN, which is what `onScreenClip` arranges.
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
  const onScreen = await onScreenClip(page, clip);

  try {
    for (;;) {
      if (await predicate(await page.screenshot({ clip: onScreen.clip }))) return;
      if (Date.now() >= deadline) {
        throw new Error(`Canvas did not render ${options.description ?? 'the expected pixels'} within ${timeoutMs}ms`);
      }
      await page.waitForTimeout(pollIntervalMs);
    }
  } finally {
    await onScreen.restore();
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
