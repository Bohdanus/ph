import { type Locator, type Page, expect } from '@playwright/test';

type ColorChannels = { r: number; g: number; b: number };

const HEX_DIGITS_ONLY = /^[0-9a-f]+$/i;

const doubleDigits = (digits: string): string =>
  digits
    .split('')
    .map((digit) => digit + digit)
    .join('');

/**
 * Rounds a channel to the nearest 0-255 integer and formats it as a hex pair.
 * Rounding is the tolerance: a computed value that is correct but expressed in
 * another unit (`color(srgb 1 0 0)`, a percentage, a sub-1/255 float) still
 * lands on the same pair as the colour that was asked for.
 */
const toHexPair = (channel: number): string => Math.round(channel).toString(16).padStart(2, '0');

/** The only shape `<input type="color">` stores, and the form the swatch is compared in. */
const toSimpleColor = ({ r, g, b }: ColorChannels): string => `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;

const CHANNEL_TOKEN = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?/gi;

/**
 * The two notations scale a channel differently: in `rgb()` a bare number is
 * already a 0-255 channel and only a percentage needs scaling, while in
 * `color(srgb …)` both forms are a 0-1 fraction of 255.
 */
const RGB_CHANNEL_UNITS = { numberMax: 1, percentageMax: 255 } as const;
const SRGB_CHANNEL_UNITS = { numberMax: 255, percentageMax: 255 } as const;

type ChannelUnits = { readonly numberMax: number; readonly percentageMax: number };

const toChannel = (token: string, units: ChannelUnits): number => {
  const raw = Number.parseFloat(token);
  const value = token.trim().endsWith('%') ? (raw / 100) * units.percentageMax : raw * units.numberMax;
  return Math.min(255, Math.max(0, value));
};

/**
 * Reads the three colour channels out of a computed `background-color`, so the
 * comparison is per channel rather than against a formatted string: the browser
 * is free to serialise the same colour as `rgb(255, 0, 0)`,
 * `rgb(100% 0% 0%)` or `color(srgb 1 0 0)`, and an animation in flight makes it
 * change between reads. Alpha is deliberately ignored — a swatch drawn at
 * partial opacity still carries the colour that was set.
 */
const parseComputedChannels = (computed: string): ColorChannels => {
  // `color(srgb …)` nests its name inside the function, `rgb()`/`rgba()` do not,
  // so the notation is normalised to a bare parenthesised argument list first.
  const isSrgbFunction = /^color\(\s*srgb\s/i.test(computed);
  const argumentList = computed.replace(/^color\(\s*srgb\s*/i, '(').replace(/^rgba?\s*/i, '');
  const match = argumentList.match(/^\s*\(([^)]*)\)\s*$/i);
  if (!match) {
    throw new Error(`setForegroundColor: cannot read colour channels from computed value "${computed}"`);
  }
  const units = isSrgbFunction ? SRGB_CHANNEL_UNITS : RGB_CHANNEL_UNITS;
  const [first, second, third] = (match[1].match(CHANNEL_TOKEN) ?? []).slice(0, 3);
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error(`setForegroundColor: computed value "${computed}" has fewer than three channels`);
  }
  return {
    r: toChannel(first, units),
    g: toChannel(second, units),
    b: toChannel(third, units),
  };
};

const readComputedBackgroundColor = (element: Locator): Promise<string> =>
  element.evaluate((node) => window.getComputedStyle(node).backgroundColor);

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== 'string' || hex.trim().length === 0) {
    throw new Error('hexToRgb: expected a non-empty string');
  }
  let cleanHex = hex.trim().replace(/^#/, '');
  if (cleanHex.length === 3) {
    // #rgb shorthand: every digit doubles.
    cleanHex = doubleDigits(cleanHex);
  } else if ((cleanHex.length === 4 || cleanHex.length === 8) && HEX_DIGITS_ONLY.test(cleanHex)) {
    // #rgba and #rrggbbaa carry an alpha byte that is dropped rather than
    // doubled. The dropped digits are checked first: `#ff0zz` is not the
    // shorthand for `#ffff00`, and expanding it anyway would report a colour
    // the caller never asked for.
    cleanHex = cleanHex.length === 4 ? doubleDigits(cleanHex.slice(0, 3)) : cleanHex.slice(0, 6);
  }
  if (cleanHex.length !== 6) {
    throw new Error(`hexToRgb: expected 3, 4, 6 or 8 hex digits, got "${cleanHex}"`);
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
  // Pre-flight. A colour input sanitises an invalid value to `#000000` instead
  // of rejecting it, so a typo would be written, reported as applied, and only
  // discovered by the pixel assertions. hexToRgb is the single parser for every
  // accepted notation; the result is expanded to the `#rrggbb` simple colour the
  // DOM can actually store, so a shorthand or an alpha-carrying form is not
  // silently rewritten to black on the way in.
  const expected = toSimpleColor(hexToRgb(hex));

  await page.evaluate((color) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="foreground-color-input"]');
    if (!(input instanceof window.HTMLInputElement)) {
      throw new Error('setForegroundColor: no HTMLInputElement matched [data-testid="foreground-color-input"]');
    }
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor || !descriptor.set) {
      throw new Error('Native value setter not found on HTMLInputElement.prototype');
    }
    descriptor.set.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, expected);

  if (verifySwatch) {
    const swatch = page.locator('[data-testid="foreground-color-swatch"]');
    await expect
      .poll(async () => toSimpleColor(parseComputedChannels(await readComputedBackgroundColor(swatch))), {
        message: `Foreground swatch background-color should be ${expected}`,
      })
      .toBe(expected);
  }
}
