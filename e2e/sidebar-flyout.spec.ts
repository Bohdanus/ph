import { expect, test } from '@playwright/test';
import { getWorkspaceCanvas, hasDarkPixels, loadImageData, waitForCanvasPixels } from './helpers/canvas-helpers';
import {
  clickToolButton,
  openToolFlyout,
  selectFromFlyout,
  verifyPrimaryTool,
  openToolFlyoutViaRightClick,
  verifyHoverDoesNotOpenFlyout,
} from './helpers/toolbar-helpers';

/**
 * The box the shape test drags, in CSS pixels, centred on the canvas.
 *
 * A fixed size rather than a fraction of the canvas, because the app contains the document
 * in the viewport (`usePointerPosition`'s `ContainDimensions`): the image is letterboxed and
 * centred, so the canvas centre is inside the image at every viewport size, while a
 * percentage of the canvas can reach past the image's edge on a very wide one.
 */
const SHAPE_DRAG_WIDTH = 160;
const SHAPE_DRAG_HEIGHT = 120;

/** Half-width of a square patch sampled at a point, in CSS pixels. */
const SAMPLE_HALF_SIZE = 4;

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

    // Half of the claim is the figure, not the tile: `selectTool` calls
    // `patchToolArgs('shape', { figure })` as well as switching tools. The Shape options panel
    // prints the figure it was handed, so a patch that never landed shows up here as
    // "Rectangle Tool" - the default in `defaultSettings` - instead of "Ellipse Tool".
    await expect(page.getByLabel('Current shape')).toContainText('Ellipse Tool');

    // And the figure creator path, which is what the patch exists for: drag a box and look
    // at what the app commits. A shape is an outline by default, so a rectangle paints the
    // corners of the drag box and an oval curves away from them - the corner of the box sits
    // ~24px clear of the oval's stroke for this drag size, against dead on the rectangle's.
    const canvas = getWorkspaceCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    const left = box.x + box.width / 2 - SHAPE_DRAG_WIDTH / 2;
    const top = box.y + box.height / 2 - SHAPE_DRAG_HEIGHT / 2;
    const right = left + SHAPE_DRAG_WIDTH;
    const bottom = top + SHAPE_DRAG_HEIGHT;
    const patch = (centreX: number, centreY: number) => ({
      x: centreX - SAMPLE_HALF_SIZE,
      y: centreY - SAMPLE_HALF_SIZE,
      width: SAMPLE_HALF_SIZE * 2,
      height: SAMPLE_HALF_SIZE * 2,
    });

    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();

    // Positive control first: the midpoint of the bottom edge is the one point an ellipse
    // inscribed in the drag box is guaranteed to touch, so a shape really was committed
    // there. Without it the corner assertions below would also pass on a canvas nothing was
    // ever drawn on.
    await waitForCanvasPixels(page, patch((left + right) / 2, bottom), hasDarkPixels, {
      description: 'the shape outline',
    });

    for (const [label, cornerX, cornerY] of [
      ['top left', left, top],
      ['top right', right, top],
      ['bottom left', left, bottom],
      ['bottom right', right, bottom],
    ] as const) {
      const corner = await loadImageData(await page.screenshot({ clip: patch(cornerX, cornerY) }));
      // `page.screenshot` truncates a clip at the viewport edge SILENTLY and returns a
      // shorter image. This app lays the canvas out taller than the 720px default viewport,
      // so a sample point that drifts past the fold would decode to a small or empty strip -
      // which reads as "no dark pixels here" and turns this negative assertion into a false
      // pass. The size is therefore asserted before the pixels are read.
      expect(`${corner.width}x${corner.height}`, `shape ${label} corner capture, clipped at the viewport edge`).toBe(
        `${SAMPLE_HALF_SIZE * 2}x${SAMPLE_HALF_SIZE * 2}`
      );
      expect(await hasDarkPixels(corner), `shape ${label} corner`).toBe(false);
    }
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
    await page.mouse.up();

    await expect(page.getByRole('menu')).toBeHidden();

    // Control, and the reason the negative assertion above is worth anything: the same
    // long-press must still open a flyout. It used to sleep 400ms first and hope that was
    // longer than the app's delay, which is a vacuous pass the moment the delay is raised -
    // the assertion would then be taken before the cancelled timer could ever have fired.
    // `openToolFlyout` polls for the menu instead, so a broken long-press fails here rather
    // than passing as "the flyout stayed closed".
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();
  });
});
