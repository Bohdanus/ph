import { describe, expect, it } from 'vitest';

import {
  NON_TEXT_FLOOR,
  UnreadableColorError,
  compositeOver,
  contrastRatio,
  contrastRatioOver,
  flattenBackgrounds,
  contrastRatioUnderFilter,
  formatRatio,
  parseColor,
  parseFilter,
  relativeLuminance,
  textContrastFloor,
} from '../contrast.ts';

const rgb = (value: string) => parseColor(value);

describe('parseColor', () => {
  it('reads rgb() as OPAQUE, which is the alpha getComputedStyle leaves implicit', () => {
    // The bug this guards: reading `rgb(31, 41, 55)` as translucent makes every ratio computed
    // against it wrong, in the direction that flatters the result.
    expect(rgb('rgb(31, 41, 55)')).toEqual({ r: 31, g: 41, b: 55, a: 1 });
    expect(rgb('rgba(31, 41, 55, 0.6)').a).toBeCloseTo(0.6);
  });

  it('reads an explicit alpha, and the space-separated form Chrome uses', () => {
    expect(rgb('rgba(255, 255, 255, 0.5)').a).toBeCloseTo(0.5);
    expect(rgb('rgb(31 41 55 / 0.4)').a).toBeCloseTo(0.4);
  });

  it('reads oklab(), which is how Chrome reports every color-mix in this repository', () => {
    // `dark:bg-blue-500/20` on a selected tool tile comes back in this exact form. A parser that only
    // knows `rgb()` reads it as nothing at all, and the background then falls through the whole
    // ancestor chain to the white default — which is how an active tile was first reported as
    // 1.54:1, a number about no pair of colours on screen.
    const parsed = rgb('oklab(0.559564 -0.00175945 -0.0190281 / 0.891447)');
    expect(parsed.a).toBeCloseTo(0.891447, 6);
    // It is a DESATURATED BLUE, which is what `blue-500` at 20% is: in OKLab a negative `b` is the
    // blue direction, and the channel order b > g > r is the check that both axes were applied rather
    // than dropped. Reading it as a neutral grey would pass a looser assertion and lose the hue.
    expect(parsed.b).toBeGreaterThan(parsed.g);
    expect(parsed.g).toBeGreaterThan(parsed.r);
    // A mid lightness, so it lands in the middle of the channel range rather than at either end.
    expect(parsed.r).toBeGreaterThan(90);
    expect(parsed.r).toBeLessThan(140);
  });

  it('reads oklab() neutrally when both chromatic axes are zero', () => {
    // The same check against a colour with no chroma, which is the case that would catch an
    // implementation returning the lightness as three identical channels.
    const neutral = rgb('oklab(0.5 0 0)');
    expect(neutral.r).toBeCloseTo(neutral.g, 0);
    expect(neutral.g).toBeCloseTo(neutral.b, 0);
  });

  it('reads oklch(), the polar form of the same space', () => {
    // oklch(0.6 0.2 30deg) is a saturated orange; its luminance must land BELOW its own lightness,
    // which is the check that the hue was applied rather than dropped.
    const orange = rgb('oklch(0.6 0.2 30)');
    expect(orange.r).toBeGreaterThan(orange.b);
    expect(relativeLuminance(orange)).toBeLessThan(0.6);
    // The same colour at zero chroma is neutral, and its channels agree.
    const neutral = rgb('oklch(0.6 0 30)');
    expect(Math.abs(neutral.r - neutral.g)).toBeLessThan(3);
    expect(Math.abs(neutral.g - neutral.b)).toBeLessThan(3);
  });

  it('reads a percentage component as a fraction, so oklab(50% …) means 0.5', () => {
    const half = rgb('oklab(50% 0 0)');
    expect(Math.abs(half.r - half.g)).toBeLessThan(3);
    expect(relativeLuminance(half)).toBeCloseTo(relativeLuminance(rgb('oklab(0.5 0 0)')), 6);
  });

  it('clamps an out-of-gamut colour rather than returning a negative channel', () => {
    const wild = rgb('oklab(0.5 0.9 -0.9)');
    for (const channel of [wild.r, wild.g, wild.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it('treats `transparent` as a colour that composites to nothing', () => {
    expect(rgb('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('REFUSES a colour it cannot read, rather than defaulting it away', () => {
    // The failure this prevents is silent: a default makes a ratio computable from a pair the user
    // never sees, and the spec passes or fails on a number that means nothing.
    expect(() => rgb('not-a-colour')).toThrow(UnreadableColorError);
    expect(() => rgb('')).toThrow(UnreadableColorError);
    expect(() => rgb('color(display-p3 1 0 0)')).toThrow(UnreadableColorError);
  });
});

describe('compositeOver', () => {
  it('leaves an opaque source untouched', () => {
    expect(compositeOver({ r: 10, g: 20, b: 30, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
  });

  it('mixes a translucent source toward the backdrop in straight alpha', () => {
    // 50% white on black is mid grey, not 255.
    const result = compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
    expect(result.r).toBeCloseTo(127.5);
    expect(result.a).toBe(1);
  });
});

describe('flattenBackgrounds', () => {
  it('resolves a nearest-first chain to the colour actually behind the top one', () => {
    // The rail tile case: the tile's own fill at 60% over the rail behind it.
    const rail = rgb('rgb(31, 41, 55)');
    const tile = rgb('rgba(17, 24, 39, 0.6)');
    const flattened = flattenBackgrounds([tile, rail]);

    // 0.6 x 17 + 0.4 x 31 = 22.6, 0.6 x 24 + 0.4 x 41 = 30.8, 0.6 x 39 + 0.4 x 55 = 45.4. Compared
    // closely because these are exact tenths of integers and the point is the arithmetic itself —
    // a per-channel mix that dropped the `0.4 x backdrop` term would pass a looser comparison.
    expect(flattened.r).toBeCloseTo(22.6, 10);
    expect(flattened.g).toBeCloseTo(30.8, 10);
    expect(flattened.b).toBeCloseTo(45.4, 10);
    expect(flattened.a).toBe(1);
    expect(flattened.r).toBeLessThan(rail.r);
  });

  it('ignores a fully transparent layer, which paints nothing', () => {
    const rail = rgb('rgb(31, 41, 55)');
    expect(flattenBackgrounds([rgb('rgba(0, 0, 0, 0)'), rail])).toEqual({ r: 31, g: 41, b: 55, a: 1 });
  });

  it('resolves an empty chain to white, the document canvas', () => {
    expect(flattenBackgrounds([])).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio(rgb('rgb(0, 0, 0)'), rgb('rgb(255, 255, 255)'))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb('rgb(31, 41, 55)'), rgb('rgb(31, 41, 55)'))).toBeCloseTo(1, 5);
  });

  it('is SYMMETRIC, so a test cannot pass by swapping the pair', () => {
    const a = contrastRatio(rgb('rgb(17, 24, 39)'), rgb('rgb(31, 41, 55)'));
    const b = contrastRatio(rgb('rgb(31, 41, 55)'), rgb('rgb(17, 24, 39)'));
    expect(a).toBeCloseTo(b, 10);
  });

  it('reproduces the ratios quoted in the Ruler bar and the rail stylesheet', () => {
    // The defect the dark-theme work fixed: `CLEAR_CLASS` carried no text colour, so it inherited the
    // user agent's `canvastext` — black — and was drawn black on the dark bar. Note that a ratio can
    // be BELOW 1 only by inverting the pair; black on near-black is 1.43:1, which is the arithmetic
    // that says "slightly worse than invisible" rather than "inverted".
    expect(contrastRatio(rgb('rgb(0, 0, 0)'), rgb('rgb(31, 41, 55)'))).toBeCloseTo(1.43, 1);
    // The replacement, `dark:text-gray-200` on `dark:bg-gray-700`.
    expect(contrastRatio(rgb('rgb(229, 231, 235)'), rgb('rgb(55, 65, 81)'))).toBeCloseTo(8.33, 1);
    // The recessed readout field's boundary, `dark:border-gray-500` on the `dark:bg-gray-800` bar.
    expect(contrastRatio(rgb('rgb(107, 114, 128)'), rgb('rgb(31, 41, 55)'))).toBeCloseTo(3.04, 1);
    // The rail header glyph, `text-gray-500` at 4.39 failing and `text-gray-600` at 6.87 clearing.
    expect(contrastRatio(rgb('rgb(107, 114, 128)'), rgb('rgb(243, 244, 246)'))).toBeCloseTo(4.39, 1);
    expect(contrastRatio(rgb('rgb(75, 85, 99)'), rgb('rgb(243, 244, 246)'))).toBeCloseTo(6.87, 1);
  });

  it('measures a translucent foreground against what is behind it, not against its own channels', () => {
    // 40% grey-200 over the dark rail: this is the dimmed unimplemented tool.
    const dimmed = contrastRatioOver(rgb('rgba(229, 231, 235, 0.4)'), [rgb('rgb(31, 41, 55)')]);
    const naive = contrastRatio(rgb('rgba(229, 231, 235, 0.4)'), rgb('rgb(31, 41, 55)'));
    expect(dimmed).toBeCloseTo(naive, 10);
    expect(dimmed).toBeGreaterThan(1);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance(rgb('rgb(0, 0, 0)'))).toBeCloseTo(0, 10);
    expect(relativeLuminance(rgb('rgb(255, 255, 255)'))).toBeCloseTo(1, 10);
  });

  it('uses the 0.04045 linearisation breakpoint rather than a plain power curve', () => {
    // Below the breakpoint the standard divides by 12.92; above it it applies the 2.4 power with the
    // 0.055 offset. A plain 2.4 power gives this channel a different value, so this pins the branch.
    expect(relativeLuminance({ r: 10, g: 10, b: 10, a: 1 })).toBeCloseTo(10 / 255 / 12.92, 10);
    expect(relativeLuminance({ r: 128, g: 128, b: 128, a: 1 })).toBeGreaterThan(0.2);
  });
});

describe('textContrastFloor', () => {
  it('asks 4.5 of ordinary text and 3.0 of large text, by WCAG PX definition of large', () => {
    expect(textContrastFloor(12, 400)).toBe(4.5);
    expect(textContrastFloor(10, 700)).toBe(4.5);
    // 24px REGULAR is large; 18px regular is not.
    expect(textContrastFloor(24, 400)).toBe(3);
    expect(textContrastFloor(18, 400)).toBe(4.5);
    // 18.66px BOLD is large; 16px bold is not. WCAG states the thresholds in points — 18pt and 14pt —
    // and its own note converts them, so the POINT numbers are not the pixel numbers.
    expect(textContrastFloor(18.66, 700)).toBe(3);
    expect(textContrastFloor(16, 700)).toBe(4.5);
  });

  it('does not hand out the lenient floor inside the 14-24px band, which is where the error was', () => {
    // The bug this pins: the thresholds were the POINT values read as pixels, so everything from 14px
    // up got 3.0. A helper documented as WCAG's rule cannot quietly apply the wrong half of it.
    for (const size of [14, 16, 18, 20, 23]) {
      expect(textContrastFloor(size, 400), `${size}px regular is ordinary text`).toBe(4.5);
    }
    for (const size of [14, 16, 18]) {
      expect(textContrastFloor(size, 700), `${size}px bold is ordinary text`).toBe(4.5);
    }
  });

  it('never asks less than the non-text floor for anything', () => {
    expect(textContrastFloor(400, 900)).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
  });
});

describe('formatRatio', () => {
  it('quotes two decimal places, matching the figures written in source comments', () => {
    expect(formatRatio(3.0441)).toBe('3.04:1');
    expect(formatRatio(0.6963)).toBe('0.70:1');
  });
});

describe('parseFilter', () => {
  it('reads the two components the dim uses, in either order', () => {
    expect(parseFilter('opacity(0.55) grayscale(1)')).toEqual({ opacity: 0.55, grayscale: 1 });
    expect(parseFilter('grayscale(1) opacity(0.4)')).toEqual({ opacity: 0.4, grayscale: 1 });
  });

  it('treats `none` and an empty value as the identity', () => {
    expect(parseFilter('none')).toEqual({ opacity: 1, grayscale: 0 });
    expect(parseFilter('')).toEqual({ opacity: 1, grayscale: 0 });
  });

  it('ignores a component it does not model rather than failing on it', () => {
    // A blur changes the pixels without changing the contrast, so refusing to model it would make
    // this file fail on a filter that is not its subject.
    expect(parseFilter('opacity(0.55) grayscale(1) blur(1px)')).toEqual({ opacity: 0.55, grayscale: 1 });
  });
});

describe('contrastRatioUnderFilter', () => {
  const rail = rgb('rgb(31, 41, 55)');
  const transparent = rgb('rgba(0, 0, 0, 0)');

  it('is the plain ratio when there is no filter', () => {
    const chain = [rgb('rgb(55, 65, 81)'), rail];
    expect(contrastRatioUnderFilter(rgb('rgb(229, 231, 235)'), chain, { opacity: 1, grayscale: 0 })).toBeCloseTo(
      contrastRatioOver(rgb('rgb(229, 231, 235)'), chain),
      10
    );
  });

  it('models the dim, and the dark flyout row is what moved the fraction', () => {
    const chain = [transparent, rail];
    const rowLabel = rgb('rgb(229, 231, 235)');
    const at40 = contrastRatioUnderFilter(rowLabel, chain, { opacity: 0.4, grayscale: 1 });
    const at55 = contrastRatioUnderFilter(rowLabel, chain, { opacity: 0.55, grayscale: 1 });

    // These are the figures `SidebarLeft.scss` and `docs/OVERRIDES.md` quote, so a change to either the
    // filter or the modelling shows up as a failing number here rather than as a comment that has
    // quietly stopped being true.
    expect(formatRatio(at40)).toBe('3.17:1');
    expect(formatRatio(at55)).toBe('4.68:1');
    // And the direction: a dim at a higher fraction is always more legible.
    expect(at55).toBeGreaterThan(at40);
  });

  it('uses the element background TWICE: once as its fill, once as what it fades onto', () => {
    // With a transparent own background the surface lands on the rail. With an opaque one the element
    // paints it and then fades toward the rail, which is a different surface and a different ratio —
    // so an implementation that flattened the chain once and used it for both would pass the
    // transparent case and fail this one.
    const transparentRow = contrastRatioUnderFilter(rgb('rgb(229, 231, 235)'), [transparent, rail], {
      opacity: 0.55,
      grayscale: 1,
    });
    const activeRow = contrastRatioUnderFilter(rgb('rgb(219, 234, 254)'), [rgb('rgb(59, 130, 246)'), rail], {
      opacity: 0.55,
      grayscale: 1,
    });
    expect(activeRow).not.toBeCloseTo(transparentRow, 2);
  });

  it('ignores hue when grayscale is 1, so a blue row reads as the grey it is painted as', () => {
    const blue = rgb('rgb(59, 130, 246)');
    // NOT mid-grey: `grayscale(1)` replaces every channel with the weighted luminance
    // `0.2126 R + 0.7152 G + 0.0722 B`, which for this blue is 123 — the same coefficients the
    // filter specification uses. Using 128 here would be a plausible-looking value that is not the
    // one a browser paints, and the assertion would pass only by accident of rounding.
    const luminance = 0.2126 * blue.r + 0.7152 * blue.g + 0.0722 * blue.b;
    const asGrey = { r: luminance, g: luminance, b: luminance, a: 1 };
    expect(contrastRatioUnderFilter(blue, [transparent, rail], { opacity: 0.55, grayscale: 1 })).toBeCloseTo(
      contrastRatioUnderFilter(asGrey, [transparent, rail], { opacity: 0.55, grayscale: 1 }),
      10
    );
    // And that grey is distinctly darker than mid-grey, which is why a saturated placeholder reads
    // darker once desaturated.
    expect(luminance).toBeLessThan(128);
  });
});
