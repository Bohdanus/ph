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
 *
 * Rounding IS the whole comparison tolerance, and it is a wide one: half of an 8-bit step,
 * in each direction. Anything up to 0.5 of a step off is folded onto the integer the caller
 * asked for and verifies, so a computed value that is correct but expressed in another unit
 * — `color(srgb 1 0 0)`, `rgb(100% 0% 0%)`, a percentage landing between two integers —
 * lands on the same pair. Anything past 0.5 lands on the neighbouring integer and is
 * REJECTED, which is what stops a whole 8-bit step of real colour error from passing. The
 * two edges of that band are pinned by `__tests__/color-helpers.unit.test.ts`; the band is
 * stated here as half a step rather than as a "sub-1/255 float", which understated it by
 * two orders of magnitude.
 */
const toHexPair = (channel: number): string => Math.round(channel).toString(16).padStart(2, '0');

/** The only shape `<input type="color">` stores, and the form the swatch is compared in. */
const toSimpleColor = ({ r, g, b }: ColorChannels): string => `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;

const CHANNEL_TOKEN = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?/gi;

/** A single number or percentage, for the one alpha token a notation may carry. */
const ALPHA_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/;

/** The head of a colour function: its notation name and its argument list. */
const COLOR_FUNCTION = /^([a-z][a-z0-9-]*)\((.*)\)\s*$/i;

/** The leading colour space of a `color( … )` argument list. */
const COLOR_SPACE = /^\s*([a-z][a-z0-9-]*)\s*/i;

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
 * Alpha is a 0-1 scale in every notation, as a number or a percentage, and it
 * defaults to fully opaque when the notation omits it.
 */
const toAlpha = (token: string, computed: string): number => {
  const trimmed = token.trim();
  if (!ALPHA_TOKEN.test(trimmed)) {
    throw new Error(`setForegroundColor: cannot read the alpha of computed value "${computed}" from "${trimmed}"`);
  }
  const raw = Number.parseFloat(trimmed);
  return Math.min(1, Math.max(0, trimmed.endsWith('%') ? raw / 100 : raw));
};

/**
 * Splits an argument list into its three channels and the alpha that follows
 * them. Both spellings CSS allows are read: `255, 0, 0, 0.5` carries the alpha
 * as a fourth comma-separated argument, and `255 0 0 / 50%` carries it after a
 * slash.
 */
const splitAlpha = (argumentList: string): { readonly channels: string; readonly alpha?: string } => {
  const slash = argumentList.indexOf('/');
  if (slash >= 0) {
    return { channels: argumentList.slice(0, slash), alpha: argumentList.slice(slash + 1) };
  }
  const commaSeparated = argumentList.split(',');
  return commaSeparated.length === 4
    ? { channels: commaSeparated.slice(0, 3).join(','), alpha: commaSeparated[3] }
    : { channels: argumentList };
};

/**
 * Resolves a notation to the units its channels are expressed in, and returns the
 * argument list with the notation's own prefix removed. A notation that is not
 * `rgb()`, `rgba()` or `color(srgb …)` is named here, so it is never read as if
 * its numbers were sRGB channels.
 */
const readNotation = (
  name: string,
  argumentList: string,
  computed: string
): { readonly units: ChannelUnits; readonly channels: string } => {
  switch (name.toLowerCase()) {
    case 'rgb':
    case 'rgba':
      return { units: RGB_CHANNEL_UNITS, channels: argumentList };
    case 'color': {
      // The space is a leading identifier inside the argument list, and only
      // `srgb` states its channels in units this comparison can read.
      const space = COLOR_SPACE.exec(argumentList);
      if (space?.[1].toLowerCase() !== 'srgb') {
        throw new Error(
          `setForegroundColor: unsupported colour space "${space?.[1] ?? argumentList}" in computed value "${computed}"; only srgb carries channels a per-channel comparison can read`
        );
      }
      return { units: SRGB_CHANNEL_UNITS, channels: argumentList.slice(space[0].length) };
    }
    default:
      throw new Error(
        `setForegroundColor: unsupported colour notation "${name}()" in computed value "${computed}"; only rgb(), rgba() and color(srgb …) carry channels a per-channel comparison can read`
      );
  }
};

/**
 * Reads the colour channels out of a computed `background-color` so the
 * comparison is per channel rather than against a formatted string. Measured
 * against the browser this suite drives (`getComputedStyle` in Chrome), a
 * computed `background-color` is `rgb()`/`rgba()` in either the comma-separated
 * or the space-separated spelling, or `color(srgb …)` — which is what both a
 * `color(srgb …)` and a `color-mix(in srgb, …)` declaration computes to. Every
 * other notation is preserved verbatim by the browser (`oklch( … )`,
 * `lab( … )`, `color(srgb-linear … )`, `color(display-p3 … )`), and none of
 * their numbers are sRGB channels, so each is reported by name instead of being
 * read as one.
 *
 * Alpha decides whether the swatch carries the colour at all, and it is checked
 * here rather than compared. A swatch drawn at `0 < alpha < 1` — mid-animation,
 * translucent — still carries the colour that was set and verifies. A swatch at
 * `alpha = 0` paints nothing: that is the computed value of a background that
 * was never set, and of one covered by a `background-image`, so its channels
 * are the initial `0 0 0` rather than anything the caller asked for. Comparing
 * them would report a colour the swatch is not showing, which is why alpha 0 is
 * refused instead of passed.
 */
const parseComputedColor = (computed: string, expected: string): ColorChannels => {
  const refuseTransparent = (): never => {
    throw new Error(
      `setForegroundColor: foreground swatch computed "${computed}" at alpha 0, which paints nothing, so it cannot carry the expected colour "${expected}"`
    );
  };
  if (computed.trim().toLowerCase() === 'transparent') {
    return refuseTransparent();
  }
  const notation = COLOR_FUNCTION.exec(computed);
  if (!notation) {
    throw new Error(
      `setForegroundColor: cannot read colour channels from computed value "${computed}": not a colour function`
    );
  }
  const [, name, argumentList] = notation;
  const { units, channels: namedChannels } = readNotation(name, argumentList, computed);
  const { channels, alpha } = splitAlpha(namedChannels);
  const tokens = channels.match(CHANNEL_TOKEN) ?? [];
  if (tokens.length !== 3) {
    throw new Error(
      `setForegroundColor: cannot read three colour channels from ${name}() computed value "${computed}"`
    );
  }
  if (alpha !== undefined && toAlpha(alpha, computed) === 0) {
    return refuseTransparent();
  }
  return {
    r: toChannel(tokens[0], units),
    g: toChannel(tokens[1], units),
    b: toChannel(tokens[2], units),
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
      .poll(async () => toSimpleColor(parseComputedColor(await readComputedBackgroundColor(swatch), expected)), {
        message: `Foreground swatch background-color should be ${expected}`,
      })
      .toBe(expected);
  }
}
