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
 * Polls the dominant red of the line clip until `isSettled` accepts the reading, and
 * returns that reading.
 *
 * Two different things are being waited for, and the caller states the second one:
 *
 * - That the stroke is still there. A null reading is never settled, so a line that
 *   disappeared fails this poll instead of satisfying it — which is what a bare
 *   `toBeTruthy()` on the value would have let through once a predicate existed.
 * - That the adjustment has repainted. Brightness and contrast go through a
 *   `requestAnimationFrame` and a layer preview, so a single screenshot taken
 *   immediately after `fill()` can land on the pre-repaint frame. That is why this
 *   polls instead of sampling once.
 *
 * `isSettled` states the DIRECTION the adjustment must move the reading, not the exact
 * value, so the poll absorbs the pre-repaint frame rather than reporting it as the
 * answer. The exact measured value is asserted by the caller as a separate
 * `expect`, which names the number that was actually read; polling `toBe(expected)`
 * instead would answer a red with `expected 141, received 204`.
 *
 * `name` is the attachment BASE, and every attempt appends its index. A constant name
 * wrote the same `outputDir` path N times and gave N attachments one name, so a
 * failing poll left only the last frame behind — the one least likely to explain
 * anything — and every attempt re-encoded the same path.
 */
async function readRedLine(
  page: Page,
  box: BoundingBox,
  name: string,
  testInfo: TestInfo,
  isSettled: (observed: DominantColor) => boolean,
  failureMessage: string
): Promise<DominantColor> {
  let observed: DominantColor | null = null;
  let attempt = 0;
  await expect
    .poll(
      async () => {
        attempt += 1;
        observed = await dominantRed(await takeLineScreenshot(page, box, `${name}-attempt-${attempt}`, testInfo));
        return observed !== null && isSettled(observed);
      },
      {
        message: failureMessage,
        timeout: CANVAS_REDRAW_TIMEOUT_MS,
        intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS],
      }
    )
    .toBe(true);
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
// accessible names read "Brightness 0%" and "Contrast 0%" — `defaultSettings.levels`
// is `{ brightness: 0, contrast: 0 }` and a fresh context starts there. Matching the
// label part alone survives the value suffix changing and needs no knowledge of the
// slider ids.
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

    // Open Colors flyout and select Levels
    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });

    const brightness = page.getByRole('slider', { name: /Brightness/ });
    await expect(brightness).toBeVisible();

    // ONE clip rect for both readings, and it is measured AFTER the panel opens. The
    // panel changes the options bar, which moves the canvas, so a rect measured before
    // it opened describes a different region of the page. The old order took the
    // "before" reading through the old rect and the "after" reading through the new
    // one and then asserted only that the two reds DIFFERED — which any two regions
    // of the page satisfy. Re-reading the unmodified line through the final geometry
    // is the only way to get a like-for-like pair: the pre-change colour is not
    // recoverable after the fact.
    const adjustedBox = await remeasureCanvasBox(page);

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );

    await brightness.fill('-20');
    await expect(brightness).toHaveValue('-20');

    // Brightness -20 is `brightness(62.8%)` on the layer — `buildLevelsFilter` feeds
    // the signed slider through `expAdjustment(-20, 1.9)` — so every channel is scaled
    // down and the line's red must DROP. A direction, not a difference: "the two
    // numbers are not equal" was satisfied by any pair of differently-sampled pixels
    // and by an adjustment that moved the line the wrong way.
    const afterBrightness = await readRedLine(
      page,
      adjustedBox,
      'levels-brightness',
      testInfo,
      (observed) => observed.red < original.red,
      'Brightness -20 must darken the line: no reading through the same clip rect ever came back darker'
    );
    expect(afterBrightness.red, 'brightness -20 makes the line darker, not lighter').toBeLessThan(original.red);
    expect(afterBrightness.red, 'brightness -20 is measured to produce this red').toBe(
      MEASURED_BRIGHTNESS_MINUS_20_RED
    );
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

    // Open Colors flyout and select Levels
    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });

    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(contrast).toBeVisible();

    // See the brightness test: one clip rect for both readings, measured after the
    // panel opened, with the pre-change reading re-taken through it.
    const adjustedBox = await remeasureCanvasBox(page);

    const original = await readRedLine(
      page,
      adjustedBox,
      'levels-original-contrast',
      testInfo,
      () => true,
      'Red line not found on the original stroke through the post-open geometry'
    );

    // 0 is the default, so this is a real change rather than a re-set of the value
    // the panel arrived with — which is what the old body did not establish.
    await contrast.fill('50');
    await expect(contrast).toHaveValue('50');

    // Contrast +50 is `contrast(325.4%)` — `expAdjustment(50, 2.2)` — which pushes the
    // line's red up and clamps it at 255 while the already-zero green and blue stay
    // at zero. The direction is the assertion; "different" was satisfied by sampling
    // two different rectangles.
    const afterContrast = await readRedLine(
      page,
      adjustedBox,
      'levels-contrast',
      testInfo,
      (observed) => observed.red > original.red,
      'Contrast +50 must brighten the line: no reading through the same clip rect ever came back brighter'
    );
    expect(afterContrast.red, 'contrast +50 makes the line more contrasty, so its red rises').toBeGreaterThan(
      original.red
    );
    expect(afterContrast.red, 'contrast 50 is measured to produce this red').toBe(MEASURED_CONTRAST_50_RED);
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
