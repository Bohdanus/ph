import { test, expect } from '@playwright/test';

test('check dpr', async ({ page }) => {
  await page.goto('/');
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  expect(dpr).toBeGreaterThanOrEqual(1);
});
