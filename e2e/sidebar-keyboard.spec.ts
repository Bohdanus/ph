import { expect, test } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { openToolFlyoutViaKeyboard, verifyPrimaryTool } from './helpers/toolbar-helpers';

// FLAKY — see e2e/OPEN_PROBLEMS.md, "Enter does not reliably close the flyout".
//
// Both tests marked FLaky below race on `expect(page.getByRole('menu')).toBeHidden()`
// after pressing Enter: the flyout closes asynchronously and the assertion can still
// see it open. Observed in 4 of 5 headless runs with no operator input, so this is a
// real defect in the flyout-close path and NOT a headed-run artifact. Running headless
// does not fix it; the fix is a readiness assertion between the keypress and the check.
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

  // FLaky: see the note at the top of this file.
  test('Enter activates focused flyout item', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'brush');

    // Navigate to Pencil Tool (index 1)
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');
  });

  // FLaky: see the note at the top of this file.
  test('full keyboard flow: open, navigate, select', async ({ page }) => {
    // Open flyout with keyboard
    await openToolFlyoutViaKeyboard(page, 'color', 'ArrowDown');

    // Navigate to Levels (index 1) and select
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('menu')).toBeHidden();
    // Levels tool should now be selected (would need verifyPrimaryTool for 'levels')
  });
});
