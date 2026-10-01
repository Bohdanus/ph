import { expect, test } from './fixtures/extended-test';
import {
  drawLine,
  getDarkPixelBounds,
  getWorkspaceCanvas,
  getSelectionBounds,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  screenshotBoundsToCss,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imagePointToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
// Resize handle center offset from selection outline edge (screenshot pixels)
const HANDLE_OFFSET = 4;

/**
 * How far a measured CSS delta may sit from the amount the gesture asked for.
 *
 * The two error sources are a page pixel of pointer rounding and a capture pixel of edge
 * quantisation: `getDarkPixelBounds` and `getSelectionBounds` report inclusive capture
 * indices, and the 2px outline stroke straddles the path it is drawn on, so a trailing edge
 * reads about one pixel past the geometry. The capture scale itself divides out through
 * `screenshotBoundsToCss`, so it contributes nothing here.
 *
 * Two, and the number is measured rather than chosen: with this bound set to zero and both
 * tests run, every leading edge and both anchors read their requested amount EXACTLY, and
 * the only nonzero errors were 1.0 — the move's width extent, and the resize frame's right
 * and bottom edges reading 141.0 and 81.0. So the observed range is 0..1 and this leaves
 * one capture pixel of headroom over it, which is the whole of what the dashed outline
 * needs: a 2px dash on the frame's path can drop one column off an extreme and never two.
 *
 * One would be exactly at the measured maximum with no margin, and three is three times it
 * for no gain in discrimination — the smallest real defect these reads can distinguish is a
 * wrong direction or a wrong amount, which is tens of pixels, so nothing between one and
 * three catches an error the other does not.
 */
const GESTURE_TOLERANCE_PX = 2;

test.describe('Select & Move', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // moves drawn line
  test('moves drawn line', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await clickToolButton(page, 'draw');
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasRedraw(page, box);

    const originalScreenshot = await captureCanvasScreenshot(page, box, testInfo, 'select-move-original');
    const original = await getDarkPixelBounds(originalScreenshot);
    expect(original, 'Line not found on original canvas screenshot').toBeTruthy();

    // Select Move Tool (reposition)
    await clickToolButton(page, 'reposition');
    // Verify the reposition toolbox is visible
    await expect(page.getByTestId('reposition-hint-text')).toBeVisible();

    await page.mouse.move(box.x + 250, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 250, { steps: 10 });
    await page.mouse.up();

    const movedScreenshot = await captureCanvasScreenshot(page, box, testInfo, 'select-move-moved');
    const moved = await getDarkPixelBounds(movedScreenshot);
    expect(moved, 'Line disappeared after move').toBeTruthy();
    expect(moved!.left).not.toBe(original!.left);
    expect(moved!.top).not.toBe(original!.top);

    // The AMOUNT, and on all four edges. The drag was +150/+100 CSS px, so a stroke that
    // failed to translate reads a delta of zero, one that went the wrong way on one axis
    // reads a negative one, one that ran 10x over reads 1500, and one that scaled the layer
    // on the way across reads a non-zero extent delta. `not.toBe` on a pair of edges sees
    // none of the four. The edges are converted to CSS first, because both are inclusive
    // CAPTURE pixels and the gesture is in page pixels.
    const originalCss = screenshotBoundsToCss(original!, box);
    const movedCss = screenshotBoundsToCss(moved!, box);
    const extent = {
      width: movedCss.right - movedCss.left - (originalCss.right - originalCss.left),
      height: movedCss.bottom - movedCss.top - (originalCss.bottom - originalCss.top),
    };
    expect
      .soft(
        Math.abs(movedCss.left - originalCss.left - 150) <= GESTURE_TOLERANCE_PX,
        `the drag was +150 CSS px in x, and the stroke's left edge read ${(movedCss.left - originalCss.left).toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(movedCss.top - originalCss.top - 100) <= GESTURE_TOLERANCE_PX,
        `the drag was +100 CSS px in y, and the stroke's top edge read ${(movedCss.top - originalCss.top).toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(extent.width) <= GESTURE_TOLERANCE_PX,
        `a move must not resize, and the width changed by ${extent.width.toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(extent.height) <= GESTURE_TOLERANCE_PX,
        `a move must not resize, and the height changed by ${extent.height.toFixed(1)}`
      )
      .toBe(true);
  });

  // stretches selected line
  test('stretches selected line', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await clickToolButton(page, 'draw');
    await drawLine(page, box, LINE_START_X, LINE_START_Y, LINE_END_X, LINE_END_Y);
    await waitForCanvasRedraw(page, box);

    // Select Move Tool (reposition)
    await clickToolButton(page, 'reposition');
    // Verify the reposition toolbox is visible
    await expect(page.getByTestId('reposition-hint-text')).toBeVisible();

    await page.mouse.move(box.x + 250, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 250, { steps: 10 });
    await page.mouse.up();

    const movedScreenshot = await captureCanvasScreenshot(page, box, testInfo, 'select-move-moved-for-resize');
    // `getSelectionBounds` reads its colour thresholds from `STROKE_ANALYSIS`
    // (`canvas-helpers.ts`), where they are tripwire-pinned. This call used to pass a
    // local copy of those three numbers as its second argument, which is a behavioural
    // no-op: if the shared constants move, this call site would have carried the old
    // values along and the "explicit thresholds" comment would have read as a
    // protection it never provided. Taking the defaults is the pin.
    const handle = await getSelectionBounds(movedScreenshot);
    expect(handle, 'Bottom-right resize handle not found').toBeTruthy();

    // Map the handle from screenshot pixel space to CSS page space via the canvas
    // bounding box, inset by HANDLE_OFFSET to center the click on the handle.
    const handlePoint = imagePointToCss({ width: handle!.imageWidth, height: handle!.imageHeight }, box, {
      x: handle!.right - HANDLE_OFFSET,
      y: handle!.bottom - HANDLE_OFFSET,
    });
    const handleX = handlePoint.x;
    const handleY = handlePoint.y;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 140, handleY + 80, { steps: 10 });
    await page.mouse.up();

    const resizedScreenshot = await captureCanvasScreenshot(page, box, testInfo, 'select-move-resized');
    const resized = await getDarkPixelBounds(resizedScreenshot);
    expect(resized, 'Line disappeared after resize').toBeTruthy();
    const moved = await getDarkPixelBounds(movedScreenshot);
    expect(resized!.width).toBeGreaterThan(moved!.width);
    expect(resized!.height).toBeGreaterThan(moved!.height);

    // The AMOUNT, read off the LAYER FRAME rather than off the stroke, because the frame is
    // what the handle drag specifies and the stroke is content that gets rescaled inside it.
    // The handle drag was +140/+80 CSS px and the opposite corner is the anchor, so the left
    // and top edges cannot have moved at all: a scale about the centre reads -70/-40 there
    // and a doubled delta reads 280/160 on the other two, and both pass the two
    // `greater than` checks above.
    //
    // `getSelectionBounds` is called the same way it is above — defaults, not a local
    // copy of the thresholds — for the reason that comment gives: a second call site
    // that passed its own `{ redMax, greenMin, blueMin }` would carry the old values
    // the moment the shared ones in `STROKE_ANALYSIS` moved, and the "before" and
    // "after" frames of the SAME resize would then be read under two different
    // definitions of the outline.
    const after = await getSelectionBounds(resizedScreenshot);
    expect(after, 'The selection outline must survive the resize').toBeTruthy();
    const frameBefore = screenshotBoundsToCss(handle!, box);
    const frameAfter = screenshotBoundsToCss(after!, box);
    expect
      .soft(
        Math.abs(frameAfter.right - frameBefore.right - 140) <= GESTURE_TOLERANCE_PX,
        `the handle drag was +140 CSS px in x, and the frame's right edge read ${(frameAfter.right - frameBefore.right).toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(frameAfter.bottom - frameBefore.bottom - 80) <= GESTURE_TOLERANCE_PX,
        `the handle drag was +80 CSS px in y, and the frame's bottom edge read ${(frameAfter.bottom - frameBefore.bottom).toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(frameAfter.left - frameBefore.left) <= GESTURE_TOLERANCE_PX,
        `the opposite corner is the anchor, and the frame's left edge read ${(frameAfter.left - frameBefore.left).toFixed(1)}`
      )
      .toBe(true);
    expect
      .soft(
        Math.abs(frameAfter.top - frameBefore.top) <= GESTURE_TOLERANCE_PX,
        `the opposite corner is the anchor, and the frame's top edge read ${(frameAfter.top - frameBefore.top).toFixed(1)}`
      )
      .toBe(true);
  });
});
