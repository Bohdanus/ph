import { expect, test, type Page } from './fixtures/extended-test';
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
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

/**
 * Per-test budget. The config default is 30s, which covers a single canvas wait
 * (`CANVAS_REDRAW_TIMEOUT_MS` is 10s) and little else. These tests chain three
 * strokes and up to three navigations, and every step waits on the replayed canvas
 * rather than on a timer, so the floor is a handful of poll loops at their full
 * timeout. 60s is the figure this suite raises a per-test budget to for work of
 * this shape — a stroke, then a navigation, then a pixel read — in
 * `select-move.spec.ts:31` and `select-move.spec.ts:64`, and in
 * `viewport-drawing.spec.ts:17`. The specs that go higher are heavier: layers are
 * reordered and deleted one at a time in `layers.spec.ts:21` at 90s, and
 * `paint-tools.spec.ts:569` uses this same `test.describe.configure` mechanism at
 * 120s for tests that open an options bar, build a fixture, and make three history
 * round trips with a capture per poll. None of that is in these five tests.
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
 * A box fraction is not a document coordinate: the document is letterboxed inside
 * the box, and `usePointerPosition` fits it and centres it, so the fraction range
 * that lands on the document is the box less a symmetric inset. That inset is what
 * `documentToCanvasOffset` computes (`e2e/helpers/canvas-helpers.ts:75-84`, which
 * mirrors the app's own mapping at `src/hooks/usePointerPosition.ts:72-89`), and
 * for the measured box it is small enough at both ends that 0.2 and 0.85 are
 * comfortably inside. The claim is not asserted here but demonstrated: a span
 * reaching past the document puts no ink in its band, and every wait on a band
 * below is a `waitForBandInked`, so an aim that stopped landing inside the
 * document times out by name instead of passing on a canvas that never took the
 * stroke.
 *
 * The second span is offset from the first so a second stroke in the same band
 * measurably widens it, which is how the branch test tells the new stroke apart
 * from the one it replaced.
 */
const FIRST_SPAN = { start: 0.2, end: 0.6 };
const BRANCH_SPAN = { start: 0.45, end: 0.85 };

/*
 * WINDOW SIZE: the project default, 1280x720, which is what `devices['Desktop
 * Chrome']` in `playwright.config.ts` already sets. There is deliberately no
 * `setViewportSize` call anywhere in this spec, and that absence is a decision.
 *
 * There used to be one, at 1280x1000, and it was justified by a premise that
 * stopped being true. The bump existed to lift the workspace canvas above the fold,
 * because the app used to lay the canvas out TALLER than a 720px window — measured
 * at 840px of canvas in a 720px window. It no longer does: `min-h-0 overflow-y-auto`
 * on the left sidebar's `<aside>` (`src/components/SidebarLeft/SidebarLeft.tsx:459`)
 * is what bounds the grid row, `e2e/sidebar-layout.spec.ts:21` pins that the
 * default page does not scroll, and P1 of `e2e/OPEN_PROBLEMS.md` records the
 * measured canvas box and page height for both toolbar layouts. Those numbers are
 * that document's to own, which is why none of them are written here.
 *
 * Dropping the bump makes this spec harder to pass, not easier, and that is the
 * argument for it. A taller window is exactly what a taller canvas would need, so
 * 1280x1000 would have MASKED the very regression the 840px canvas was. At the
 * default size a canvas that grew past the fold again makes `visibleCanvasBox` cut
 * the bands to the visible intersection, the lower bands stop receiving the strokes
 * aimed at them, and the per-band assertions fail by name — instead of quietly
 * passing against a window the test chose for itself. `visibleCanvasBox` is the belt
 * to that pair of braces, and is what makes the clips correct whatever the window
 * turns out to be.
 */

test.describe('Undo and redo', () => {
  test.describe.configure({ timeout: UNDO_REDO_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
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

  const expectPresentationDecision = async (page: Page) => {
    const strip = page.getByTestId('dev-status-strip');
    await expect
      .poll(() => strip.getAttribute('data-presentation-status'), {
        message: 'history navigation must publish a durable composition or an explicit legacy fallback',
      })
      .toMatch(/^(durable|legacy-fallback)$/);
    const status = await strip.getAttribute('data-presentation-status');
    if (status === 'durable') {
      await expect(strip).toHaveAttribute('data-durable-cursor', /^-?\d+$/);
      await expect(strip).toHaveAttribute('data-durable-publication', /.+/);
      await expect(strip).toHaveAttribute('data-durable-layer-ids', /.+/);
      await expect(strip).toHaveAttribute('data-durable-fallback-reason', '');
      return;
    }
    await expect(strip).toHaveAttribute('data-durable-fallback-reason', /.+/);
    await expect(strip).toHaveAttribute('data-durable-publication', '');
    await expect(strip).toHaveAttribute('data-durable-layer-ids', '');
  };

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

    const initialStrip = page.getByTestId('dev-status-strip');
    await expect(initialStrip).toHaveAttribute('data-presentation-status', 'unpublished');
    await expect(initialStrip).toHaveAttribute('data-durable-publication', '');
    await expect(initialStrip).toHaveAttribute('data-durable-layer-ids', '');

    // A fresh document is a single history entry, so there is nothing on either
    // side of the cursor: `canUndo` is `historyIndex > 0` (`src/contexts/useHistory.ts:47`)
    // and `canRedo` is `historyIndex < history.length - 1`
    // (`src/contexts/useHistory.ts:56`), both false at index 0 of 1.
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
    await expectPresentationDecision(page);

    expect(await hasDarkPixels(await capture(page, clip)), 'undo left ink on the canvas').toBe(false);
    await expect(getRedoButton(page)).toBeEnabled();

    await getRedoButton(page).click();
    await waitForBands(page, [wholeCanvasBand(box)], [true], { description: 'the redone stroke to be back' });
    await expectPresentationDecision(page);

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
    const stackClip = bandUnionClip(bands);

    await strokeInto(page, box, bands, 0);
    await strokeInto(page, box, bands, 1);
    await strokeInto(page, box, bands, 2);
    await waitForBands(page, bands, [true, true, true], { description: 'all three strokes to reach the canvas' });

    // The state is read after EACH click, and that is the whole point of the per-band
    // read. An undo that stepped two entries instead of one would reach
    // [true, false, false] on its first click, and its second click would be refused
    // by the negative-index guard in `resetHistoryTo` and do nothing - leaving a test
    // that only looked at the end staring at exactly the state it wanted. Reading the
    // intermediate state is what makes the NUMBER of steps the assertion, rather than
    // only the destination.
    await getUndoButton(page).click();
    await waitForBands(page, bands, [true, true, false], {
      description: 'one undo to drop the third stroke and leave the first two',
    });
    expect(await bandInkFlags(await capture(page, stackClip), bands)).toEqual([true, true, false]);

    await getUndoButton(page).click();
    await waitForBands(page, bands, [true, false, false], {
      description: 'the third stroke gone and the second one gone after two undos',
    });

    // Read it back as pixels rather than trusting the wait: a per-band read is the
    // assertion, the wait is only what makes it deterministic. This is the check a
    // whole-canvas "is there ink" cannot make - an off-by-one cursor leaves ink too.
    expect(await bandInkFlags(await capture(page, stackClip), bands)).toEqual([true, false, false]);
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
    // as `(event.metaKey || event.ctrlKey) !== shortcut.mod`
    // (`src/hooks/useKeyboardEvents.tsx:64`), so either one works on either OS, and
    // spelling out the platform's own key would only pass on one. The redo side adds
    // `shift: true` (`src/components/Common/AppKeyboardShortcuts.tsx:174`), which
    // `matchesShortcut` checks separately, so the plain undo press cannot reach it.
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
    // the cursor (`entries.slice(0, cursor + 1)`, `src/contexts/history-timeline.ts:31`).
    // The cursor is at 2 here (blank document, stroke 1, stroke 2), so the slice keeps
    // those three and the entry it drops is the one just undone: the THIRD stroke.
    await strokeInto(page, box, bands, 0, BRANCH_SPAN);
    await expect(getRedoButton(page), 'the branch should have truncated the redo tail').toBeDisabled();

    // Neither dropped stroke came back, and the branch stroke is on the canvas: a
    // wider span in band 0 is a wider dark-pixel box than the stroke it replaced.
    expect(await bandInkFlags(await capture(page, stackClip), bands)).toEqual([true, true, false]);
    const branched = await getDarkPixelBounds(await capture(page, bands[0].clip));
    expect(branched, 'the branch stroke is not on the canvas at all').toBeTruthy();
    expect(branched!.right, 'the branch stroke did not widen band 0').toBeGreaterThan(beforeBranch!.right);

    // "Redo is disabled" does NOT mean the tail was dropped, and this block is what
    // pins the difference. The append puts the cursor at the new last entry either
    // way, so `canRedo` is false whether or not `slice(0, cursor + 1)` ran: an append
    // that kept the tail is indistinguishable from a truncating one for as long as
    // nothing walks back into it. Undoing walks back into it. With the tail dropped,
    // the undo removes the branch stroke and lands on [stroke 1, stroke 2], so band 2
    // is still clean; with the tail kept it lands one entry further along and revives
    // the third stroke, so band 2 is inked. Band 2 is the whole assertion - the two
    // timelines differ there and nowhere else this test can see.
    await getUndoButton(page).click();
    await waitForBands(page, bands, [true, true, false], {
      description: 'the undo to drop the branch stroke without reviving the dropped third stroke',
    });
    expect(await bandInkFlags(await capture(page, stackClip), bands)).toEqual([true, true, false]);
    await expect(getRedoButton(page), 'undoing back to the branch point should make it redoable').toBeEnabled();
  });

  test('vector shape undo and redo publish durable presentation with cursor and layer ids', async ({ page }) => {
    const box = await canvasBox(page);
    const clip = wholeCanvasClip(box);

    // Select the Rectangle shape tool
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Rectangle Tool' });

    // Draw a rectangle in the center of the canvas
    const rectStart = { x: box.width * 0.25, y: box.height * 0.25 };
    const rectEnd = { x: box.width * 0.75, y: box.height * 0.75 };
    await drawLine(page, box, rectStart.x, rectStart.y, rectEnd.x, rectEnd.y, { steps: 10 });

    // Wait for the shape to appear on the canvas
    await waitForBandInked(page, wholeCanvasBand(box), { description: 'the rectangle to reach the canvas' });

    // Verify the shape was drawn
    const drawn = await getDarkPixelBounds(await capture(page, clip));
    expect(drawn, 'the rectangle was not on the canvas at all').toBeTruthy();

    // Undo the shape creation
    await getUndoButton(page).click();
    await waitForBands(page, [wholeCanvasBand(box)], [false], { description: 'the canvas to carry no ink after undo' });
    await expectPresentationDecision(page);
    await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'durable');

    expect(await hasDarkPixels(await capture(page, clip)), 'undo left ink on the canvas').toBe(false);
    await expect(getRedoButton(page)).toBeEnabled();

    // Redo the shape creation
    await getRedoButton(page).click();
    await waitForBands(page, [wholeCanvasBand(box)], [true], { description: 'the redone rectangle to be back' });
    await expectPresentationDecision(page);
    await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-presentation-status', 'durable');

    const redone = await getDarkPixelBounds(await capture(page, clip));
    expect(redone, 'redo left the canvas empty').toBeTruthy();
    expect(redone, 'redo did not restore the rectangle pixel for pixel').toEqual(drawn);
  });
});
