import sharp from 'sharp';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_THRESHOLD, compareScreenshots } from '../image-comparison';
import type { CaptureSize, ChannelDelta, ChannelName, CompareOptions, CompareResult } from '../image-comparison';

type Rgba = { r: number; g: number; b: number; alpha: number };
type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

const OPAQUE_RED: Rgba = { r: 255, g: 0, b: 0, alpha: 1 };
const OPAQUE_GREEN: Rgba = { r: 0, g: 255, b: 0, alpha: 1 };
/**
 * Red carrying 10 more green than `#ff0000` has. It is named for what it is rather than
 * for how near it is to red, because at the default threshold the word "near" is the
 * overstatement this file exists to correct: 10 steps is forgiven, and so are 93.
 */
const RED_WITH_TEN_GREEN: Rgba = { r: 255, g: 10, b: 0, alpha: 1 };
/** The size of that green shift, which several assertions below quote rather than recompute. */
const TEN_GREEN_STEPS = 10;
/** A red shift `diffPixels` forgave outright, so `channelDelta` is the only place it appears. */
const FOUR_RED_STEPS = 4;
/** The `threshold` the one live call site, `e2e/export/visual-regression.spec.ts`, passes. */
const EXPORT_CALL_SITE_THRESHOLD = 0.01;
/** The widest possible per-channel step, which a black-to-opaque patch reaches exactly. */
const OPAQUE_CHANNEL_MAX = 255;
const SEMI_TRANSPARENT_RED: Rgba = { r: 255, g: 0, b: 0, alpha: 0.5 };
const SEMI_TRANSPARENT_GREEN: Rgba = { r: 0, g: 255, b: 0, alpha: 0.5 };

const SQUARE_100: Size = { width: 100, height: 100 };
const SQUARE_100_PIXELS = SQUARE_100.width * SQUARE_100.height;
const SQUARE_50: Size = { width: 50, height: 50 };
const SQUARE_50_PIXELS = SQUARE_50.width * SQUARE_50.height;
const SQUARE_10: Size = { width: 10, height: 10 };
const SQUARE_10_PIXELS = SQUARE_10.width * SQUARE_10.height;
const HALF_SQUARE_10_PIXELS = SQUARE_10_PIXELS / 2;
const HALF_SQUARE_10_RATIO = HALF_SQUARE_10_PIXELS / SQUARE_10_PIXELS;
const SINGLE_PIXEL: Size = { width: 1, height: 1 };
const SINGLE_PIXEL_COUNT = SINGLE_PIXEL.width * SINGLE_PIXEL.height;

const PATCH_SIDE = 10;
const PATCH_PIXELS = PATCH_SIDE * PATCH_SIDE;
const FULL_PATCH: Rect = { left: 0, top: 0, width: PATCH_SIDE, height: PATCH_SIDE };
const HALF_PATCH: Rect = { left: 0, top: 0, width: SQUARE_10.width / 2, height: SQUARE_10.height };
const EXTRA_PIXEL_PATCH: Rect = {
  left: SQUARE_100.width - 1,
  top: SQUARE_100.height - 1,
  width: 1,
  height: 1,
};

const PIXELS_AT_DEFAULT_ALLOWANCE = PATCH_PIXELS;
const PIXELS_ONE_OVER_DEFAULT_RATIO = PIXELS_AT_DEFAULT_ALLOWANCE + 1;
const PIXELS_ONE_UNDER_DEFAULT_BUDGET = PIXELS_AT_DEFAULT_ALLOWANCE - 1;
const RATIO_STEP = 1 / SQUARE_100_PIXELS;
const RATIO_AT_DEFAULT_LIMIT = PIXELS_AT_DEFAULT_ALLOWANCE / SQUARE_100_PIXELS;
const RATIO_ONE_STEP_BELOW_DEFAULT = RATIO_AT_DEFAULT_LIMIT - RATIO_STEP;
const RATIO_ONE_STEP_BELOW_HALF = HALF_SQUARE_10_RATIO - 1 / SQUARE_10_PIXELS;
/**
 * Half a 10x10 image moved by the full 255 of green-over-red: 50 * 255 / 100 pixels. A
 * half-integer on purpose, so a mean rounded or truncated to an integer fails.
 */
const HALF_GREEN_PATCH_MEAN = (HALF_SQUARE_10_PIXELS * OPAQUE_CHANNEL_MAX) / SQUARE_10_PIXELS;

const solidPng = (size: Size, background: Rgba): Promise<Buffer> =>
  sharp({ create: { width: size.width, height: size.height, channels: 4, background } })
    .png()
    .toBuffer();

/** The four channel names `CompareResult.channelDelta` is keyed by, in a fixed order. */
const CHANNEL_NAMES: readonly ChannelName[] = ['r', 'g', 'b', 'a'];

/** What `channelDelta` must report for two byte-identical images. */
const NO_MOVEMENT: Record<ChannelName, ChannelDelta> = {
  r: { mean: 0, max: 0 },
  g: { mean: 0, max: 0 },
  b: { mean: 0, max: 0 },
  a: { mean: 0, max: 0 },
};

const patchedPng = async (size: Size, background: Rgba, patches: Rect[]): Promise<Buffer> => {
  const base = await solidPng(size, background);
  const composites = await Promise.all(
    patches.map(async ({ left, top, width, height }) => ({
      input: await solidPng({ width, height }, OPAQUE_GREEN),
      left,
      top,
    }))
  );
  return sharp(base).composite(composites).png().toBuffer();
};

const redPng100 = () => solidPng(SQUARE_100, OPAQUE_RED);
const greenPng100 = () => solidPng(SQUARE_100, OPAQUE_GREEN);
const red10x10 = () => solidPng(SQUARE_10, OPAQUE_RED);
const green10x10 = () => solidPng(SQUARE_10, OPAQUE_GREEN);
const halfGreen10x10 = () => patchedPng(SQUARE_10, OPAQUE_RED, [HALF_PATCH]);
const patched100 = (...patches: Rect[]) => patchedPng(SQUARE_100, OPAQUE_RED, patches);

/** A solid image whose named colour channels are all lifted `steps` above black, uniformly. */
const shiftedBlack = (steps: number, channels: readonly ('r' | 'g' | 'b')[] = ['r']): Promise<Buffer> => {
  const lifted: Rgba = { r: 0, g: 0, b: 0, alpha: 1 };
  for (const channel of channels) {
    lifted[channel] = steps;
  }
  return solidPng(SQUARE_10, lifted);
};

describe('Image Comparison Helpers', () => {
  describe('DEFAULT_THRESHOLD', () => {
    it('is 0.2', () => {
      expect(DEFAULT_THRESHOLD).toBe(0.2);
    });

    it('is the threshold compareScreenshots applies when no override is given', async () => {
      const base = await redPng100();
      const shifted = await solidPng(SQUARE_100, RED_WITH_TEN_GREEN);

      const implicit = await compareScreenshots(shifted, base);
      const explicit = await compareScreenshots(shifted, base, { threshold: DEFAULT_THRESHOLD });

      expect(implicit).toEqual(explicit);
      expect(implicit.diffPixels).toBe(0);
    });
  });

  /**
   * WHAT THE DEFAULT THRESHOLD FORGIVES, measured rather than asserted.
   *
   * `DEFAULT_THRESHOLD` is 0.2 and its name reads as "loose but sane". It is not: pixelmatch
   * counts a pixel different only when its YIQ distance exceeds `35215 * threshold²`, and the
   * YIQ metric weights blue at 0.0565 and red at 0.1601, so the per-channel forgiveness is
   * wildly unequal. The previous single pin in this file was a 10-step green shift on red,
   * labelled "near-identical" — 7.5x tighter than the truth, in the one direction that made
   * the constant look better than it is.
   *
   * Every boundary below was derived from pixelmatch@7.2.0's own `colorDelta` and then
   * confirmed through `compareScreenshots` on real PNGs, one entry per row. The scale is
   * 10x10 so a whole-image shift is exactly 100 differing pixels when it is not forgiven.
   */
  describe('what the default threshold forgives over a whole image', () => {
    const forgivenRows: [string, number, readonly ('r' | 'g' | 'b')[]][] = [
      ['10 red steps', 10, ['r']],
      ['75 red steps', 75, ['r']],
      ['93 red steps — the last forgiven value', 93, ['r']],
      ['75 green steps — the last forgiven value', 75, ['g']],
      ['157 blue steps — the last forgiven value', 157, ['b']],
      ['52 steps on red, green and blue together — the last forgiven value', 52, ['r', 'g', 'b']],
    ];

    it.each(forgivenRows)('reports zero diff pixels for %s', async (_label, steps, channels) => {
      const result = await compareScreenshots(await shiftedBlack(steps, channels), await shiftedBlack(0));

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
    });

    const rejectedRows: [string, number, readonly ('r' | 'g' | 'b')[]][] = [
      ['94 red steps — one past the red boundary', 94, ['r']],
      ['96 red steps', 96, ['r']],
      ['76 green steps — one past the green boundary', 76, ['g']],
      ['158 blue steps — one past the blue boundary', 158, ['b']],
      ['53 steps on red, green and blue together — one past the achromatic boundary', 53, ['r', 'g', 'b']],
    ];

    it.each(rejectedRows)('counts every pixel different for %s', async (_label, steps, channels) => {
      const result = await compareScreenshots(await shiftedBlack(steps, channels), await shiftedBlack(0));

      expect(result.diffPixels).toBe(SQUARE_10_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('measures a 157-step blue shift as looser than a 94-step red shift of the same count', async () => {
      // The unequal weighting, stated as a comparison rather than as a coefficient: 157 blue
      // steps and 93 red steps are BOTH forgiven, so an oracle tuned on red alone is 1.7x
      // looser on blue without anything in the suite saying so.
      const blue = await compareScreenshots(await shiftedBlack(157, ['b']), await shiftedBlack(0));
      const red = await compareScreenshots(await shiftedBlack(94, ['r']), await shiftedBlack(0));

      expect(blue.diffPixels).toBe(0);
      expect(red.diffPixels).toBe(SQUARE_10_PIXELS);
    });
  });

  describe('compareScreenshots - identical images', () => {
    it('detects identical images', async () => {
      const img = await redPng100();

      const result = await compareScreenshots(img, img);

      expect(result.diffPixels).toBe(0);
      expect(result.matches).toBe(true);
      expect(result.diffRatio).toBe(0);
    });

    it('treats two independently encoded but visually identical images as equal', async () => {
      const first = await redPng100();
      const second = await redPng100();

      expect(first.equals(second)).toBe(true);
      expect(await compareScreenshots(first, second)).toEqual({
        matches: true,
        diffPixels: 0,
        diffRatio: 0,
        channelDelta: NO_MOVEMENT,
        sizeMismatch: null,
      });
    });

    it('reports zero diff for identical semi-transparent images', async () => {
      const img = await solidPng(SQUARE_50, SEMI_TRANSPARENT_RED);

      const result = await compareScreenshots(img, img);

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
    });
  });

  describe('compareScreenshots - fully different images', () => {
    it('reports every pixel as different for fully-different same-sized images', async () => {
      const result = await compareScreenshots(await redPng100(), await greenPng100());

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('detects differences when alpha differs but RGB matches', async () => {
      const result = await compareScreenshots(
        await solidPng(SQUARE_50, SEMI_TRANSPARENT_RED),
        await solidPng(SQUARE_50, OPAQUE_RED)
      );

      expect(result.diffPixels).toBe(SQUARE_50_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('detects differences when RGB differs but alpha is identically semi-transparent', async () => {
      const result = await compareScreenshots(
        await solidPng(SQUARE_50, SEMI_TRANSPARENT_RED),
        await solidPng(SQUARE_50, SEMI_TRANSPARENT_GREEN)
      );

      expect(result.diffPixels).toBe(SQUARE_50_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });
  });

  describe('compareScreenshots - size mismatches use the sentinel verdict', () => {
    /**
     * `channelDelta` is part of the sentinel, not absent from it: every channel reports
     * `Infinity`, so a caller gating on `channelDelta.r.max` fails here instead of reading a
     * size mismatch as a perfect colour match.
     *
     * Built from the two sizes rather than a frozen constant, because `sizeMismatch` reports
     * them and a constant here could not assert what they are. Every assertion that used one
     * frozen object would pass even if the reported sizes were swapped or copied from the
     * wrong side, which is the whole failure this row exists to remove.
     */
    const sentinelVerdict = (actual: Size, expected: Size) => ({
      matches: false,
      diffPixels: Number.MAX_SAFE_INTEGER,
      diffRatio: 1,
      channelDelta: {
        r: { mean: Infinity, max: Infinity },
        g: { mean: Infinity, max: Infinity },
        b: { mean: Infinity, max: Infinity },
        a: { mean: Infinity, max: Infinity },
      },
      sizeMismatch: {
        actual: { width: actual.width, height: actual.height },
        expected: { width: expected.width, height: expected.height },
      },
    });

    it('does not match when both dimensions differ', async () => {
      const larger = { width: SQUARE_100.width * 2, height: SQUARE_100.height * 2 };
      const result = await compareScreenshots(await redPng100(), await solidPng(larger, OPAQUE_GREEN));

      expect(result).toEqual(sentinelVerdict(SQUARE_100, larger));
    });

    it('does not match when only the width differs', async () => {
      const wider = { width: SQUARE_100.width * 2, height: SQUARE_100.height };
      const result = await compareScreenshots(await solidPng(wider, OPAQUE_GREEN), await redPng100());

      expect(result).toEqual(sentinelVerdict(wider, SQUARE_100));
    });

    it('does not match when only the height differs', async () => {
      const taller = { width: SQUARE_100.width, height: SQUARE_100.height * 2 };
      const result = await compareScreenshots(await solidPng(taller, OPAQUE_GREEN), await redPng100());

      expect(result).toEqual(sentinelVerdict(taller, SQUARE_100));
    });

    /**
     * The verdict is symmetric and the REPORT is not, deliberately, and this is the one place
     * that distinction is pinned.
     *
     * Swapping the arguments swaps `actual` and `expected` and nothing else: `matches`,
     * `diffPixels`, `diffRatio` and `channelDelta` are identical either way. An earlier shape
     * asserted the entire object was equal under both orders, which was only possible while
     * the verdict said nothing about which image was which — i.e. it was asserting the very
     * absence this row removes. The direction is the feature: "exported 800x600 against a
     * baseline of 800x601" is only actionable in that order, because the exported buffer is
     * what the current build produced and the baseline is the committed record.
     */
    it('reports the same verdict under either argument order, and swaps only the sizes', async () => {
      const tall = await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, OPAQUE_GREEN);
      const short = await redPng100();

      const forward = await compareScreenshots(tall, short);
      const reverse = await compareScreenshots(short, tall);

      const { sizeMismatch: forwardSizes, ...forwardVerdict } = forward;
      const { sizeMismatch: reverseSizes, ...reverseVerdict } = reverse;

      expect(forwardVerdict).toEqual(reverseVerdict);
      expect(forwardSizes).toEqual({
        actual: { width: SQUARE_100.width, height: SQUARE_100.height * 2 },
        expected: SQUARE_100,
      });
      expect(reverseSizes).toEqual({ actual: SQUARE_100, expected: forwardSizes?.actual });
    });

    it('applies the sentinel even when the size-mismatched images share a single colour', async () => {
      const small = await solidPng(SQUARE_10, OPAQUE_RED);
      const larger = await solidPng({ width: SQUARE_10.width * 2, height: SQUARE_10.height * 2 }, OPAQUE_RED);

      expect(await compareScreenshots(small, larger)).toEqual(
        sentinelVerdict(SQUARE_10, { width: SQUARE_10.width * 2, height: SQUARE_10.height * 2 })
      );
    });

    /**
     * The reason this row exists. A one-pixel size disagreement produced a verdict
     * indistinguishable from "the picture is completely different": same `matches: false`,
     * same `diffPixels: Number.MAX_SAFE_INTEGER`, same `diffRatio: 1`. An operator triaging a
     * red export diff could only see a budget failure, when the actual defect was a dimension.
     */
    it('names both sizes when a single pixel of height differs, rather than only reporting a total failure', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height + 1 }, OPAQUE_RED),
        await redPng100()
      );

      expect(result.sizeMismatch).toEqual({
        actual: { width: SQUARE_100.width, height: SQUARE_100.height + 1 },
        expected: SQUARE_100,
      });
    });

    it('still matches the smallest possible image against itself', async () => {
      const single = await solidPng(SINGLE_PIXEL, OPAQUE_RED);

      expect(await compareScreenshots(single, single)).toEqual({
        matches: true,
        diffPixels: 0,
        diffRatio: 0,
        channelDelta: NO_MOVEMENT,
        sizeMismatch: null,
      });
    });

    it('counts a single changed pixel in a 1x1 image', async () => {
      const result = await compareScreenshots(
        await solidPng(SINGLE_PIXEL, { r: 0, g: 0, b: 0, alpha: 1 }),
        await solidPng(SINGLE_PIXEL, { r: 255, g: 255, b: 255, alpha: 1 })
      );

      expect(result.diffPixels).toBe(SINGLE_PIXEL_COUNT);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });
  });

  describe('compareScreenshots - threshold sensitivity', () => {
    it('counts a 10-step green shift as different at a zero threshold', async () => {
      const result = await compareScreenshots(await solidPng(SQUARE_100, RED_WITH_TEN_GREEN), await redPng100(), {
        threshold: 0,
      });

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('forgives that same 10-step green shift at the default threshold', async () => {
      // "Near-identical" was the word here, and it was the finding: 10 of 255 is 4%, and the
      // default threshold forgives up to 93 red / 157 blue steps, so the honest name for this
      // case is the magnitude. The forgiveness itself is pinned, so the name can change.
      const result = await compareScreenshots(await solidPng(SQUARE_100, RED_WITH_TEN_GREEN), await redPng100());

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
    });

    it('still reports the 10 green steps in channelDelta while forgiving them in diffPixels', async () => {
      // The two answers disagree on purpose, and that disagreement is the reason
      // `channelDelta` exists: `diffPixels` is a thresholded luma distance, so it rounds this
      // shift away to nothing, while the arithmetic below counts it exactly.
      const result = await compareScreenshots(await solidPng(SQUARE_100, RED_WITH_TEN_GREEN), await redPng100());

      expect(result.diffPixels).toBe(0);
      expect(result.channelDelta).toEqual({
        r: { mean: 0, max: 0 },
        g: { mean: TEN_GREEN_STEPS, max: TEN_GREEN_STEPS },
        b: { mean: 0, max: 0 },
        a: { mean: 0, max: 0 },
      });
    });
  });

  describe('compareScreenshots - default allowance boundary', () => {
    it('matches at exactly the default diff-pixel and diff-ratio allowance', async () => {
      const result = await compareScreenshots(await patched100(FULL_PATCH), await redPng100());

      expect(result.diffPixels).toBe(PIXELS_AT_DEFAULT_ALLOWANCE);
      expect(result.diffRatio).toBe(RATIO_AT_DEFAULT_LIMIT);
      expect(result.matches).toBe(true);
    });

    it('does not match one pixel past the default diff-ratio allowance', async () => {
      const result = await compareScreenshots(await patched100(FULL_PATCH, EXTRA_PIXEL_PATCH), await redPng100());

      expect(result.diffPixels).toBe(PIXELS_ONE_OVER_DEFAULT_RATIO);
      expect(result.matches).toBe(false);
    });

    // Only probe that pins the *default* diff-pixel budget, since 100 is not passed in explicitly.
    it('does not match one pixel under the default diff-pixel allowance', async () => {
      const result = await compareScreenshots(await patched100(FULL_PATCH), await redPng100(), {
        maxDiffPixels: PIXELS_ONE_UNDER_DEFAULT_BUDGET,
      });

      expect(result.diffPixels).toBe(PIXELS_AT_DEFAULT_ALLOWANCE);
      expect(result.matches).toBe(false);
    });

    it('does not match one ratio step under the default diff-ratio allowance', async () => {
      const result = await compareScreenshots(await patched100(FULL_PATCH), await redPng100(), {
        maxDiffPixelRatio: RATIO_ONE_STEP_BELOW_DEFAULT,
      });

      expect(result.diffRatio).toBe(RATIO_AT_DEFAULT_LIMIT);
      expect(result.matches).toBe(false);
    });
  });

  describe('compareScreenshots - explicit maxDiffPixels boundary', () => {
    it('matches when diffPixels is exactly maxDiffPixels', async () => {
      const result = await compareScreenshots(await red10x10(), await green10x10(), {
        maxDiffPixels: SQUARE_10_PIXELS,
        maxDiffPixelRatio: 1,
      });

      expect(result.diffPixels).toBe(SQUARE_10_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(true);
    });

    it('matches a partial diff sitting exactly on the allowance', async () => {
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10(), {
        maxDiffPixels: HALF_SQUARE_10_PIXELS,
        maxDiffPixelRatio: 1,
      });

      expect(result.diffPixels).toBe(HALF_SQUARE_10_PIXELS);
      expect(result.matches).toBe(true);
    });

    it('does not match a partial diff sitting one pixel above the allowance', async () => {
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10(), {
        maxDiffPixels: HALF_SQUARE_10_PIXELS - 1,
        maxDiffPixelRatio: 1,
      });

      expect(result.diffPixels).toBe(HALF_SQUARE_10_PIXELS);
      expect(result.matches).toBe(false);
    });

    it('rejects any allowance once maxDiffPixels is zero', async () => {
      const result = await compareScreenshots(await redPng100(), await greenPng100(), { maxDiffPixels: 0 });

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.matches).toBe(false);
    });
  });

  /**
   * The ratio's DENOMINATOR, on an image that is not a square.
   *
   * Every successful comparison in this file up to here is square — 100x100, 50x50, 10x10,
   * 1x1 — so `actualInfo.width * actualInfo.height` and `width * width` and
   * `(width + height) / 2` all produce the same number on all of them, and a denominator
   * that quietly stopped using the height passes the whole file. The screenshots this
   * helper judges are captures of whatever region a caller measured, and a region is
   * rectangular and routinely not square.
   *
   * 100x50 with a 10x5 patch: 50 differing pixels out of 5000, which is exactly
   * `DEFAULT_MAX_DIFF_PIXEL_RATIO` (0.01) and exactly half of the default pixel budget.
   */
  describe('compareScreenshots - the ratio divides by the image AREA, not the width', () => {
    const WIDE: Size = { width: 100, height: 50 };
    const WIDE_PIXELS = WIDE.width * WIDE.height;
    const WIDE_PATCH: Rect = { left: 0, top: 0, width: 10, height: 5 };
    const WIDE_PATCH_PIXELS = WIDE_PATCH.width * WIDE_PATCH.height;

    it('computes the ratio over width x height, so a half-height image doubles it', async () => {
      // 50 / 5000. A `width * width` denominator answers 0.005 here.
      const result = await compareScreenshots(
        await patchedPng(WIDE, OPAQUE_RED, [WIDE_PATCH]),
        await solidPng(WIDE, OPAQUE_RED)
      );

      expect(result.diffPixels).toBe(WIDE_PATCH_PIXELS);
      expect(result.diffRatio).toBe(WIDE_PATCH_PIXELS / WIDE_PIXELS);
      expect(result.diffRatio).toBe(0.01);
    });

    it('does not take the height from the expected image when only the widths agree', async () => {
      // Both images are the same shape here, so a denominator mixing the two images'
      // geometry is also caught — and `width * height` of the EXPECTED image is the shape a
      // refactor is most likely to reach for, because `expectedInfo` is the other name in
      // scope at the top of the function.
      const result = await compareScreenshots(
        await solidPng(WIDE, OPAQUE_RED),
        await patchedPng(WIDE, OPAQUE_RED, [WIDE_PATCH])
      );

      expect(result.diffPixels).toBe(WIDE_PATCH_PIXELS);
      expect(result.diffRatio).toBe(0.01);
    });

    it('sits on the default ratio allowance on a non-square image, and one pixel over leaves it', async () => {
      const EXTRA: Rect = { left: 99, top: 49, width: 1, height: 1 };

      const onTheLimit = await compareScreenshots(
        await patchedPng(WIDE, OPAQUE_RED, [WIDE_PATCH]),
        await solidPng(WIDE, OPAQUE_RED)
      );
      expect(onTheLimit.diffRatio).toBe(0.01);
      expect(onTheLimit.matches).toBe(true);

      const oneOver = await compareScreenshots(
        await patchedPng(WIDE, OPAQUE_RED, [WIDE_PATCH, EXTRA]),
        await solidPng(WIDE, OPAQUE_RED)
      );
      expect(oneOver.diffPixels).toBe(WIDE_PATCH_PIXELS + 1);
      expect(oneOver.diffRatio).toBe((WIDE_PATCH_PIXELS + 1) / WIDE_PIXELS);
      expect(oneOver.matches).toBe(false);
    });

    it('reports every pixel of a fully different non-square image as a ratio of 1', async () => {
      // The one case a square assumption cannot disguise at all: the ratio saturates at 1
      // only when the denominator is the true area.
      const result = await compareScreenshots(await solidPng(WIDE, OPAQUE_RED), await solidPng(WIDE, OPAQUE_GREEN));

      expect(result.diffPixels).toBe(WIDE_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });
  });

  /**
   * `ensureAlpha()` on both decodes.
   *
   * Every fixture above is built with `channels: 4`, so pixelmatch is always handed two
   * RGBA buffers of the same length and the `.ensureAlpha()` calls are never the thing that
   * made that true. A capture that comes back without an alpha channel — a JPEG, an
   * `image/jpeg` data URL, any `format` other than `'png'` on the CDP capture, a format a
   * future caller adds — decodes to three bytes per pixel instead of four, and the raw
   * buffers handed to pixelmatch are then a quarter too short: it reads past the end of
   * both, and the result is a diff count and a ratio that mean nothing.
   */
  describe('compareScreenshots - decodes images that carry no alpha channel', () => {
    const rgbPng = (background: Rgba): Promise<Buffer> =>
      sharp({ create: { width: SQUARE_100.width, height: SQUARE_100.height, channels: 3, background } })
        .png()
        .toBuffer();

    it('matches a three-channel image against itself', async () => {
      // Without `ensureAlpha()` the raw buffer is 30000 bytes where pixelmatch reads 40000,
      // and the two ends disagree on their length before a single pixel is compared.
      const image = await rgbPng({ r: 255, g: 0, b: 0, alpha: 1 });

      const { info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
      expect(info.channels, 'the fixture really is the three-channel case').toBe(3);

      expect(await compareScreenshots(image, image)).toEqual({
        matches: true,
        diffPixels: 0,
        diffRatio: 0,
        channelDelta: NO_MOVEMENT,
        // `toEqual` on the whole verdict, so widening the channels must not turn a decoded
        // size disagreement into a match: `sizeMismatch` is `null` only because the two decodes
        // agree, and this assertion now says so.
        sizeMismatch: null,
      });
    });

    it('compares three-channel against four-channel on equal terms', async () => {
      // Both sides name the same colour, so the only difference between a match and a
      // whole-image diff is whether both sides were widened to four channels first.
      const result = await compareScreenshots(await rgbPng({ r: 255, g: 0, b: 0, alpha: 1 }), await redPng100());

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
    });

    it('still counts a real difference in a three-channel image', async () => {
      // The other half of the contract: widening must not turn every sample into a match.
      const result = await compareScreenshots(
        await rgbPng({ r: 0, g: 0, b: 0, alpha: 1 }),
        await rgbPng({ r: 255, g: 255, b: 255, alpha: 1 })
      );

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });
  });

  describe('compareScreenshots - explicit maxDiffPixelRatio boundary', () => {
    it('matches when diffRatio is exactly maxDiffPixelRatio', async () => {
      const result = await compareScreenshots(await red10x10(), await green10x10(), {
        maxDiffPixels: SQUARE_10_PIXELS,
        maxDiffPixelRatio: 1,
      });

      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(true);
    });

    it('matches a partial diff whose ratio lands exactly on the allowance', async () => {
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10(), {
        maxDiffPixels: SQUARE_10_PIXELS,
        maxDiffPixelRatio: HALF_SQUARE_10_RATIO,
      });

      expect(result.diffRatio).toBe(HALF_SQUARE_10_RATIO);
      expect(result.matches).toBe(true);
    });

    it('does not match a partial diff whose ratio sits one step outside the allowance', async () => {
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10(), {
        maxDiffPixels: SQUARE_10_PIXELS,
        maxDiffPixelRatio: RATIO_ONE_STEP_BELOW_HALF,
      });

      expect(result.diffRatio).toBe(HALF_SQUARE_10_RATIO);
      expect(result.matches).toBe(false);
    });

    it('rejects any allowance once maxDiffPixelRatio is zero and pixels differ', async () => {
      const options: CompareOptions = { maxDiffPixelRatio: 0 };
      const result = await compareScreenshots(await redPng100(), await greenPng100(), options);

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });
  });

  describe('compareScreenshots - both allowances must hold', () => {
    it('does not match when the pixel allowance holds but the ratio allowance does not', async () => {
      const result = await compareScreenshots(await redPng100(), await greenPng100(), {
        maxDiffPixels: SQUARE_100_PIXELS,
        maxDiffPixelRatio: 0,
      });

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('does not match when the ratio allowance holds but the pixel allowance does not', async () => {
      const result = await compareScreenshots(await redPng100(), await greenPng100(), {
        maxDiffPixels: 0,
        maxDiffPixelRatio: 1,
      });

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('matches only when both allowances hold simultaneously', async () => {
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10(), {
        maxDiffPixels: HALF_SQUARE_10_PIXELS,
        maxDiffPixelRatio: HALF_SQUARE_10_RATIO,
      });

      expect(result.diffPixels).toBe(HALF_SQUARE_10_PIXELS);
      expect(result.diffRatio).toBe(HALF_SQUARE_10_RATIO);
      expect(result.matches).toBe(true);
    });
  });

  describe('sharp fixture guards (third-party behaviour, not asserted by image-comparison)', () => {
    const zeroDimensionSizes: [string, Size][] = [
      ['zero-width', { width: 0, height: SQUARE_10.height }],
      ['zero-height', { width: SQUARE_10.width, height: 0 }],
    ];

    // Pins only that sharp refuses zero-dimension input; sharp's own wording is deliberately not pinned.
    it.each(zeroDimensionSizes)('cannot encode a %s image', (_label, size) => {
      expect(() => solidPng(size, OPAQUE_RED)).toThrow();
    });
  });

  describe('compareScreenshots - degenerate inputs', () => {
    it('rejects an empty buffer instead of reporting a match', async () => {
      await expect(compareScreenshots(Buffer.alloc(0), await redPng100())).rejects.toThrow(/empty/i);
    });

    it('rejects a non-image buffer instead of reporting a match', async () => {
      await expect(compareScreenshots(Buffer.from('not-an-image'), await redPng100())).rejects.toThrow(
        /unsupported image format/
      );
    });

    it('rejects a truncated image buffer instead of reporting a match', async () => {
      const truncated = (await redPng100()).subarray(0, PATCH_SIDE);

      await expect(compareScreenshots(truncated, await redPng100())).rejects.toThrow();
    });

    it('rejects a header-only buffer that declares no decodable geometry', async () => {
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      await expect(compareScreenshots(pngSignature, await redPng100())).rejects.toThrow();
    });
  });

  describe('compareScreenshots - option normalization', () => {
    it('treats an explicitly undefined threshold as an omitted threshold', async () => {
      const base = await redPng100();
      const shifted = await solidPng(SQUARE_100, RED_WITH_TEN_GREEN);

      expect(await compareScreenshots(shifted, base, { threshold: undefined })).toEqual(
        await compareScreenshots(shifted, base)
      );
    });

    it('treats an empty options object as no options', async () => {
      const actual = await redPng100();
      const expected = await greenPng100();

      expect(await compareScreenshots(actual, expected, {})).toEqual(await compareScreenshots(actual, expected));
    });
  });

  /**
   * WHY `channelDelta` EXISTS, stated as the disagreement it resolves.
   *
   * `diffPixels` is a luma-weighted YIQ distance compared against one number, so it is not
   * a colour oracle at all: at the live call site's `threshold: 0.01` a uniform shift of up
   * to 4 red, 3 green, 7 blue or 2 alpha steps across EVERY pixel of an 800x600 export is
   * not a difference to it. No test in the suite asserted an exported colour before this,
   * and `assertExportGeometry` cannot close the gap either — it measures luma-weighted ink,
   * so a shift that trades red for blue at equal luma is invisible to both.
   *
   * These tests pin the ARITHMETIC, not a budget. What a caller then asserts on the numbers
   * is a separate, deliberate decision, and the recommendation for the export call site is
   * in the change report rather than in this file — a threshold added here would be a gate
   * change wearing a test's clothes.
   */
  describe('compareScreenshots - channelDelta', () => {
    it('reports no movement on any channel for two identical images', async () => {
      const result = await compareScreenshots(await red10x10(), await red10x10());

      expect(result.channelDelta).toEqual(NO_MOVEMENT);
    });

    it('reports the exact mean and max for a uniform shift over every pixel', async () => {
      // Mean equals max because every pixel moved by the same amount, which is the case that
      // makes the two numbers distinguishable from each other at all.
      const result = await compareScreenshots(await shiftedBlack(4, ['r']), await shiftedBlack(0));

      expect(result.channelDelta).toEqual({
        ...NO_MOVEMENT,
        r: { mean: FOUR_RED_STEPS, max: FOUR_RED_STEPS },
      });
    });

    it('separates mean from max when only half the image moved', async () => {
      // Half of a 10x10 is 50 pixels; green-over-red is a 255-step move on red and on green,
      // so the mean is exactly half the max. Blue is 0 in both colours and is the control:
      // it must read zero, which is what a per-channel mean or a max that leaked across
      // channels would not do. A half-integer mean means a mean rounded to an integer fails.
      const result = await compareScreenshots(await halfGreen10x10(), await red10x10());

      expect(result.channelDelta).toEqual({
        r: { mean: HALF_GREEN_PATCH_MEAN, max: OPAQUE_CHANNEL_MAX },
        g: { mean: HALF_GREEN_PATCH_MEAN, max: OPAQUE_CHANNEL_MAX },
        b: { mean: 0, max: 0 },
        a: { mean: 0, max: 0 },
      });
    });

    it('reports a whole-image channel move that diffPixels forgave entirely', async () => {
      // The case the whole field exists for. At the export call site's `threshold: 0.01`,
      // 4 red steps over 480,000 pixels is `diffPixels: 0` and `matches: true`; the channel
      // arithmetic below says the colour moved by 4 and the caller is the only one who can
      // decide whether that is a failure. Both halves are asserted together precisely so
      // that neither can be changed without the other being re-decided.
      const result = await compareScreenshots(await shiftedBlack(4, ['r']), await shiftedBlack(0), {
        threshold: EXPORT_CALL_SITE_THRESHOLD,
        maxDiffPixels: 0,
      });

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
      expect(result.channelDelta.r).toEqual({ mean: FOUR_RED_STEPS, max: FOUR_RED_STEPS });
    });

    it('reports the same move that diffPixels DID count, so the two agree when they should', async () => {
      // 94 red steps is past the boundary at the default threshold and past it at 0.01 too, so
      // the pixel count and the channel arithmetic have to move together. Without this, a
      // `channelDelta` that reported a plausible number for an image pixelmatch never read
      // would still pass every case above.
      const result = await compareScreenshots(await shiftedBlack(94, ['r']), await shiftedBlack(0), {
        threshold: EXPORT_CALL_SITE_THRESHOLD,
      });

      expect(result.diffPixels).toBe(SQUARE_10_PIXELS);
      expect(result.channelDelta.r).toEqual({ mean: 94, max: 94 });
    });

    it('reports Infinity on every channel for a size mismatch, rather than zero', async () => {
      // Zero would be the dangerous lie here: it is what "the colour did not move" looks
      // like, and a caller gating on `channelDelta.r.max` would read a size mismatch as a
      // perfect colour match. `Infinity` fails that gate, which is the right outcome.
      const result = await compareScreenshots(await red10x10(), await greenPng100());

      expect(result.matches).toBe(false);
      for (const channel of CHANNEL_NAMES) {
        expect(result.channelDelta[channel]).toEqual({ mean: Infinity, max: Infinity });
      }
    });

    it('hands out a fresh channelDelta that a caller may mutate without affecting later calls', async () => {
      // Red against green at the same size, so every channel is measured rather than reported
      // as the size-mismatch `Infinity`: the mutation below would be invisible if a later
      // comparison returned the shared unmeasured object.
      const first = await compareScreenshots(await red10x10(), await green10x10());
      first.channelDelta.r.max = 0;
      first.channelDelta.g = { mean: 0, max: 0 };

      const second = await compareScreenshots(await red10x10(), await green10x10());

      expect(second.channelDelta.r.max).toBe(OPAQUE_CHANNEL_MAX);
      expect(second.channelDelta.g.max).toBe(OPAQUE_CHANNEL_MAX);
    });
  });

  describe('compareScreenshots - result contract', () => {
    it('returns exactly the documented result keys', async () => {
      const result = await compareScreenshots(await redPng100(), await redPng100());

      expect(Object.keys(result).sort()).toEqual([
        'channelDelta',
        'diffPixels',
        'diffRatio',
        'matches',
        'sizeMismatch',
      ]);
    });

    it('returns values of the documented runtime types', async () => {
      const result: CompareResult = await compareScreenshots(await redPng100(), await greenPng100());

      expect(typeof result.matches).toBe('boolean');
      expect(typeof result.diffPixels).toBe('number');
      expect(Number.isFinite(result.diffRatio)).toBe(true);
      expect(Object.keys(result.channelDelta).sort()).toEqual(['a', 'b', 'g', 'r']);
      // `null` on a measured verdict, so `sizeMismatch !== null` is the whole size test and a
      // caller never has to read `diffPixels` to find out which verdict it is holding.
      expect(result.sizeMismatch).toBeNull();
    });

    /**
     * Both keys must be present on the mismatch, and they must be the two sides rather than
     * one size copied twice. A verdict that reported the expected size in both slots would
     * satisfy `sizeMismatch !== null` and every consumer of it, while naming nothing.
     */
    it('reports the two sides distinctly on a size mismatch', async () => {
      const result = await compareScreenshots(await redPng100(), await solidPng(SQUARE_50, OPAQUE_GREEN));

      expect(result.sizeMismatch).not.toBeNull();
      expect(result.sizeMismatch?.actual).toEqual(SQUARE_100);
      expect(result.sizeMismatch?.expected).toEqual(SQUARE_50);
      expect(result.sizeMismatch?.actual).not.toEqual(result.sizeMismatch?.expected);
    });

    it('returns a fresh result object that callers may mutate without affecting later calls', async () => {
      const first = await compareScreenshots(await redPng100(), await redPng100());
      first.matches = false;

      const second = await compareScreenshots(await redPng100(), await redPng100());

      expect(second.matches).toBe(true);
    });

    /**
     * The nested object needs this as much as the top-level one: `sizeMismatch` is built per
     * call, so a shared literal would let one mutation leak into the next comparison.
     */
    it('returns a fresh sizeMismatch object on every mismatched call', async () => {
      const first = await compareScreenshots(await redPng100(), await solidPng(SQUARE_50, OPAQUE_GREEN));
      if (first.sizeMismatch) first.sizeMismatch.actual.width = 1;

      const second = await compareScreenshots(await redPng100(), await solidPng(SQUARE_50, OPAQUE_GREEN));

      expect(second.sizeMismatch?.actual).toEqual(SQUARE_100);
    });
  });

  describe('type-level contracts', () => {
    it('CompareOptions has optional threshold, maxDiffPixels, maxDiffPixelRatio', () => {
      expectTypeOf<CompareOptions>().toEqualTypeOf<{
        threshold?: number;
        maxDiffPixels?: number;
        maxDiffPixelRatio?: number;
      }>();
    });

    it('CompareResult has matches, diffPixels, diffRatio, channelDelta and sizeMismatch', () => {
      expectTypeOf<CompareResult>().toEqualTypeOf<{
        matches: boolean;
        diffPixels: number;
        diffRatio: number;
        channelDelta: Record<ChannelName, ChannelDelta>;
        sizeMismatch: { actual: CaptureSize; expected: CaptureSize } | null;
      }>();
    });

    it('ChannelDelta carries a mean and a max, both plain numbers', () => {
      expectTypeOf<ChannelDelta>().toEqualTypeOf<{ mean: number; max: number }>();
    });

    it('CaptureSize is a width and a height', () => {
      expectTypeOf<CaptureSize>().toEqualTypeOf<{ width: number; height: number }>();
    });
  });
});

describe('the exported surface is exactly what the suite uses', () => {
  it('exports only the comparison itself and its defaults', async () => {
    // `saveScreenshotArtifact` was deleted: its only references in the repository were
    // its own definition and this file, so it was ~30 lines of never-executed code
    // documenting a second convention the suite does not follow. Its sibling
    // `expectCanvasToMatch` had already been removed for the same reason, and it is
    // gone too, which leaves `compareScreenshots` as the one thing here that a spec
    // actually calls.
    //
    // Asserted on the runtime namespace rather than by a source grep so that a
    // re-export under any spelling, or a new helper added beside it, is what fails.
    const mod = await import('../image-comparison');
    expect(Object.keys(mod).sort()).toEqual([
      'DEFAULT_MAX_DIFF_PIXELS',
      'DEFAULT_MAX_DIFF_PIXEL_RATIO',
      'DEFAULT_THRESHOLD',
      'compareScreenshots',
    ]);
  });
});
