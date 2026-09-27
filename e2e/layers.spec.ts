import { expect, test } from '@playwright/test';
import { drawLine, getColorAtPoint, getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { cssPointToImage } from './helpers/screenshot-scale';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

/** Canvas-relative point where the three strokes cross; used for pixel sampling. */
const LAYER_OVERLAP_X = 300;
const LAYER_OVERLAP_Y = 260;

test.describe('Layers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  // слои меняют порядок и последовательно удаляются
  test('layers change order and are deleted sequentially', async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const layerRows = page.getByTitle('Drag to reorder');
    const layerRow = (name: string) => layerRows.filter({ hasText: name });
    const capture = async (name: string) => {
      return captureCanvasScreenshot(page, box, testInfo, name);
    };
    /**
     * Samples the overlap point from a capture. The CSS point is converted to image pixels
     * with the repo's single scaling rule (screenshot-scale.ts) rather than by dividing by
     * devicePixelRatio, so device-pixel captures stay correct without that assumption.
     */
    const sampleOverlap = async (
      screenshot: Buffer,
      radius?: number,
      options?: { ignoreNearWhite?: boolean; nearWhiteThreshold?: number }
    ) => {
      const image = await loadImageData(screenshot);
      const point = cssPointToImage(image, box, { x: box.x + LAYER_OVERLAP_X, y: box.y + LAYER_OVERLAP_Y });
      return getColorAtPoint(image, Math.round(point.x), Math.round(point.y), radius, options);
    };
    const draw = async (color: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
      await clickToolButton(page, 'draw');
      // verifySwatch asserts the store picked up the color the draw tool will stroke with.
      await setForegroundColor(page, color, true);

      await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 15 });
    };
    const moveToTop = async (sourceName: string, targetName: string) => {
      const source = layerRow(sourceName);
      const target = layerRow(targetName);
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      const targetBox = await target.boundingBox();
      if (!targetBox) throw new Error(`Layer row ${targetName} not found`);
      await source.dispatchEvent('dragstart', { dataTransfer });
      await target.dispatchEvent('dragover', { dataTransfer, clientY: targetBox.y + 5 });
      await target.dispatchEvent('drop', { dataTransfer, clientY: targetBox.y + 5 });
      await source.dispatchEvent('dragend', { dataTransfer });
      // The drop is applied asynchronously: the moved layer only reaches the top of the
      // panel list once the reorder lands, so wait on row order instead of a fixed sleep.
      await expect(layerRows.first()).toContainText(sourceName);
    };
    const removeLayer = async (name: string) => {
      const row = layerRow(name);
      await row.getByRole('button', { name: 'Remove layer' }).click();
      await expect(row).toHaveCount(0);
    };
    const removeAndCapture = async (name: string, screenshotName: string) => {
      await removeLayer(name);
      return capture(screenshotName);
    };

    await draw('#000000', { x: box.x + 180, y: box.y + 180 }, { x: box.x + 420, y: box.y + 340 }); // draw 2, bottom
    await draw('#ff0000', { x: box.x + 420, y: box.y + 180 }, { x: box.x + 180, y: box.y + 340 }); // draw 3
    await draw('#00aa00', { x: box.x + 160, y: box.y + 260 }, { x: box.x + 440, y: box.y + 260 }); // draw 4, top

    const initialScreenshot = await capture('layers-initial');
    const initialColor = await sampleOverlap(initialScreenshot);
    expect(initialColor, 'Expected green at overlap point').toBeTruthy();
    expect(initialColor!.green).toBeGreaterThan(initialColor!.red * 1.5);
    expect(initialColor!.green).toBeGreaterThan(initialColor!.blue * 1.5);

    await moveToTop('draw 2', 'draw 4');
    await expect(page.getByText('Reorder Layers')).toBeVisible();
    const blackTopScreenshot = await capture('layers-black-top');
    const blackTopColor = await sampleOverlap(blackTopScreenshot);
    expect(blackTopColor, 'Expected black at overlap point').toBeTruthy();
    expect(blackTopColor!.red).toBeLessThan(70);
    expect(blackTopColor!.green).toBeLessThan(70);
    expect(blackTopColor!.blue).toBeLessThan(70);

    await moveToTop('draw 3', 'draw 2');
    const redTopScreenshot = await capture('layers-red-top');
    const redTopColor = await sampleOverlap(redTopScreenshot);
    expect(redTopColor, 'Expected red at overlap point').toBeTruthy();
    expect(redTopColor!.red).toBeGreaterThan(redTopColor!.green * 1.5);
    expect(redTopColor!.red).toBeGreaterThan(redTopColor!.blue * 1.5);
    expect(redTopColor!.red).toBeGreaterThan(100);

    const removeRedScreenshot = await removeAndCapture('draw 3', 'layers-remove-red');
    const removeRedColor = await sampleOverlap(removeRedScreenshot);
    expect(removeRedColor, 'Expected black after removing red').toBeTruthy();
    expect(removeRedColor!.red).toBeLessThan(70);
    expect(removeRedColor!.green).toBeLessThan(70);
    expect(removeRedColor!.blue).toBeLessThan(70);

    const removeBlackScreenshot = await removeAndCapture('draw 2', 'layers-remove-black');
    const removeBlackColor = await sampleOverlap(removeBlackScreenshot);
    expect(removeBlackColor, 'Expected green after removing black').toBeTruthy();
    expect(removeBlackColor!.green).toBeGreaterThan(removeBlackColor!.red * 1.5);
    expect(removeBlackColor!.green).toBeGreaterThan(removeBlackColor!.blue * 1.5);

    const removeGreenScreenshot = await removeAndCapture('draw 4', 'layers-remove-green');
    const removeGreenColor = await sampleOverlap(removeGreenScreenshot, 5, { ignoreNearWhite: true });
    expect(removeGreenColor).toBeNull();

    // Nothing is read from a capture here, so take none: it would cost a CDP session,
    // a PNG write and an attachment for a screenshot nothing asserts on.
    await removeLayer('Blank 1');
  });
});
