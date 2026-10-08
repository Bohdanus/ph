import { expect, test } from './fixtures/extended-test';
import { drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout } from './helpers/toolbar-helpers';

test.describe('Spot Healing Brush Tool', () => {
  test('is reachable from the Brush flyout and commits one replayable raster action', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('workspace canvas has no bounding box');

    await clickToolButton(page, 'draw');
    await drawLine(page, box, 260, 200, 310, 200, { steps: 8 });
    await openToolFlyout(page, 'brush');
    await page.locator('[data-testid^="tool-flyout-item-spot-healing-"]').click();

    await expect(page.locator('#spot-healing-size')).toBeVisible();
    await drawLine(page, box, 285, 200, 289, 200, { steps: 2 });

    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');
    await expect(undo, 'Spot Healing must commit through the history path').toBeEnabled();
    await undo.click();
    await expect(undo, 'the first undo must remove Spot Healing, leaving the draw stroke').toBeEnabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await redo.click();
    await expect(undo).toBeEnabled();
  });
});
