import { expect, test } from './fixtures/extended-test';
import { drawLine, getWorkspaceCanvas, loadImageData } from './helpers/canvas-helpers';
import { waitForCanvasPixels, type CanvasPixelPredicate } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, openToolFlyout } from './helpers/toolbar-helpers';

// Healing preserves destination luminance, so its output need not equal the sampled color.
const hasBlueDominantPixel: CanvasPixelPredicate = async (screenshot) => {
  const { data } = await loadImageData(screenshot);
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    if (data[index + 3] > 0 && blue > 180 && blue > red + 10 && blue > green + 10) return true;
  }
  return false;
};

test.describe('Healing Brush Tool', () => {
  test('samples with Alt-click and commits one aligned raster stroke', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const getCanvasBox = async () => {
      const box = await canvas.boundingBox();
      if (!box) throw new Error('workspace canvas has no bounding box');
      return box;
    };

    await clickToolButton(page, 'draw');
    let box = await getCanvasBox();
    const drawSize = page.getByRole('slider', { name: /^Size/ });
    await drawSize.fill('3');
    await expect(drawSize).toHaveValue('3');
    await setForegroundColor(page, '#0000ff', true);
    await drawLine(page, box, 260, 200, 355, 200, { steps: 16 });
    let sourceClip = { x: box.x + 340, y: box.y + 190, width: 20, height: 20 };
    await waitForCanvasPixels(page, sourceClip, hasBlueDominantPixel, { description: 'the blue sample source' });

    await clickToolButton(page, 'eraser');
    const eraserSize = page.getByRole('slider', { name: /^Size/ });
    await eraserSize.fill('4');
    await expect(eraserSize).toHaveValue('4');
    const eraserHardness = page.getByRole('slider', { name: /^Hardness/ });
    await eraserHardness.fill('100');
    await expect(eraserHardness).toHaveValue('100');
    box = await getCanvasBox();
    // Leave only the small blue source patch around the Alt-click, within the same layer raster.
    await drawLine(page, box, 260, 200, 335, 200, { steps: 14 });
    sourceClip = { x: box.x + 340, y: box.y + 190, width: 20, height: 20 };
    let targetClip = { x: box.x + 284, y: box.y + 197, width: 6, height: 6 };
    const hasNoBluePixels: CanvasPixelPredicate = async (screenshot) => !(await hasBlueDominantPixel(screenshot));
    await waitForCanvasPixels(page, sourceClip, hasBlueDominantPixel, {
      description: 'the surviving blue sample source',
    });
    await waitForCanvasPixels(page, targetClip, hasNoBluePixels, { description: 'the erased target hole' });

    await openToolFlyout(page, 'brush');
    await page.locator('[data-testid^="tool-flyout-item-healing-brush-"]').click();

    await expect(page.locator('#healing-brush-size')).toBeVisible();
    box = await getCanvasBox();
    sourceClip = { x: box.x + 340, y: box.y + 190, width: 20, height: 20 };
    targetClip = { x: box.x + 284, y: box.y + 197, width: 6, height: 6 };
    await waitForCanvasPixels(page, sourceClip, hasBlueDominantPixel, { description: 'the sample after tool switch' });
    await waitForCanvasPixels(page, targetClip, hasNoBluePixels, { description: 'the erased hole after tool switch' });
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 350, box.y + 200);
    await page.keyboard.up('Alt');
    await drawLine(page, box, 285, 200, 289, 200, { steps: 2 });
    await waitForCanvasPixels(page, targetClip, hasBlueDominantPixel, {
      description: 'sampled blue texture in the healed target',
    });

    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');
    await expect(undo, 'Healing Brush must commit through the history path').toBeEnabled();
    await undo.click();
    await expect(undo, 'the first undo must remove Healing Brush, leaving the erased target').toBeEnabled();
    await waitForCanvasPixels(page, targetClip, hasNoBluePixels, {
      description: 'the erased hole after undoing healing',
    });
    await undo.click();
    await expect(undo, 'the second undo restores the draw stroke').toBeEnabled();
    await waitForCanvasPixels(page, targetClip, hasBlueDominantPixel, {
      description: 'the line restored by undoing erasure',
    });
    await undo.click();
    await expect(undo, 'the third undo removes the draw layer').toBeDisabled();
    await waitForCanvasPixels(page, targetClip, hasNoBluePixels, { description: 'the draw layer removed by undo' });
    await waitForCanvasPixels(page, sourceClip, hasNoBluePixels, { description: 'the source line removed by undo' });
    await expect(redo).toBeEnabled();
    await redo.click();
    await waitForCanvasPixels(page, sourceClip, hasBlueDominantPixel, {
      description: 'the source line restored by redo',
    });
    await waitForCanvasPixels(page, targetClip, hasBlueDominantPixel, { description: 'the line restored by redo' });
    await redo.click();
    await waitForCanvasPixels(page, targetClip, hasNoBluePixels, { description: 'the erased hole restored by redo' });
    await redo.click();
    await expect(undo).toBeEnabled();
    await waitForCanvasPixels(page, targetClip, hasBlueDominantPixel, {
      description: 'the healed target restored by redo',
    });
  });
});
