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

/**
 * One decoded capture's own size, in its own pixels. `[IMAGE]` — no CSS and no viewport in
 * it, because it is read off the PNG and not off anything the caller measured.
 */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * The two sides of a comparison that compared no pixel, each named by the ARGUMENT it came
 * from: `actual` is the first, `expected` the second.
 *
 * Named, and not reported as a bare pair of numbers, because "the two sizes" is not the
 * diagnosis — WHICH side moved is. A capture that comes back 87 pixels short is a different
 * defect from a baseline that was re-recorded at a different size, and an unordered
 * `{width, height}` pair leaves the reader to work out which of the two happened by
 * comparing them against each other.
 */
export interface CaptureSizePair {
  /** The size of `actual`, the first argument to `compareScreenshots`. */
  actual: CaptureSize;
  /** The size of `expected`, the second argument to `compareScreenshots`. */
  expected: CaptureSize;
}

/**
 * A verdict. Its four figures are MEASURED when `sizeMismatch` is absent, and are sentinels
 * when it is present — so `sizeMismatch` is the field that says which of the two a caller is
 * holding, and it is the one thing here that is not a number.
 *
 * `channelDelta` is present on every verdict including the size-mismatch one, where it is
 * `Infinity` because no channel was measured.
 */
export interface CompareResult {
  matches: boolean;
  /**
   * Differing pixels. A measured count whenever `sizeMismatch` is absent; on a size mismatch
   * it is `Number.MAX_SAFE_INTEGER`, a sentinel rather than a count — see `sizeMismatch`.
   */
  diffPixels: number;
  /** Differing pixels over the image's pixel total, on the same terms as `diffPixels`. */
  diffRatio: number;
  /**
   * Per-channel movement, which `diffPixels` is structurally blind to — see the note on
   * `measureChannelDelta`. Present on every verdict including the size-mismatch sentinel,
   * where it is `Infinity` because no channel was measured.
   */
  channelDelta: Record<ChannelName, ChannelDelta>;
  /**
   * The two captures' real dimensions, PRESENT ONLY when they differ, and ABSENT — not null,
   * not `{0,0}` — on every comparable comparison.
   *
   * Absent rather than always-present so that a comparable comparison's own keys stay
   * exactly the four it has always reported: a result object that grew a filler field on the
   * path every caller depends on would change what a matching comparison reports in order to
   * describe a case that is not one.
   *
   * Its presence is what makes the other three figures honest. A size mismatch reports
   * `matches: false`, `diffPixels: Number.MAX_SAFE_INTEGER` and `diffRatio: 1`, which is a
   * budget check that cannot be argued with; a reader holding this field knows those are not
   * measurements and can go to the two numbers that are the actual diagnosis.
   */
  sizeMismatch?: CaptureSizePair;
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

  // THE SIZE MISMATCH, and the one case where the sizes are the whole diagnosis.
  //
  // pixelmatch needs both buffers to be the same size, so the comparison below cannot run at
  // all here and every figure in the returned object is a sentinel rather than a measurement.
  // The sentinels are load-bearing and stay: `diffPixels: Number.MAX_SAFE_INTEGER` is
  // consulted BEFORE the `maxDiffPixels` budget, which is what makes a capture that came
  // back a different size fail loudly on the first run rather than degrade into a quiet
  // "close enough" — and `diffRatio: 1` keeps it failing for a caller that reads only the
  // ratio.
  //
  // What used to be missing is the reason. This branch returned `matches: false` and
  // nothing about either image, so a capture 87 pixels short — the drift
  // `e2e/OPEN_PROBLEMS.md` records against `captureCanvasScreenshot`, where the page came
  // back 87 CSS px shorter than the one the caller measured — reported "every pixel is
  // different" and never said so. The two images were never comparable, so reporting their
  // difference as a pixel count was the one thing a size mismatch must not do; naming both
  // sides' dimensions is what turns the sentinel back into a diagnosis. `sizeMismatch` is
  // also what says the figures beside it are not measurements, and the matching path below
  // does not carry it at all, so its presence is the whole difference between a count and a
  // sentinel.
  if (actualInfo.width !== expectedInfo.width || actualInfo.height !== expectedInfo.height) {
    return {
      matches: false,
      diffPixels: Number.MAX_SAFE_INTEGER,
      diffRatio: 1,
      channelDelta: unmeasuredChannelDelta(),
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
  };
}
