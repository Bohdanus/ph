import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  DEFAULT_MAX_DIFF_PIXELS,
  DEFAULT_MAX_DIFF_PIXEL_RATIO,
  DEFAULT_THRESHOLD,
  compareScreenshots,
  expectCanvasToMatch,
  saveScreenshotArtifact,
} from '../image-comparison';
import type { CompareOptions, CompareResult } from '../image-comparison';

type ScreenshotOptions = NonNullable<Parameters<Page['screenshot']>[0]>;
type ClipRegion = { x: number; y: number; width: number; height: number };
type Rgba = { r: number; g: number; b: number; alpha: number };
type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
type CanvasScreenshotOptions = {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
  mask?: Locator[];
  animations?: 'disabled' | 'allow';
  caret?: 'hide' | 'initial';
  scale?: 'css' | 'device';
};

const { expectMock, toHaveScreenshotMock } = vi.hoisted(() => {
  const hoistedToHaveScreenshot = vi.fn<(name: string, options?: CanvasScreenshotOptions) => Promise<void>>();
  const hoistedExpect = vi.fn((_actual: unknown) => ({ toHaveScreenshot: hoistedToHaveScreenshot }));
  return { expectMock: hoistedExpect, toHaveScreenshotMock: hoistedToHaveScreenshot };
});

vi.mock('@playwright/test', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@playwright/test')>()),
  expect: expectMock,
}));

const createMockPage = (screenshot: Page['screenshot']): Page => ({ screenshot }) as Page;
const createMockTestInfo = (outputDir: string, attach: TestInfo['attach']): TestInfo =>
  ({ outputDir, attach }) as TestInfo;
const createMockLocator = (partial: Partial<Locator> = {}): Locator => partial as Locator;
const noOpScreenshot = () => vi.fn(async (): Promise<Buffer> => Buffer.alloc(0));

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

const requireNumeric = (value: number | undefined, label: string): number => {
  if (typeof value !== 'number') {
    throw new Error(`expected a numeric ${label}, received ${String(value)}`);
  }
  return value;
};

const recordedSnapshot = (callIndex = 0): string => {
  const call = toHaveScreenshotMock.mock.calls[callIndex];
  if (!call) throw new Error(`toHaveScreenshot was not called at index ${callIndex}`);
  return call[0];
};

const recordedCanvasOptions = (callIndex = 0): CanvasScreenshotOptions => {
  const call = toHaveScreenshotMock.mock.calls[callIndex];
  if (!call) throw new Error(`toHaveScreenshot was not called at index ${callIndex}`);
  const [, options] = call;
  if (!options) throw new Error(`toHaveScreenshot was called without options at index ${callIndex}`);
  return options;
};

const recordedCanvas = (callIndex = 0): unknown => {
  const call = expectMock.mock.calls[callIndex];
  if (!call) throw new Error(`expect was not called at index ${callIndex}`);
  return call[0];
};

const recordedScreenshotOptions = (
  screenshot: { mock: { calls: [ScreenshotOptions?][] } },
  callIndex = 0
): ScreenshotOptions => {
  const call = screenshot.mock.calls[callIndex];
  if (!call) throw new Error(`page.screenshot was not called at index ${callIndex}`);
  const [options] = call;
  if (!options) throw new Error(`page.screenshot was called without options at index ${callIndex}`);
  return options;
};

const fileExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const createScreenshotWriter = (payload: Buffer) =>
  vi.fn(async (options?: ScreenshotOptions): Promise<Buffer> => {
    const target = options?.path;
    if (target) await fs.writeFile(target, payload);
    return payload;
  });

const createFailingScreenshot = (error: Error) =>
  vi.fn(async (): Promise<Buffer> => {
    throw error;
  });

const attachMock = () => vi.fn(async () => {});

let outputDir = '';

beforeAll(async () => {
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-comparison-'));
});

afterAll(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
});

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

  describe('saveScreenshotArtifact', () => {
    const artifactPath = (name: string) => path.join(outputDir, `${name}.png`);

    it('writes the artifact into outputDir and attaches that exact path', async () => {
      const name = 'written-artifact';
      const payload = await redPng100();
      const screenshot = createScreenshotWriter(payload);
      const attach = attachMock();

      const returned = await saveScreenshotArtifact(
        createMockPage(screenshot),
        createMockTestInfo(outputDir, attach),
        name
      );

      expect(returned).toBe(payload);
      expect(recordedScreenshotOptions(screenshot).path).toBe(artifactPath(name));
      expect(await fileExists(artifactPath(name))).toBe(true);
      expect(await fs.readFile(artifactPath(name))).toEqual(payload);
      expect(attach).toHaveBeenCalledTimes(1);
      expect(attach).toHaveBeenCalledWith(name, { path: artifactPath(name), contentType: 'image/png' });
    });

    it('requests the screenshot with animations disabled', async () => {
      const screenshot = createScreenshotWriter(await redPng100());

      await saveScreenshotArtifact(
        createMockPage(screenshot),
        createMockTestInfo(outputDir, attachMock()),
        'animations'
      );

      expect(recordedScreenshotOptions(screenshot).animations).toBe('disabled');
    });

    it('forwards a clip region when provided', async () => {
      const clip: ClipRegion = { x: 10, y: 20, width: 30, height: 40 };
      const screenshot = createScreenshotWriter(await redPng100());

      await saveScreenshotArtifact(createMockPage(screenshot), createMockTestInfo(outputDir, attachMock()), 'clipped', {
        clip,
      });

      expect(recordedScreenshotOptions(screenshot).clip).toEqual(clip);
    });

    it('omits the clip key entirely when no clip is provided', async () => {
      const screenshot = createScreenshotWriter(await redPng100());

      await saveScreenshotArtifact(
        createMockPage(screenshot),
        createMockTestInfo(outputDir, attachMock()),
        'unclipped'
      );

      expect(Object.hasOwn(recordedScreenshotOptions(screenshot), 'clip')).toBe(false);
    });

    it('surfaces a page.screenshot failure and attaches nothing', async () => {
      const failure = new Error('browser closed');
      const attach = attachMock();

      await expect(
        saveScreenshotArtifact(
          createMockPage(createFailingScreenshot(failure)),
          createMockTestInfo(outputDir, attach),
          'screenshot-failure'
        )
      ).rejects.toThrow(failure);

      expect(attach).not.toHaveBeenCalled();
      expect(await fileExists(artifactPath('screenshot-failure'))).toBe(false);
    });

    it('surfaces a testInfo.attach failure while keeping the written artifact', async () => {
      const name = 'attach-failure';
      const failure = new Error('report already closed');
      const attach = vi.fn(async () => {
        throw failure;
      });

      await expect(
        saveScreenshotArtifact(
          createMockPage(createScreenshotWriter(await redPng100())),
          createMockTestInfo(outputDir, attach),
          name
        )
      ).rejects.toThrow(failure);

      expect(await fileExists(artifactPath(name))).toBe(true);
    });

    it('forwards an invalid clip to Playwright unchanged instead of masking it', async () => {
      const invalidClip = { x: 0, y: 0, width: -PATCH_SIDE, height: PATCH_SIDE };
      const screenshot = vi.fn(async (options?: ScreenshotOptions): Promise<Buffer> => {
        if (options?.clip && options.clip.width <= 0) {
          throw new Error('Clipped area is either empty or outside the resulting image');
        }
        return Buffer.alloc(0);
      });
      const attach = attachMock();

      await expect(
        saveScreenshotArtifact(createMockPage(screenshot), createMockTestInfo(outputDir, attach), 'invalid-clip', {
          clip: invalidClip,
        })
      ).rejects.toThrow('Clipped area is either empty or outside the resulting image');

      expect(recordedScreenshotOptions(screenshot).clip).toEqual(invalidClip);
      expect(attach).not.toHaveBeenCalled();
      expect(await fileExists(artifactPath('invalid-clip'))).toBe(false);
    });

    it('delegates the write to Playwright instead of writing the file itself', async () => {
      const screenshot = noOpScreenshot();
      const attach = attachMock();

      await saveScreenshotArtifact(
        createMockPage(screenshot),
        createMockTestInfo(outputDir, attach),
        'delegated-write'
      );

      expect(recordedScreenshotOptions(screenshot).path).toBe(artifactPath('delegated-write'));
      expect(await fileExists(artifactPath('delegated-write'))).toBe(false);
      expect(attach).toHaveBeenCalledWith('delegated-write', {
        path: artifactPath('delegated-write'),
        contentType: 'image/png',
      });
    });
  });

  describe('expectCanvasToMatch', () => {
    const snapshotName = 'canvas-snapshot.png';
    const canvas = createMockLocator();

    interface HelperDefaults {
      threshold: number;
      maxDiffPixels: number;
      maxDiffPixelRatio: number;
    }

    let helperDefaults: HelperDefaults;

    beforeAll(async () => {
      await expectCanvasToMatch(canvas, snapshotName);
      const options = recordedCanvasOptions();
      helperDefaults = {
        threshold: requireNumeric(options.threshold, 'threshold'),
        maxDiffPixels: requireNumeric(options.maxDiffPixels, 'maxDiffPixels'),
        maxDiffPixelRatio: requireNumeric(options.maxDiffPixelRatio, 'maxDiffPixelRatio'),
      };
    });

    beforeEach(() => {
      expectMock.mockClear();
      toHaveScreenshotMock.mockClear();
    });

    it('forwards the canvas it was given to the visual assertion', async () => {
      await expectCanvasToMatch(canvas, snapshotName);

      expect(expectMock).toHaveBeenCalledTimes(1);
      expect(recordedCanvas()).toBe(canvas);
    });

    it('forwards the snapshot name unchanged', async () => {
      await expectCanvasToMatch(canvas, snapshotName);

      expect(recordedSnapshot()).toBe(snapshotName);
    });

    it('forwards the helper defaults plus the fixed visual options', async () => {
      await expectCanvasToMatch(canvas, snapshotName);

      expect(recordedCanvasOptions()).toEqual({
        ...helperDefaults,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
      // helperDefaults is captured from the call under test, so pin the literals separately.
      const options = recordedCanvasOptions();
      expect(options.threshold).toBe(0.2);
      expect(options.maxDiffPixels).toBe(100);
      expect(options.maxDiffPixelRatio).toBe(0.01);
    });

    it('keeps the default threshold in sync with the exported DEFAULT_THRESHOLD', async () => {
      await expectCanvasToMatch(canvas, snapshotName);

      expect(helperDefaults.threshold).toBe(DEFAULT_THRESHOLD);
    });

    it('keeps its diff-pixel budget and ratio in sync with the exported defaults', async () => {
      await expectCanvasToMatch(canvas, snapshotName);

      expect(helperDefaults.maxDiffPixels).toBe(DEFAULT_MAX_DIFF_PIXELS);
      expect(helperDefaults.maxDiffPixelRatio).toBe(DEFAULT_MAX_DIFF_PIXEL_RATIO);
    });

    it('applies partial overrides while retaining the untouched defaults', async () => {
      const threshold = helperDefaults.threshold / 2;
      const maxDiffPixels = helperDefaults.maxDiffPixels / 2;

      await expectCanvasToMatch(canvas, snapshotName, { threshold, maxDiffPixels });

      expect(recordedCanvasOptions()).toEqual({
        ...helperDefaults,
        threshold,
        maxDiffPixels,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
    });

    it('forwards a mask list through to the visual assertion', async () => {
      const mask = [createMockLocator(), createMockLocator()];

      await expectCanvasToMatch(canvas, snapshotName, { mask });

      expect(recordedCanvasOptions().mask).toBe(mask);
      expect(recordedCanvasOptions().threshold).toBe(helperDefaults.threshold);
    });

    it('awaits the visual assertion before resolving', async () => {
      let resolved = false;
      toHaveScreenshotMock.mockImplementationOnce(async () => {
        await Promise.resolve();
        resolved = true;
      });

      await expectCanvasToMatch(canvas, snapshotName);

      expect(resolved).toBe(true);
    });

    it('surfaces a visual assertion failure to the caller', async () => {
      const failure = new Error('toHaveScreenshot failed');
      toHaveScreenshotMock.mockRejectedValueOnce(failure);

      await expect(expectCanvasToMatch(canvas, snapshotName)).rejects.toThrow(failure);
    });

    it('tolerates an explicit undefined mask without replacing the other defaults', async () => {
      await expectCanvasToMatch(canvas, snapshotName, { mask: undefined });

      const options = recordedCanvasOptions();
      expect(options.mask).toBeUndefined();
      expect(options.threshold).toBe(helperDefaults.threshold);
      expect(options.maxDiffPixels).toBe(helperDefaults.maxDiffPixels);
      expect(options.animations).toBe('disabled');
    });

    it('reapplies the default threshold when the caller passes an explicit undefined threshold', async () => {
      await expectCanvasToMatch(canvas, snapshotName, { threshold: undefined });

      expect(requireNumeric(recordedCanvasOptions().threshold, 'threshold')).toBe(DEFAULT_THRESHOLD);
    });

    it('reapplies the default diff-pixel budget when the caller passes an explicit undefined budget', async () => {
      await expectCanvasToMatch(canvas, snapshotName, { maxDiffPixels: undefined });

      expect(requireNumeric(recordedCanvasOptions().maxDiffPixels, 'maxDiffPixels')).toBe(helperDefaults.maxDiffPixels);
    });

    const invalidCanvases: [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['a plain object', {}],
      ['a string', 'canvas'],
      ['a number', 0],
    ];

    it.each(invalidCanvases)(
      'hands an invalid canvas (%s) to the visual assertion instead of silently skipping it',
      async (_label, invalidCanvas) => {
        await expectCanvasToMatch(invalidCanvas as Locator, snapshotName);

        expect(expectMock).toHaveBeenCalledTimes(1);
        expect(recordedCanvas()).toBe(invalidCanvas);
        expect(toHaveScreenshotMock).toHaveBeenCalledTimes(1);
      }
    );

    it('propagates a failure from building the visual assertion without wrapping it', async () => {
      const failure = new Error('expect() may only be used inside a Playwright test');
      expectMock.mockImplementationOnce(() => {
        throw failure;
      });

      await expect(expectCanvasToMatch(canvas, snapshotName)).rejects.toThrow(failure);
      expect(toHaveScreenshotMock).not.toHaveBeenCalled();
    });
  });
});
