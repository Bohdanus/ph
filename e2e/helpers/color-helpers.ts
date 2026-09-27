import { type Page, expect } from '@playwright/test';

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== 'string' || hex.trim().length === 0) {
    throw new Error('hexToRgb: expected a non-empty string');
  }
  let cleanHex = hex.trim().replace(/^#/, '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }
  if (cleanHex.length !== 6) {
    throw new Error(`hexToRgb: expected 3 or 6 hex digits, got "${cleanHex}"`);
  }
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`hexToRgb: invalid hex value "${hex}"`);
  }
  return { r, g, b };
}

export async function setForegroundColor(page: Page, hex: string, verifySwatch = false): Promise<void> {
  await page.evaluate((color) => {
    const input = document.querySelector('[data-testid="foreground-color-input"]') as HTMLInputElement;
    if (input) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (!descriptor || !descriptor.set) {
        throw new Error('Native value setter not found on HTMLInputElement.prototype');
      }
      descriptor.set.call(input, color);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, hex);

  if (verifySwatch) {
    const expectedRgb = hexToRgb(hex);
    await expect(page.locator('[data-testid="foreground-color-swatch"]')).toHaveCSS(
      'background-color',
      `rgb(${expectedRgb.r}, ${expectedRgb.g}, ${expectedRgb.b})`
    );
  }
}
