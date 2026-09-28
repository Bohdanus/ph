import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

const hasNoDarkPixels: CanvasPixelPredicate = async (screenshot) => !(await hasDarkPixels(screenshot));

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so strokes cannot be placed');
  return box;
}

const layerRows = (page: Page): Locator => page.getByTitle('Drag to reorder');
const layerRow = (page: Page, name: string): Locator => layerRows(page).filter({ hasText: name });

/**
 * The eye, by the label `LayersTab` mints from the layer's own `visible` flag, so the
 * locator names the state it is about to change and the two are the same fact read twice.
 */
const hideButton = (row: Locator): Locator => row.getByRole('button', { name: 'Hide layer' });
const showButton = (row: Locator): Locator => row.getByRole('button', { name: 'Show layer' });

/** The `<span>` holding the layer name, which is the only element `LayersTab` renames. */
const layerName = (row: Locator): Locator => row.locator('div.flex-1 > span');

/**
 * Clicks the row itself rather than anything inside it. `setActiveLayer` hangs off the
 * row's `onClick`, and the three things that sit on the row all intercept it: the eye and
 * the trash stop propagation explicitly, and the name span stops it unconditionally so
 * that a click inside an open rename does not also change the selection.
 *
 * The point clicked is the drag handle — `px-2` padding (8px), then the 24px eye, then an
 * 8px gap puts it at 40..56 — which is a real element inside the row and has no handler of
 * its own, so the event reaches the row. Its left-hand geometry is fixed by the row's own
 * classes, so it does not move when the panel is resized.
 */
async function activateRow(row: Locator): Promise<void> {
  await row.click({ position: { x: 48, y: 16 } });
}

test.describe('Layers panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('the eye takes a layer off the canvas and puts it back', async ({ page }) => {
    test.setTimeout(60_000);
    const box = await canvasBox(page);
    const clip = canvasRedrawClip(box);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the stroke' });

    // One draw commits one layer on top of the bedrock one, so the stroke has a row of
    // its own and hiding it leaves the bedrock layer, which is white, showing through.
    const drawn = layerRow(page, 'draw 2');
    await expect(drawn).toBeVisible();
    await expect(hideButton(drawn), 'the label states the action, not the state').toBeVisible();

    await hideButton(drawn).click();
    await expect(showButton(drawn), 'the eye now offers to show it').toBeVisible();
    await waitForCanvasPixels(page, clip, hasNoDarkPixels, { description: 'the hidden layer' });

    await showButton(drawn).click();
    await expect(hideButton(drawn)).toBeVisible();
    await waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'the shown layer' });
  });

  test('hiding a layer is a history entry of its own', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the stroke' });

    // Visibility is a document edit, so it belongs on the timeline. A layer attribute
    // that only lived in component state would pass the pixel test above and be lost on
    // the next undo, which is what this pins.
    const drawn = layerRow(page, 'draw 2');
    await hideButton(drawn).click();
    await expect(showButton(drawn)).toBeVisible();
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    await page.getByTestId('undo-button').click();
    await expect(hideButton(drawn), 'undo put the layer back on the canvas').toBeVisible();
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the restored stroke' });
  });

  test('clicking a row makes that layer the one the next tool gesture edits', async ({ page }) => {
    test.setTimeout(60_000);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    const drawBox = await canvasBox(page);
    // Two strokes 200px apart, on two layers. A single stroke on one layer would make the
    // first half of this test unfalsifiable: erasing the layer that holds nothing changes no
    // pixel, so "the pixels did not change" is also what "nothing happened at all" looks
    // like. A second layer, and a history row to prove the gesture was processed, are what
    // make the negative half mean something.
    await drawLine(page, drawBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    const firstClip = canvasRedrawClip(drawBox);
    await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the first stroke' });
    await drawLine(page, drawBox, LINE_START_X, LINE_START_Y + 200, LINE_END_X, LINE_START_Y + 200);
    const secondClip = { ...firstClip, y: firstClip.y + 200 };
    await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the second stroke' });
    // Every history row, not just the draw ones: an eraser commit is titled after the
    // eraser, and the count is what says the gesture was processed at all.
    const historyRows = page.getByTitle('Click to go back to this state');
    await expect(historyRows, 'the document entry plus one per stroke').toHaveCount(3);

    // The eraser edits the ACTIVE layer in place, so it is the tool that makes
    // `setActiveLayer` observable. The draw tool could not: it commits a new layer every
    // time and never touches the one that was active. It is a secondary member of the brush
    // group, so it comes out of the flyout.
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'eraser', label: 'Eraser Tool' });
    // The eraser bar is a different height from the draw bar, so the canvas box moves.
    // Measuring it once and reusing it is the defect `e2e/OPEN_PROBLEMS.md` records.
    const eraserBox = await canvasBox(page);
    const eraserFirst = canvasRedrawClip(eraserBox);
    const eraserSecond = { ...eraserFirst, y: eraserFirst.y + 200 };

    await activateRow(layerRow(page, 'draw 2'));
    await drawLine(page, eraserBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y, { steps: 20 });
    // The history row is the observable that the erase was PROCESSED. Without it the pixel
    // check below passes on its first poll, before the app has done anything, and the test
    // is green whether or not `activateRow` worked.
    await expect(historyRows, 'the erase committed an entry on the active layer').toHaveCount(4);
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the second stroke is on the other layer, so erasing the active one must leave it alone',
      })
      .toBe(true);

    await activateRow(layerRow(page, 'draw 3'));
    await drawLine(page, eraserBox, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y, { steps: 20 });
    await expect(historyRows, 'and the second erase committed one too').toHaveCount(5);
    await waitForCanvasPixels(page, eraserFirst, hasNoDarkPixels, {
      description: 'the erased stroke, on the layer that is active now',
    });
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: eraserSecond })), {
        message: 'the other layer is untouched by both erases',
      })
      .toBe(true);
  });

  test('a layer name is edited in place, and Escape reverts the edit', async ({ page }) => {
    // The row is addressed by position rather than by its name: the point of the test is
    // that the name changes, so a locator built from the old one would stop resolving
    // halfway through it. There is exactly one layer in this test.
    const row = layerRows(page).first();
    const name = layerName(row);

    await expect(name).toHaveText('Blank 1');
    // `LayersTab` mints the span without `contenteditable` until a mousedown flips it, and
    // the flip does not focus, so the first click enters edit mode and the second is the
    // one the browser focuses.
    await name.click();
    await expect(name, 'the span became editable').toHaveAttribute('contenteditable', 'true');
    await name.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Backdrop');
    await page.keyboard.press('Enter');

    await expect(name, 'Enter blurs, and the blur is what commits the name').toHaveText('Backdrop');
    await expect(name, 'the row left edit mode').not.toHaveAttribute('contenteditable', 'true');
    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(1);

    // Escape puts the old text back and leaves edit mode without committing, which is the
    // half of the contract a rename test that only presses Enter never reaches.
    await name.click();
    await name.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Discarded');
    await page.keyboard.press('Escape');
    await expect(name).toHaveText('Backdrop');
    await expect(name).not.toHaveAttribute('contenteditable', 'true');
  });

  test('renaming a layer is one history entry', async ({ page }) => {
    const undo = page.getByTestId('undo-button');
    await expect(undo, 'a freshly opened document has nothing to undo').toBeDisabled();

    const name = layerName(layerRow(page, 'Blank 1'));
    await name.click();
    await name.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Backdrop');
    await page.keyboard.press('Enter');

    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(1);
    await expect(undo, 'the rename is a document edit').toBeEnabled();

    await undo.click();
    await expect(layerRows(page).filter({ hasText: 'Blank 1' })).toHaveCount(1);
    await expect(layerRows(page).filter({ hasText: 'Backdrop' })).toHaveCount(0);
  });

  test('removing the last layer shows the panel empty state', async ({ page }) => {
    await expect(layerRow(page, 'Blank 1')).toBeVisible();
    await layerRow(page, 'Blank 1').getByRole('button', { name: 'Remove layer' }).click();
    await expect(layerRows(page)).toHaveCount(0);
    await expect(page.getByText('No layers yet.')).toBeVisible();
  });
});
