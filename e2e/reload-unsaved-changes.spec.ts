import { expect, test } from './fixtures/extended-test';
import {
  drawLine,
  getWorkspaceCanvas,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

test('refreshing after drawing warns about unsaved changes', async ({ page }) => {
  await page.goto('/');

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Workspace canvas has no visible coordinates');

  await clickToolButton(page, 'draw');
  await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForCanvasRedraw(page, box);

  const dialogPromise = page.waitForEvent('dialog', { timeout: 5_000 });
  const reloadPromise = page.reload();
  const dialog = await dialogPromise;

  expect(dialog.type(), 'refreshing a modified document must open a beforeunload warning').toBe('beforeunload');
  await dialog.accept();
  await reloadPromise;
});
