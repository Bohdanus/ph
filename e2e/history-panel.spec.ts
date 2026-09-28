import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  drawLine,
  getWorkspaceCanvas,
  hasDarkPixels,
  LINE_END_X,
  LINE_START_X,
  LINE_START_Y,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, canvasRedrawClip, waitForCanvasPixels } from './helpers/canvas-redraw';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

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
    test.setTimeout(60_000);
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
    test.setTimeout(60_000);
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
    // The panel only renders once the store has a document, and a document's own opening
    // entry is already on its timeline — so the count here is 1, never 0, and
    // `HistoryTab`'s "No history yet." branch is unreachable for a real document. What is
    // worth pinning is that a second document does not inherit the first one's entries,
    // which only a count of exactly 1 can say.
    await expect(historyRows(page)).not.toHaveCount(0);

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await page.getByTestId('new-image-dialog-submit-button').click();

    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);
    await expect(historyRows(page)).toHaveCount(1);
    await expect(page.getByTestId('undo-button'), 'a new document starts with nothing to undo').toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeDisabled();
  });
});
