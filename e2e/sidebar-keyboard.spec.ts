import { expect, test } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { openToolFlyoutViaKeyboard, navigateAndSelectInFlyout, verifyPrimaryTool } from './helpers/toolbar-helpers';

// The Enter tests below used to race on `expect(page.getByRole('menu')).toBeHidden()`.
// Root cause, since fixed: the app focuses the first flyout item from a
// `requestAnimationFrame` callback, while the opener waited only for the menu to
// become visible. A keypress landing in that one-frame gap is handled by the tool
// button again, which re-opens the flyout instead of activating an item - so Enter
// left it open. `openToolFlyoutViaKeyboard` now waits for the focus to land, which is
// what makes these deterministic. See e2e/OPEN_PROBLEMS.md.
test.describe('SidebarLeft - Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  test('ArrowDown opens flyout on grouped tool', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush', 'ArrowDown');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('Enter opens flyout on grouped tool', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush', 'Enter');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('Space opens flyout on grouped tool', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush', ' ');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('ArrowUp opens flyout on grouped tool', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush', 'ArrowUp');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('keyboard does not open flyout on single-tool groups', async ({ page }) => {
    const drawButton = page.getByTestId('tool-button-draw');
    await drawButton.focus();
    await drawButton.press('ArrowDown');
    await drawButton.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('ArrowDown navigates flyout items', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush');

    const items = page.getByRole('menuitemradio');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
  });

  test('ArrowUp wraps to last item', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush');

    const items = page.getByRole('menuitemradio');
    await expect(items.first()).toBeFocused();

    await page.keyboard.press('ArrowUp');
    const count = await items.count();
    await expect(items.nth(count - 1)).toBeFocused();
  });

  test('Enter activates focused flyout item', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush');

    // Navigate to Pencil Tool (index 1)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');
  });

  test('full keyboard flow: open, navigate, select', async ({ page }) => {
    // Open flyout with keyboard
    await openToolFlyoutViaKeyboard(page, 'color', 'ArrowDown');

    // Navigate to Levels and select. `navigateAndSelectInFlyout` finds the index by asking
    // the open menu for each item's `data-testid`, so the flow does not depend on Levels
    // happening to sit at index 1 of the Colors/Levels/Transform group.
    await navigateAndSelectInFlyout(page, 'levels', 'Levels');

    // The tile becomes the tool the flyout chose, `SidebarLeft` re-keys the group button on
    // `primaryTool.name`, so this is the assertion that the selection actually landed. Before
    // it, the test asserted only that the menu closed — which any wrong pick also satisfies.
    await verifyPrimaryTool(page, 'levels', 'Levels');
  });
});
