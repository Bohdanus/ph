import { expect, test } from '@playwright/test';
import {
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  takeLineScreenshot,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

// скриншот области холста содержит нарисованную черную линию
test('screenshot of canvas area contains drawn black line', async ({ page }, testInfo) => {
  await page.goto('/');

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();

  await clickToolButton(page, 'draw');
  await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForCanvasRedraw(page, box!);

  const screenshot = await takeLineScreenshot(page, box!, 'drawn-line', testInfo);
  await expect(hasDarkPixels(screenshot)).resolves.toBe(true);
});
