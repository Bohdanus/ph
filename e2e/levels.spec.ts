import { expect, type Page, test, type TestInfo } from '@playwright/test';
import {
  type BoundingBox,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  type DominantColor,
  drawLine,
  dominantRed,
  getWorkspaceCanvas,
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

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
}

/**
 * Reads the dominant red of the line clip, retrying until `isSettled` accepts the
 * reading, and returns that reading.
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
    await setForegroundColor(page, '#cc0000', true);
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
    const adjustedBox = await canvas.boundingBox();
    expect(adjustedBox, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();

    const original = await readRedLine(
      page,
      adjustedBox!,
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
      adjustedBox!,
      'levels-brightness',
      testInfo,
      (observed) => observed.red < original.red,
      'Brightness -20 must darken the line: no reading through the same clip rect ever came back darker'
    );
    expect(afterBrightness.red, 'brightness -20 makes the line darker, not lighter').toBeLessThan(original.red);
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
    await setForegroundColor(page, '#cc0000', true);
    await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForRedStroke(page, box!);

    // Open Colors flyout and select Levels
    await openToolFlyout(page, 'color');
    await selectFromFlyout(page, { toolName: 'levels', label: 'Levels' });

    const contrast = page.getByRole('slider', { name: /Contrast/ });
    await expect(contrast).toBeVisible();

    // See the brightness test: one clip rect for both readings, measured after the
    // panel opened, with the pre-change reading re-taken through it.
    const adjustedBox = await canvas.boundingBox();
    expect(adjustedBox, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();

    const original = await readRedLine(
      page,
      adjustedBox!,
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
      adjustedBox!,
      'levels-contrast',
      testInfo,
      (observed) => observed.red > original.red,
      'Contrast +50 must brighten the line: no reading through the same clip rect ever came back brighter'
    );
    expect(afterContrast.red, 'contrast +50 makes the line more contrasty, so its red rises').toBeGreaterThan(
      original.red
    );
  });
});
