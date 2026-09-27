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
 * Reads the dominant red of the line clip, retrying until the stroke is actually there.
 * Adjusting brightness/contrast repaints the canvas, so a single screenshot can land on
 * the pre-repaint frame; `failureMessage` is carried into the poll error so the only
 * signal a failing run gives is the one that names the assertion that broke.
 */
async function readRedLine(
  page: Page,
  box: BoundingBox,
  name: string,
  testInfo: TestInfo,
  failureMessage: string
): Promise<DominantColor> {
  let observed: DominantColor | null = null;
  await expect
    .poll(
      async () => {
        observed = await dominantRed(await takeLineScreenshot(page, box, name, testInfo));
        return observed;
      },
      {
        message: failureMessage,
        timeout: CANVAS_REDRAW_TIMEOUT_MS,
        intervals: [CANVAS_REDRAW_POLL_INTERVAL_MS],
      }
    )
    .toBeTruthy();
  return observed!;
}

// The Levels sliders are labelled by a <label for> plus a live value suffix, so their
// accessible names read "Brightness 0%" and "Contrast 50%". Matching the label part
// alone survives the value suffix changing and needs no knowledge of the slider ids.
test.describe('Levels adjustment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // меняет красную линию через brightness
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
    const adjustedBox = await canvas.boundingBox();
    expect(adjustedBox, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();

    const afterBrightness = await readRedLine(
      page,
      adjustedBox!,
      'levels-brightness',
      testInfo,
      'Red line disappeared after brightness change'
    );
    expect(afterBrightness.red).not.toBe(original!.red);
  });

  // меняет красную линию через contrast
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
    const adjustedBox = await canvas.boundingBox();
    expect(adjustedBox, 'Canvas should have visible coordinates after opening Levels').not.toBeNull();

    const afterContrast = await readRedLine(
      page,
      adjustedBox!,
      'levels-contrast',
      testInfo,
      'Red line disappeared after contrast change'
    );
    expect(afterContrast.red).not.toBe(original!.red);
  });
});
