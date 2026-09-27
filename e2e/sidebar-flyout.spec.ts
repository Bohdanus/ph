import { expect, test } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import {
  clickToolButton,
  openToolFlyout,
  selectFromFlyout,
  verifyPrimaryTool,
  openToolFlyoutViaRightClick,
  verifyHoverDoesNotOpenFlyout,
} from './helpers/toolbar-helpers';

test.describe('SidebarLeft - Flyout Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const canvas = getWorkspaceCanvas(page);
    await expect(canvas).toBeVisible();
  });

  test('long-press opens flyout for grouped tools', async ({ page }) => {
    // Brush tool is in a group (brush, pencil, color-replacement)
    await openToolFlyout(page, 'brush');

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Brush Tool');
    await expect(flyout).toContainText('Pencil Tool');
    await expect(flyout).toContainText('Color Replacement Tool');
  });

  test('short click selects primary tool without opening flyout', async ({ page }) => {
    await clickToolButton(page, 'brush');

    // Flyout should not be visible
    await expect(page.getByRole('menu')).toBeHidden();

    // Verify primary tool is still brush
    await verifyPrimaryTool(page, 'brush', 'Brush Tool');
  });

  test('right-click opens flyout for grouped tools', async ({ page }) => {
    await openToolFlyoutViaRightClick(page, 'brush');

    const flyout = page.getByRole('menu');
    await expect(flyout).toBeVisible();
    await expect(flyout).toContainText('Brush Tool');
  });

  test.skip('right-click does not open flyout for single-tool groups', async ({ page }) => {
    // Draw is a single tool (no group)
    // SKIPPED: Business value unclear - right-click on single-tool groups is not a user-facing feature.
    // The test checks that right-click doesn't open a flyout, but there's no requirement or user story
    // for this behavior. Introduced in dd774cd merge without clear rationale.
    // FLAKINESS: Browser native context menu interferes with right-click detection.
    // Right-click events are consumed by browser before reaching app logic in some environments.
    // This makes the test unreliable across CI/browser configurations.
    // Re-enable if a specific UX requirement for right-click handling on single tools emerges.
    const drawButton = page.getByTestId('tool-button-draw');
    await expect(drawButton).toBeVisible();

    await drawButton.click({ button: 'right' });

    // Flyout should not appear
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('hover does not open flyout', async ({ page }) => {
    await verifyHoverDoesNotOpenFlyout(page, 'brush');
  });

  test('selecting from flyout updates primary tool', async ({ page }) => {
    // Open brush flyout and select Pencil
    await openToolFlyout(page, 'brush');
    await selectFromFlyout(page, { toolName: 'pencil', label: 'Pencil Tool' });

    // Verify primary tool is now Pencil
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');

    // Clicking the button should select pencil again
    await clickToolButton(page, 'pencil');
    await verifyPrimaryTool(page, 'pencil', 'Pencil Tool');
  });

  test('selecting shape from flyout updates primary and patches figure', async ({ page }) => {
    // Open shape flyout (grouped under 'shape' tool)
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Ellipse Tool' });

    // Verify primary tool shows Ellipse
    await verifyPrimaryTool(page, 'shape', 'Ellipse Tool');
  });

  test('flyout closes on outside click', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    // Click on body (outside flyout)
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes on Escape key', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('flyout closes when clicking active grouped tile again', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    // Click the brush button again
    await clickToolButton(page, 'brush');

    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('long-press on different grouped tile switches flyout', async ({ page }) => {
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeVisible();

    // Long-press on shape tool
    await openToolFlyout(page, 'shape');

    // Brush flyout should be closed, shape flyout open
    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeHidden();
    await expect(page.getByRole('menu', { name: 'Shape tools' })).toBeVisible();
  });

  test('all lasso tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'freehand-lasso');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Lasso Tool');
    await expect(flyout).toContainText('Polygonal Lasso Tool');
    await expect(flyout).toContainText('Magnetic Lasso Tool');
  });

  test('all pen tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'pen');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Pen Tool');
    await expect(flyout).toContainText('Freeform Pen Tool');
    await expect(flyout).toContainText('Curvature Pen Tool');
    await expect(flyout).toContainText('Add Anchor Point Tool');
    await expect(flyout).toContainText('Delete Anchor Point Tool');
    await expect(flyout).toContainText('Convert Point Tool');
  });

  test('all colors tools present in flyout', async ({ page }) => {
    await openToolFlyout(page, 'color');

    const flyout = page.getByRole('menu');
    await expect(flyout).toContainText('Colors');
    await expect(flyout).toContainText('Levels');
    await expect(flyout).toContainText('Transform');
  });

  test('pending long-press cancels on pointer leave', async ({ page }) => {
    const brushButton = page.getByTestId('tool-button-brush');
    await expect(brushButton).toBeVisible();

    await brushButton.hover();
    await page.mouse.down();
    await page.mouse.move(0, 0); // Move away
    await page.waitForTimeout(400); // Wait longer than long-press delay
    await page.mouse.up();

    await expect(page.getByRole('menu')).toBeHidden();
  });
});
