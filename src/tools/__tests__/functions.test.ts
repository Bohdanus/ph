import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIGHTNESS_SLIDER_RANGE,
  buildColorsFilter,
  buildLevelsFilter,
  CONTRAST_SLIDER_RANGE,
  expAdjustment,
  proportionateFactor,
  writeImageToCanvas,
} from '../functions.ts';

/**
 * The Colors chain's exponent, named here rather than exported: `buildColorsFilter`'s own
 * literal expectations above already pin the value the module actually uses, so widening
 * the module's API to let a test read it back would buy nothing.
 */
const SATURATION_EXPONENT = 2.1;

/**
 * These are the load-bearing literals of the whole filter contract. All four emission
 * sites — `colors.ts`, `levels.ts`, `layer-renderer.ts` (preview) and `materialization.ts`
 * (durable) — build their strings from these two functions, so pinning the strings here
 * pins all four at once. The defect this replaced was four independent copies of the same
 * template drifting apart; a site that stopped routing through here would fail its own
 * file's literal expectation instead of silently disagreeing with the other three.
 */
describe('buildColorsFilter', () => {
  it('emits the neutral as a 100% saturate, so the default args are a visual no-op', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: 0 })).toBe('grayscale(0%) sepia(0%) saturate(100%)');
  });

  it('desaturates: -100 emits saturate(0%), a genuinely grey image', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -100 })).toBe(
      'grayscale(0%) sepia(0%) saturate(0%)'
    );
  });

  it('keeps the % on grayscale and sepia, the two arms that were already correct', () => {
    expect(buildColorsFilter({ grayscale: 30, sepia: 80, saturation: 0 })).toBe(
      'grayscale(30%) sepia(80%) saturate(100%)'
    );
  });

  it('propagates a non-finite saturation into the emitted string', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: Number.NaN })).toBe(
      'grayscale(0%) sepia(0%) saturate(NaN%)'
    );
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: Number.POSITIVE_INFINITY })).toBe(
      'grayscale(0%) sepia(0%) saturate(Infinity%)'
    );
  });

  it('emits a saturate above 100% for a positive saturation', () => {
    expect(filterTerm(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: 100 }), 'saturate')).toBeGreaterThan(1);
  });

  it('emits a saturate between 0 and 1 for a mild negative saturation', () => {
    const factor = filterTerm(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -50 }), 'saturate');
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThan(1);
  });

  it('emits a negative saturate for saturation below the -100 floor', () => {
    expect(filterTerm(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -200 }), 'saturate')).toBeLessThan(0);
  });

  it('crosses zero exactly at -100, staying positive just above and negative just below', () => {
    expect(filterTerm(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -99 }), 'saturate')).toBeGreaterThan(0);
    expect(filterTerm(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: -101 }), 'saturate')).toBeLessThan(0);
  });

  it.fails('does not clamp NaN saturation to the neutral 100%', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: Number.NaN })).toBe(
      'grayscale(0%) sepia(0%) saturate(100%)'
    );
  });

  it.fails('does not clamp Infinity saturation to the neutral 100%', () => {
    expect(buildColorsFilter({ grayscale: 0, sepia: 0, saturation: Number.POSITIVE_INFINITY })).toBe(
      'grayscale(0%) sepia(0%) saturate(100%)'
    );
  });
});

/**
 * CSS filter-effects reads these as percentages: `brightness(f)` is a clamped pure
 * multiply, `contrast(f)` is `(in - 0.5) * f + 0.5` about mid-grey, and both results are
 * "clamped into the allowable ranges". <https://www.w3.org/TR/filter-effects-1/#feFuncBrightness>
 *
 * So a factor `f <= 1` can never move a value outside `[0, 1]`, and any `f > 1` clips some
 * input. These two return the WHOLE output range over the whole `[0, 1]` input domain, which
 * is what "non-clipping" means here: an emitted string whose range is inside `[0, 1]` is one
 * where the clamp never fires and no detail is lost to it.
 */
const cssBrightnessRange = (factor: number) => ({ min: 0, max: factor });
const cssContrastRange = (factor: number) => ({ min: 0.5 - 0.5 * factor, max: 0.5 + 0.5 * factor });

/** The numeric operand of a composed CSS filter term, e.g. `50` from `contrast(50%)`. */
const filterTerm = (filter: string, term: 'brightness' | 'contrast' | 'saturate'): number => {
  const match = new RegExp(`${term}\\(([^)]+)\\)`).exec(filter);
  if (!match) throw new Error(`filter "${filter}" is missing a ${term}() term`);
  return Number(match[1].replace('%', '')) / 100;
};

/** Every integer a slider in this tool can actually reach, inclusive. */
const sliderTravel = (range: { min: number; max: number }) => {
  const values: number[] = [];
  for (let value = range.min; value <= range.max; value += 1) values.push(value);
  return values;
};

describe('buildLevelsFilter', () => {
  it('emits the neutral as brightness(100%) contrast(100%), so the default args apply nothing', () => {
    // Load-bearing in four suites beyond this one: `tool-settings.test.ts`,
    // `materialization.assets.test.ts` and `util/settings.test.ts` all pin the default
    // `levels` args as the filter identity. A curve that did not land on exactly `1` at
    // zero would open every freshly opened document colour-shifted.
    expect(buildLevelsFilter({ brightness: 0, contrast: 0 })).toBe('brightness(100%) contrast(100%)');
  });

  it.each([
    ['-150', '0', '0'],
    ['-75', '50', '50'],
    ['-50', '66.67', '66.67'],
    ['-1', '99.33', '99.33'],
    ['+50', '133.33', '133.33'],
    ['+150', '200', '200'],
  ])('maps brightness %s to brightness(%s%), the full Adobe -150..150 travel', (brightness, emitted) => {
    const [factor] = parseLevelsFilter(buildLevelsFilter({ brightness: Number(brightness), contrast: 0 }));
    expect(factor).toBe(Number(emitted) / 100);
  });

  it.each([
    ['-50', '50'],
    ['-25', '75'],
    ['-1', '99'],
    ['+1', '101'],
    ['+100', '200'],
  ])('maps contrast %s to contrast(%s%), the full Adobe -50..100 travel', (contrast, emitted) => {
    const [, factor] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: Number(contrast) }));
    expect(factor).toBe(Number(emitted) / 100);
  });

  it('is proportionate: one slider step is the same factor step everywhere on the travel', () => {
    // What "proportionate" buys over the exponential this replaced, stated as one property
    // any non-linear curve breaks: equal slider steps produce equal factor steps. The
    // tolerance is the emission's own two-decimal resolution (`adjustmentPercent`), not a
    // fudge — a step that varied by more than 0.01% would be a visibly different feel at the
    // two ends of the slider.
    const brightnessSteps = sliderTravel(BRIGHTNESS_SLIDER_RANGE)
      .slice(0, -1)
      .map((brightness) => {
        const [lower] = parseLevelsFilter(buildLevelsFilter({ brightness, contrast: 0 }));
        const [higher] = parseLevelsFilter(buildLevelsFilter({ brightness: brightness + 1, contrast: 0 }));
        return higher - lower;
      });
    for (const step of brightnessSteps) {
      expect(step).toBeCloseTo(brightnessSteps[0], 3);
    }

    const contrastSteps = sliderTravel(CONTRAST_SLIDER_RANGE)
      .slice(0, -1)
      .map((contrast) => {
        const [, lower] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast }));
        const [, higher] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: contrast + 1 }));
        return higher - lower;
      });
    for (const step of contrastSteps) {
      expect(step).toBeCloseTo(contrastSteps[0], 3);
    }

    // And neither is zero, or "proportionate" would mean "inert".
    expect(brightnessSteps[0]).toBeGreaterThan(0);
    expect(contrastSteps[0]).toBeGreaterThan(0);
  });

  it('keeps the whole negative half of the Brightness travel non-clipping', () => {
    // Adobe's normal mode is non-clipping in both directions. Over this half the CSS
    // multiply is exactly that: `brightness(0%..100%)` maps `[0, 1]` into `[0, factor]` with
    // the clamp never firing, so no shadow detail is lost to it.
    for (const brightness of sliderTravel(BRIGHTNESS_SLIDER_RANGE).filter((value) => value <= 0)) {
      const [factor] = parseLevelsFilter(buildLevelsFilter({ brightness, contrast: 0 }));
      const range = cssBrightnessRange(factor);

      expect(range.min, `brightness ${brightness} lifts a black pixel`).toBeGreaterThanOrEqual(0);
      expect(range.max, `brightness ${brightness} lifts a white pixel past white`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the whole negative half of the Contrast travel non-clipping', () => {
    // `contrast(f)` for `f <= 1` contracts the tonal range about the mid-grey pivot without
    // ever leaving `[0, 1]`, which is precisely what Adobe's contrast minimum does.
    for (const contrast of sliderTravel(CONTRAST_SLIDER_RANGE).filter((value) => value <= 0)) {
      const [, factor] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast }));
      const range = cssContrastRange(factor);

      expect(range.min, `contrast ${contrast} clips a black pixel`).toBeGreaterThanOrEqual(0);
      expect(range.max, `contrast ${contrast} clips a white pixel`).toBeLessThanOrEqual(1);
    }
  });

  it('flattens Contrast -50 to a half-range rather than collapsing the image to one mid-grey', () => {
    // The defect this replaced. `expAdjustment(contrast, 2.2)` bottoms out at exactly `0`,
    // so the old `-100` floor emitted `contrast(0%)` — every pixel became the same grey and
    // the image carried no information at all. Adobe names that as the Legacy failure:
    // "this can cause clipping or loss of image detail in highlight or shadow areas".
    const [, factor] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: CONTRAST_SLIDER_RANGE.min }));
    const range = cssContrastRange(factor);

    expect(factor).toBe(0.5);
    expect(range.min).toBeGreaterThan(0);
    expect(range.max).toBeLessThan(1);
    // Strictly contracting, so distinct inputs stay distinct: this is what separates
    // "reduced contrast" from "no contrast".
    expect(range.max - range.min).toBeLessThan(1);
  });

  it('keeps the mid-grey pivot fixed at every Contrast value, the pivot Photoshop expands about', () => {
    for (const contrast of sliderTravel(CONTRAST_SLIDER_RANGE)) {
      const [, factor] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast }));

      expect((0.5 - 0.5) * factor + 0.5).toBe(0.5);
    }
  });

  it('is strictly monotone over both Adobe travels, so no slider step is a no-op', () => {
    for (const brightness of sliderTravel(BRIGHTNESS_SLIDER_RANGE)) {
      const [lower] = parseLevelsFilter(buildLevelsFilter({ brightness, contrast: 0 }));
      const [higher] = parseLevelsFilter(buildLevelsFilter({ brightness: brightness + 1, contrast: 0 }));

      expect(higher, `brightness ${brightness} does nothing`).toBeGreaterThan(lower);
    }

    for (const contrast of sliderTravel(CONTRAST_SLIDER_RANGE)) {
      const [, lower] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast }));
      const [, higher] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: contrast + 1 }));

      expect(higher, `contrast ${contrast} does nothing`).toBeGreaterThan(lower);
    }
  });

  it('clips on the positive half of both controls, which is the boundary this pipeline cannot cross', () => {
    // Recorded rather than papered over: Adobe's normal mode does NOT clip in either
    // direction, and its response is nonlinear (`+20` brightness reads `10→11`, `128→145`,
    // `250→253` — no constant scale and no constant offset produces that). A CSS
    // `brightness(f)` is a clamped pure multiply and `contrast(f)` a clamped affine pivot,
    // so every `f > 1` clips some input. Closing this needs a per-channel lookup table
    // applied per pixel, the mechanism `docs/TOOLS-TOO-HARD.md` records as absent.
    const [bright] = parseLevelsFilter(buildLevelsFilter({ brightness: BRIGHTNESS_SLIDER_RANGE.max, contrast: 0 }));
    const [, punch] = parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: CONTRAST_SLIDER_RANGE.max }));

    expect(cssBrightnessRange(bright).max).toBeGreaterThan(1);
    expect(cssContrastRange(punch).max).toBeGreaterThan(1);
    // The first positive step is the first clip: the neutral is the largest non-clipping
    // value on each control.
    expect(bright).toBeGreaterThan(1);
    expect(punch).toBeGreaterThan(1);
  });

  it('propagates a non-finite adjustment into the emitted string rather than sanitising it', () => {
    // `presentation-evaluator.ts` — `numericFilterArg()` owns the refusal. The `it.fails`
    // tripwire in `image-processors.test.ts` asserts that nothing upstream quietly turns a
    // non-finite value into a number, so this must stay `NaN`.
    expect(buildLevelsFilter({ brightness: Number.NaN, contrast: 0 })).toBe('brightness(NaN%) contrast(100%)');
    expect(buildLevelsFilter({ brightness: 0, contrast: Number.NaN })).toBe('brightness(100%) contrast(NaN%)');
  });

  it('propagates Infinity and -Infinity into the emitted string rather than sanitising them', () => {
    expect(buildLevelsFilter({ brightness: Number.POSITIVE_INFINITY, contrast: 0 })).toBe(
      'brightness(Infinity%) contrast(100%)'
    );
    expect(buildLevelsFilter({ brightness: Number.NEGATIVE_INFINITY, contrast: 0 })).toBe(
      'brightness(-Infinity%) contrast(100%)'
    );
    expect(buildLevelsFilter({ brightness: 0, contrast: Number.POSITIVE_INFINITY })).toBe(
      'brightness(100%) contrast(Infinity%)'
    );
  });

  it('emits a negative factor for values below the slider floor, which invalidates the CSS term', () => {
    // Outside the slider travel the proportionate factor turns negative. The slider bounds
    // keep these from reaching the emitted string in practice; this pins the mathematical
    // behaviour rather than a sanitised result.
    expect(parseLevelsFilter(buildLevelsFilter({ brightness: -200, contrast: 0 }))[0]).toBeLessThan(0);
    expect(parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast: -200 }))[1]).toBeLessThan(0);
  });

  it('crosses zero exactly at the brightness floor, staying positive just above and negative just below', () => {
    expect(parseLevelsFilter(buildLevelsFilter({ brightness: -149, contrast: 0 }))[0]).toBeGreaterThan(0);
    expect(parseLevelsFilter(buildLevelsFilter({ brightness: -150, contrast: 0 }))[0]).toBe(0);
    expect(parseLevelsFilter(buildLevelsFilter({ brightness: -151, contrast: 0 }))[0]).toBeLessThan(0);
  });

  it.fails('does not clamp NaN brightness to 0', () => {
    expect(buildLevelsFilter({ brightness: Number.NaN, contrast: 0 })).toBe('brightness(0%) contrast(100%)');
  });

  it.fails('does not clamp NaN contrast to 50', () => {
    expect(buildLevelsFilter({ brightness: 0, contrast: Number.NaN })).toBe('brightness(100%) contrast(50%)');
  });

  it.fails('does not clamp Infinity brightness to 100', () => {
    expect(buildLevelsFilter({ brightness: Number.POSITIVE_INFINITY, contrast: 0 })).toBe(
      'brightness(100%) contrast(100%)'
    );
  });

  it.fails('does not clamp Infinity contrast to 100', () => {
    expect(buildLevelsFilter({ brightness: 0, contrast: Number.POSITIVE_INFINITY })).toBe(
      'brightness(100%) contrast(100%)'
    );
  });

  it('emits a negative factor for nothing on either travel, because a negative `brightness()` invalidates the whole string', () => {
    // A browser DISCARDS an invalid `ctx.filter` assignment outright rather than applying
    // its valid part, so one negative operand would drop the contrast term with it and the
    // layer would draw unfiltered with nothing to say so — the failure
    // `FilterArgumentUnrenderableError` exists to prevent. Dividing by the travel rather
    // than scaling the slider is what keeps both controls non-negative.
    for (const brightness of sliderTravel(BRIGHTNESS_SLIDER_RANGE)) {
      expect(parseLevelsFilter(buildLevelsFilter({ brightness, contrast: 0 }))[0]).toBeGreaterThanOrEqual(0);
    }
    for (const contrast of sliderTravel(CONTRAST_SLIDER_RANGE)) {
      expect(parseLevelsFilter(buildLevelsFilter({ brightness: 0, contrast }))[1]).toBeGreaterThan(0);
    }
  });
});

/** `['brightnessFactor', 'contrastFactor']` out of a composed Brightness/Contrast filter. */
function parseLevelsFilter(filter: string): [number, number] {
  return [filterTerm(filter, 'brightness'), filterTerm(filter, 'contrast')];
}

describe('proportionateFactor', () => {
  it('anchors the neutral at exactly 1, which is the identity every default depends on', () => {
    expect(proportionateFactor(0, 150)).toBe(1);
    expect(proportionateFactor(0, 100)).toBe(1);
    expect(proportionateFactor(0, 1)).toBe(1);
  });

  it('is affine in the value, so equal slider steps are equal factor steps', () => {
    // The whole difference from `expAdjustment`: no exponent, so the second derivative is
    // zero and the response cannot be gentle at one end of the travel and abrupt at the
    // other. `expAdjustment` needed a `floor` term purely to force its `-100` end to zero;
    // this reaches zero at the end of the travel and never needs a correction for it.
    for (const span of [150, 100]) {
      expect(proportionateFactor(0, span) - proportionateFactor(-span, span)).toBe(1);
      expect(proportionateFactor(span, span) - proportionateFactor(0, span)).toBe(1);
      expect(proportionateFactor(span / 4, span) - proportionateFactor(-span / 4, span)).toBe(0.5);
    }
  });

  it('reaches exactly 0 at `-span`, so a proportionate factor can reach black', () => {
    // The contract `expAdjustment` could not carry without a re-anchoring hack: it is
    // strictly positive for every finite input, so its zero arrived from subtracting a
    // floor rather than from the curve.
    expect(proportionateFactor(-150, 150)).toBe(0);
    expect(proportionateFactor(-100, 100)).toBe(0);
  });

  it('propagates a non-finite input rather than silently sanitising it', () => {
    expect(proportionateFactor(Number.NaN, 150)).toBeNaN();
    expect(proportionateFactor(Number.POSITIVE_INFINITY, 150)).toBe(Number.POSITIVE_INFINITY);
  });

  it('propagates negative Infinity through the affine expression, unbounded below', () => {
    expect(proportionateFactor(Number.NEGATIVE_INFINITY, 150)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('yields a negative factor below the -span floor, the travel is unbounded below', () => {
    expect(proportionateFactor(-200, 150)).toBeLessThan(0);
    expect(proportionateFactor(-300, 150)).toBeLessThan(0);
  });

  it('crosses zero exactly at -span, staying positive just above and negative just below', () => {
    expect(proportionateFactor(-149, 150)).toBeCloseTo(1 / 150, 10);
    expect(proportionateFactor(-150, 150)).toBe(0);
    expect(proportionateFactor(-151, 150)).toBeCloseTo(-1 / 150, 10);
  });

  it.fails('does not clamp NaN to 0', () => {
    expect(proportionateFactor(Number.NaN, 150)).toBe(0);
  });

  it.fails('does not clamp NaN to 1', () => {
    expect(proportionateFactor(Number.NaN, 150)).toBe(1);
  });

  it.fails('does not clamp Infinity to 1', () => {
    expect(proportionateFactor(Number.POSITIVE_INFINITY, 150)).toBe(1);
  });

  it.fails('does not clamp -Infinity to 0', () => {
    expect(proportionateFactor(Number.NEGATIVE_INFINITY, 150)).toBe(0);
  });
});

describe('expAdjustment', () => {
  it('anchors the neutral at exactly 1, so a zero adjustment is a visual no-op', () => {
    // The default Colors args are all zero (`settings.ts` — the `color` entry of
    // `defaultSettings`). If zero did not map to a factor of exactly 1, every freshly
    // opened document would open colour-shifted.
    expect(expAdjustment(0)).toBe(1);
    expect(expAdjustment(0, SATURATION_EXPONENT)).toBe(1);
  });

  it('reaches exactly 0 at the -100 end, so saturation can desaturate to a grey image', () => {
    // `Math.exp` is strictly positive, so the un-re-anchored `exp(k * val / 100)` bottoms
    // out at `exp(-k)` — about 12% saturation at k=2.1, a dull image that never desaturates.
    // These are exact zeros, not approximations of one.
    expect(expAdjustment(-100, SATURATION_EXPONENT)).toBe(0);
  });

  it('rises above 1 across the positive travel', () => {
    expect(expAdjustment(50, SATURATION_EXPONENT)).toBeGreaterThan(1);
    expect(expAdjustment(100, SATURATION_EXPONENT)).toBeGreaterThan(expAdjustment(50, SATURATION_EXPONENT));
  });

  it('is strictly increasing over the whole -100..100 travel of the only slider that uses it', () => {
    for (let val = -100; val < 100; val += 1) {
      expect(expAdjustment(val + 1, SATURATION_EXPONENT)).toBeGreaterThan(expAdjustment(val, SATURATION_EXPONENT));
    }
  });

  it('stays distinct from the proportionate Brightness and Contrast curve at the same value', () => {
    // The two curves are different functions, not one constant relabelled. The exponential is
    // still the Colors chain's — Saturation is not proportionate, and Photoshop's Vibrance
    // and Saturation are not either — so this is a record of the difference rather than a
    // claim that either is wrong.
    expect(expAdjustment(50, SATURATION_EXPONENT)).not.toBe(proportionateFactor(50, 150));
    expect(expAdjustment(-50, SATURATION_EXPONENT)).not.toBe(proportionateFactor(-50, 100));
  });

  it('propagates a non-finite input rather than silently sanitising it', () => {
    // Pin: nothing clamps here. The `it.fails` sanitiser declarations in
    // image-processors.test.ts assert that a non-finite adjustment survives all the way
    // into the composed CSS filter string, so this must stay `NaN`.
    expect(expAdjustment(Number.NaN, SATURATION_EXPONENT)).toBeNaN();
  });

  it('propagates positive Infinity through the exponential, unbounded above', () => {
    expect(expAdjustment(Number.POSITIVE_INFINITY, SATURATION_EXPONENT)).toBe(Number.POSITIVE_INFINITY);
  });

  it('propagates negative Infinity as a strictly negative factor, past the -100 zero', () => {
    expect(expAdjustment(Number.NEGATIVE_INFINITY, SATURATION_EXPONENT)).toBeLessThan(0);
  });

  it('yields a negative factor below the -100 floor, the curve is unbounded below', () => {
    expect(expAdjustment(-200, SATURATION_EXPONENT)).toBeLessThan(0);
    expect(expAdjustment(-300, SATURATION_EXPONENT)).toBeLessThan(0);
  });

  it('crosses zero exactly at -100, staying positive just above and negative just below', () => {
    expect(expAdjustment(-99, SATURATION_EXPONENT)).toBeGreaterThan(0);
    expect(expAdjustment(-101, SATURATION_EXPONENT)).toBeLessThan(0);
  });

  it.fails('does not clamp NaN to 0', () => {
    expect(expAdjustment(Number.NaN, SATURATION_EXPONENT)).toBe(0);
  });

  it.fails('does not clamp NaN to 1', () => {
    expect(expAdjustment(Number.NaN, SATURATION_EXPONENT)).toBe(1);
  });

  it.fails('does not clamp Infinity to 1', () => {
    expect(expAdjustment(Number.POSITIVE_INFINITY, SATURATION_EXPONENT)).toBe(1);
  });
});

describe('writeImageToCanvas', () => {
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    const ctxObj = { canvas: null as HTMLCanvasElement | null, drawImage: vi.fn() };
    mockCtx = ctxObj as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      ctxObj.canvas = this;
      return mockCtx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets canvas dimensions and draws the image', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 200, height: 150 } as unknown as HTMLImageElement;
    const result = writeImageToCanvas(image, canvas);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(result).toBe(mockCtx);
  });

  it('invokes the resize callback with image dimensions', () => {
    const canvas = document.createElement('canvas');
    const callback = vi.fn();
    const image = { width: 300, height: 200 } as unknown as HTMLImageElement;

    writeImageToCanvas(image, canvas, callback);

    expect(callback).toHaveBeenCalledWith(300, 200);
  });

  it('does not throw when callback is omitted', () => {
    const canvas = document.createElement('canvas');
    const image = { width: 10, height: 10 } as unknown as HTMLImageElement;
    expect(() => writeImageToCanvas(image, canvas)).not.toThrow();
  });
});
