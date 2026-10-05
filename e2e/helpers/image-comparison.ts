import compare from 'pixelmatch';
import sharp from 'sharp';

/**
 * Image comparison helper for custom visual checks.
 * For regression snapshots, prefer expect(locator).toHaveScreenshot() when a fixture exists.
 */
export interface CompareOptions {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
}

/**
 * One channel's movement across the whole image, in 8-bit steps: the average per pixel
 * and the worst single pixel.
 */
export interface ChannelDelta {
  /** Mean absolute difference over every pixel of the channel. */
  mean: number;
  /** Largest absolute difference anywhere in the channel. */
  max: number;
}

/** The four channels of a decoded RGBA buffer, in the order they sit in it. */
export type ChannelName = 'r' | 'g' | 'b' | 'a';

export interface CompareResult {
  matches: boolean;
  diffPixels: number;
  diffRatio: number;
  /**
   * Per-channel movement, which `diffPixels` is structurally blind to — see the note on
   * `measureChannelDelta`. Present on every verdict including the size-mismatch sentinel,
   * where it is `Infinity` because no channel was measured.
   */
  channelDelta: Record<ChannelName, ChannelDelta>;
  /**
   * Both decoded sizes, or `null` when they agreed. Non-null exactly when the comparison is
   * the size-mismatch sentinel, so `sizeMismatch !== null` IS the verdict a caller tests for
   * rather than inferring one from `diffPixels`.
   *
   * WHY THIS IS NOT A BOOLEAN. The sentinel reports `diffPixels: Number.MAX_SAFE_INTEGER`,
   * which is the same number an entirely-different pair of same-sized images would approach,
   * so a red export diff could not be triaged: the operator saw "every pixel differs" for a
   * 1-pixel size disagreement, which is a different defect with a different fix. Reporting the
   * two sizes names which of the pair moved and by how much, so the message can say
   * "exported 800x600 against a baseline of 800x601" instead of restating the budget failure.
   */
  sizeMismatch: { actual: CaptureSize; expected: CaptureSize } | null;
}

/**
 * The comparison defaults, in one place. `compareScreenshots` is their only reader, and
 * must read them from here: a literal written into a second function looks equal today
 * and silently becomes a different budget the day it drifts.
 *
 * WHAT A CALLER INHERITS BY DEFAULT. `DEFAULT_THRESHOLD` is 0.2, and that number is far
 * looser than it reads. pixelmatch counts a pixel different only when its YIQ distance
 * exceeds `35215 * threshold²`, so at this default a UNIFORM shift of 93 red, 75 green,
 * 157 blue, or 52 steps on all three channels together is forgiven outright over an entire
 * image — 37% of red's full scale, in one invisible step. The unit suite pins each of those
 * boundaries and the first value that is NOT forgiven, so the magnitude above is measured
 * rather than asserted. The one live call site,
 * `e2e/export/visual-regression.spec.ts`, overrides the threshold with 0.01, which forgives
 * 4 red / 3 green / 7 blue / 2 achromatic steps; no other caller uses the default at all,
 * which is what makes its value a judgement call rather than a property of this suite.
 */
export const DEFAULT_THRESHOLD = 0.2;
export const DEFAULT_MAX_DIFF_PIXELS = 100;
export const DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01;

/** The channel names, in the byte order a decoded RGBA buffer stores them. */
const CHANNEL_NAMES: readonly ChannelName[] = ['r', 'g', 'b', 'a'];
/** Bytes per pixel of a decoded RGBA buffer: one per channel. */
const BYTES_PER_PIXEL = CHANNEL_NAMES.length;

/**
 * The per-channel movement pixelmatch's own answer does not carry.
 *
 * `diffPixels` is a luma-weighted YIQ distance thresholded against one number, so a change
 * too small to cross that distance in ANY channel is not a difference to it at all: at the
 * export call site's `threshold: 0.01`, a uniform shift of up to 4 red, 3 green, 7 blue or
 * 2 alpha steps over all 480,000 pixels of an 800x600 export reports `diffPixels: 0` and
 * `matches: true`. `channelDelta` is what makes such a shift visible to a caller — asserting
 * on it is the caller's decision, and `compareScreenshots` deliberately does not make one,
 * because doing so would be a budget change and not a measurement.
 */
const measureChannelDelta = (actual: Buffer, expected: Buffer): Record<ChannelName, ChannelDelta> => {
  const totals: number[] = new Array(BYTES_PER_PIXEL).fill(0);
  const peaks: number[] = new Array(BYTES_PER_PIXEL).fill(0);
  for (let offset = 0; offset < actual.length; offset += BYTES_PER_PIXEL) {
    for (let channel = 0; channel < BYTES_PER_PIXEL; channel++) {
      const delta = Math.abs(actual[offset + channel] - expected[offset + channel]);
      totals[channel] += delta;
      if (delta > peaks[channel]) {
        peaks[channel] = delta;
      }
    }
  }
  // No zero-pixel guard, because there is no such image: `sharp` refuses a zero-dimension
  // input outright, which `__tests__/image-comparison.unit.test.ts` pins under "sharp fixture
  // guards", so this division cannot be by 0 and cannot put a NaN in `CompareResult`.
  const pixels = actual.length / BYTES_PER_PIXEL;
  return Object.fromEntries(
    CHANNEL_NAMES.map((name, channel) => [
      name,
      {
        mean: totals[channel] / pixels,
        max: peaks[channel],
      },
    ])
  ) as Record<ChannelName, ChannelDelta>;
};

/**
 * The size-mismatch verdict reports no measured channel at all, and `Infinity` says so: a
 * caller asserting `channelDelta.r.max <= 2` fails on a size mismatch, which is the correct
 * outcome, where a zero would have reported "the colour did not move".
 *
 * Built per call rather than shared, because `CompareResult` hands its objects to a caller
 * that may mutate them and the next size-mismatched comparison must not inherit the damage.
 */
const unmeasuredChannelDelta = (): Record<ChannelName, ChannelDelta> =>
  Object.fromEntries(
    CHANNEL_NAMES.map((name) => [name, { mean: Number.POSITIVE_INFINITY, max: Number.POSITIVE_INFINITY }])
  ) as Record<ChannelName, ChannelDelta>;

/**
 * A capture's decoded dimensions, in pixels, as `sharp` reports them.
 */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * Compare two PNG buffers using Node.js (sharp + pixelmatch).
 * Runs entirely in Node.js - no browser round-trip needed.
 * Much faster and more reliable than browser-based comparison.
 */
export async function compareScreenshots(
  actual: Buffer,
  expected: Buffer,
  options: CompareOptions = {}
): Promise<CompareResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxDiffPixels = options.maxDiffPixels ?? DEFAULT_MAX_DIFF_PIXELS;
  const maxDiffPixelRatio = options.maxDiffPixelRatio ?? DEFAULT_MAX_DIFF_PIXEL_RATIO;

  // Decode both images to raw sRGB RGBA.
  //
  // `.raw()` on its own returns the channels the FILE carries, so a wide-gamut baseline
  // would be compared byte-for-byte against an untagged sRGB export as though both were
  // sRGB. The explicit `.toColourspace('srgb')` is what makes that comparison mean anything;
  // a comment here used to claim sharp "handles DPR, color space, etc." for a Buffer input,
  // which it does not — it handles neither for this call shape.
  //
  // The conversion costs nothing on this suite's inputs, and that is measured rather than
  // assumed: across all ten committed export baselines and a full-spectrum image carrying
  // every 8-bit value in every channel (262,144 bytes), not one byte differs with and
  // without it. So it cannot move a committed oracle. What it buys is that a baseline
  // tagged in another space is converted rather than silently mis-compared, which is a
  // future risk closed for free rather than a present-day one fixed.
  const [actualDecoded, expectedDecoded] = await Promise.all([
    sharp(actual).ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
  ]);

  const { data: actualData, info: actualInfo } = actualDecoded;
  const { data: expectedData, info: expectedInfo } = expectedDecoded;

  if (actualInfo.width !== expectedInfo.width || actualInfo.height !== expectedInfo.height) {
    return {
      matches: false,
      diffPixels: Number.MAX_SAFE_INTEGER,
      diffRatio: 1,
      channelDelta: unmeasuredChannelDelta(),
      // The reason the sentinel exists at all, reported rather than inferred: without these two
      // numbers the caller cannot tell this apart from "the picture is completely different",
      // because `diffPixels` is MAX_SAFE_INTEGER in both cases and `matches` is false in both.
      sizeMismatch: {
        actual: { width: actualInfo.width, height: actualInfo.height },
        expected: { width: expectedInfo.width, height: expectedInfo.height },
      },
    };
  }

  // No diff output buffer. pixelmatch accepts a void third argument and skips every write
  // when it is void, and nothing here ever read what it drew: `diff` was local, its drawn
  // image had one reader — nothing — and at 800x600x4 it was 1.92 MB written per format per
  // run to be discarded. `includeAA: true` is what made that pure waste, because it
  // disables the anti-aliasing detector (`isExcludedAA = !includeAA && …`, pixelmatch :74)
  // while `drawPixel` still writes. `includeAA` stays `true` and load-bearing: flipping it
  // to `false` would EXCLUDE anti-aliased pixels from `diffPixels`, which is a budget
  // loosening, not a saving. Only the drawing was removed; the returned count is identical
  // either way, and every `diffPixels` assertion in the suite proves it.
  const diffPixels = compare(actualData, expectedData, undefined, actualInfo.width, actualInfo.height, {
    threshold,
    includeAA: true,
  });

  const diffRatio = diffPixels / (actualInfo.width * actualInfo.height);
  return {
    matches: diffPixels <= maxDiffPixels && diffRatio <= maxDiffPixelRatio,
    diffPixels,
    diffRatio,
    channelDelta: measureChannelDelta(actualData, expectedData),
    sizeMismatch: null,
  };
}
