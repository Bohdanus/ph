import { expect, showFirstUseTour, test } from './fixtures/extended-test';

const TOUR_SEEN_KEY = 'ph.firstUseTourSeen';

test('first-use tour is modal and can be hidden across the mobile viewport boundary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await showFirstUseTour(page);

  const tour = page.getByRole('dialog');
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('status')).toHaveText('Step 1 of 8: Move layers and pan');
  await expect(page.locator('.tool-highlight-pulse')).toHaveCount(1);
  await expect(page.locator('#root > div[inert]')).toHaveCount(1);

  await page.setViewportSize({ width: 500, height: 800 });
  await expect(tour).toHaveCount(0);
  await expect(page.locator('#root > div[inert]')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOUR_SEEN_KEY)).toBeNull();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), TOUR_SEEN_KEY)).toBe('true');
});

test('new badges sync across tabs and stay anchored to flyout rows', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/');
  await expect(page.getByTestId('tool-button-pen')).toBeVisible();
  await expect(page.getByTestId('tool-new-badge-pen')).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.setViewportSize({ width: 1280, height: 1400 });
  await otherTab.goto('/');
  await expect(otherTab.getByTestId('tool-button-pen')).toBeVisible();
  await expect(otherTab.getByTestId('tool-new-badge-pen')).toBeVisible();

  await page.getByTestId('tool-button-pen').hover();
  await expect(page.getByTestId('tool-new-badge-pen')).toHaveCount(0);
  await expect(otherTab.getByTestId('tool-new-badge-pen')).toHaveCount(0);

  await page.getByTestId('tool-button-pen').click({ button: 'right' });
  const freeformPen = page.getByRole('menuitemradio', { name: 'Freeform Pen Tool' });
  const badge = page.getByTestId('tool-new-badge-freeform-pen');
  await expect(badge).toBeVisible();
  expect(await badge.evaluate((element) => (element as HTMLElement).offsetParent === element.closest('button'))).toBe(
    true
  );

  await freeformPen.focus();
  await expect(badge).toHaveCount(0);
  await otherTab.close();
});
