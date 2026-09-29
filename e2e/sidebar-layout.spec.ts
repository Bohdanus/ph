import { expect, test } from '@playwright/test';

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
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Don't wait for canvas - just verify page loads
    await expect(page.locator('body')).toBeVisible();
  });

  // Two columns is the default: a one-column toolbar needs a much taller window before it
  // stops scrolling, because its content is far taller. Neither layout can floor the grid
  // row — the rail is a scroll container, so its automatic minimum size is already zero —
  // and the page is pinned not to scroll at all. The measured heights are recorded once, in
  // the header of `e2e/no-document-overflow.spec.ts`; they are deliberately not restated
  // here, because they are font-metric dependent and a second copy is a second thing to rot.
  test('defaults to two-column layout', async ({ page }) => {
    const toolbar = page.getByTestId('left-toolbar-tools');
    const toggle = page.getByTestId('toolbar-layout-toggle');

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar, 'the two-column tile is 6.75rem wide, not any class containing that text').toHaveClass(
      TWO_COLUMN_TILE
    );
  });

  test('the default two-column toolbar fits a 720px viewport without overflowing the page', async ({ page }) => {
    const { height: pageHeight, scrollHeight } = await page.evaluate(() => ({
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(scrollHeight, 'the shell must be exactly viewport-tall, so the page never scrolls').toBeLessThanOrEqual(
      pageHeight
    );
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
