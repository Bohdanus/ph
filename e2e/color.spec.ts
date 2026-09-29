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
import { clickToolButton, resolveToolTile } from './helpers/toolbar-helpers';

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'red pixels' });
}

// screenshot of canvas area contains line of selected red color
test('screenshot of canvas area contains line of selected red color', async ({ page }, testInfo) => {
  await page.goto('/');

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();

  // `draw` is the app's default tool, so `tool-button-draw` already carries
  // `aria-pressed="true"` before anything is clicked, and asserting that after the
  // click was satisfied by the state the test started in - it could not fail.
  // `clickToolButton` asserts nothing about activation either, so this is the test's
  // only tool-state check, and it has to be the one that can go red. Select a
  // DIFFERENT tool first: that is the only state in which the attribute can still
  // change, which turns the second assertion into a check that the click did
  // something rather than a check that the app booted.
  await clickToolButton(page, 'reposition');
  // Resolved, not addressed: `draw` is the seventeenth group, so at this viewport it has been
  // folded into the three-dots tile and there is no `tool-button-draw` element at all. The
  // three-dots tile computes `aria-pressed` with the same `group.some(...)` the real tiles do,
  // so this says the same thing whether the tool has a tile or not.
  await expect(await resolveToolTile(page, 'draw'), 'draw is not active while another tool is').toHaveAttribute(
    'aria-pressed',
    'false'
  );

  await clickToolButton(page, 'draw');
  // The draw tool only strokes with the active foreground color once it is the active tool.
  await expect(
    page.getByTestId('tool-button-draw'),
    'clicking the Draw tile must make draw the active tool'
  ).toHaveAttribute('aria-pressed', 'true');

  // Measured AFTER the tool switches, not before: a tool change swaps the options
  // bar, which can move the canvas, and `drawLine` takes box-relative offsets. A box
  // measured before would stroke - and then sample - somewhere the geometry no longer
  // describes. The two clicks above are what makes this ordering load-bearing.
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();

  // SET COLOR via native setter (triggers React onChange)
  // This bypasses React's "value unchanged" check and reaches delegated listeners
  // verifySwatch also asserts the store kept the color, which the draw tool reads.
  await setForegroundColor(page, '#ff0000', true);

  await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForRedStroke(page, box!);

  const screenshot = await takeLineScreenshot(page, box!, 'red-line', testInfo);
  await expect(hasRedPixels(screenshot)).resolves.toBe(true);
});
