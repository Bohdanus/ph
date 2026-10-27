import { expect, test } from './fixtures/extended-test';
import {
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  takeLineScreenshot,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

// screenshot of canvas area contains drawn black line
test('screenshot of canvas area contains drawn black line', async ({ page }, testInfo) => {
  await page.goto('/');

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();

  const start = documentToCanvasOffset(box!, 150, 150);
  const end = documentToCanvasOffset(box!, 350, 150);
  const lineClip = {
    x: box!.x + Math.min(start.x, end.x) - 20,
    y: box!.y + Math.min(start.y, end.y) - 20,
    width: Math.abs(end.x - start.x) + 40,
    height: Math.abs(end.y - start.y) + 40,
  };

  await clickToolButton(page, 'draw');
  await drawLine(page, box!, start.x, start.y, end.x, end.y);
  await waitForCanvasRedraw(page, box!, { clip: lineClip });

  const screenshot = await takeLineScreenshot(page, box!, 'drawn-line', testInfo, lineClip);
  await expect(hasDarkPixels(screenshot)).resolves.toBe(true);
});
