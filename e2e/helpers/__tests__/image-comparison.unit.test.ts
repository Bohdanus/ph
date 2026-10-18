import sharp from 'sharp';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_THRESHOLD, compareScreenshots } from '../image-comparison';
import type { ChannelDelta, ChannelName, CompareOptions, CompareResult } from '../image-comparison';

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
     */
    const sentinelVerdict = (
      actual: { width: number; height: number },
      expected: { width: number; height: number }
    ) => ({
      matches: false,
      diffPixels: Number.MAX_SAFE_INTEGER,
      diffRatio: 1,
      sizeMismatch: { actual, expected },
      channelDelta: {
        r: { mean: Infinity, max: Infinity },
        g: { mean: Infinity, max: Infinity },
        b: { mean: Infinity, max: Infinity },
        a: { mean: Infinity, max: Infinity },
      },
    });

    it('does not match when both dimensions differ', async () => {
      const result = await compareScreenshots(
        await redPng100(),
        await solidPng({ width: SQUARE_100.width * 2, height: SQUARE_100.height * 2 }, OPAQUE_GREEN)
      );

      expect(result).toEqual(
        sentinelVerdict(SQUARE_100, { width: SQUARE_100.width * 2, height: SQUARE_100.height * 2 })
      );
    });

    it('does not match when only the width differs', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: SQUARE_100.width * 2, height: SQUARE_100.height }, OPAQUE_GREEN),
        await redPng100()
      );

      expect(result).toEqual(sentinelVerdict({ width: SQUARE_100.width * 2, height: SQUARE_100.height }, SQUARE_100));
    });

    it('does not match when only the height differs', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, OPAQUE_GREEN),
        await redPng100()
      );

      expect(result).toEqual(sentinelVerdict({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, SQUARE_100));
    });

    it('preserves actual and expected sizes when argument order changes', async () => {
      const tall = await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, OPAQUE_GREEN);
      const short = await redPng100();

      expect((await compareScreenshots(tall, short)).sizeMismatch).toEqual({
        actual: { width: SQUARE_100.width, height: SQUARE_100.height * 2 },
        expected: SQUARE_100,
      });
      expect((await compareScreenshots(short, tall)).sizeMismatch).toEqual({
        actual: SQUARE_100,
        expected: { width: SQUARE_100.width, height: SQUARE_100.height * 2 },
      });
    });

    it('applies the sentinel even when the size-mismatched images share a single colour', async () => {
      const small = await solidPng(SQUARE_10, OPAQUE_RED);
      const larger = await solidPng({ width: SQUARE_10.width * 2, height: SQUARE_10.height * 2 }, OPAQUE_RED);

      expect(await compareScreenshots(small, larger)).toEqual(
        sentinelVerdict(SQUARE_10, { width: SQUARE_10.width * 2, height: SQUARE_10.height * 2 })
      );
    });

    it('still matches the smallest possible image against itself', async () => {
      const single = await solidPng(SINGLE_PIXEL, OPAQUE_RED);

      expect(await compareScreenshots(single, single)).toEqual({
        matches: true,
        diffPixels: 0,
        diffRatio: 0,
        channelDelta: NO_MOVEMENT,
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

      expect(Object.keys(result).sort()).toEqual(['channelDelta', 'diffPixels', 'diffRatio', 'matches']);
    });

    it('returns values of the documented runtime types', async () => {
      const result: CompareResult = await compareScreenshots(await redPng100(), await greenPng100());

      expect(typeof result.matches).toBe('boolean');
      expect(typeof result.diffPixels).toBe('number');
      expect(Number.isFinite(result.diffRatio)).toBe(true);
      expect(Object.keys(result.channelDelta).sort()).toEqual(['a', 'b', 'g', 'r']);
    });

    it('returns a fresh result object that callers may mutate without affecting later calls', async () => {
      const first = await compareScreenshots(await redPng100(), await redPng100());
      first.matches = false;

      const second = await compareScreenshots(await redPng100(), await redPng100());

      expect(second.matches).toBe(true);
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

    it('CompareResult includes optional size-mismatch dimensions', () => {
      expectTypeOf<CompareResult>().toEqualTypeOf<{
        matches: boolean;
        diffPixels: number;
        diffRatio: number;
        sizeMismatch?: {
          actual: { width: number; height: number };
          expected: { width: number; height: number };
        };
        channelDelta: Record<ChannelName, ChannelDelta>;
      }>();
    });

    it('ChannelDelta carries a mean and a max, both plain numbers', () => {
      expectTypeOf<ChannelDelta>().toEqualTypeOf<{ mean: number; max: number }>();
    });
  });

  describe('compareScreenshots - additional edge cases', () => {
    it('reports a size mismatch for non-square dimensions that differ in both axes', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: 100, height: 50 }, OPAQUE_RED),
        await solidPng({ width: 50, height: 100 }, OPAQUE_GREEN)
      );

      expect(result.matches).toBe(false);
      expect(result.sizeMismatch).toEqual({
        actual: { width: 100, height: 50 },
        expected: { width: 50, height: 100 },
      });
    });

    it('reports a size mismatch when dimensions share the same area but differ in shape', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: 20, height: 5 }, OPAQUE_RED),
        await solidPng({ width: 10, height: 10 }, OPAQUE_GREEN)
      );

      expect(result.matches).toBe(false);
      expect(result.sizeMismatch).toEqual({
        actual: { width: 20, height: 5 },
        expected: { width: 10, height: 10 },
      });
    });

    it('reports exactly one diff pixel for a single changed pixel in a 100x100 image', async () => {
      // A 1x1 green patch in the top-left corner of a red 100x100 field.
      const base = await patchedPng(SQUARE_100, OPAQUE_RED, [{ left: 0, top: 0, width: 1, height: 1 }]);
      const ref = await redPng100();

      // The count and ratio are exact regardless of tolerance.
      const withinDefault = await compareScreenshots(base, ref, { threshold: 0 });
      expect(withinDefault.diffPixels).toBe(1);
      expect(withinDefault.diffRatio).toBe(1 / SQUARE_100_PIXELS);

      // Within the default allowance, one pixel still matches; the interest
      // here is the precision of diffPixels and diffRatio.
      expect(withinDefault.matches).toBe(true);

      // Under a zero pixel budget, that single pixel is the difference.
      const strict = await compareScreenshots(base, ref, { threshold: 0, maxDiffPixels: 0 });
      expect(strict.matches).toBe(false);
    });

    it('forgives a 40-step red shift at threshold 0.1 but not at threshold 0', async () => {
      // 0.1 sits between the two extremes already pinned; this mid-range shift
      // survives the looser threshold but fails the exact-match threshold.
      const atZero = await compareScreenshots(await shiftedBlack(40, ['r']), await shiftedBlack(0), {
        threshold: 0,
      });

      expect(atZero.diffPixels).toBe(SQUARE_10_PIXELS);

      const atThreshold = await compareScreenshots(await shiftedBlack(40, ['r']), await shiftedBlack(0), {
        threshold: 0.1,
      });

      expect(atThreshold.diffPixels).toBe(0);
      expect(atThreshold.matches).toBe(true);
    });

    it('counts a 50-step red shift as different at threshold 0.1', async () => {
      // Well past the ~46-step boundary for red at 0.1, but well under the
      // 93-step boundary at the default 0.2 — the same image pair that this
      // suite treats as a match under the default threshold is a mismatch here.
      const atDefault = await compareScreenshots(await shiftedBlack(50, ['r']), await shiftedBlack(0));
      const atThreshold = await compareScreenshots(await shiftedBlack(50, ['r']), await shiftedBlack(0), {
        threshold: 0.1,
      });

      expect(atThreshold.diffPixels).toBe(SQUARE_10_PIXELS);
      expect(atThreshold.matches).toBe(false);
      expect(atDefault.diffPixels).toBe(0);
      expect(atDefault.matches).toBe(true);
    });

    it('reports zero diff for identical pixels encoded with different PNG compression', async () => {
      // sharp normalises compression level and metadata on decode, so two PNGs
      // of the same pixels with different byte-level encoding must compare equal.
      const lowCompression = await sharp({
        create: { width: 50, height: 50, channels: 4, background: OPAQUE_RED },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      const highCompression = await sharp({
        create: { width: 50, height: 50, channels: 4, background: OPAQUE_RED },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();

      expect(lowCompression.equals(highCompression)).toBe(false);

      const result = await compareScreenshots(lowCompression, highCompression);

      expect(result.diffPixels).toBe(0);
      expect(result.matches).toBe(true);
    });

    it('reports all four channels as moving when RGB and alpha both shift', async () => {
      // Opaque black → fully transparent white: every channel byte changes.
      // `diffPixels` blurs alpha through the checkerboard, but `channelDelta`
      // reads raw bytes and must see the move on r, g, b and a alike.
      const result = await compareScreenshots(
        await solidPng(SQUARE_10, { r: 0, g: 0, b: 0, alpha: 1 }),
        await solidPng(SQUARE_10, { r: 255, g: 255, b: 255, alpha: 0 })
      );

      expect(result.channelDelta.r).toEqual({ mean: 255, max: 255 });
      expect(result.channelDelta.g).toEqual({ mean: 255, max: 255 });
      expect(result.channelDelta.b).toEqual({ mean: 255, max: 255 });
      expect(result.channelDelta.a).toEqual({ mean: 255, max: 255 });
    });

    it('reports max per-channel delta far larger than mean for a single-pixel change', async () => {
      // One green pixel in a sea of red: max is the full 255-step swing,
      // but the mean is averaged over all 10,000 pixels.
      const result = await compareScreenshots(
        await patchedPng(SQUARE_100, OPAQUE_RED, [{ left: 0, top: 0, width: 1, height: 1 }]),
        await redPng100()
      );

      expect(result.channelDelta.r.max).toBe(OPAQUE_CHANNEL_MAX);
      expect(result.channelDelta.g.max).toBe(OPAQUE_CHANNEL_MAX);
      expect(result.channelDelta.r.mean).toBeCloseTo(OPAQUE_CHANNEL_MAX / SQUARE_100_PIXELS);
      expect(result.channelDelta.g.mean).toBeCloseTo(OPAQUE_CHANNEL_MAX / SQUARE_100_PIXELS);
      expect(result.channelDelta.b.mean).toBe(0);
      expect(result.channelDelta.a.mean).toBe(0);
    });

    it('matches identical images even when both allowances are zero', async () => {
      const result = await compareScreenshots(await redPng100(), await redPng100(), {
        maxDiffPixels: 0,
        maxDiffPixelRatio: 0,
      });

      expect(result.matches).toBe(true);
      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
    });

    it('includes sizeMismatch in the result when dimensions differ by a single pixel', async () => {
      const result = await compareScreenshots(
        await solidPng(SQUARE_10, OPAQUE_RED),
        await solidPng({ width: SQUARE_10.width, height: SQUARE_10.height + 1 }, OPAQUE_GREEN)
      );

      expect(result.matches).toBe(false);
      expect(result.sizeMismatch).toEqual({
        actual: SQUARE_10,
        expected: { width: SQUARE_10.width, height: SQUARE_10.height + 1 },
      });
      expect(Object.keys(result).sort()).toEqual([
        'channelDelta',
        'diffPixels',
        'diffRatio',
        'matches',
        'sizeMismatch',
      ]);
    });

    it('forgives a 20-step red shift at threshold 0.05 but not at threshold 0', async () => {
      // 0.05 is between the two extremes already pinned; this shift survives
      // the looser threshold but fails the exact-match threshold.
      const atZero = await compareScreenshots(await shiftedBlack(20, ['r']), await shiftedBlack(0), {
        threshold: 0,
      });

      expect(atZero.diffPixels).toBe(SQUARE_10_PIXELS);

      const atThreshold = await compareScreenshots(await shiftedBlack(20, ['r']), await shiftedBlack(0), {
        threshold: 0.05,
      });

      expect(atThreshold.diffPixels).toBe(0);
      expect(atThreshold.matches).toBe(true);
    });

    it('counts every pixel as different for a 2x2 image of solid opposing colours', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: 2, height: 2 }, OPAQUE_RED),
        await solidPng({ width: 2, height: 2 }, OPAQUE_GREEN)
      );

      expect(result.diffPixels).toBe(4);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
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
