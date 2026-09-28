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

/**
 * The document the app seeds on boot, and the size the export baselines describe.
 *
 * This is a DEFAULT, not a fact about the app. `documentToCanvasOffset` used to hardcode
 * it, which made the document size an assumption every document-space gesture inherited
 * silently; a caller that knows the real size — the export fixture reads it off the canvas
 * backing store — passes it, and the `e2e/export` suite asserts the two agree before it
 * draws anything. `DEFAULT_DOCUMENT_*` remain exported for callers that genuinely mean
 * "the seeded document".
 */
export const DEFAULT_DOCUMENT_WIDTH = 800;
export const DEFAULT_DOCUMENT_HEIGHT = 600;
export const DEFAULT_DOCUMENT_SIZE = { width: DEFAULT_DOCUMENT_WIDTH, height: DEFAULT_DOCUMENT_HEIGHT } as const;

export interface DocumentSize {
  width: number;
  height: number;
}

/**
 * The contain fit, in ONE place.
 *
 * `documentToCanvasOffset` and `canvasOffsetToDocument` used to each carry their own copy
 * of these three lines, and the docstring above the second claimed it was "read off the
 * live app". It never was: it was the first function's algebra inverted. The consequence
 * was a round-trip test (`document-mapping.unit.test.ts`) asserting `f^-1(f(x)) = x` for
 * one formula and its own inverse, which cannot fail and says nothing about the app. There
 * is now a single `scale` / `offsetX` / `offsetY` derivation, so a change to the fit rule is
 * a change in one place, and the only remaining question — whether this agrees with
 * `usePointerPosition` — is answered against the app, not against this file.
 *
 * Mirrors `src/hooks/usePointerPosition.ts`: `scale = min(outerW/imageW, outerH/imageH)`,
 * then the leftover split evenly as the offset. The app publishes its own computed values
 * on the container as `data-fit-*` (see `publishFit` there), and
 * `visual-regression.spec.ts` asserts these three numbers equal the app's, at more than
 * one rect size including one that differs only in width.
 */
export function containFit(
  box: { width: number; height: number },
  documentSize: DocumentSize = DEFAULT_DOCUMENT_SIZE
): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(box.width / documentSize.width, box.height / documentSize.height);
  return {
    scale,
    offsetX: (box.width - documentSize.width * scale) / 2,
    offsetY: (box.height - documentSize.height * scale) / 2,
  };
}

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
 * `box` is the app's CONTAINER rect, and the helper is the forward direction only: the
 * caller adds the box origin to reach a client coordinate, exactly as the app then maps
 * that back through `getLocalCoords`. `visual-regression.spec.ts` asserts the box it passes
 * is the container's own rect rather than the `<canvas>`'s, and that the two coincide here
 * only because `<main>` has no padding or border and the canvas is `h-full w-full` of it.
 *
 * `documentSize` defaults to the seeded document; pass the measured size when you have it.
 */
export function documentToCanvasOffset(
  box: { width: number; height: number },
  documentX: number,
  documentY: number,
  documentSize: DocumentSize = DEFAULT_DOCUMENT_SIZE
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = containFit(box, documentSize);
  return { x: offsetX + documentX * scale, y: offsetY + documentY * scale };
}

/**
 * The inverse of `documentToCanvasOffset`: the document point a canvas offset names.
 *
 * This is the app's `getLocalCoords` with the box origin dropped — `(clientX - offsetX -
 * rect.x) / scale` — and it shares `containFit` with the forward direction, so the two
 * cannot drift apart inside this file.
 *
 * It is NOT read off the live app, and it is not claimed to be. What the app actually
 * computed is read at runtime, from the `data-fit-*` attributes `usePointerPosition`
 * publishes on the container, and compared against the numbers above: see the
 * "agrees with the app's own contain fit" test in `e2e/export/visual-regression.spec.ts`.
 * That is the only assertion here that can fail if the app's mapping changes.
 */
export function canvasOffsetToDocument(
  box: { width: number; height: number },
  canvasX: number,
  canvasY: number,
  documentSize: DocumentSize = DEFAULT_DOCUMENT_SIZE
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = containFit(box, documentSize);
  return { x: (canvasX - offsetX) / scale, y: (canvasY - offsetY) / scale };
}

export const CANVAS_REDRAW_TIMEOUT_MS = 10_000;
export const CANVAS_REDRAW_POLL_INTERVAL_MS = 100;

export interface DominantColor {
  red: number;
  green: number;
  blue: number;
  count: number;
}

/**
 * A screenshot clip, in VIEWPORT-relative CSS pixels.
 *
 * THE ORIGIN IS THE POINT. `page.screenshot({ clip })` measures the clip against the
 * viewport and adds `window.scrollX/Y` itself, and it trims the clip to the viewport, so a
 * region entirely above or below the fold collapses to zero height and throws.
 *
 * A same-named type in `e2e/helpers/cdp-helpers.ts` is a DIFFERENT space. `Page.captureScreenshot`
 * reads its clip against the DOCUMENT origin, so the identical numbers name a region
 * `scrollY` pixels away. Passing a viewport-relative number to CDP does not throw; it
 * photographs the wrong pixels, which is how a capture came back as mostly white — a
 * plausible image of a document that is mostly white. Anything handed to
 * `captureCanvasScreenshot` must be converted with `viewportRectToPageRect` first, and
 * anything handed to `page.screenshot` must not be.
 */
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
 * The clip this takes and returns is VIEWPORT-relative (see `ClipOptions`); the scroll is
 * undone afterwards rather than left in place, because a caller's later `page.mouse`
 * coordinates are viewport-relative and were built against the window it expects to still
 * be in. A `Page.captureScreenshot` clip is document-relative and needs the opposite
 * treatment — see `cdp-helpers.ts`.
 *
 * This is a SAFETY NET, not a workaround for a bug that is present. The rail now declares
 * `min-h-0 overflow-y-auto`, so the page no longer outgrows a 720px viewport and no region
 * of a 583px canvas can be off screen. It stays because the failure it prevents is silent
 * and total — the capture throws, or worse, photographs the app's own dark header and
 * reports success — and because "the page does not scroll" is a property of the current
 * layout rather than of the helper's contract. If a future change reintroduces an
 * overflowing page, the read below degrades to working instead of to a false negative.
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
  const onScreen = await onScreenClip(page, actualClip);
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({ path: screenshotPath, clip: onScreen.clip });
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
    // Re-derived every poll rather than hoisted: the window may have moved under us, and a
    // stale clip photographs the wrong region. `onScreenClip` is a no-op when the region is
    // already in view, which is every poll in the current layout.
    const onScreen = await onScreenClip(page, clip);
    try {
      if (await predicate(await page.screenshot({ clip: onScreen.clip }))) return;
    } finally {
      await onScreen.restore();
    }
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

/**
 * Where a mark's ink sits, and how much of it there is.
 *
 * Every field is in IMAGE pixels, using the pixel-centre convention: the centre of the
 * pixel at index `i` is `i + 0.5`, so an ink centroid of `78.5` means half the ink above
 * the 78th row's midpoint. Every field is ink-WEIGHTED, so anti-aliased edge pixels
 * contribute in proportion to how much ink they carry and the centroid moves
 * sub-pixel-accurately with the mark.
 */
export interface InkProfile {
  imageWidth: number;
  imageHeight: number;
  /** Total ink: the sum of the per-pixel weights. Zero means "no ink at all". */
  ink: number;
  /** Number of pixels carrying any ink. */
  pixelCount: number;
  /** Ink-weighted mean column and row, in image pixels. */
  centroidX: number;
  centroidY: number;
  /** Ink-weighted standard deviation per axis: the mark's spread, independent of where it sits. */
  spreadX: number;
  spreadY: number;
  /** Inclusive bounds of the columns and rows carrying any ink. */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Luma below which a pixel is paper rather than ink.
 *
 * Eight of 255, and the reason is measured, not chosen: on the committed export baselines
 * the paper is EXACTLY 255.0 in every format, so a floor of 0 would admit no background at
 * all — but the lossy formats ring around a black-on-white edge, and a floor of 0 lets
 * JPEG's ringing widen the ink's column bounds from the `118..292` that every format
 * agrees on to `112..295`. A floor of 8 trims that and nothing else: on `drawing.png` it
 * moves the centroid by 0.013 document pixels, well inside every tolerance below.
 */
export const INK_LUMA_FLOOR = 8;

/**
 * Measure a mark's ink geometry, sub-pixel.
 *
 * THE POINT. `compareScreenshots` counts differing pixels against a budget, and for a long
 * horizontal stroke that budget is wildly asymmetric: shifting a 174x11 band one pixel
 * sideways relights only the two round caps, so on the committed baseline a 1.0-document-pixel
 * horizontal shift produces 88 diff pixels and PASSES the 100-pixel budget, while the same
 * shift vertically produces 741 and fails. The oracle was therefore about 110x looser on the
 * one axis a sidebar-width change, a DPR change or a rounding difference actually moves —
 * the horizontal one. A measured centroid has no such blind spot: it tracks a horizontal
 * shift of 1.0 document pixels to within 1e-6, and it costs no committed baseline.
 *
 * The weight is `INK_LUMA_FLOOR`-relative darkness against the 255 paper, which is the right
 * model for ink on paper: it needs no knowledge of what colour the mark is, it is immune to
 * a background that drifts off pure white, and it stays continuous, so it does not quantise
 * the centroid the way a hard threshold would.
 *
 * Returns `null` when the image carries no ink at all, which is a legitimate answer (a blank
 * export) and must not be read as "the mark was not found".
 */
export async function measureInk(
  image: Buffer | ImageDataResult,
  options: { floor?: number } = {}
): Promise<InkProfile | null> {
  const imageData = isBuffer(image) ? await loadImageData(image) : image;
  const { width, height, data } = imageData;
  const floor = options.floor ?? INK_LUMA_FLOOR;
  const paper = 255 - floor;

  let ink = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let pixelCount = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      if (alpha === 0) continue;
      const luma = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      // Scaled by alpha so a mark on a transparent background weighs the same as on paper.
      const weight = ((paper - luma) * alpha) / 255;
      if (weight <= 0) continue;

      const centerX = x + 0.5;
      const centerY = y + 0.5;
      ink += weight;
      sumX += weight * centerX;
      sumY += weight * centerY;
      sumXX += weight * centerX * centerX;
      sumYY += weight * centerY * centerY;
      pixelCount += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (ink === 0) return null;

  const centroidX = sumX / ink;
  const centroidY = sumY / ink;
  return {
    imageWidth: width,
    imageHeight: height,
    ink,
    pixelCount,
    centroidX,
    centroidY,
    spreadX: Math.sqrt(Math.max(0, sumXX / ink - centroidX * centroidX)),
    spreadY: Math.sqrt(Math.max(0, sumYY / ink - centroidY * centroidY)),
    left,
    top,
    right,
    bottom,
  };
}

/** `right - left + 1`: the width of the ink's column span, in whole image pixels. */
export function inkWidth(profile: InkProfile): number {
  return profile.right - profile.left + 1;
}

/** `bottom - top + 1`: the height of the ink's row span, in whole image pixels. */
export function inkHeight(profile: InkProfile): number {
  return profile.bottom - profile.top + 1;
}
