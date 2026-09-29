import { expect, test } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';

/**
 * `toHaveClass(/…/)` runs its regex against `classList.toString()` — the element's
 * WHOLE class list, not one token — so an unanchored `/w-14/` is satisfied by
 * `w-14.5`, `w-140` and `min-w-14` equally, and a reader auditing for default-drift
 * would take it as a statement about the tile's width. Anchoring on a whitespace
 * boundary is what makes each of these name one class and only that class.
 */
const ONE_COLUMN_TILE = /(^|\s)w-14(\s|$)/;
const TWO_COLUMN_TILE = /(^|\s)w-\[6\.75rem\](\s|$)/;

test.describe('SidebarLeft - Layout Toggle (fast)', () => {
  // The 720px viewport the fit test below names, declared on the describe rather than set
  // inside the test. `devices['Desktop Chrome']` is 1280x720 today, so a `setViewportSize`
  // to that same size is a no-op against this config that still fires a real resize at a
  // mounted app — and none of the file's other four tests do that. A `test.use` here makes
  // the size true by construction and fires nothing.
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigation, not the app: `body` is visible on a blank document and on a Vite error
    // overlay too. The guard that needs a mounted app is each test's own locator.
    await expect(page.locator('body')).toBeVisible();
  });

  // Two columns is the default: a one-column toolbar is as tall as the whole tool list, and
  // that min-content height becomes the grid row floor, dragging the `h-full` canvas up and
  // overflowing a 720px viewport (e2e/OPEN_PROBLEMS.md P1).
  test('defaults to two-column layout', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar, 'the two-column tile is 6.75rem wide, not any class containing that text').toHaveClass(
      TWO_COLUMN_TILE
    );
  });

  test('the default two-column toolbar fits a 720px viewport without overflowing the page', async ({ page }) => {
    // The metrics below are page-level, so a blank page satisfies them without a toolbar
    // having been laid out at all. The canvas is what the toolbar is being measured against.
    await expect(getWorkspaceCanvas(page)).toBeVisible();

    const { height: pageHeight, scrollHeight } = await page.evaluate(() => ({
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(
      scrollHeight,
      'a toolbar taller than the viewport floors the grid row and drags the canvas up'
    ).toBeLessThanOrEqual(pageHeight);
  });

  test('toggles to one-column layout', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toolbar, 'the one-column tile is w-14, which is not the same class as w-140 or min-w-14').toHaveClass(
      ONE_COLUMN_TILE
    );
  });

  test('toggles back to two-column', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await toggle.click();
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar, 'toggling back must restore the two-column tile, not merely any w- class').toHaveClass(
      TWO_COLUMN_TILE
    );
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
