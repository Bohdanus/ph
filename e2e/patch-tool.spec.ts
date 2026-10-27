import { expect, test } from './fixtures/extended-test';
import { drawLine, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout } from './helpers/toolbar-helpers';

test.describe('Patch Tool', () => {
  test('preserves an active selection, drags a donor area, and replays one raster action', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('workspace canvas has no bounding box');

    await clickToolButton(page, 'draw');
    await drawLine(page, box, 220, 180, 240, 180, { steps: 4 });
    await clickToolButton(page, 'rectangular-selection');
    await drawLine(page, box, 260, 190, 300, 225, { steps: 8 });
    await openToolFlyout(page, 'brush');
    await page.locator('[data-testid^="tool-flyout-item-patch-"]').click();
    await expect(page.locator('#patch-mode')).toHaveValue('source');

    await drawLine(page, box, 280, 207, 350, 207, { steps: 8 });

    const undo = page.getByTestId('undo-button');
    const redo = page.getByTestId('redo-button');
    await expect(undo, 'Patch must commit through the history path').toBeEnabled();
    await undo.click();
    await expect(undo, 'the first undo must remove Patch, leaving the selection').toBeEnabled();
    await undo.click();
    await expect(undo, 'the second undo must remove the selection, leaving the draw stroke').toBeEnabled();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await redo.click();
    await redo.click();
    await expect(undo).toBeEnabled();
  });
});
