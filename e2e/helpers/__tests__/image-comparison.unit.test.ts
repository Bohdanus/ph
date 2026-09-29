import sharp from 'sharp';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEFAULT_THRESHOLD, compareScreenshots } from '../image-comparison';
import type { CompareOptions, CompareResult } from '../image-comparison';

type Rgba = { r: number; g: number; b: number; alpha: number };
type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

const OPAQUE_RED: Rgba = { r: 255, g: 0, b: 0, alpha: 1 };
const OPAQUE_GREEN: Rgba = { r: 0, g: 255, b: 0, alpha: 1 };
const NEAR_RED: Rgba = { r: 255, g: 10, b: 0, alpha: 1 };
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

const solidPng = (size: Size, background: Rgba): Promise<Buffer> =>
  sharp({ create: { width: size.width, height: size.height, channels: 4, background } })
    .png()
    .toBuffer();

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

describe('Image Comparison Helpers', () => {
  describe('DEFAULT_THRESHOLD', () => {
    it('is 0.2', () => {
      expect(DEFAULT_THRESHOLD).toBe(0.2);
    });

    it('is the threshold compareScreenshots applies when no override is given', async () => {
      const base = await redPng100();
      const nearIdentical = await solidPng(SQUARE_100, NEAR_RED);

      const implicit = await compareScreenshots(nearIdentical, base);
      const explicit = await compareScreenshots(nearIdentical, base, { threshold: DEFAULT_THRESHOLD });

      expect(implicit).toEqual(explicit);
      expect(implicit.diffPixels).toBe(0);
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
      expect(await compareScreenshots(first, second)).toEqual({ matches: true, diffPixels: 0, diffRatio: 0 });
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
    const sentinelVerdict = { matches: false, diffPixels: Number.MAX_SAFE_INTEGER, diffRatio: 1 };

    it('does not match when both dimensions differ', async () => {
      const result = await compareScreenshots(
        await redPng100(),
        await solidPng({ width: SQUARE_100.width * 2, height: SQUARE_100.height * 2 }, OPAQUE_GREEN)
      );

      expect(result).toEqual(sentinelVerdict);
    });

    it('does not match when only the width differs', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: SQUARE_100.width * 2, height: SQUARE_100.height }, OPAQUE_GREEN),
        await redPng100()
      );

      expect(result).toEqual(sentinelVerdict);
    });

    it('does not match when only the height differs', async () => {
      const result = await compareScreenshots(
        await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, OPAQUE_GREEN),
        await redPng100()
      );

      expect(result).toEqual(sentinelVerdict);
    });

    it('reports the same sentinel regardless of argument order', async () => {
      const tall = await solidPng({ width: SQUARE_100.width, height: SQUARE_100.height * 2 }, OPAQUE_GREEN);
      const short = await redPng100();

      expect(await compareScreenshots(tall, short)).toEqual(await compareScreenshots(short, tall));
    });

    it('applies the sentinel even when the size-mismatched images share a single colour', async () => {
      const small = await solidPng(SQUARE_10, OPAQUE_RED);
      const larger = await solidPng({ width: SQUARE_10.width * 2, height: SQUARE_10.height * 2 }, OPAQUE_RED);

      expect(await compareScreenshots(small, larger)).toEqual(sentinelVerdict);
    });

    it('still matches the smallest possible image against itself', async () => {
      const single = await solidPng(SINGLE_PIXEL, OPAQUE_RED);

      expect(await compareScreenshots(single, single)).toEqual({ matches: true, diffPixels: 0, diffRatio: 0 });
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
    it('counts near-identical pixels as different at a zero threshold', async () => {
      const result = await compareScreenshots(await solidPng(SQUARE_100, NEAR_RED), await redPng100(), {
        threshold: 0,
      });

      expect(result.diffPixels).toBe(SQUARE_100_PIXELS);
      expect(result.diffRatio).toBe(1);
      expect(result.matches).toBe(false);
    });

    it('ignores near-identical pixels at the default threshold', async () => {
      const result = await compareScreenshots(await solidPng(SQUARE_100, NEAR_RED), await redPng100());

      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.matches).toBe(true);
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
      const nearIdentical = await solidPng(SQUARE_100, NEAR_RED);

      expect(await compareScreenshots(nearIdentical, base, { threshold: undefined })).toEqual(
        await compareScreenshots(nearIdentical, base)
      );
    });

    it('treats an empty options object as no options', async () => {
      const actual = await redPng100();
      const expected = await greenPng100();

      expect(await compareScreenshots(actual, expected, {})).toEqual(await compareScreenshots(actual, expected));
    });
  });

  describe('compareScreenshots - result contract', () => {
    it('returns exactly the documented result keys', async () => {
      const result = await compareScreenshots(await redPng100(), await redPng100());

      expect(Object.keys(result).sort()).toEqual(['diffPixels', 'diffRatio', 'matches']);
    });

    it('returns values of the documented runtime types', async () => {
      const result: CompareResult = await compareScreenshots(await redPng100(), await greenPng100());

      expect(typeof result.matches).toBe('boolean');
      expect(typeof result.diffPixels).toBe('number');
      expect(Number.isFinite(result.diffRatio)).toBe(true);
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

    it('CompareResult has matches, diffPixels, diffRatio', () => {
      expectTypeOf<CompareResult>().toEqualTypeOf<{
        matches: boolean;
        diffPixels: number;
        diffRatio: number;
      }>();
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
