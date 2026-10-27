import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  hasRedPixels,
  takeLineScreenshot,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
/*
 * Every redraw wait in this file polls the DOCUMENT's own rect inside the canvas box, derived
 * from the contain fit, rather than `CANVAS_REDRAW_CLIP`.
 *
 * `CANVAS_REDRAW_CLIP` is a fixed 300x100 box-relative rect, so whether it stays inside the
 * document is a property of the current layout rather than of the helper: at the suite's
 * 974x583 box it starts at box x 100 while the document's own left edge is at
 * `offsetX = 98.33`, and `offsetX` reaches 100 at a box height of 580.5. A viewport three
 * pixels shorter therefore puts the LETTERBOX inside it. In the light theme that is
 * `#ffffff` and nothing false-passes; under DARK it is `#121212`, which is inside
 * `hasDarkPixels` (all three channels under 60) with no stroke on the canvas at all — so a
 * wait for the stroke would return on a frame containing nothing, and a wait for the stroke
 * to LOSE its dark core could never settle and would time out instead.
 *
 * The fitted document rect is a subset of the box by construction, so a clip built from the
 * fit cannot contain the letterbox. That is the spec-side statement; the containment itself
 * is pinned in `__tests__/document-sampling.unit.test.ts`.
 */
import { documentClipInBox } from './helpers/document-sampling';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, expectToolSelected } from './helpers/toolbar-helpers';

async function waitForRedStroke(page: Page, box: BoundingBox): Promise<void> {
  await waitForCanvasPixels(page, documentClipInBox(box), hasRedPixels, { description: 'red pixels' });
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
  // Draw is available through overflow at this viewport, not as a primary tile. The helper
  // opens the overflow entry and checks the selected group state; avoid hard-coding a group
  // ordinal because the toolbar mapping and fit can change independently.
  await expectToolSelected(page, 'draw', false);

  await clickToolButton(page, 'draw');
  // The draw tool only strokes with the active foreground color once it is the active tool.
  // Asserted through the shared selected-group state because Draw is in the overflow menu at
  // this viewport rather than a visible primary tile.
  await expectToolSelected(page, 'draw');

  // Measured AFTER the tool switches, not before, and `drawLine` takes box-relative
  // offsets, so the box has to be the one the finished layout produced. It is NOT read
  // after the switch because a tool change moves the canvas: it cannot. The options bar
  // mounts in the toolbar row, which `TOOLBAR_BASE_CLASS` fixes at 50px, and the canvas is
  // in the main area, a different row in `App.tsx`. Read after the switch, this box is
  // right whether or not that holds, and a layout that made a tool resize the workspace
  // would not silently aim the stroke somewhere else.
  // The two clicks above are what makes this ordering load-bearing.
  const box = await canvas.boundingBox();
  expect(box, 'Canvas should have visible coordinates').not.toBeNull();

  // SET COLOR via native setter (triggers React onChange)
  // This bypasses React's "value unchanged" check and reaches delegated listeners
  // verifySwatch also asserts the store kept the color, which the draw tool reads.
  await setForegroundColor(page, '#ff0000', true);

  const start = documentToCanvasOffset(box!, 150, 150);
  const end = documentToCanvasOffset(box!, 350, 150);
  const lineClip = {
    x: box!.x + Math.min(start.x, end.x) - 20,
    y: box!.y + Math.min(start.y, end.y) - 20,
    width: Math.abs(end.x - start.x) + 40,
    height: Math.abs(end.y - start.y) + 40,
  };

  await drawLine(page, box!, start.x, start.y, end.x, end.y);
  await waitForRedStroke(page, box!);

  const screenshot = await takeLineScreenshot(page, box!, 'red-line', testInfo, lineClip);
  await expect(hasRedPixels(screenshot)).resolves.toBe(true);
});
