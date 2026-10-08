import { expect, test } from './fixtures/extended-test';
import { drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout } from './helpers/toolbar-helpers';

test.describe('Healing Brush Tool', () => {
  test('samples with Alt-click and commits one aligned raster stroke', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('workspace canvas has no bounding box');

    await clickToolButton(page, 'draw');
    await drawLine(page, box, 260, 200, 310, 200, { steps: 8 });
    await openToolFlyout(page, 'brush');
    await page.locator('[data-testid^="tool-flyout-item-healing-brush-"]').click();

    await expect(page.locator('#healing-brush-size')).toBeVisible();
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 350, box.y + 200);
    await page.keyboard.up('Alt');
    await drawLine(page, box, 285, 200, 289, 200, { steps: 2 });

    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');
    await expect(undo, 'Healing Brush must commit through the history path').toBeEnabled();
    await undo.click();
    await expect(undo, 'the first undo must remove Healing Brush, leaving the draw stroke').toBeEnabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await redo.click();
    await expect(undo).toBeEnabled();
  });
});
