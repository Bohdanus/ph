import { expect, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  drawLine,
  getWorkspaceCanvas,
  hasRedPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
}

// скриншот области холста содержит линию выбранного красного цвета
test('screenshot of canvas area contains line of selected red color', async ({ page }, testInfo) => {
  await page.goto('/');

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();

  await clickToolButton(page, 'draw');
  // The draw tool only strokes with the active foreground color once it is the active tool.
  await expect(page.getByTestId('tool-button-draw')).toHaveAttribute('aria-pressed', 'true');

  // SET COLOR via native setter (triggers React onChange)
  // This bypasses React's "value unchanged" check and reaches delegated listeners
  // verifySwatch also asserts the store kept the color, which the draw tool reads.
  await setForegroundColor(page, '#ff0000', true);

  await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForRedStroke(page, box!);

  const screenshot = await takeLineScreenshot(page, box!, 'red-line', testInfo);
  await expect(hasRedPixels(screenshot)).resolves.toBe(true);
});
