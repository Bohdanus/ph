import { expect, test } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';

test.describe('Start page', () => {
  test.use({ initialEntry: 'start-page' });

  test('shows document choices without displaying a workspace canvas', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('start-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create a new image' })).toBeVisible();
    await expect(page.getByTestId('main-preset-landscape-button')).toBeVisible();
    await expect(page.getByTestId('main-preset-square-button')).toBeVisible();
    await expect(page.getByTestId('main-preset-portrait-button')).toBeVisible();
    await expect(page.getByTestId('main-blank-image-button')).toBeVisible();
    await expect(page.getByTestId('main-open-file-button')).toBeVisible();
    await expect(getWorkspaceCanvas(page)).not.toBeVisible();
  });

  for (const preset of [
    { id: 'landscape', width: 1920, height: 1080 },
    { id: 'square', width: 1080, height: 1080 },
    { id: 'portrait', width: 1080, height: 1350 },
  ]) {
    test(`creates a ${preset.id} document from its preset`, async ({ page }) => {
      await page.goto('/');
      await page.getByTestId(`main-preset-${preset.id}-button`).click();

      await expect(getWorkspaceCanvas(page)).toBeVisible();
      await expect(page.getByTestId('start-page')).toHaveCount(0);
      await expect(page.getByTestId('footer-dimensions')).toContainText(
        `Dimensions: ${preset.width} × ${preset.height} px`
      );
    });
  }

  test('creates a custom document using the dialog default size', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('main-blank-image-button').click();

    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    await expect(page.getByTestId('new-image-width-input')).toHaveValue('800');
    await expect(page.getByTestId('new-image-height-input')).toHaveValue('600');
    await page.getByTestId('new-image-dialog-submit-button').click();

    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await expect(page.getByTestId('footer-dimensions')).toContainText('Dimensions: 800 × 600 px');
  });
});
