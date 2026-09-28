import { expect, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/**
 * Pixel coordinates inside the image `takeLineScreenshot` returns, which crops the
 * canvas to `DEFAULT_LINE_CLIP` (120,120,260,80) measured from the canvas box. The
 * standard test line runs from (150,150) to (350,150) in box coordinates, so in that
 * image it spans x 30..230 on row 30.
 *
 * Three samples along the stroke rather than one: an adjustment that erased the
 * layer, or one that only reached part of it, would pass a single mid-stroke read.
 *
 * Every read below passes `ignoreNearWhite`. That is what makes a `null` result a
 * survival failure rather than a tautology: the document behind the layer is white, so
 * a point where the stroke has been erased samples nothing at all, while a point the
 * stroke still covers samples its pixels.
 */
const STROKE_SAMPLES = [
  { name: 'start', x: 30, y: 30 },
  { name: 'middle', x: 130, y: 30 },
  { name: 'end', x: 225, y: 30 },
] as const;

const STROKE_MIDDLE = STROKE_SAMPLES[1];

/** `#cc0000`, the colour the two Colors tests stroke with: saturated, so a greyscale
 *  or a desaturation of it is a visible change rather than a rounding difference. */
const RED_STROKE = '#cc0000';

/**
 * Black, for the blur test only. The blur is asserted as ink dispersing outwards, and
 * a black stroke is what gives `getDarkPixelBounds` a fully dark core to lose; a
 * saturated red never reads as dark at all once it is composited over the white
 * document.
 */
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
 * Draws the standard line on a fresh page and returns the canvas box.
 *
 * The colour is set AFTER the tool is activated: the draw tool only strokes with the
 * active foreground colour once it is the active tool, and `verifySwatch` proves the
 * store it reads actually holds the value.
 */
async function drawStroke(page: Page, hex: string): Promise<BoundingBox> {
  const box = await visibleCanvasBox(page);
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, hex, true);
  await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  return box;
}

/**
 * Re-measures the canvas box.
 *
 * Opening an adjustment panel reflows the workspace canvas, so a box measured before
 * the panel opened can crop empty canvas and every pixel read below it lands on the
 * white page background.
 */
async function remeasureCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'Canvas should have visible coordinates after opening the panel').not.toBeNull();
  return box!;
}

/** The polarity `waitForCanvasPixels` polls on, as a named predicate. */
const isNot =
  (predicate: CanvasPixelPredicate): CanvasPixelPredicate =>
  async (png) =>
    !(await predicate(png));

test.describe('Colors adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('grayscale at 100 turns the red stroke neutral without destroying it', async ({ page }, testInfo) => {
    const box = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before', testInfo);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeAnalysis = await getStrokeAnalysis(before);
    expect(beforeAnalysis, 'The stroke should be visible to stroke analysis').not.toBeNull();
    expect(beforeAnalysis!.type, 'The unadjusted stroke should read as solid').toBe('solid');

    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'color', label: 'Colors' });
    const panelBox = await remeasureCanvasBox(page);

    // The panel's discard can only remove a live preview, so it is disabled until one
    // exists. That makes it a readout of the preview lifecycle, not just a button.
    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const grayscale = page.getByRole('slider', { name: /Grayscale/ });
    await expect(grayscale).toBeVisible();
    await grayscale.fill('100');
    await expect(grayscale).toHaveValue('100');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    // The pre-state has red pixels and the post-state cannot, so this poll is a real
    // wait for the repaint rather than a sleep.
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixels), {
      description: 'the stroke to stop being red',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-grayscale-100', testInfo);
    expect(await hasRedPixels(after), 'grayscale(100%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE. `grayscale(100%)` replaces every channel with the
    // pixel's own luminance, so a neutral stroke is guaranteed whatever colour space
    // the canvas filter is evaluated in - and the document behind it is white, so
    // compositing two neutrals over each other stays neutral. Red, green and blue must
    // come out equal, not merely close.
    const samples = await Promise.all(
      STROKE_SAMPLES.map(async ({ name, x, y }) => {
        const sampled = await getColorAtPoint(after, x, y, 5, { ignoreNearWhite: true });
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

    // The colour check alone passes if the tool emptied the layer, so the stroke's own
    // shape is asserted too: same classification, same segment count, same extent.
    const afterAnalysis = await getStrokeAnalysis(after);
    expect(afterAnalysis, 'grayscale(100%) erased the stroke entirely').not.toBeNull();
    expect(afterAnalysis!.type, 'The greyed stroke should still read as solid').toBe('solid');
    expect(afterAnalysis!.segments, 'The greyed stroke should still be one unbroken run').toBe(
      beforeAnalysis!.segments
    );
    expect(afterAnalysis!.verticalSpread, 'The greyed stroke should occupy the same rows').toBe(
      beforeAnalysis!.verticalSpread
    );
    expect(afterAnalysis!.pixelCount, 'The greyed stroke should still cover pixels').toBeGreaterThan(0);

    // Reset discards the uncommitted preview: the stroke comes back red and the button
    // goes back to disabled, because there is no preview left for it to remove.
    await reset.click();
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), hasRedPixels, {
      description: 'the red stroke to come back after Reset',
    });
    await expect(reset, 'Reset has nothing left to discard once the preview is gone').toBeDisabled();
  });

  test('saturation at -100 desaturates the red stroke without destroying it', async ({ page }, testInfo) => {
    const box = await drawStroke(page, RED_STROKE);
    const before = await takeLineScreenshot(page, box, 'colors-before-saturation', testInfo);
    expect(await hasRedPixels(before), 'The stroke should be red before the adjustment').toBe(true);
    const beforeAnalysis = await getStrokeAnalysis(before);
    expect(beforeAnalysis, 'The stroke should be visible to stroke analysis').not.toBeNull();

    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'color', label: 'Colors' });
    const panelBox = await remeasureCanvasBox(page);

    const saturation = page.getByRole('slider', { name: /Saturation/ });
    await expect(saturation).toBeVisible();
    await saturation.fill('-100');
    await expect(saturation).toHaveValue('-100');

    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasRedPixels), {
      description: 'the stroke to be desaturated',
    });

    const after = await takeLineScreenshot(page, panelBox, 'colors-saturation-minus-100', testInfo);
    expect(await hasRedPixels(after), 'saturate(0%) must leave no red pixel in the stroke').toBe(false);

    // EXACT AND CALIBRATION-FREE, for the same reason as grayscale above: zero
    // saturation is a mix with the pixel's own luminance, so all three channels have to
    // come out equal.
    for (const { name, x, y } of STROKE_SAMPLES) {
      const sampled = await getColorAtPoint(after, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `saturate(0%) left no ink at the ${name} of the stroke`).not.toBeNull();
      expect(sampled!.red, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.green);
      expect(sampled!.blue, `saturate(0%) must neutralise the ${name} of the stroke`).toBe(sampled!.red);
    }

    const afterAnalysis = await getStrokeAnalysis(after);
    expect(afterAnalysis, 'saturate(0%) erased the stroke entirely').not.toBeNull();
    expect(afterAnalysis!.type, 'The desaturated stroke should still read as solid').toBe('solid');
    expect(afterAnalysis!.segments, 'The desaturated stroke should still be one unbroken run').toBe(
      beforeAnalysis!.segments
    );
    expect(afterAnalysis!.verticalSpread, 'The desaturated stroke should occupy the same rows').toBe(
      beforeAnalysis!.verticalSpread
    );
  });
});

test.describe('Blur adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('a non-zero radius disperses the stroke off its hard edge', async ({ page }, testInfo) => {
    const box = await drawStroke(page, BLACK_STROKE);
    const before = await takeLineScreenshot(page, box, 'blur-before', testInfo);
    const beforeBounds = await getDarkPixelBounds(before);
    expect(beforeBounds, 'The black stroke should have a fully dark core before the adjustment').not.toBeNull();
    expect(beforeBounds!.height, 'The unblurred stroke should have a hard, finite edge').toBeGreaterThan(0);
    const beforeAnalysis = await getStrokeAnalysis(before);
    expect(beforeAnalysis, 'The stroke should be visible to stroke analysis').not.toBeNull();
    expect(beforeAnalysis!.type, 'The unblurred stroke should read as solid').toBe('solid');
    const beforeMiddle = await getColorAtPoint(before, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 5, {
      ignoreNearWhite: true,
    });
    expect(beforeMiddle, 'The stroke should be inked at its middle before the adjustment').not.toBeNull();

    // `blur` is a singleton toolbar button, not a flyout group, so it is clicked
    // directly rather than reached through a long-press flyout.
    await clickToolButton(page, 'blur');
    const panelBox = await remeasureCanvasBox(page);

    const reset = page.getByTestId('undo-button-reset');
    await expect(reset, 'Reset is gated on a live preview, and there is none yet').toBeDisabled();

    const radius = page.getByRole('slider', { name: /Blur Radius/ });
    await expect(radius).toBeVisible();
    await radius.fill('10');
    await expect(radius).toHaveValue('10');
    await expect(reset, 'Moving the slider creates the live preview Reset is gated on').toBeEnabled();

    // The pre-state has a fully dark core and the blurred state has none, so this poll
    // is a real wait for the repaint rather than a sleep.
    await waitForCanvasPixels(page, canvasRedrawClip(panelBox), isNot(hasDarkPixels), {
      description: 'the stroke to lose its fully dark core',
    });

    const after = await takeLineScreenshot(page, panelBox, 'blur-radius-10', testInfo);

    // DIRECTIONAL, NOT A MAGIC NUMBER. The exact spread of a CSS `blur()` is
    // implementation defined, so nothing here pins one. What is asserted is the
    // direction the ink moves in: a blur pushes the stroke's own pixels outwards, so
    // the core that was dark enough to have bounds is gone, the soft edge covers more
    // rows, and the stroke's own value is lifted towards the white document behind it.
    expect(
      await getDarkPixelBounds(after),
      `The fully dark core the unblurred stroke had (${beforeBounds!.height}px tall) is dispersed by the blur`
    ).toBeNull();

    const afterAnalysis = await getStrokeAnalysis(after);
    expect(afterAnalysis, 'The blurred stroke should still be visible to stroke analysis').not.toBeNull();
    expect(
      afterAnalysis!.verticalSpread,
      `The blurred stroke should cover more rows than the unblurred one (${beforeAnalysis!.verticalSpread})`
    ).toBeGreaterThan(beforeAnalysis!.verticalSpread);
    expect(afterAnalysis!.type, 'The spread soft edge is what the analyser classifies as spray').toBe('spray');

    // ...and the artwork survived: the ink is still there, just spread out and lighter.
    // A blur cannot add ink, so the stroke's value rises towards - never above - the
    // white of the document behind it.
    for (const { name, x, y } of STROKE_SAMPLES) {
      const sampled = await getColorAtPoint(after, x, y, 5, { ignoreNearWhite: true });
      expect(sampled, `The blur erased the stroke at the ${name} of it`).not.toBeNull();
      expect(sampled!.red, `A blur lifts the stroke's value towards the background, not above it`).toBeLessThan(WHITE);
    }
    const afterMiddle = await getColorAtPoint(after, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 5, { ignoreNearWhite: true });
    expect(
      afterMiddle!.red,
      `The middle of the stroke read ${beforeMiddle!.red} before the blur, and a blur can only disperse its ink outwards`
    ).toBeGreaterThan(beforeMiddle!.red);
  });
});
