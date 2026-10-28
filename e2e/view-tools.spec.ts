import { expect, test } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

async function openWorkspace(page: Parameters<typeof clickToolButton>[0]): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page), 'the seeded document canvas must be visible').toBeVisible();
}

async function dragAcrossWorkspace(page: Parameters<typeof clickToolButton>[0], distance = 120): Promise<void> {
  const box = await page.getByTestId('workspace-container').boundingBox();
  if (!box) throw new Error('workspace-container has no bounding box');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2 - distance / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + distance, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('Transient view tools', () => {
  test('H, Z, and R select the Hand, Zoom, and Rotate View tools', async ({ page }) => {
    await openWorkspace(page);

    await page.keyboard.press('h');
    await expect(page.getByRole('region', { name: 'hand tool options', exact: true })).toBeVisible();
    await page.keyboard.press('z');
    await expect(page.getByRole('region', { name: 'zoom tool options', exact: true })).toBeVisible();
    await page.keyboard.press('r');
    await expect(page.getByRole('button', { name: 'Reset View', exact: true })).toBeVisible();
  });

  test('Hand drag changes only transient pan state', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'hand');
    const workspace = page.getByTestId('workspace-container');
    await expect(workspace).toHaveAttribute('data-view-pan-x', '0');

    await dragAcrossWorkspace(page);

    await expect(workspace).not.toHaveAttribute('data-view-pan-x', '0');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('Zoom click changes scale without creating document history', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'zoom');
    const workspace = page.getByTestId('workspace-container');
    const box = await workspace.boundingBox();
    if (!box) throw new Error('workspace-container has no bounding box');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(workspace).not.toHaveAttribute('data-view-zoom', '1');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await page.getByRole('button', { name: 'Fit On Screen', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-view-zoom', '1');
  });

  test('Rotate View drag and Escape reset presentation angle without history', async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press('r');
    const workspace = page.getByTestId('workspace-container');

    await dragAcrossWorkspace(page, 80);
    await expect(workspace).not.toHaveAttribute('data-view-rotation', '0');
    await page.keyboard.press('Escape');
    await expect(workspace).toHaveAttribute('data-view-rotation', '0');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('Space temporarily pans while the selected document tool remains active', async ({ page }) => {
    await openWorkspace(page);
    await clickToolButton(page, 'draw');
    const drawOptions = page.getByRole('region', { name: 'draw tool options', exact: true });
    await expect(drawOptions).toBeVisible();
    const workspace = page.getByTestId('workspace-container');
    await page.keyboard.down('Space');
    await dragAcrossWorkspace(page, 70);
    await page.keyboard.up('Space');

    await expect(drawOptions).toBeVisible();
    await expect(workspace).not.toHaveAttribute('data-view-pan-x', '0');
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });
});
