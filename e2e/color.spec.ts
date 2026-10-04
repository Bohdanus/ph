import { expect, type Page, test } from './fixtures/extended-test';
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
  // Resolved, not addressed: `draw` is group 13 of the 16 in `toolbar-mapping.ts`, and the
  // rail fits SEVEN of them into the slot at this viewport, so `draw` sits in the three-dots
  // tile and there is no `tool-button-draw` element at all. The seven is the number to keep
  // current: the fold follows the fit, not the ordinal, and `draw` stopped being the last
  // group, so a count derived any other way would be describing a rail this viewport does not
  // produce. The three-dots tile carries no `aria-pressed` at all — it opens a menu rather
  // than toggling a tool — so the helper reads its lit class off the same `group.some(...)`
  // predicate the tiles read `aria-pressed` from, and this says the same thing whether the
  // tool has a tile or not.
  await expectToolSelected(page, 'draw', false);

  await clickToolButton(page, 'draw');
  // The draw tool only strokes with the active foreground color once it is the active tool.
  // Asserted for the same reason as the assertion above it: `draw` is group 13 and the rail
  // fits seven at this viewport, so it is in the three-dots tile and there is no
  // `tool-button-draw` element.
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

  await drawLine(page, box!, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
  await waitForRedStroke(page, box!);

  const screenshot = await takeLineScreenshot(page, box!, 'red-line', testInfo);
  await expect(hasRedPixels(screenshot)).resolves.toBe(true);
});
