import { expect, type Page, test, type TestInfo } from '@playwright/test';
import {
  type BoundingBox,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  type DominantColor,
  drawLine,
  dominantRed,
  getColorAtPoint,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/** `#cc0000`, the colour every spec here strokes with. */
const STROKE_COLOR = '#cc0000';

/**
 * The centre of the stroke in the image `takeLineScreenshot` returns, which crops the
 * canvas to `DEFAULT_LINE_CLIP` (120,120,260,80) measured from the canvas box. The
 * standard test line runs (150,150)->(350,150) in box coordinates, so in that image it
 * spans x 30..230 on row 30 and (130,30) is the middle of the line.
 */
const STROKE_MIDDLE = { x: 130, y: 30 } as const;

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
}

/**
 * Polls the dominant red of the line clip until the canvas has settled on `expectedRed`.
 *
 * Adjusting brightness/contrast repaints the canvas, so a single screenshot can land on
 * the pre-repaint frame. Polling to the settled value both waits for the repaint and
 * asserts the value the filter actually produced: a poll failure reports the red it
 * really read, which is the only useful signal about a wrong adjustment. `message` is
 * carried into the poll error so the failure names the assertion that broke.
 */
async function readRedLine(
  page: Page,
  box: BoundingBox,
  name: string,
  testInfo: TestInfo,
  expectedRed: number,
  failureMessage: string
): Promise<DominantColor> {
  let observed: DominantColor | null = null;
  await expect
    .poll(
      async () => {
        observed = await dominantRed(await takeLineScreenshot(page, box, name, testInfo));
        return observed?.red ?? null;
      },
      {
        message: failureMessage,
        timeout: CANVAS_REDRAW_TIMEOUT_MS,
        intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS],
      }
    )
    .toBe(expectedRed);
  return observed!;
}

/**
 * The dominant red measured for `#cc0000` at brightness `-20`, which emits
 * `brightness(62.83%)` (`expAdjustment(-20, 1.9)`, `src/tools/functions.ts:36`).
 *
 * The one thing that is NOT being asserted is a prediction of what Chrome does with
 * that percentage - the repo documents nothing about the colour space canvas 2D
 * evaluates filters in, and guessing one is how a pin ends up asserting a lie. The
 * number is what this suite measured on this app, checked stable across repeated
 * retries-0 runs. If the exposure curve in `buildLevelsFilter` ever changes, this is
 * supposed to fail.
 */
const MEASURED_BRIGHTNESS_MINUS_20_RED = 141;

/**
 * The dominant red measured for `#cc0000` at contrast `50`, which emits
 * `contrast(325.39%)`.
 *
 * `contrast()` is anchored at mid grey: a channel above `128 + (255 - 128) / 3.2539`
 * is pushed past white and clamps at 255 whatever colour space the filter is evaluated
 * in, so this one is algebraically forced rather than merely measured. `#cc0000`'s red
 * channel is 204, well past that knee.
 */
const MEASURED_CONTRAST_50_RED = 255;

/**
 * The stroke's core at brightness `-100`, which emits `brightness(0%)` because
 * `expAdjustment(-100, 1.9) === 0`.
 *
 * Multiplying every channel by zero is exact in any colour space, in any evaluation
 * order, and with or without anti-aliasing, so the layer's own pixels become (0,0,0)
 * whatever the filter does. What reaches the screenshot is the document showing through
 * the stroke's 0.9 alpha, so the composited core is neutral rather than literally black.
 */
const MEASURED_BRIGHTNESS_MINUS_100_CORE = { red: 26, green: 26, blue: 26 };

/** Re-measures the canvas box after an adjustment panel has opened. */
async function remeasureCanvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  expect(box, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();
  return box!;
}

// The Levels sliders are labelled by a <label for> plus a live value suffix, so their
// accessible names read "Brightness 0%" and "Contrast 50%". Matching the label part
// alone survives the value suffix changing and needs no knowledge of the slider ids.
test.describe('Levels adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // changes red line via brightness
  test('changes red line via brightness', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    // Select Draw tool and draw a line
    await clickToolButton(page, 'draw');
    // The draw tool only strokes with the active foreground color once it is the active
    // tool, so the color has to be set after activation; verifySwatch then proves the
    // store the draw tool reads actually holds it.
    // SET COLOR via native setter (triggers React onChange)
    // This bypasses React's "value unchanged" check and reaches delegated listeners
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    const original = await dominantRed(await takeLineScreenshot(page, box!, 'levels-original', testInfo));
    expect(original, 'Red line not found on original screenshot').toBeTruthy();

    // Open Colors flyout and select Levels
    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();
    await brightness.fill('-20');
    await expect(brightness).toHaveValue('-20');

    // Opening the Levels panel can reflow the workspace canvas, so a box measured before
    // the flyout opened can clip empty canvas; re-measure before reading pixels.
    const adjustedBox = await remeasureCanvasBox(page);

    const afterBrightness = await readRedLine(
      page,
      adjustedBox,
      'levels-brightness',
      testInfo,
      MEASURED_BRIGHTNESS_MINUS_20_RED,
      'The stroke did not settle on the red brightness -20 is measured to produce'
    );
    // Direction first: brightness -20 darkens, so the sampled red must fall. This is
    // the assertion that survives even if the exact value above moves.
    expect(afterBrightness.red, 'brightness -20 must darken the stroke').toBeLessThan(original!.red);
  });

  // changes red line via contrast
  test('changes red line via contrast', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    // Select Draw tool and draw a line
    await clickToolButton(page, 'draw');
    // See the brightness test: the color is set after the tool is active, and
    // verifySwatch asserts the store the draw tool strokes with kept it.
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    const original = await dominantRed(await takeLineScreenshot(page, box!, 'levels-original-contrast', testInfo));
    expect(original, 'Red line not found on original screenshot').toBeTruthy();

    // Open Colors flyout and select Levels
    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });

    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(contrast).toBeVisible();
    await contrast.fill('50');
    await expect(contrast).toHaveValue('50');

    // See the brightness test: re-measure the canvas, it can reflow when Levels opens.
    const adjustedBox = await remeasureCanvasBox(page);

    const afterContrast = await readRedLine(
      page,
      adjustedBox,
      'levels-contrast',
      testInfo,
      MEASURED_CONTRAST_50_RED,
      'The stroke did not settle on the red contrast 50 is measured to produce'
    );
    expect(afterContrast.red, 'contrast 50 must raise the stroke above mid grey').toBeGreaterThan(original!.red);
  });

  // brightness -100 emits brightness(0%), which is exact in every colour space
  test('darkens the red stroke to neutral black at brightness -100', async ({ page }, testInfo) => {
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box, 'Canvas should have visible coordinates').not.toBeNull();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, STROKE_COLOR, true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    const original = await takeLineScreenshot(page, box!, 'levels-minus-100-original', testInfo);
    expect(await hasRedPixels(original), 'The stroke should be red before the adjustment').toBe(true);
    // `hasDarkPixels` needs all three channels under 60, and no pixel of this stroke
    // ever is: even its darkest green and blue ride on a red channel above 200. So the
    // state waited for below cannot have existed before the slider moved.
    expect(await hasDarkPixels(original), 'The unadjusted stroke should have no dark pixel').toBe(false);

    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });
    const adjustedBox = await remeasureCanvasBox(page);

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();
    await brightness.fill('-100');
    await expect(brightness).toHaveValue('-100');

    // A genuine wait for the repaint: the state being waited for did not exist before
    // the slider moved.
    await waitForCanvasPixels(page, canvasRedrawClip(adjustedBox), hasDarkPixels, {
      description: 'the stroke darkened at brightness -100',
    });

    const after = await takeLineScreenshot(page, adjustedBox, 'levels-minus-100', testInfo);
    expect(await hasDarkPixels(after), 'brightness(0%) must leave the stroke dark').toBe(true);
    expect(await hasRedPixels(after), 'brightness(0%) must leave no red pixel behind').toBe(false);

    // `brightness(0%)` multiplies every channel by zero, so the layer's own pixels are
    // (0,0,0) whatever colour space the filter is evaluated in. What the screenshot
    // sees is the white document composited through the stroke's 0.9 alpha, which is a
    // neutral grey and identical in all three channels.
    const core = await getColorAtPoint(after, STROKE_MIDDLE.x, STROKE_MIDDLE.y, 0, { ignoreNearWhite: true });
    expect(core, 'brightness(0%) left no ink at the middle of the stroke').not.toBeNull();
    expect(core, 'brightness(0%) must drive all three channels of the stroke to the same value').toEqual(
      MEASURED_BRIGHTNESS_MINUS_100_CORE
    );
  });
});
