import type { Point, Size } from '../contexts/general-types.ts';

/**
 * The shared pixel-buffer primitive layer.
 *
 * Nothing in `src/util` used to own buffer addressing. Every pixel loop spelled
 * its own arithmetic, and the three surviving copies disagree about what a pixel
 * index even is: `getIndex` in `src/util/magneticLasso.ts:55` returns a
 * `y * width + x` *pixel* number and the caller multiplies by 4 separately
 * (`magneticLasso.ts:152-153`), `clearPixel` in
 * `src/util/homography-resample.ts:14-19` and `clearPixel` in
 * `src/util/selection.ts` (the feathering path) both take an already-scaled byte
 * offset, and the resample loop in `homography-resample.ts:37-38` inlines
 * `(y * width + x) * 4` a third time. Any tool written against one of those and
 * then handed the other silently reads a neighbouring row. This module owns the
 * one definition so a caller cannot pick the wrong convention.
 *
 * All colour here is STRAIGHT (unassociated) alpha, matching `getImageData`, and
 * every buffer is a row-major 4-byte-per-pixel `Uint8ClampedArray`. Nothing in
 * this module touches a canvas, so it is safe to call from a worker and from
 * unit tests without a `2D` context.
 */

/** One pixel's four channels, each 0-255, in straight (unassociated) alpha. */
export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * An integer pixel rect with INCLUSIVE `right`/`bottom` edges. Not exported: every
 * caller builds it as a literal or derives it from a drag, so the name would only be
 * a second spelling of the same object.
 */
type PixelRect = { left: number; top: number; right: number; bottom: number };

/**
 * Byte offset of the pixel at `(x, y)` in a row-major RGBA buffer of `width` pixels.
 *
 * This is the single definition the three private copies above lacked. It returns a
 * BYTE offset, not a pixel number, so it composes directly with the
 * `(y * width + x) * 4` form already inlined at `src/util/homography-resample.ts:38`
 * and with the `* 4` call sites do with `getIndex`.
 */
export const pixelIndex = (x: number, y: number, width: number): number => (y * width + x) * 4;

/**
 * Clamp one channel to the 0-255 range a `Uint8ClampedArray` stores.
 *
 * A non-finite value clamps to 0 rather than propagating, because that is exactly
 * what the buffer does with it on write (`Uint8ClampedArray` converts `NaN` to 0),
 * and the per-pixel tools here feed this straight into sharpen and smudge kernels
 * that divide by a neighbourhood sum: a propagated `NaN` would blacken the whole
 * output where a clamped 0 confines the damage to the one pixel whose kernel
 * overflowed.
 */
export const clampChannel = (value: number): number => (Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : 0);

/**
 * Scale one channel by `factor` and clamp the result to 0-255.
 *
 * `factor` is deliberately unclamped: a dodge/burn tool needs factors above 1 to
 * clip against white and black the way Photoshop's Exposure does, and a negative
 * factor is the inverting blend those two tools share.
 */
export const multiplyChannel = (value: number, factor: number): number => clampChannel(value * factor);

/**
 * Read the pixel at `(x, y)`.
 *
 * A coordinate whose x or y is fractional, negative, or past the end of `data` reads
 * TRANSPARENT rather than a neighbour's byte. Checking the byte offset alone is not
 * enough: `(0.5, 0)` at width 2 has the integer offset 2, which points into the middle
 * of the first pixel. Letting that through turns the arithmetic in `blendPixel` and
 * `premultiplyRgba` into a value a caller cannot trace back to a bad coordinate.
 *
 * `width` is validated separately from the byte offset so a malformed or fractional
 * width cannot turn integer coordinates into mid-pixel reads. Horizontal overflow is
 * rejected before it can wrap into the next row. The signature carries no height, so
 * the backing-buffer bounds provide the upper-y guard; pointer callers should still
 * pair this with `isPointInSize` or `clampPointToSize` for the document's actual height.
 */
export const readRgba = (data: Uint8ClampedArray, x: number, y: number, width: number): Rgba => {
  const offset = pixelIndex(x, y, width);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(width) ||
    width <= 0 ||
    x < 0 ||
    x >= width ||
    y < 0 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + 3 >= data.length
  ) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
};

/**
 * Write the pixel at `(x, y)`, discarding fractional or out-of-buffer coordinates.
 *
 * Discarding rather than throwing matches `clearPixel`'s role in
 * `src/util/homography-resample.ts:14-19`: a resample target is a fixed-size buffer
 * and a homography legitimately maps some of its texels outside it, so a write has
 * to have a defined no-op arm. It validates the row width and rejects horizontal
 * overflow; the backing-buffer bounds reject rows past the allocated pixels.
 */
export const writeRgba = (data: Uint8ClampedArray, x: number, y: number, width: number, rgba: Rgba): void => {
  const offset = pixelIndex(x, y, width);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(width) ||
    width <= 0 ||
    x < 0 ||
    x >= width ||
    y < 0 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + 3 >= data.length
  ) {
    return;
  }

  data[offset] = rgba.r;
  data[offset + 1] = rgba.g;
  data[offset + 2] = rgba.b;
  data[offset + 3] = rgba.a;
};

/**
 * A `Size` reduced to the non-negative integer pixel extents a buffer can actually
 * hold, so a fractional or non-finite extent cannot produce a short buffer or a
 * fractional `pixelIndex`. Matches how assigning to `canvas.width` truncates.
 */
const pixelExtent = (size: Size): Size => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/**
 * A zero-filled `width * height * 4` buffer, the shape `getImageData` hands back.
 *
 * Zero is transparent black, which is the correct empty for a selection mask and
 * for a stroke's own layer before the tool writes into it — `createSelectionCanvas`
 * in `src/util/selection.ts:302-313` has to special-case the same empty as a 1x1.
 */
export const createPixelBuffer = (size: Size): Uint8ClampedArray => {
  const { width, height } = pixelExtent(size);
  return new Uint8ClampedArray(width * height * 4);
};

/** Row-major walk over an inclusive pixel span, shared by both public iterators. */
function forEachPixelInSpan(
  width: number,
  fromX: number,
  toX: number,
  fromY: number,
  toY: number,
  visit: (x: number, y: number, offset: number) => boolean | void
): void {
  for (let y = fromY; y <= toY; y++) {
    for (let x = fromX; x <= toX; x++) {
      if (visit(x, y, pixelIndex(x, y, width)) === false) return;
    }
  }
}

/**
 * Visit every pixel of `size`, top-left to bottom-right, handing the callback the
 * byte `offset` it can read or write directly.
 *
 * Returning `false` from the callback stops the walk at that pixel. The `=== false`
 * test is deliberate: a void callback (the common case, e.g. `(x, y, o) =>
 * writeRgba(data, x, y, width, colour)`) must not be read as a request to stop, and
 * only a strict `false` opts out.
 */
export const forEachPixelInSize = (
  size: Size,
  visit: (x: number, y: number, offset: number) => boolean | void
): void => {
  const { width, height } = pixelExtent(size);
  if (width === 0 || height === 0) return;

  forEachPixelInSpan(width, 0, width - 1, 0, height - 1, visit);
};

/**
 * Visit every pixel of `rect` that lies inside `size`, top-left to bottom-right.
 *
 * `right` and `bottom` are INCLUSIVE, so `{ left: 0, top: 0, right: 0, bottom: 0 }`
 * is one pixel and `right - left + 1` is the covered width. The alternative —
 * exclusive edges — silently loses the last row and column of every marquee tool
 * that clips a fill to its own selection, because the tool computes its end point
 * as `left + width` and then forgets the `- 1`. Inclusive matches how the
 * pixel-addressed neighbours in `src/util/magneticLasso.ts:209-212` are already
 * written (`maxX = Math.min(edgeMap.width - 1, ...)`).
 *
 * The rect is clipped to `size` on all four sides, and an inverted rect is sorted
 * before clipping rather than after: clamping an inverted pair one side at a time
 * is the phantom-rect bug `clampEdge` in `src/util/rect.ts:31-33` documents.
 * Fractional edges are rounded outward (`ceil` on the near side, `floor` on the
 * far side) so a drag of 4.5px still covers every pixel it touched. A rect that
 * clips to nothing visits nothing and returns normally.
 */
export const forEachPixelInRect = (
  size: Size,
  rect: PixelRect,
  visit: (x: number, y: number, offset: number) => boolean | void
): void => {
  const { width, height } = pixelExtent(size);
  if (width === 0 || height === 0) return;

  const left = Math.max(0, Math.ceil(Math.min(rect.left, rect.right)));
  const right = Math.min(width - 1, Math.floor(Math.max(rect.left, rect.right)));
  const top = Math.max(0, Math.ceil(Math.min(rect.top, rect.bottom)));
  const bottom = Math.min(height - 1, Math.floor(Math.max(rect.top, rect.bottom)));
  if (left > right || top > bottom) return;

  forEachPixelInSpan(width, left, right, top, bottom, visit);
};

/**
 * Whether a coordinate addresses a pixel of `size`, over the half-open interval
 * `[0, width) x [0, height)`.
 *
 * Half-open, not inclusive of the far edge, because a drag's end point is an
 * exclusive bound: at a 100px canvas a pointer at `x = 100` is one pixel past the
 * last column and has to fail the same containment test `isPointInPolygon` in
 * `src/util/selection.ts:186` applies to a polygon. Sub-pixel coordinates inside
 * the interval still report true — this is geometric containment, not a pixel index.
 */
export const isPointInSize = (point: Point, size: Size): boolean =>
  point.x >= 0 && point.x < size.width && point.y >= 0 && point.y < size.height;

/**
 * Clamp a coordinate to `[0, size - 1]` on each axis, per axis independently.
 *
 * The floor is `0` rather than `size - 1` for a zero-extent size, matching
 * `clampPointToEdgeMap` in `src/util/magneticLasso.ts:182-187`: `clamp(x, 0, -1)`
 * would return `-1` for a degenerate buffer. The result is NOT rounded — a caller
 * interpolating along a stroke still needs the fraction, and every existing caller
 * rounds for itself (`roundPoint` in `magneticLasso.ts:51-53`).
 */
export const clampPointToSize = (point: Point, size: Size): Point => ({
  x: Math.min(Math.max(0, point.x), Math.max(0, size.width - 1)),
  y: Math.min(Math.max(0, point.y), Math.max(0, size.height - 1)),
});

/**
 * Source-over composite of `src` onto the pixel at byte `offset`, scaled by
 * `opacity` (0-1), in straight (unassociated) alpha.
 *
 * Both operands are straight, so both are premultiplied by their own alpha, added,
 * and the sum is divided back out. With `as = src.a / 255`, `ad = dst.a / 255`,
 * `e = as * opacity` (the source's effective alpha), and `ao = e + ad * (1 - e)`
 * (the Porter-Duff `source-over` coverage):
 *
 * ```
 *   ao = as * opacity + ad * (1 - as * opacity)
 *   Co = (Cs * as * opacity + Cd * ad * (1 - as * opacity)) / ao
 *   ao8 = ao * 255
 * ```
 *
 * The `e` factor carries `opacity` rather than scaling `Co` afterwards, because
 * scaling the result would scale an already-composited colour and darken towards
 * black instead of towards the destination. This is the same premultiply-accumulate
 * -unpremultiply shape as `src/util/homography-resample.ts:86-118`, which is the
 * only alpha-correct arithmetic the repo had; that loop is a resampler's weighted
 * filter rather than a blend, so it keeps its own.
 *
 * `opacity <= 0` and a fully transparent `src` are both exact no-ops on the buffer,
 * and both return before any write. That is not only an optimisation: the equation
 * above divides by `ao`, which is 0 for a transparent source over a transparent
 * destination, and the resampler's answer to that case — `clearPixel` at
 * `homography-resample.ts:110-113` — would overwrite colour a caller may be
 * iterating toward. A `src.a` of 0 contributes no coverage under any arithmetic, so
 * leaving the destination alone is the correct result, not an approximation.
 */
export const blendPixel = (data: Uint8ClampedArray, offset: number, src: Rgba, opacity: number): void => {
  if (!(opacity > 0)) return;

  // Source-over assumes normalized color and alpha values in [0, 1]. Inputs here
  // are byte-scale RGBA, so use the same channel policy as the rest of this module
  // before normalizing them. This prevents NaN and out-of-range alpha from
  // producing invalid weights, and prevents one invalid color channel from
  // poisoning the whole output pixel.
  const sourceAlpha = clampChannel(src.a);
  if (!(sourceAlpha > 0)) return;
  if (!Number.isInteger(offset) || offset % 4 !== 0 || offset < 0 || offset + 3 >= data.length) return;

  const destinationAlpha = data[offset + 3] / 255;
  const effectiveAlpha = (sourceAlpha / 255) * Math.min(1, opacity);
  const outAlpha = effectiveAlpha + destinationAlpha * (1 - effectiveAlpha);
  if (outAlpha <= 0) {
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    return;
  }

  // The two numerator terms of `Co` above, kept named so the code is the comment.
  const sourceWeight = effectiveAlpha;
  const destinationWeight = destinationAlpha * (1 - effectiveAlpha);
  const sourceRed = clampChannel(src.r);
  const sourceGreen = clampChannel(src.g);
  const sourceBlue = clampChannel(src.b);

  data[offset] = (sourceRed * sourceWeight + data[offset] * destinationWeight) / outAlpha;
  data[offset + 1] = (sourceGreen * sourceWeight + data[offset + 1] * destinationWeight) / outAlpha;
  data[offset + 2] = (sourceBlue * sourceWeight + data[offset + 2] * destinationWeight) / outAlpha;
  data[offset + 3] = outAlpha * 255;
};

/** Two lowercase hex digits for one channel, so `toHex` reads as three channel names. */
const channelToHexPair = (value: number): string => Math.round(clampChannel(value)).toString(16).padStart(2, '0');

/**
 * `'#rrggbb'`, lowercase, for a colour the store holds as a CSS string.
 *
 * Alpha is DROPPED, not encoded. The foreground colour the eyedropper writes is a
 * CSS hex consumed by `<input type="color">` and by the options bar, neither of
 * which carries an alpha channel, and `src/tools/__tests__/tool-settings.test.ts`
 * asserts every non-null colour in `defaultSettings` is a 6-digit hex. A caller
 * holding a translucent colour keeps the alpha in its own `Rgba`; pass it to
 * `blendPixel`, which is where it belongs.
 *
 * Channels are rounded and clamped, so a float from a gradient stop still emits a
 * 6-digit literal rather than `#ff.5`.
 */
export const toHex = (rgba: Rgba): string =>
  `#${channelToHexPair(rgba.r)}${channelToHexPair(rgba.g)}${channelToHexPair(rgba.b)}`;

/**
 * Parse `'#rgb'`, `'#rrggbb'`, or the same without the leading `#`, case-insensitively.
 * Alpha is 255, because neither accepted form carries one.
 *
 * A 3-digit form expands by doubling each digit, which is the CSS rule (`#f80` is
 * `#ff8800`) rather than a left-pad of zeros — `#f80` as `#0f800f` is a silent
 * wrong colour that still parses, so the two are not interchangeable and only one
 * of them is right.
 *
 * Anything else THROWS. Every colour that can reach a tool is either a literal in
 * `defaultSettings` or the output of `<input type="color">`, both of which are
 * 6-digit hex, so a non-hex string here is a bug in the caller; substituting
 * transparent black would paint a tool's whole stroke with a colour the user never
 * picked. The throw names the offending string so the source is findable.
 */
export const fromHex = (hex: string): Rgba => {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex;
  const expanded = digits.length === 3 ? digits.replace(/./g, (digit) => digit + digit) : digits;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new TypeError(`fromHex: expected '#rgb' or '#rrggbb', got ${JSON.stringify(hex)}`);
  }

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
    a: 255,
  };
};

/**
 * Scale each colour channel by `alpha / 255`, leaving `a` alone.
 *
 * Premultiplied colour is the only form in which channels may be averaged: at
 * `a = 128`, a straight red (255, 0, 0) and a straight blue (0, 0, 255) average to
 * (127, 0, 127) in straight alpha, which is a magenta that was never in the
 * neighbourhood, and to (127, 0, 127) in premultiplied alpha at `a = 128`, which
 * is the correct half-and-half. `src/util/homography-resample.ts:86-106` weights
 * each texel by `alpha * cornerWeight` for exactly this reason, and lines 115-117
 * divide the accumulated colour back out by the accumulated alpha — that division
 * is `unpremultiplyRgba` on the accumulator.
 *
 * Channels are NOT clamped or rounded: the result is an intermediate in a float
 * accumulator, and clamping here would discard the sub-quantum values the final
 * unpremultiply still needs.
 */
export const premultiplyRgba = (rgba: Rgba): Rgba => {
  const alpha = clampChannel(rgba.a);
  const factor = alpha / 255;

  return { r: rgba.r * factor, g: rgba.g * factor, b: rgba.b * factor, a: alpha };
};

/**
 * Invert `premultiplyRgba`: divide each colour channel by `alpha / 255`, clamped
 * back to 0-255.
 *
 * A zero alpha has no colour to recover, so it returns transparent black rather
 * than dividing by zero — the resampler's `if (alpha <= 0) clearPixel` at
 * `src/util/homography-resample.ts:110-113` is this same guard, reached from the
 * other direction.
 *
 * The round trip is exact only for `a = 255`. At `a = 128` an 8-bit straight
 * channel has only 128 distinct surviving values, so a premultiplied-then-restored
 * channel can be off by one. That is inherent to an 8-bit buffer, not to this
 * function: the resampler pays the same rounding in order to average texels
 * correctly, which a straight-alpha average cannot do at all.
 */
export const unpremultiplyRgba = (rgba: Rgba): Rgba => {
  const alpha = clampChannel(rgba.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };

  const factor = 255 / alpha;

  return {
    r: clampChannel(rgba.r * factor),
    g: clampChannel(rgba.g * factor),
    b: clampChannel(rgba.b * factor),
    a: alpha,
  };
};
