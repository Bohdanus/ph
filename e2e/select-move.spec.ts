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
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imagePointToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

// Selection outline in the app appears to be cyan-ish; pass explicit thresholds instead of relying on defaults
const SELECTION_COLOR_THRESHOLDS = { redMax: 80, greenMin: 80, blueMin: 180 };
// Resize handle center offset from selection outline edge (screenshot pixels)
const HANDLE_OFFSET = 4;

test.describe('Select & Move', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // перемещает нарисованную линию
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
    // Migrating to getByTestId('reposition-hint-text') is blocked: Reposition.tsx in the app
    // repo renders this hint with no data-testid, id, or role to anchor on.
    await expect(page.getByText('Drag or resize on canvas')).toBeVisible();

    await page.mouse.move(box.x + 250, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 250, { steps: 10 });
    await page.mouse.up();

    const movedScreenshot = await captureCanvasScreenshot(page, box, testInfo, 'select-move-moved');
    const moved = await getDarkPixelBounds(movedScreenshot);
    expect(moved, 'Line disappeared after move').toBeTruthy();
    expect(moved!.left).not.toBe(original!.left);
    expect(moved!.top).not.toBe(original!.top);
  });

  // растягивает выделенную линию
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
    await expect(page.getByText('Drag or resize on canvas')).toBeVisible();

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
  });
});
