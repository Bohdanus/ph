import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  documentToCanvasOffset,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  isBuffer,
  type ImageDataResult,
  loadImageData,
  measureInk,
  takeLineScreenshot,
  WHOLE_CAPTURE,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { cssPointToImage, viewportClip, type ViewportClipOptions } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * Document-space coordinates for the standard test line.
 * Mirrors the box-relative LINE_* constants (150,150 to 350,150) but expressed in
 * the 800x600 document space so they are layout-independent.
 */
const DOC_LINE_START = { x: 150, y: 150 } as const;
const DOC_LINE_END = { x: 350, y: 150 } as const;

/**
 * Document-space sample positions along the stroke.
 * These correspond to the original STROKE_SAMPLES which were at clip-relative
 * (30,30), (130,30), (225,30) in the old DEFAULT_LINE_CLIP (120,120,260,80).
 * The old clip placed the line at clip-relative (30,30) to (230,30), so:
 * - start  (30,30)  -> document (150,150)
 * - middle (130,30) -> document (250,150)
 * - end    (225,30) -> document (345,150)
 */
const DOC_STROKE_SAMPLES = [
  { name: 'start', x: 150, y: 150 },
  { name: 'middle', x: 250, y: 150 },
  { name: 'end', x: 345, y: 150 },
] as const;

const DOC_STROKE_MIDDLE = DOC_STROKE_SAMPLES[1];

/**
 * How far the stroke's ink BOUNDS may move across an adjustment, in capture pixels.
 * Unchanged from the original constant.
 */
const INK_BOUNDS_TOLERANCE_PX = 1;

/**
 * The four inclusive edges of a capture's ink, or a thrown error when it carries none.
 * Unchanged from the original function.
 */
async function inkBounds(screenshot: Buffer | ImageDataResult) {
  const profile = await measureInk(screenshot);
  expect(profile, 'The capture carries no ink at all, so there is no geometry to compare').not.toBeNull();
  const { left, top, right, bottom } = profile!;
  return { left, top, right, bottom };
}

/** How far each of the four edges moved, per edge, so a failure names the one that moved. */
function inkDrift(before: { left: number; top: number; right: number; bottom: number }, after: typeof before) {
  return {
    left: after.left - before.left,
    top: after.top - before.top,
    right: after.right - before.right,
    bottom: after.bottom - before.bottom,
  };
}

/**
 * Samples a point given in DOCUMENT space by converting to the capture's CSS pixels.
 *
 * The capture is taken over a dynamically computed clip (20px padding around the line
 * in box space). This function converts the document point to box space via
 * `documentToCanvasOffset`, then to clip-relative CSS coordinates, then to image pixels.
 *
 * `region` is the CSS size of the capture (clip.width x clip.height), required because
 * the clip size varies with the canvas box (contain fit scale).
 */
async function sampleDocPoint(
  screenshot: Buffer | ImageDataResult,
  box: BoundingBox,
  clip: ViewportClipOptions,
  docX: number,
  docY: number,
  radius: number,
  options?: Parameters<typeof getColorAtPoint>[4]
) {
  // Convert document point to box-relative coordinates
  const boxPos = documentToCanvasOffset(box, docX, docY);

  // Convert box-relative to clip-relative CSS coordinates
  // clip.x/y are viewport-relative; box.x/y are viewport-relative
  const clipRelativeX = boxPos.x - (clip.x! - box.x);
  const clipRelativeY = boxPos.y - (clip.y! - box.y);

  const image = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const point = cssPointToImage(
    { width: image.width, height: image.height },
    { x: 0, y: 0, width: clip.width!, height: clip.height! },
    { x: clipRelativeX, y: clipRelativeY }
  );
  return getColorAtPoint(image, Math.round(point.x), Math.round(point.y), radius, options);
}

/** `#cc0000`, the colour the two Colors tests stroke with. */
const RED_STROKE = '#cc0000';

/** Black, for the blur test only. */
const BLACK_STROKE = '#000000';

const WHITE = 255;

async function visibleCanvasBox(page: Page): Promise<BoundingBox> {
  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();
  return box!;
}

/**
 * Computes the line's box-relative endpoints and the viewport clip for a given box.
 * Mirrors the pattern in `color.spec.ts`: 20px padding around the line in box space.
 */
function computeLineGeometry(box: BoundingBox) {
  const start = documentToCanvasOffset(box, DOC_LINE_START.x, DOC_LINE_START.y);
  const end = documentToCanvasOffset(box, DOC_LINE_END.x, DOC_LINE_END.y);
  const clip = viewportClip({
    x: box.x + Math.min(start.x, end.x) - 20,
    y: box.y + Math.min(start.y, end.y) - 20,
    width: Math.abs(end.x - start.x) + 40,
    height: Math.abs(end.y - start.y) + 40,
  } as const);
  return { start, end, clip };
}

/**
 * Draws the standard line on a fresh page and returns the canvas box and clip.
 * The colour is set AFTER the tool is activated.
 */
async function drawStroke(page: Page, hex: string): Promise<{ box: BoundingBox; clip: ViewportClipOptions }> {
  const box = await visibleCanvasBox(page);
  const { start, end, clip } = computeLineGeometry(box);
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, hex, true);
  await drawLine(page, box, start.x, start.y, end.x, end.y);
  return { box, clip };
}

/**
 * Re-measures the canvas box and recomputes the clip for the new layout.
 * Opening an adjustment panel reflows the workspace canvas.
 */
async function remeasureCanvasBox(page: Page): Promise<{ box: BoundingBox; clip: ViewportClipOptions }> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'Canvas should have visible coordinates after opening the panel').not.toBeNull();
  const { clip } = computeLineGeometry(box!);
  return { box: box!, clip };
}

/** The polarity `waitForCanvasPixels` polls on, as a named predicate. */
const isNot =
  (predicate: CanvasPixelPredicate): CanvasPixelPredicate =>
  async (png, mask) =>
    !(await predicate(png, mask));

/** Wrapper for `hasRedPixels` to accept the mask parameter from `waitForCanvasPixels`. */
const hasRedPixelsWithMask: CanvasPixelPredicate = async (screenshot, _mask) => hasRedPixels(screenshot);

/** Wrapper for `hasDarkPixels` to accept the mask parameter from `waitForCanvasPixels`. */
const hasDarkPixelsWithMask: CanvasPixelPredicate = async (screenshot, mask) => hasDarkPixels(screenshot, mask);

/**
 * Selects the Colors panel through `Image ▸ Adjustments ▸ Desaturate`.
 */
async function openColorsPanel(page: Page): Promise<void> {
  await page.getByTestId('header-image-menu-button').click();
  await page.getByTestId('image-menu-adjustments-button').click();
  await page.getByTestId('image-menu-adjustments-desaturate-button').click();
}

test.describe('Colors adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('grayscale at 100 turns the red stroke neutral without destroying it', async ({ page }, testInfo) => {
    const { box, clip } = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before', testInfo, clip);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeBounds = await inkBounds(before);

    await openColorsPanel(page);
    const { box: panelBox, clip: panelClip } = await remeasureCanvasBox(page);

    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const grayscale = page.getByRole('slider', { name: /Grayscale/ });
    await expect(grayscale).toBeVisible();
    await grayscale.press('End');
    await expect(grayscale).toHaveValue('100');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixelsWithMask), {
      description: 'the stroke to stop being red',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-grayscale-100', testInfo, panelClip);
    expect(await hasRedPixels(after), 'grayscale(100%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE. `grayscale(100%)` replaces every channel with the
    // pixel's own luminance, so a neutral stroke is guaranteed whatever colour space
    // the canvas filter is evaluated in - and the document behind it is white, so
    // compositing two neutrals over each other stays neutral. Red, green and blue must
    // come out equal, not merely close.
    //
    // The same three reads are the survival check, and they are the only colour check in
    // this file that can be: each one is a non-null answer from the middle of the stroke
    // BODY, so an adjustment that emptied the layer samples the white document and returns
    // null. What they cannot see is GEOMETRY — three points on one row still read the same
    // colour if the layer was scaled about its middle, shifted, or thinned — so the four ink
    // edges are compared below.
    const samples = await Promise.all(
      DOC_STROKE_SAMPLES.map(async ({ name, x, y }) => {
        const sampled = await sampleDocPoint(after, panelBox, panelClip, x, y, 5, { ignoreNearWhite: true });
        expect(sampled, `grayscale(100%) left no ink at the ${name} of the stroke`).not.toBeNull();
        return { name, ...sampled! };
      })
    );
    for (const { name, red, green, blue } of samples) {
      expect({ at: name, red, green, blue }, `grayscale(100%) must neutralise the ${name} of the stroke`).toEqual({
        at: name,
        red,
        green: red,
        blue: red,
      });
    }

    // THE SHAPE, and it is the only assertion here that the adjustment is not allowed to
    // move. The three samples above pass for a layer that was scaled about its middle,
    // translated, or thinned, because a red stroke neutralised in place still reads grey
    // at all three of them; the ink's four edges do not survive any of the three.
    const afterBounds = await inkBounds(after);
    const drift = inkDrift(beforeBounds, afterBounds);
    expect
      .soft(
        Math.max(...Object.values(drift).map(Math.abs)) <= INK_BOUNDS_TOLERANCE_PX,
        `grayscale(100%) must leave the stroke where it was, and the four edges moved by ${JSON.stringify(drift)}`
      )
      .toBe(true);

    // Reset discards the uncommitted preview: the stroke comes back red and the button
    // goes back to disabled, because there is no preview left for it to remove.
    await reset.click();
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), hasRedPixels, {
      description: 'the red stroke to come back after Reset',
    });
    await expect(reset, 'Reset has nothing left to discard once the preview is gone').toBeDisabled();
  });

  test('saturation at -100 desaturates the red stroke without destroying it', async ({ page }, testInfo) => {
    const { box, clip } = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before-saturation', testInfo, clip);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeBounds = await inkBounds(before);

    await openColorsPanel(page);
    const { box: panelBox, clip: panelClip } = await remeasureCanvasBox(page);

    const saturation = page.getByRole('slider', { name: /Saturation/ });
    await expect(saturation).toBeVisible();
    await saturation.fill('-100');
    await expect(saturation).toHaveValue('-100');

    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixelsWithMask), {
      description: 'the stroke to be desaturated',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-saturation-minus-100', testInfo, panelClip);
    expect(await hasRedPixels(after), 'saturate(0%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE, for the same reason as grayscale above: zero
    // saturation is a mix with the pixel's own luminance, so all three channels have to
    // come out equal. The non-null read of each sample is the survival check, and it is
    // the same one the grayscale test makes for the reason given there.
    for (const { name, x, y } of DOC_STROKE_SAMPLES) {
      const sampled = await sampleDocPoint(after, panelBox, panelClip, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `saturate(0%) left no ink at the ${name} of the stroke`).not.toBeNull();
      expect(sampled!.red, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.green);
      expect(sampled!.blue, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.red);
    }

    // The same one shape assertion the grayscale test makes, over the same four ink edges
    // and for the same reason: three samples on a single row still read the same colour if
    // the layer was scaled about its middle, translated, or thinned.
    const afterBounds = await inkBounds(after);
    const drift = inkDrift(beforeBounds, afterBounds);
    expect
      .soft(
        Math.max(...Object.values(drift).map(Math.abs)) <= INK_BOUNDS_TOLERANCE_PX,
        `saturate(0%) must leave the stroke where it was, and the four edges moved by ${JSON.stringify(drift)}`
      )
      .toBe(true);
  });
});

test.describe('Blur adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a non-zero radius disperses the stroke off its hard edge', async ({ page }, testInfo) => {
    const { box, clip } = await drawStroke(page, BLACK_STROKE);
    const before = await takeLineScreenshot(page, box, 'blur-before', testInfo, clip);
    const beforeBounds = await getDarkPixelBounds(before, WHOLE_CAPTURE);
    expect(beforeBounds, 'The black stroke should have a fully dark core before the adjustment').not.toBeNull();
    expect(beforeBounds!.height, 'The unblurred stroke should have a hard, finite edge').toBeGreaterThan(0);
    const beforeAnalysis = await getStrokeAnalysis(before, { width: clip.width!, height: clip.height! });
    expect(beforeAnalysis, 'The stroke should be visible to stroke analysis').not.toBeNull();
    expect(beforeAnalysis!.type, 'The unblurred stroke should read as solid').toBe('solid');
    const beforeMiddle = await sampleDocPoint(before, box, clip, DOC_STROKE_MIDDLE.x, DOC_STROKE_MIDDLE.y, 5, {
      ignoreNearWhite: true,
    });
    expect(beforeMiddle, 'The stroke should be inked at its middle before the adjustment').not.toBeNull();

    // `blur` is a singleton toolbar button, not a flyout group, so it is clicked
    // directly rather than reached through a long-press flyout.
    await clickToolButton(page, 'blur');
    const { box: panelBox, clip: panelClip } = await remeasureCanvasBox(page);

    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const radius = page.getByRole('slider', { name: /Blur Radius/ });
    await expect(radius).toBeVisible();
    await radius.fill('10');
    await expect(radius).toHaveValue('10');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    // The pre-state has a fully dark core and the blurred state has none, so this poll
    // is a real wait for the repaint rather than a sleep.
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasDarkPixelsWithMask), {
      description: 'the stroke to lose its fully dark core',
    });

    const after = await takeLineScreenshot(page, panelBox, 'blur-radius-10', testInfo, panelClip);

    // DIRECTIONAL, NOT A MAGIC NUMBER. The exact spread of a CSS `blur()` is
    // implementation defined, so nothing here pins one. What is asserted is the
    // direction the ink moves in: a blur pushes the stroke's own pixels outwards, so
    // the core that was dark enough to have bounds is gone, the soft edge covers more
    // rows, and the stroke's own value is lifted towards the white document behind it.
    expect(
      await getDarkPixelBounds(after, WHOLE_CAPTURE),
      `The fully dark core the unblurred stroke had (${beforeBounds!.height}px tall) is dispersed by the blur`
    ).toBeNull();

    const afterAnalysis = await getStrokeAnalysis(after, { width: panelClip.width!, height: panelClip.height! });
    expect(afterAnalysis, 'The blurred stroke should still be visible to stroke analysis').not.toBeNull();
    expect(
      afterAnalysis!.verticalSpread,
      `The blurred stroke should cover more rows than the unblurred one (${beforeAnalysis!.verticalSpread})`
    ).toBeGreaterThan(beforeAnalysis!.verticalSpread);
    expect(afterAnalysis!.type, 'The spread soft edge is what the analyser classifies as spray').toBe('spray');

    // ...and the artwork survived: the ink is still there, just spread out and lighter.
    // A blur cannot add ink, so the stroke's value rises towards - never above - the
    // white of the document behind it.
    for (const { name, x, y } of DOC_STROKE_SAMPLES) {
      const sampled = await sampleDocPoint(after, panelBox, panelClip, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `The blur erased the stroke at the ${name} of it`).not.toBeNull();
      expect(sampled!.red, `A blur lifts the stroke's value towards the background, not above it`).toBeLessThan(WHITE);
    }
    const afterMiddle = await sampleDocPoint(after, panelBox, panelClip, DOC_STROKE_MIDDLE.x, DOC_STROKE_MIDDLE.y, 5, {
      ignoreNearWhite: true,
    });
    expect(
      afterMiddle!.red,
      `The middle of the stroke read ${beforeMiddle!.red} before the blur, and a blur can only disperse its ink outwards`
    ).toBeGreaterThan(beforeMiddle!.red);
  });
});
