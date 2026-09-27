import { expect, test } from '@playwright/test';

test.describe('SidebarLeft - Layout Toggle (fast)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Don't wait for canvas - just verify page loads
    await expect(page.locator('body')).toBeVisible();
  });

  test('defaults to one-column layout', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar).toHaveClass(/w-14/);
  });

  test('toggles to two-column layout', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar).toHaveClass(/w-\[6\.75rem\]/);
  });

  test('toggles back to one-column', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await toggle.click();
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar).toHaveClass(/w-14/);
  });

  test('closes open flyout on layout toggle', async ({ page }) => {
    const toggle = page.getByTestId('toolbar-layout-toggle');

    // Open flyout via right-click (faster than long-press)
    await page.getByTestId('tool-button-brush').click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();

    await toggle.click();

    await expect(page.getByRole('menu')).toBeHidden();
  });
});
