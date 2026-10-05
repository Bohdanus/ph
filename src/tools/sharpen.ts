import { clampChannel, pixelIndex } from '../util/pixels.ts';
import type { RasterRowTarget } from '../util/homography-resample.ts';
import { compositeStrokeFootprint } from '../util/focus-stroke-mask.ts';
import type { Point, Pos } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type SharpenToolArgs = {
  amount: number;
  radius: number;
  points?: Point[];
  rasterBounds?: Pos;
  toolName: 'sharpen';
};

/**
 * The kernel floor on the STROKE path only, mirroring `blur.ts`.
 *
 * The whole-layer form rounds a sub-half-texel `radius` to 0 and returns the source untouched.
 * A stroke is different: the brush is live under the pointer, so a zero-span box would make the
 * tool look broken while the bar reads 0. One texel keeps the stroke visible, and the two forms
 * deliberately disagree at `radius` 0.
 */
const STROKE_SPAN_FLOOR = 1;

/**
 * `Amount` is a PERCENTAGE, as in Photoshop, and 0 is a legal choice: 0% is the
 * identity and is what the slider's own left end says. The ceiling is Photoshop's 500%.
 */
export const SHARPEN_AMOUNT_MIN = 0;
export const SHARPEN_AMOUNT_MAX = 500;

/** The divisor that turns the percentage above into the unsharp mask's multiplier. */
export const SHARPEN_AMOUNT_SCALE = 100;

/**
 * `Radius` is in PIXELS and 0 is a legal choice: a zero-radius box is a one-texel
 * kernel whose mean is the pixel itself, which makes the filter an exact identity in
 * exact arithmetic (and bit-identical in float, since the whole convolution is skipped
 * below rather than computed).
 *
 * The ceiling is 100 rather than the 250 Photoshop's Sharpen dialog allows, for the same
 * reason `BRUSH_SIZE_MAX` is 500 rather than 5000: this is a filter over the raster, and
 * a 250px radius is a 501-wide kernel walked over every pixel of the document on every
 * frame of a slider drag. 100 keeps the neighbour walk linear and bounded without
 * narrowing the control to a range where nothing visible happens.
 */
export const SHARPEN_RADIUS_MIN = 0;
export const SHARPEN_RADIUS_MAX = 100;

/** `Size` reduced to the integer extents a pixel buffer can address. */
const rasterSize = (size: { width: number; height: number }): { width: number; height: number } => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/**
 * Clamp one slider into its Photoshop range, substituting the NEAR end for a non-finite
 * value rather than throwing.
 *
 * The near end is 0 for both sliders, and 0 is the identity filter, so a `NaN` that
 * reached the kernel would not be able to hang the tab the way a `NaN` radius does in a
 * neighbourhood mean (`tipAlphaAt`'s own JSDoc makes that argument for `brushDabCenters`).
 * `Math.max` propagates `NaN`, and a `NaN` here would make `taps` `NaN` and every
 * divisor with it — a loop that silently emits transparent black instead of an error.
 */
const clampSetting = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/**
 * Add (`sign` 1) or subtract (`sign` -1) one pixel into a four-channel accumulator,
 * PREMULTIPLIED.
 *
 * The premultiply is the whole alpha strategy of this file, so it is stated here once at
 * the arithmetic that implements it rather than at the call site that depends on it.
 */
const accumulatePixel = (data: Uint8ClampedArray, pixelOffset: number, sums: Float64Array, sign: number): void => {
  const alpha = data[pixelOffset + 3];
  const factor = alpha / 255;

  sums[0] += sign * data[pixelOffset] * factor;
  sums[1] += sign * data[pixelOffset + 1] * factor;
  sums[2] += sign * data[pixelOffset + 2] * factor;
  sums[3] += sign * alpha;
};

/**
 * The horizontal half of the blur: one box pass per row, running accumulator, O(1) per
 * pixel regardless of radius.
 *
 * THE KERNEL IS A BOX, NOT A GAUSSIAN, AND THAT IS THE POINT. A true Gaussian has no
 * finite support, so the usual approximations either truncate it (three box passes at
 * sigma/2.4, still three passes) or sample a per-pixel neighbourhood (O(radius^2) per
 * pixel, which is the naive mean this file exists to avoid: at `SHARPEN_RADIUS_MAX` it
 * would be 40000 additions per pixel and a 100px radius would hang the tab). One box pass
 * is the cheapest kernel that actually removes low frequencies, which is the only thing
 * the unsharp mask needs from it: `source - blurred` must vanish on a flat field and
 * survive on detail, and a box already does both.
 *
 * `sums` is a four-slot accumulator reused across every column of every row, so the pass
 * allocates once for the whole image. It is a `Float64Array` on purpose: every term is an
 * integer below 255 and the running total stays under `201 * 255`, so a double accumulates
 * the window exactly, and the only rounding in the pass is the single division by `taps`.
 */
const horizontalBoxPass = (
  data: Uint8ClampedArray,
  horizontal: Float32Array,
  width: number,
  height: number,
  radius: number
): void => {
  const taps = radius * 2 + 1;
  const sums = new Float64Array(4);

  for (let y = 0; y < height; y++) {
    const rowStart = pixelIndex(0, y, width);
    sums.fill(0);

    // The window for `x = 0` is columns `[-radius, radius]` with the edge REPLICATED, so
    // it is `radius + 1` reads of column 0 followed by columns `1..radius` clamped to the
    // last column. Counting TERMS rather than columns is what keeps the divisor at `taps`
    // when `radius >= width` and the window covers the row several times over.
    for (let repeat = 0; repeat <= radius; repeat++) accumulatePixel(data, rowStart, sums, 1);
    for (let x = 1; x <= radius; x++) {
      accumulatePixel(data, rowStart + Math.min(x, width - 1) * 4, sums, 1);
    }

    for (let x = 0; x < width; x++) {
      const offset = rowStart + x * 4;
      horizontal[offset] = sums[0] / taps;
      horizontal[offset + 1] = sums[1] / taps;
      horizontal[offset + 2] = sums[2] / taps;
      horizontal[offset + 3] = sums[3] / taps;

      if (x + 1 >= width) break;
      // Slide the window one column right: `x - radius` leaves it, `x + radius + 1` joins,
      // each clamped to a real column so the replication stays exact.
      accumulatePixel(data, rowStart + Math.max(0, x - radius) * 4, sums, -1);
      accumulatePixel(data, rowStart + Math.min(width - 1, x + radius + 1) * 4, sums, 1);
    }
  }
};

/**
 * Add (`sign` 1) or subtract (`sign` -1) one whole row of the horizontal pass into the
 * per-column accumulators the vertical pass holds across rows.
 */
const accumulateRow = (
  horizontal: Float32Array,
  sums: Float32Array,
  row: number,
  width: number,
  sign: number
): void => {
  const rowStart = row * width * 4;
  for (let i = 0; i < width * 4; i++) sums[i] += sign * horizontal[rowStart + i];
};

/**
 * One output row of the unsharp mask, written into `strip`.
 *
 * THE HALO IS AVOIDED BY PREMULTIPLYING, AND THIS IS THE ARITHMETIC THAT SAYS SO. The
 * unsharp mask is `source + amount * (source - blurred)`, and on a hard alpha edge the
 * difference term is huge in both directions. Applied to alpha as if it were a plain
 * channel, the ring just inside an opaque region goes negative (the region's own blurred
 * alpha is above its alpha) and the ring just outside it goes above 255; applied to STRAIGHT
 * colour, a fully transparent neighbour still contributes its stored RGB to the mean, so a
 * hole with hidden colour bleeds a ring into the opaque side. Both are the halo, and both
 * are wrong for a filter whose only job is to increase local contrast.
 *
 * So the blur runs on PREMULTIPLIED colour, the overshoot is clamped at 0 there (a
 * premultiplied channel below zero has no colour to describe, so a negative one is not a
 * dark pixel but a broken one), alpha is unsharp-masked and clamped on its own 0-255
 * scale, and the straight colour is recovered by dividing out the sharpened alpha. The
 * division is `unpremultiplyRgba`'s (`src/util/pixels.ts:371`) inlined for the same reason
 * the resampler inlines it at `src/util/homography-resample.ts:115-117`: one object per
 * pixel is a per-pixel allocation, and this runs over every pixel of the document on every
 * frame of a slider drag.
 */
const sharpenRow = (
  data: Uint8ClampedArray,
  sums: Float32Array,
  row: number,
  width: number,
  taps: number,
  factor: number,
  strip: ImageData
): void => {
  const pixels = strip.data;

  for (let x = 0; x < width; x++) {
    const source = pixelIndex(x, row, width);
    // The same byte offset in all three buffers: `strip` is one row of `width` pixels, and
    // `sums` is indexed in the image's own row-major layout, so `x * 4` addresses the column
    // of the row being emitted in each of them.
    const offset = x * 4;

    const sourceAlpha = data[source + 3];
    const sharpenAlpha = clampChannel(sourceAlpha + factor * (sourceAlpha - sums[offset + 3] / taps));
    const premultiply = sourceAlpha / 255;

    for (let channel = 0; channel < 3; channel++) {
      const straight = data[source + channel] * premultiply;
      const sharpened = straight + factor * (straight - sums[offset + channel] / taps);
      const premultiplied = clampChannel(sharpened);
      // `clampChannel` maps a non-finite channel to 0 rather than letting it through, so a
      // single bad term blackens one pixel instead of the whole output.
      pixels[offset + channel] = sharpenAlpha > 0 ? premultiplied * (255 / sharpenAlpha) : 0;
    }
    pixels[offset + 3] = sharpenAlpha;
  }
};

/**
 * Photoshop's Sharpen Tool: a real unsharp mask over the raster.
 *
 * `out = source + amount * (source - boxBlur(source, radius))`, with the blur split into
 * exactly TWO passes — one horizontal, one vertical — because a box blur factorises that way
 * and each pass is a running accumulator, so the cost is O(pixels) per pass rather than
 * O(pixels * radius^2).
 *
 * This is not a `ctx.filter` string, and there is no CSS sharpen filter to reach for
 * either. `blur.ts` gets away with `ctx.filter = 'blur(8px)'` precisely because the browser
 * has a cheap, already-implemented route to that ONE kernel; unsharp masking is `source
 * minus a blurred copy`, and a canvas filter string can only express the blurred copy, never
 * the subtraction. The subtraction is the tool.
 *
 * The output is emitted ROW-AT-A-TIME through the same `RasterRowTarget` seam
 * `resampleThroughHomographyRowByRow` (`src/util/homography-resample.ts:128-141`) uses, for
 * the same reason: the one-row `ImageData` strip is allocated once and rewritten per row, so
 * peak output memory is one row rather than a second full-image buffer. The blur itself
 * cannot stream that way — its vertical pass reads rows the horizontal pass has not written
 * yet — so the horizontal result is the one full-size float buffer the pass spends, about
 * 16 bytes per pixel.
 *
 * `amount` 0 and `radius` 0 both return the drawn source untouched and skip the
 * convolution entirely. That is a fast path rather than the only guarantee: a zero-radius
 * box is a one-texel kernel whose mean is the pixel, and a zero multiplier makes the
 * difference term vanish, so both are identities in exact arithmetic. Returning early is
 * what makes them bit-identical in float as well.
 */
export const sharpen =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ amount, radius, points }: SharpenToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(bitmap, 0, 0);

    const { width, height } = rasterSize(size);
    if (width < 1 || height < 1) return [canvas];

    // The reduced-canvas guard the raster processors already use
    // (`src/tools/gradient.ts:126`): with no read-back there is no buffer to convolve, and
    // the source already drawn above is the honest answer rather than a throw.
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

    const factor = clampSetting(amount, SHARPEN_AMOUNT_MIN, SHARPEN_AMOUNT_MAX) / SHARPEN_AMOUNT_SCALE;
    // A fractional box radius has no meaning — the kernel is `2 * radius + 1` WHOLE texels
    // wide — so Photoshop's fractional steps round here rather than silently becoming a box
    // one texel narrower than the slider reads. It also means a `radius` below 0.5 rounds
    // to 0, which is the identity filter, and that is the same contract `brushDabCenters`
    // has for a non-positive size.
    const stroked = Boolean(points?.length);
    const span = Math.round(
      clampSetting(stroked ? Math.max(STROKE_SPAN_FLOOR, radius) : radius, SHARPEN_RADIUS_MIN, SHARPEN_RADIUS_MAX)
    );
    if (factor === 0 || span === 0) return [canvas];

    const source = ctx.getImageData(0, 0, width, height);
    const data = source.data;
    const taps = span * 2 + 1;

    const horizontal = new Float32Array(width * height * 4);
    horizontalBoxPass(data, horizontal, width, height, span);

    const target: RasterRowTarget = ctx;
    const strip = target.createImageData(width, 1);
    const sums = new Float32Array(width * 4);

    // The window for row 0 is rows `[-span, span]` with the edge row REPLICATED: `span + 1`
    // reads of row 0, then rows `1..span` clamped to the last row. Identical in form to the
    // horizontal pass's own seeding, because the two passes are the same box filter on two
    // axes.
    for (let repeat = 0; repeat <= span; repeat++) accumulateRow(horizontal, sums, 0, width, 1);
    for (let y = 1; y <= span; y++) accumulateRow(horizontal, sums, Math.min(y, height - 1), width, 1);

    for (let row = 0; row < height; row++) {
      sharpenRow(data, sums, row, width, taps, factor, strip);
      target.putImageData(strip, 0, row);
      if (row + 1 >= height) break;

      // Slide the window one row down: `row - span` leaves it, `row + span + 1` joins.
      // Replicating rather than renormalising is what keeps the divisor a constant `taps`
      // and the accumulator O(1) per row.
      accumulateRow(horizontal, sums, Math.max(0, row - span), width, -1);
      accumulateRow(horizontal, sums, Math.min(height - 1, row + span + 1), width, 1);
    }

    return [stroked ? compositeStrokeFootprint(bitmap, canvas, size, points!) : canvas];
  };
