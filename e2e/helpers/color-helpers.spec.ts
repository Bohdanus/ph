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
      // The swatch is seeded with a colour the helper is NOT asked to set. It used to
      // be seeded with the target, `rgb(255, 0, 0)`, which made the internal
      // `toHaveCSS` unsatisfiable-by-failure: a helper that did nothing at all would
      // still have read back the seeded value and passed. Nothing here asserts on its
      // own, so this test's whole strength is whether the value it checks for differs
      // from the value it started with.
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch" style="background-color: rgb(0, 128, 0)"></div>
      `);

      await setForegroundColor(page, '#ff0000', true);
    });

    test('throws when input not found', async ({ page }) => {
      await page.setContent('<div>No input here</div>');

      // A missing input used to be a silent no-op: the helper resolved as if it
      // had set the colour, so a renamed or absent testid could not fail a test.
      await expect(setForegroundColor(page, '#ff0000', false)).rejects.toThrow(
        'setForegroundColor: no HTMLInputElement matched [data-testid="foreground-color-input"]'
      );
    });

    test('verifies a colour the browser computes in a non-rgb notation', async ({ page }) => {
      // `color-mix` in srgb computes to `color(srgb …)`, so this is a real
      // non-`rgb()` computed value, not a fixture the app cannot produce.
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch"
          style="background-color: color-mix(in srgb, #ff0000 100%, #00ff00)"></div>
      `);

      const computed = await page
        .locator('[data-testid="foreground-color-swatch"]')
        .evaluate((node) => window.getComputedStyle(node).backgroundColor);
      expect(computed).toBe('color(srgb 1 0 0)');

      await setForegroundColor(page, '#ff0000', true);
    });

    test('refuses a fully transparent swatch', async ({ page }) => {
      // A swatch that never received the colour computes `rgba(0, 0, 0, 0)`,
      // and one covered by a `background-image` computes the same. Either way it
      // paints nothing, so it cannot satisfy the check for the colour that was
      // set. This is the case the pre-fix `toHaveCSS` rejected.
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch" style="background: linear-gradient(#ff0000, #00ff00)"></div>
      `);

      await expect(setForegroundColor(page, '#ff0000', true)).rejects.toThrow(
        'setForegroundColor: foreground swatch computed "rgba(0, 0, 0, 0)" at alpha 0, which paints nothing, so it cannot carry the expected colour "#ff0000"'
      );
    });

    test('reports an unsupported computed notation by name', async ({ page }) => {
      // `oklch()` is preserved verbatim by the browser, so a wide-gamut or
      // perceptual swatch reaches the comparison. It must name the notation
      // rather than read its numbers as sRGB channels.
      await page.setContent(`
        <input data-testid="foreground-color-input" type="color" value="#000000">
        <div data-testid="foreground-color-swatch" style="background-color: oklch(0.7 0.1 20)"></div>
      `);

      await expect(setForegroundColor(page, '#ff0000', true)).rejects.toThrow(
        'setForegroundColor: unsupported colour notation "oklch()" in computed value "oklch(0.7 0.1 20)"'
      );
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
