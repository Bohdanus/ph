import { expect, test, type Page } from '@playwright/test';
import {
  bandCentreY,
  bandInkFlags,
  bandUnionClip,
  canvasBands,
  getRedoButton,
  getUndoButton,
  visibleCanvasBox,
  waitForBandInked,
  waitForBands,
  wholeCanvasBand,
  type CanvasBand,
} from './helpers/history-helpers';
import {
  drawLine,
  getDarkPixelBounds,
  getWorkspaceCanvas,
  hasDarkPixels,
  type BoundingBox,
  type ClipOptions,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

/**
 * Per-test budget. The config default is 30s, which covers a single canvas wait
 * (`CANVAS_REDRAW_TIMEOUT_MS` is 10s) and little else. These tests chain three
 * strokes and up to three navigations, and every step waits on the replayed canvas
 * rather than on a timer, so the floor is a handful of poll loops at their full
 * timeout. 60s is the same figure the other multi-step specs in this suite use
 * (`select-move.spec.ts`, `viewport-drawing.spec.ts`).
 */
const UNDO_REDO_TIMEOUT_MS = 60_000;

/**
 * Strokes go into horizontal bands of the canvas rather than at fixed points, and
 * the assertions are per band. A whole-canvas ink check cannot tell WHICH stroke a
 * replay left behind: after two undos out of three strokes "some ink is present" is
 * true for the correct result and for a history cursor that is off by one in either
 * direction. Per-band state distinguishes all three.
 */
const BAND_COUNT = 3;

/**
 * Horizontal extent of a stroke, as fractions of the canvas box width.
 *
 * The workspace canvas fills the main area and the document is letterboxed inside
 * it, so a point chosen as a fraction of the box is always inside the document:
 * the letterbox maps the box onto the document, and the app draws a stroke at the
 * box-relative coordinate the pointer reported (`usePointerPosition`). The second
 * span is offset from the first so a second stroke in the same band measurably
 * widens it, which is how the branch test tells the new stroke apart from the one
 * it replaced.
 */
const FIRST_SPAN = { start: 0.2, end: 0.6 };
const BRANCH_SPAN = { start: 0.45, end: 0.85 };

/**
 * Window size for these tests. The project default is 1280x720, and this app lays
 * the workspace canvas out TALLER than that - measured at 840px of canvas in a
 * 720px window - while `page.screenshot({ clip })` truncates a clip at the viewport
 * edge without saying so. Bands cut from the truncated part would read as
 * permanently clean, which is a silent pass rather than a failure. Asking for a
 * window the whole canvas fits in is what lets "the whole canvas" mean the whole
 * canvas in the assertions below; `visibleCanvasBox` is the belt to that pair of
 * braces, and is what makes the clips correct whatever the window turns out to be.
 */
const WORKSPACE_VIEWPORT = { width: 1280, height: 1000 };

test.describe('Undo and redo', () => {
  test.describe.configure({ timeout: UNDO_REDO_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WORKSPACE_VIEWPORT);
    await page.goto('/');
    // The blank document is created by an effect, and the canvas stack is only
    // displayed once it exists, so "visible" is also "a document is open".
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  /**
   * The canvas box reduced to what a clipped screenshot can read. Every clip below
   * comes from this, so no assertion is ever made about a strip of canvas the
   * browser did not capture.
   */
  const canvasBox = async (page: Page): Promise<BoundingBox> => {
    const box = await getWorkspaceCanvas(page).boundingBox();
    if (!box) throw new Error('Canvas not found');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('Viewport size is required to clip a canvas screenshot');
    return visibleCanvasBox(box, viewport);
  };

  /** Page clip of a whole-canvas capture, in the same space `page.screenshot` takes. */
  const wholeCanvasClip = (box: BoundingBox): Required<ClipOptions> => bandUnionClip([wholeCanvasBand(box)]);

  const capture = (page: Page, clip: Required<ClipOptions>): Promise<Buffer> => page.screenshot({ clip });

  const strokeInto = async (
    page: Page,
    box: BoundingBox,
    bands: readonly CanvasBand[],
    bandIndex: number,
    span: { start: number; end: number } = FIRST_SPAN
  ) => {
    await clickToolButton(page, 'draw');
    await drawLine(
      page,
      box,
      box.width * span.start,
      bandCentreY(box, bandIndex, bands.length),
      box.width * span.end,
      bandCentreY(box, bandIndex, bands.length),
      { steps: 12 }
    );
  };

  test('undo and redo are both unavailable on a fresh document, and only undo becomes available after the first stroke', async ({
    page,
  }) => {
    const box = await canvasBox(page);
    const bands = canvasBands(box, BAND_COUNT);

    // A fresh document is a single history entry, so there is nothing on either
    // side of the cursor: `canUndo` is `historyIndex > 0` and `canRedo` is
    // `historyIndex < history.length - 1`, both false at index 0 of 1.
    await expect(getUndoButton(page)).toBeDisabled();
    await expect(getRedoButton(page)).toBeDisabled();

    await strokeInto(page, box, bands, 0);
    await waitForBandInked(page, bands[0], { description: 'the first stroke to reach the canvas' });

    await expect(getUndoButton(page), 'one committed stroke should make undo available').toBeEnabled();
    await expect(getRedoButton(page), 'redo needs a second entry to move to, so it stays unavailable').toBeDisabled();
  });

  test('undo takes the stroke off the canvas and redo puts the same pixels back', async ({ page }) => {
    const box = await canvasBox(page);
    const bands = canvasBands(box, BAND_COUNT);
    const clip = wholeCanvasClip(box);

    await strokeInto(page, box, bands, 0);
    await waitForBandInked(page, bands[0], { description: 'the stroke to reach the canvas' });

    const drawn = await getDarkPixelBounds(await capture(page, clip));
    expect(drawn, 'the stroke was not on the canvas at all').toBeTruthy();

    await getUndoButton(page).click();
    // Wait for the replay rather than reading the canvas one shot after the click: a
    // screenshot taken before the repaint still shows the stroke, which is a loud
    // failure but a flaky one. The whole canvas as a one-band stack is the same
    // statement as "the canvas is clear of ink".
    await waitForBands(page, [wholeCanvasBand(box)], [false], { description: 'the canvas to carry no ink' });

    expect(await hasDarkPixels(await capture(page, clip)), 'undo left ink on the canvas').toBe(false);
    await expect(getRedoButton(page)).toBeEnabled();

    await getRedoButton(page).click();
    await waitForBands(page, [wholeCanvasBand(box)], [true], { description: 'the redone stroke to be back' });

    const redone = await getDarkPixelBounds(await capture(page, clip));
    expect(redone, 'redo left the canvas empty').toBeTruthy();
    // The whole bounds object, not just "there is ink": a replay that restored the
    // stroke at a different position, a different length, or a different size is a
    // different document, and `hasDarkPixels` alone would pass for all of them.
    expect(redone, 'redo did not restore the stroke pixel for pixel').toEqual(drawn);
  });

  test('two undos leave the first stroke on the canvas and the other two gone', async ({ page }) => {
    const box = await canvasBox(page);
    const bands = canvasBands(box, BAND_COUNT);

    await strokeInto(page, box, bands, 0);
    await strokeInto(page, box, bands, 1);
    await strokeInto(page, box, bands, 2);
    await waitForBands(page, bands, [true, true, true], { description: 'all three strokes to reach the canvas' });

    await getUndoButton(page).click();
    await getUndoButton(page).click();
    await waitForBands(page, bands, [true, false, false], {
      description: 'the third stroke gone and the second one gone after two undos',
    });

    // Read it back as pixels rather than trusting the wait: a per-band read is the
    // assertion, the wait is only what makes it deterministic. This is the check a
    // whole-canvas "is there ink" cannot make - an off-by-one cursor leaves ink too.
    expect(await bandInkFlags(await capture(page, bandUnionClip(bands)), bands)).toEqual([true, false, false]);
  });

  test('the keyboard shortcuts undo and redo to the same pixels as the buttons', async ({ page }) => {
    const box = await canvasBox(page);
    const bands = canvasBands(box, BAND_COUNT);
    const clip = wholeCanvasClip(box);

    await strokeInto(page, box, bands, 0);
    await waitForBandInked(page, bands[0], { description: 'the stroke to reach the canvas' });
    const drawn = await getDarkPixelBounds(await capture(page, clip));
    expect(drawn, 'the stroke was not on the canvas at all').toBeTruthy();

    // `ControlOrMeta`, not a hardcoded Meta or Control: the app matches the modifier
    // as `(event.metaKey || event.ctrlKey) !== shortcut.mod`, so either one works on
    // either OS, and spelling out the platform's own key would only pass on one.
    await page.keyboard.press('ControlOrMeta+z');
    await waitForBands(page, [wholeCanvasBand(box)], [false], { description: 'the canvas to carry no ink' });

    expect(await hasDarkPixels(await capture(page, clip)), 'the keyboard shortcut did not undo the stroke').toBe(false);
    await expect(getRedoButton(page), 'the keyboard shortcut did not move the history cursor').toBeEnabled();

    await page.keyboard.press('ControlOrMeta+Shift+z');
    // Waiting on band 0 is a real wait here, not an instant one: the previous wait
    // established that band 0 is clean, so only the redo can make this true.
    await waitForBandInked(page, bands[0], { description: 'the keyboard-redone stroke to be back' });

    const redone = await getDarkPixelBounds(await capture(page, clip));
    expect(redone, 'the keyboard shortcut did not put the ink back').toBeTruthy();
    expect(redone, 'the keyboard shortcuts did not reach the same pixels as the buttons').toEqual(drawn);
  });

  test('drawing after an undo drops the redo tail instead of branching from it', async ({ page }) => {
    const box = await canvasBox(page);
    const bands = canvasBands(box, BAND_COUNT);
    const stackClip = bandUnionClip(bands);

    await strokeInto(page, box, bands, 0);
    await strokeInto(page, box, bands, 1);
    await strokeInto(page, box, bands, 2);
    await waitForBands(page, bands, [true, true, true], { description: 'all three strokes to reach the canvas' });

    // One undo rewinds past the last stroke, so there is something to redo.
    await getUndoButton(page).click();
    await waitForBands(page, bands, [true, true, false], { description: 'the third stroke to be gone' });
    await expect(getRedoButton(page), 'the third stroke should be redoable').toBeEnabled();

    const beforeBranch = await getDarkPixelBounds(await capture(page, bands[0].clip));
    expect(beforeBranch, 'band 0 carried no ink to branch from').toBeTruthy();

    // A new stroke in band 0, on a wider span. The append truncates the timeline at
    // the cursor (`entries.slice(0, cursor + 1)`), so entries 2 and 3 - the second
    // and third strokes - are no longer reachable.
    await strokeInto(page, box, bands, 0, BRANCH_SPAN);
    await expect(getRedoButton(page), 'the branch should have truncated the redo tail').toBeDisabled();

    // Neither dropped stroke came back, and the branch stroke is on the canvas: a
    // wider span in band 0 is a wider dark-pixel box than the stroke it replaced.
    expect(await bandInkFlags(await capture(page, stackClip), bands)).toEqual([true, true, false]);
    const branched = await getDarkPixelBounds(await capture(page, bands[0].clip));
    expect(branched, 'the branch stroke is not on the canvas at all').toBeTruthy();
    expect(branched!.right, 'the branch stroke did not widen band 0').toBeGreaterThan(beforeBranch!.right);
  });
});
