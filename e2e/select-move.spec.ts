import { expect, test } from '@playwright/test';
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

// Selection outline in the app appears to be cyan-ish; pass explicit thresholds instead of relying on defaults
const SELECTION_COLOR_THRESHOLDS = { redMax: 80, greenMin: 80, blueMin: 180 };
// Resize handle center offset from selection outline edge (screenshot pixels)
const HANDLE_OFFSET = 4;

/**
 * How far a measured CSS delta may sit from the amount the gesture asked for.
 *
 * The two error sources are a page pixel of pointer rounding and a capture pixel of edge
 * quantisation: `getDarkPixelBounds` and `getSelectionBounds` report inclusive capture
 * indices, and the 2px outline stroke straddles the path it is drawn on, so a trailing edge
 * reads about one pixel past the geometry. The capture scale itself divides out through
 * `screenshotBoundsToCss`, so it contributes nothing here. Measured at a 1x capture: 0 on
 * every leading edge, 1 on the trailing ones.
 */
const GESTURE_TOLERANCE_PX = 3;

test.describe('Select & Move', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // moves drawn line
  test('moves drawn line', async ({ page }, testInfo) => {
    test.setTimeout(60_000);

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
    test.setTimeout(60_000);

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
    const handle = await getSelectionBounds(movedScreenshot, SELECTION_COLOR_THRESHOLDS);
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
    const after = await getSelectionBounds(resizedScreenshot, SELECTION_COLOR_THRESHOLDS);
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
