import { test, expect } from '@playwright/test';
import { setForegroundColor } from './color-helpers';

test.describe('Color Helpers', () => {
  test.describe('setForegroundColor', () => {
    test('sets color input value and dispatches events', async ({ page }) => {
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch" style="background-color: rgb(0, 0, 0)"></div>
      `);

      await setForegroundColor(page, '#ff0000', false);

      const inputValue = await page.locator('[data-testid="foreground-color-input"]').inputValue();
      expect(inputValue).toBe('#ff0000');
    });

    test('verifies swatch color when verifySwatch is true', async ({ page }) => {
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch" style="background-color: rgb(255, 0, 0)"></div>
      `);

      await setForegroundColor(page, '#ff0000', true);
    });

    test('does not throw when input not found', async ({ page }) => {
      await page.setContent('<div>No input here</div>');

      await expect(setForegroundColor(page, '#ff0000', false)).resolves.toBeUndefined();
    });

    test('handles various hex formats', async ({ page }) => {
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000"
          oninput="document.querySelector('[data-testid=foreground-color-swatch]').style.backgroundColor = this.value">
        <div data-testid="foreground-color-swatch" style="background-color: rgb(0, 0, 0)"></div>
      `);

      const input = page.locator('[data-testid="foreground-color-input"]');
      const swatch = page.locator('[data-testid="foreground-color-swatch"]');
      await expect(swatch).toHaveCSS('background-color', 'rgb(0, 0, 0)');

      await setForegroundColor(page, '#00ff00', true);

      await expect(swatch).toHaveCSS('background-color', 'rgb(0, 255, 0)');
      await expect(input).toHaveValue('#00ff00');
    });
  });
});
