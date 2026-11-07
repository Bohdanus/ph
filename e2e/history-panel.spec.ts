import { expect, type Locator, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  hasRedPixels,
  LINE_END_X,
  LINE_START_X,
  LINE_START_Y,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton, navigateAndSelectInFlyout, openToolFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { committedAntsOutline, waitForCommittedAnts, waitForNoCommittedAnts } from './helpers/selection-ants';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
const hasNoDarkPixels: CanvasPixelPredicate = async (screenshot) => !(await hasDarkPixels(screenshot));

/** The standard test line, black, on the row offset from the box origin. */
const ROW_OFFSET = 200;

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so strokes cannot be placed');
  return box;
}

/** `HistoryTab` mints one `<li>` per entry, newest first, each titled with the rewind action. */
const historyRows = (page: Page): Locator => page.getByTitle('Click to go back to this state');

/**
 * The rows for `draw` commits only. `getHistoryItemTitle` names a tool entry after its
 * tool, so a stroke made with the draw tool is the one row that reads exactly "draw", and
 * filtering on that excludes the document's own opening entry whatever it is called.
 */
const drawRows = (page: Page): Locator => historyRows(page).filter({ hasText: /^draw/ });

const disableButton = (row: Locator): Locator => row.getByTitle('Disable history item');
const enableButton = (row: Locator): Locator => row.getByTitle('Enable history item');

/** Rows for selection entries. Currently all labeled "selection" (lowercase, CSS capitalize only affects visual) per HANDOFF item 32. */
const selectionRows = (page: Page): Locator => historyRows(page).filter({ hasText: /selection/ });

test.describe('History panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('the panel lists one row per committed edit, newest first', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    await waitForCanvasPixels(page, canvasRedrawClip(box), hasDarkPixels, { description: 'the first stroke' });
    await expect(drawRows(page), 'one row after one stroke').toHaveCount(1);

    await drawLine(page, box, LINE_START_X, LINE_START_Y + ROW_OFFSET, LINE_END_X, LINE_START_Y + ROW_OFFSET);
    await expect(drawRows(page), 'one row per stroke, not per panel').toHaveCount(2);

    // Newest first, and only the tip is marked as the current state.
    await expect(drawRows(page).first()).toContainText('draw');
    await expect(drawRows(page).first().getByTitle('Current state')).toBeVisible();
    await expect(drawRows(page).last().getByTitle('Current state')).toHaveCount(0);
  });

  test('clicking an earlier row rewinds the canvas without touching the undo button', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const base = canvasRedrawClip(box);
    const firstClip = base;
    const secondClip = { ...base, y: base.y + ROW_OFFSET };

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the first stroke' });
    await drawLine(page, box, LINE_START_X, LINE_START_Y + ROW_OFFSET, LINE_END_X, LINE_START_Y + ROW_OFFSET);
    await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the second stroke' });

    // The rows are newest first, so the LAST one is the state that held after the first
    // stroke and nothing else.
    await drawRows(page).last().click();
    await waitForCanvasPixels(page, secondClip, hasNoDarkPixels, { description: 'the rewound second stroke' });
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: firstClip })), {
        message: 'the first stroke is the state being rewound to, so it must survive',
      })
      .toBe(true);

    // The panel is a second front end onto the same timeline, so the toolbar buttons have
    // to agree with it: a rewind past the tip is what makes redo available.
    await expect(page.getByTestId('redo-button')).toBeEnabled();
    await expect(drawRows(page).last().getByTitle('Current state'), 'the marker follows the click').toBeVisible();

    await drawRows(page).first().click();
    await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the replayed second stroke' });
    await expect(page.getByTestId('redo-button')).toBeDisabled();
  });

  test('the eye disables an entry, and the current state is recomputed without it', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    const box = await canvasBox(page);
    const base = canvasRedrawClip(box);
    const firstClip = base;
    const secondClip = { ...base, y: base.y + ROW_OFFSET };

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the first stroke' });
    await drawLine(page, box, LINE_START_X, LINE_START_Y + ROW_OFFSET, LINE_END_X, LINE_START_Y + ROW_OFFSET);
    await waitForCanvasPixels(page, secondClip, hasDarkPixels, { description: 'the second stroke' });

    // `toggleDisabled` replays to the SAME cursor with the entry flagged out, so the
    // document under the cursor changes without the cursor moving. That is the whole
    // point of the control and nothing else in the app behaves this way.
    const oldest = drawRows(page).last();
    await disableButton(oldest).click();
    await expect(enableButton(oldest), 'the eye now offers to put it back').toBeVisible();
    await waitForCanvasPixels(page, firstClip, hasNoDarkPixels, { description: 'the disabled entry' });
    await expect
      .poll(async () => hasDarkPixels(await page.screenshot({ clip: secondClip })), {
        message: 'only the disabled entry is recomputed away, never its neighbours',
      })
      .toBe(true);
    await expect(drawRows(page).first().getByTitle('Current state'), 'the cursor has not moved').toBeVisible();

    await enableButton(oldest).click();
    await expect(disableButton(oldest)).toBeVisible();
    await waitForCanvasPixels(page, firstClip, hasDarkPixels, { description: 'the re-enabled entry' });
  });

  test('a new document starts a fresh timeline, not the previous one', async ({ page }) => {
    const box = await canvasBox(page);
    const strokeClip = canvasRedrawClip(box);

    // The panel only renders once the store has a document, and a document's own opening
    // entry is already on its timeline — so a fresh document has exactly one opening row,
    // and `HistoryTab`'s "No history yet." branch is unreachable for a real document. Check
    // visibility too: a count alone would pass if the row were hidden in a rolled-up panel.
    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toBeVisible();

    await clickToolButton(page, 'draw');
    await setForegroundColor(page, '#000000', true);
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
    await waitForCanvasPixels(page, strokeClip, hasDarkPixels, { description: "the first document's stroke" });
    await expect(drawRows(page), 'the first document has an entry for the second to lose').toHaveCount(1);
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    // The stroke above is work, so File > New is gated behind the app's own discard
    // prompt. It has to be ACCEPTED, not merely tolerated: the New Image dialog is only
    // reached once the guard resolves, and the fresh timeline this test is about exists
    // only if that dialog is submitted. The `page.on('dialog')` that used to stand here
    // was a no-op for two reasons at once — it only ever matched the native `confirm()`
    // this replaced, and Playwright auto-dismisses a dialog nobody is listening for, so a
    // menu item that had stopped asking could not be told apart from a declined guard.
    await acceptDiscardPrompt(page);
    await page.getByTestId('new-image-dialog-submit-button').click();

    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expect(drawRows(page), "the new document must not inherit the first one's entries").toHaveCount(0);
    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toBeVisible();
    await expect(page.getByTestId('undo-button'), 'a new document starts with nothing to undo').toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeDisabled();
    await waitForCanvasPixels(page, strokeClip, hasNoDarkPixels, { description: "the first document's stroke" });
  });

  test.describe('HANDOFF item 32: selection rows in History panel', () => {
    test.beforeEach(() => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    });

    test('rectangular selection creates a SELECTION_ACTION row', async ({ page }) => {
      const box = await canvasBox(page);
      await openToolFlyout(page, 'rectangular-selection');
      await navigateAndSelectInFlyout(page, 'rectangular-selection', 'Rectangular Marquee Tool');
      // Drag a rectangle selection
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
      // Wait for selection to be committed
      await waitForCommittedAnts(page, 'the selection to be created');
      // Verify selection row appears
      await expect(selectionRows(page)).toHaveCount(1);
      await expect(selectionRows(page).first()).toContainText('selection');
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();
    });

    test('magic wand selection creates a SELECTION_ACTION row', async ({ page }) => {
      const box = await canvasBox(page);
      // First draw something to select
      await clickToolButton(page, 'draw');
      await setForegroundColor(page, '#cc0000', true);
      await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_START_Y);
      await waitForCanvasPixels(page, canvasRedrawClip(box), hasRedPixels, { description: 'the stroke to select' });

      await openToolFlyout(page, 'magic-wand');
      await navigateAndSelectInFlyout(page, 'magic-wand', 'Magic Wand Tool');
      await page.mouse.click(box.x + (LINE_START_X + LINE_END_X) / 2, box.y + LINE_START_Y);
      // Wait for selection to be committed
      await waitForCommittedAnts(page, 'the magic wand selection to be created');
      // Verify selection row appears
      await expect(selectionRows(page)).toHaveCount(1);
      await expect(selectionRows(page).first()).toContainText('selection');
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();
    });

    test('tool switch deselect creates a SELECTION_ACTION row', async ({ page }) => {
      const box = await canvasBox(page);
      // Create a selection
      await openToolFlyout(page, 'rectangular-selection');
      await navigateAndSelectInFlyout(page, 'rectangular-selection', 'Rectangular Marquee Tool');
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
      await waitForCommittedAnts(page, 'the selection to be created');
      await expect(selectionRows(page)).toHaveCount(1);
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();

      // Switch tool (should deselect and create SELECTION_ACTION row)
      await clickToolButton(page, 'draw');
      // Wait for selection clear to be committed
      await waitForNoCommittedAnts(page, 'the selection to be cleared');
      // Verify new selection row appears (the deselect)
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).first()).toContainText('selection');
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();
    });

    test('clear/deselect control creates a SELECTION_ACTION row', async ({ page }) => {
      const box = await canvasBox(page);
      await openToolFlyout(page, 'rectangular-selection');
      await navigateAndSelectInFlyout(page, 'rectangular-selection', 'Rectangular Marquee Tool');
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
      await waitForCommittedAnts(page, 'the selection to be created');
      await expect(selectionRows(page)).toHaveCount(1);
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();

      // Click the Deselect button in the options bar
      await page.getByRole('button', { name: 'Deselect' }).click();
      await waitForNoCommittedAnts(page, 'the selection to be cleared');
      // Verify new selection row appears (the clear)
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).first()).toContainText('selection');
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();
    });
  });

  test.describe('HANDOFF item 31: selection baseline restore on undo/redo', () => {
    test.beforeEach(() => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    });

    test('selection restore on undo after selection clear', async ({ page }) => {
      const box = await canvasBox(page);
      // Create a rectangular selection
      await openToolFlyout(page, 'rectangular-selection');
      await navigateAndSelectInFlyout(page, 'rectangular-selection', 'Rectangular Marquee Tool');
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
      await waitForCommittedAnts(page, 'the selection to be created');
      await expect(selectionRows(page)).toHaveCount(1);
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();
      const selectionOutline = await committedAntsOutline(page);
      expect(selectionOutline).not.toBeNull();

      // Click the Deselect button in the options bar (creates SELECTION_ACTION clear entry)
      await page.getByRole('button', { name: 'Deselect' }).click();
      await waitForNoCommittedAnts(page, 'the selection to be cleared');
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();

      // Undo should restore the selection
      await expect(page.getByTestId('undo-button')).toBeEnabled();
      await page.getByTestId('undo-button').click();
      await waitForCommittedAnts(page, 'the selection to be restored');
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).last().getByTitle('Current state')).toBeVisible();
      const restoredOutline = await committedAntsOutline(page);
      expect(restoredOutline).not.toBeNull();
      expect(restoredOutline).toEqual(selectionOutline);
    });

    test('selection move creates separate SELECTION_ACTION row and restores on undo', async ({ page }) => {
      const box = await canvasBox(page);
      // Create a rectangular selection
      await openToolFlyout(page, 'rectangular-selection');
      await navigateAndSelectInFlyout(page, 'rectangular-selection', 'Rectangular Marquee Tool');
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200);
      await page.mouse.up();
      await waitForCommittedAnts(page, 'the selection to be created');
      const initialOutline = await committedAntsOutline(page);
      expect(initialOutline).not.toBeNull();

      // Move the selection (drag from inside)
      await page.mouse.move(box.x + 150, box.y + 150);
      await page.mouse.down();
      await page.mouse.move(box.x + 250, box.y + 250);
      await page.mouse.up();
      await waitForCommittedAnts(page, 'the selection to be moved');
      const movedOutline = await committedAntsOutline(page);
      expect(movedOutline).not.toBeNull();
      expect(movedOutline).not.toEqual(initialOutline);
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).first().getByTitle('Current state')).toBeVisible();

      // Undo should restore the selection to original position
      await expect(page.getByTestId('undo-button')).toBeEnabled();
      await page.getByTestId('undo-button').click();
      await waitForCommittedAnts(page, 'the selection to be restored');
      await expect(selectionRows(page)).toHaveCount(2);
      await expect(selectionRows(page).last().getByTitle('Current state')).toBeVisible();
      const restoredOutline = await committedAntsOutline(page);
      expect(restoredOutline).not.toBeNull();
      expect(restoredOutline).toEqual(initialOutline);
    });
  });
});
