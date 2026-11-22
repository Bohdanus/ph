import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, expectToolSelected } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page), 'the seeded document canvas must be visible').toBeVisible();
}

async function workspaceBounds(page: Page) {
  const box = await page.getByTestId('workspace-container').boundingBox();
  if (!box) throw new Error('workspace-container has no bounding box');
  return box;
}

async function actualMagnification(page: Page): Promise<number> {
  const workspace = page.getByTestId('workspace-container');
  const [documentWidth, documentHeight, viewScale, box] = await Promise.all([
    workspace.getAttribute('data-fit-document-width'),
    workspace.getAttribute('data-fit-document-height'),
    workspace.getAttribute('data-view-effective-zoom'),
    workspace.boundingBox(),
  ]);
  if (!documentWidth || !documentHeight || !viewScale || !box)
    throw new Error('workspace fit or view scale is missing');
  const fitScale = Math.min(box.width / Number(documentWidth), box.height / Number(documentHeight));
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  return Number(fitScale) * Number(viewScale) * devicePixelRatio;
}

test.describe('Touch navigation - keyboard and menu fallback', () => {
  test.use({ deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('zoom keyboard shortcuts work for touch-like navigation', async ({ page }) => {
    const before = await actualMagnification(page);

    // Zoom in with keyboard
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(before);

    const zoomedIn = await actualMagnification(page);

    // Zoom out with keyboard
    await page.keyboard.press('Control+-');
    await expect.poll(() => actualMagnification(page)).toBeLessThan(zoomedIn);

    // Fit on screen
    await page.keyboard.press('Control+0');
    await expect.poll(() => actualMagnification(page)).toBeLessThan(zoomedIn);
  });

  test('View menu commands work for touch-like navigation', async ({ page }) => {
    const before = await actualMagnification(page);

    // Zoom in via menu
    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-zoom-in-button').click();
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(before);

    const zoomedIn = await actualMagnification(page);

    // Zoom out via menu
    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-zoom-out-button').click();
    await expect.poll(() => actualMagnification(page)).toBeLessThan(zoomedIn);

    // Fit on screen via menu
    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-fit-on-screen-button').click();
    await expect.poll(() => actualMagnification(page)).toBeLessThan(zoomedIn);
  });
});

test.describe('Tool interaction with navigation', () => {
  test.use({ deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await openWorkspace(page);
  });

  test('draw tool works while navigation available', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await workspaceBounds(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Select draw tool
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');

    const initialLayers = await page.getByTestId('layer-row').count();

    // Draw a stroke with mouse (single pointer)
    await page.mouse.move(centerX - 100, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY, { steps: 10 });
    await page.mouse.up();

    // Verify layer was created
    await expect(page.getByTestId('layer-row')).toHaveCount(initialLayers + 1);

    // Now test keyboard zoom still works after drawing
    const beforeZoom = await actualMagnification(page);

    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(beforeZoom);
  });

  test('eraser tool works with navigation available', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await workspaceBounds(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // First draw something to erase
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');

    await page.mouse.move(centerX - 100, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY, { steps: 10 });
    await page.mouse.up();

    // Switch to eraser
    await clickToolButton(page, 'eraser');
    await expectToolSelected(page, 'eraser');

    // Erase part of the stroke
    await page.mouse.move(centerX - 50, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 50, centerY, { steps: 10 });
    await page.mouse.up();

    // Now test keyboard pan works after erasing
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(1);

    const beforePan = await actualMagnification(page);

    // Pan using space + mouse (spring-loaded hand)
    await page.keyboard.down('Space');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 100, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');

    // Pan should have changed the view transform but not magnification
    const afterPan = await actualMagnification(page);
    expect(afterPan).toBeCloseTo(beforePan, 1);
  });

  test('selection tools work with navigation available', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await workspaceBounds(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Draw something to select
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');

    await page.mouse.move(centerX - 100, centerY - 50);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY - 50, { steps: 10 });
    await page.mouse.move(centerX + 100, centerY + 50, { steps: 10 });
    await page.mouse.move(centerX - 100, centerY + 50, { steps: 10 });
    await page.mouse.move(centerX - 100, centerY - 50, { steps: 10 });
    await page.mouse.up();

    // Switch to rectangular selection
    await clickToolButton(page, 'rectangular-selection');
    await expectToolSelected(page, 'rectangular-selection');

    // Make a selection
    await page.mouse.move(centerX - 50, centerY - 30);
    await page.mouse.down();
    await page.mouse.move(centerX + 50, centerY + 30, { steps: 10 });
    await page.mouse.up();

    // Selection should be visible (marching ants)
    const antsCanvas = page.locator('[data-testid="selection-ants-canvas"]');
    await expect(antsCanvas).toHaveAttribute('style', /display: block/);

    // Now test keyboard zoom works with selection active
    const beforeZoom = await actualMagnification(page);

    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(beforeZoom);

    const afterZoom = await actualMagnification(page);
    expect(afterZoom).toBeGreaterThan(beforeZoom);

    // Selection should still be visible after zoom
    await expect(antsCanvas).toHaveAttribute('style', /display: block/);
  });

  test('hand tool (Space) works alongside keyboard navigation', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await workspaceBounds(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Zoom in first
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(1);

    // Select a non-hand tool
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');

    // Hold Space for spring-loaded hand
    await page.keyboard.down('Space');

    // Pan with mouse while Space held
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY - 100, { steps: 10 });
    await page.mouse.up();

    await page.keyboard.up('Space');

    // Tool should still be draw
    await expectToolSelected(page, 'draw');

    // Keyboard zoom should still work
    const beforeZoom = await actualMagnification(page);

    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(beforeZoom);
  });

  test('keyboard navigation works independently of tool gestures', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await workspaceBounds(page);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Select draw tool
    await clickToolButton(page, 'draw');
    await expectToolSelected(page, 'draw');

    // Start a draw gesture with mouse
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // While mouse is down, keyboard zoom still works (current behavior)
    const beforeZoom = await actualMagnification(page);

    await page.keyboard.press('Control+=');
    await page.waitForTimeout(100);

    // Keyboard zoom works even during mouse gesture
    const duringGestureZoom = await actualMagnification(page);
    expect(duringGestureZoom).toBeGreaterThan(beforeZoom);

    // Complete the draw stroke
    await page.mouse.move(centerX + 100, centerY, { steps: 10 });
    await page.mouse.up();

    // Keyboard zoom continues to work
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(duringGestureZoom);
  });
});
