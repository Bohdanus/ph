import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { clickToolButton, expectToolSelected } from './helpers/toolbar-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

async function openFitDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);

  const dialog = page.getByTestId('new-image-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('new-image-width-input').fill('800');
  await page.getByTestId('new-image-height-input').fill('600');
  await page.getByTestId('new-image-dialog-submit-button').click();
  await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);

  // Give the page back its input focus after the dialog closes.
  await clickToolButton(page, 'draw');
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

function viewTransform(page: Page) {
  return page.locator('.zoom-container').evaluate((node) => (node as HTMLElement).style.transform);
}

async function getFitMagnification(page: Page): Promise<number> {
  // Press Ctrl+0 to ensure fit on screen, then return the magnification
  await page.keyboard.press('Control+0');
  await expect.poll(() => viewTransform(page)).toBe('');
  return actualMagnification(page);
}

test.describe('View menu keyboard shortcuts', () => {
  test.use({ deviceScaleFactor: 2 });
  test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await openFitDocument(page);
  });

  test('Ctrl+0 / Cmd+0 triggers Fit on Screen', async ({ page }) => {
    // Zoom in first
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(2);

    // Ctrl+0 should fit on screen
    await page.keyboard.press('Control+0');
    await expect.poll(() => actualMagnification(page)).toBeLessThan(2.1);
    await expect.poll(() => viewTransform(page)).toBe('');
  });

  test('Ctrl+1 / Cmd+1 triggers 100% magnification (1 doc pixel = 1 device pixel)', async ({ page }) => {
    // Get the fit magnification as baseline
    const fitMagnification = await getFitMagnification(page);

    // Ctrl+1 should go to 100% (1:1 pixel mapping = magnification 1)
    await page.keyboard.press('Control+1');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 1);
    // 100% is smaller than fit for a document that fits in viewport
    expect(1).toBeLessThan(fitMagnification);
  });

  test('Ctrl++ / Cmd++ triggers Zoom In', async ({ page }) => {
    // Start at fit
    const fitMagnification = await getFitMagnification(page);

    // Ctrl++ should zoom in (increase magnification)
    await page.keyboard.press('Control++');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(fitMagnification);
  });

  test('Ctrl+= / Cmd+= triggers Zoom In (alternate)', async ({ page }) => {
    // Start at fit
    const fitMagnification = await getFitMagnification(page);

    // Ctrl+= should also zoom in
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(fitMagnification);
  });

  test('Ctrl+- / Cmd+- triggers Zoom Out', async ({ page }) => {
    // Get fit magnification first
    const fitMagnification = await getFitMagnification(page);

    // Zoom in first
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(fitMagnification + 0.1);

    const before = await actualMagnification(page);

    // Ctrl+- should zoom out
    await page.keyboard.press('Control+-');
    await expect.poll(() => actualMagnification(page)).toBeLessThan(before);
  });

  test('Meta key variants work on macOS', async ({ page }) => {
    const fitMagnification = await getFitMagnification(page);

    // Test with Meta key (Cmd on macOS)
    await page.keyboard.press('Meta+0');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(fitMagnification, 1);

    await page.keyboard.press('Meta+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(fitMagnification);

    await page.keyboard.press('Meta+-');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(fitMagnification, 1);

    await page.keyboard.press('Meta+1');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 1);
  });

  test('shortcuts ignored when input field is focused', async ({ page }) => {
    // Focus an input field (the new image dialog width input)
    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();

    // Handle discard prompt if it appears (boot document has unsaved bedrock layer)
    const discardDialog = page.getByTestId('confirm-dialog');
    if (await discardDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.getByRole('button', { name: 'Discard' }).click();
    }

    // Wait for dialog to appear
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();

    const widthInput = page.getByTestId('new-image-width-input');
    await expect(widthInput).toBeVisible();
    await widthInput.focus();

    const before = await actualMagnification(page);

    // These shortcuts should not work while input is focused
    await page.keyboard.press('Control+0');
    await page.keyboard.press('Control+1');
    await page.keyboard.press('Control++');
    await page.keyboard.press('Control+-');

    await page.waitForTimeout(100);

    const after = await actualMagnification(page);
    expect(after).toBeCloseTo(before, 1);

    // Close dialog
    await page.keyboard.press('Escape');
  });

  test('shortcuts work with text tool active but no text editing', async ({ page }) => {
    await clickToolButton(page, 'text');
    await expectToolSelected(page, 'text');

    const before = await actualMagnification(page);

    // Text tool selected but not editing - shortcuts should work
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(before);

    await page.keyboard.press('Control+-');
    await expect.poll(() => actualMagnification(page)).toBeCloseTo(before, 1);
  });
});

test.describe('View menu commands via header', () => {
  test.use({ deviceScaleFactor: 2 });
  test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await openFitDocument(page);
  });

  test('View > Fit on Screen resets view', async ({ page }) => {
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(2);

    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-fit-on-screen-button').click();

    await expect.poll(() => actualMagnification(page)).toBeLessThan(2.1);
    await expect.poll(() => viewTransform(page)).toBe('');
    await expect(page.getByTestId('header-view-menu')).not.toBeVisible();
  });

  test('View > 100% sets 1:1 pixel mapping', async ({ page }) => {
    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-100-percent-button').click();

    await expect.poll(() => actualMagnification(page)).toBeCloseTo(1, 1);
    await expect(page.getByTestId('header-view-menu')).not.toBeVisible();
  });

  test('View > Zoom In steps magnification', async ({ page }) => {
    await getFitMagnification(page);
    const before = await actualMagnification(page);

    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-zoom-in-button').click();

    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(before);
    await expect(page.getByTestId('header-view-menu')).not.toBeVisible();
  });

  test('View > Zoom Out steps magnification', async ({ page }) => {
    await page.keyboard.press('Control+=');
    await expect.poll(() => actualMagnification(page)).toBeGreaterThan(2);

    const before = await actualMagnification(page);

    await page.getByTestId('header-view-menu-button').click();
    await page.getByTestId('view-menu-zoom-out-button').click();

    await expect.poll(() => actualMagnification(page)).toBeLessThan(before);
    await expect(page.getByTestId('header-view-menu')).not.toBeVisible();
  });

  test('View menu items are enabled when an image is open', async ({ page }) => {
    await page.getByTestId('header-view-menu-button').click();

    await expect(page.getByTestId('view-menu-zoom-in-button')).toBeEnabled();
    await expect(page.getByTestId('view-menu-zoom-out-button')).toBeEnabled();
    await expect(page.getByTestId('view-menu-fit-on-screen-button')).toBeEnabled();
    await expect(page.getByTestId('view-menu-100-percent-button')).toBeEnabled();
  });
});
