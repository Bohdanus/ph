import type { Point } from '../contexts/general-types.ts';
import { EYEDROPPER_SAMPLE_SIZE_OPTIONS, type EyedropperSampleSize } from './eyedropper.ts';

/**
 * The Color Sampler's arithmetic.
 *
 * Everything here is a pure function over one point and one `ImageData`, which is what makes the
 * tool's readouts testable without a canvas: `ColorSamplerToolArea` owns the pointer and the pixels,
 * this file owns the numbers, and the options bar renders what this file returns.
 *
 * **The tool is pixel-free.** Adobe's own line is that a sampler "displays color values for up to
 * four areas" — it measures, and a measurement is not part of the document. So it has no entry in
 * `src/tools/toolProcessors.ts`, no `commit` kind, no `HistoryItem` and no durable operation; see
 * `PIXEL_FREE_TOOLS` there. `sampleColorAt` therefore reads pixels and RETURNS a colour, and nothing
 * in this app writes it anywhere a commit could be recorded from.
 *
 * **The unit is the document pixel**, exactly as it is for the Ruler and for the Eyedropper beside
 * it: the composited workspace canvas is sized to the document frame, so the canvas's own pixel (0,0)
 * IS the frame origin, a frame-space point is a canvas pixel, and a sample size is a square of
 * document pixels.
 */
export type ColorSamplerToolArgs = {
  /**
   * Photoshop's Sample Size, and it is the SAME control the Eyedropper's bar carries, with the same
   * seven entries and the same default: Adobe's histogram page says "choose (then Shift-click) the
   * Eyedropper tool or Color Sampler tool, and if necessary, choose a sample size in the options
   * bar", which names one control on two bars. The type is the Eyedropper's own
   * `EyedropperSampleSize` rather than a second union spelled the same way, because one control
   * cannot have two types and the app has no Settings &gt; Preferences &gt; Cursor that could make
   * them independent.
   * http://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
   */
  sampleSize: EyedropperSampleSize;

  toolName: 'color-sampler';
};

/**
 * The Options bar's Sample Size, in Photoshop's order and with Adobe's own labels.
 *
 * This is the Eyedropper's list re-exported rather than retyped, and the reason is that Adobe names
 * ONE Sample Size for both tools on one page: a second copy of the same seven labels would be two
 * spellings of one Photoshop control, which is what `EYEDROPPER_SAMPLE_SIZE_OPTIONS` already
 * records as the cost of the first spelling.
 * http://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
 */
export const COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS: readonly { value: EyedropperSampleSize; label: string }[] =
  EYEDROPPER_SAMPLE_SIZE_OPTIONS;

/**
 * How many samplers the document can carry at once.
 *
 * **Four, on Adobe's word, and the number is contested.** Adobe's own current pages say four in two
 * places: "You can also use up to four Color Samplers to display color information for one or more
 * locations in the image" and "place up to four color samplers on the image", plus the tools table's
 * one-line "Color Sampler tool | Displays color values for up to four areas."
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html> and
 * <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html>
 *
 * Against that: Adobe's own staff blogger writes "click in the image area to set up to ten color
 * samplers" (Julieanne Kost, 2018), and two dated third-party observations of the running product
 * say ten as well. No Adobe release note announcing a change was found. This file takes **four**
 * because the authority ladder puts Adobe's documentation above judgement and above a blog post,
 * and because four is the number Adobe states in the two places a user is most likely to read it —
 * but the conflict is recorded here rather than resolved away, because a reader who has used
 * Photoshop and placed ten samplers is a reader who will find four surprising.
 * <https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html>
 */
export const COLOR_SAMPLER_MAX_SAMPLES = 4;

/**
 * One sampler, and where its colour comes from.
 *
 * `color` is STORED, not recomputed on render, because Adobe's readouts are live in a specific and
 * consequential sense: "As you make adjustments, view the before and after color values in the Info
 * panel", and an adjustment layer changes the pixels under a sampler without moving it. The app has
 * no Info panel, so its readouts live in the options bar, but "the colour changed because the
 * document changed" is the behaviour either way, and a store that re-read the pixels on every render
 * would report a fresh colour for a sampler the user never re-clicked.
 *
 * **The alternative and why it is not taken.** Re-reading on every render is the other honest shape,
 * and it is what makes a readout track an adjustment live. This app cannot do it: a change to any
 * pixel of the document has to invalidate every sampler, and the only invalidation seam this tool
 * has is the pointer gesture, so a live readout would go stale on every edit rather than on no edit.
 * Storing the colour means a sampler reports the colour it was placed at, and the app states that
 * as a divergence instead of presenting a stale number as a live one.
 */
export type ColorSampler = {
  /** 1-based, in placement order, and it is the label Photoshop prints beside the marker. */
  id: number;
  /** Where the sampler sits, in document-frame pixels. */
  point: Point;
  /** The colour read at `point` when it was placed, as `#rrggbb`. */
  color: string;
};

/**
 * The channel value one averaged channel comes out at.
 *
 * The mean of an n-by-n block is a fraction, and a readout has to be a whole channel value, so the
 * fraction is rounded. This is an APP decision, and it is stated as one: Adobe publishes no
 * rounding rule for any sampler readout, and the research found none.
 */
export const roundChannel = (sum: number, count: number): number => Math.round(sum / count);

/**
 * Three channel values as the `#rrggbb` string this app's colour controls already speak.
 *
 * Clamped rather than trusted, because `roundChannel` of a mean of in-range bytes is always in
 * range and a clamped channel here would be hiding a bug in the arithmetic above rather than
 * handling an input. `#rrggbb` and not `#rrggbbaa` because the composited canvas has already
 * resolved alpha and every swatch in this app is a CSS colour on an `<input type="color">`.
 */
const toHexColor = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0')).join('')}`;

/**
 * The colour at `point`, averaged over the square Sample Size pixels around it.
 *
 * **The block is CLIPPED to the bitmap rather than shifted inward**, which is the Eyedropper's rule
 * and is a rule about correctness rather than about affinity: a 101 by 101 block centred on a
 * document corner averages the 51 by 51 pixels that exist instead of reading out of bounds or
 * quietly sliding the footprint off the edge the user clicked. Clipping is also the only answer
 * here, because the app has no outside-the-image colour to substitute.
 *
 * **Alpha is dropped, deliberately.** The composited workspace canvas has already resolved alpha
 * against the document, and a readout of four channels would be a readout of a colour the app's own
 * colour controls cannot express — every swatch in this app is a CSS colour on an
 * `<input type="color">`, which has no alpha. Adobe's Info panel shows a crossed-out swatch for a
 * fully transparent pixel rather than a number, and this function returns `null` there for the same
 * reason, so a click that landed on nothing dispatches nothing and reports nothing.
 *
 * Returns `null` — never a fabricated colour — when the point is outside the bitmap, when the
 * clipped block is empty, when the block holds no pixels at all, or when the CENTRE pixel is
 * transparent. The centre test is the Eyedropper's and it is the one that matters: averaging a
 * transparent pixel in would report a colour the user never sampled.
 */
export const sampleColorAt = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  point: Point,
  sampleSize: number
): string | null => {
  const centerX = Math.floor(point.x);
  const centerY = Math.floor(point.y);
  if (centerX < 0 || centerY < 0 || centerX >= width || centerY >= height) return null;

  const half = Math.floor(sampleSize / 2);
  const left = Math.max(0, centerX - half);
  const top = Math.max(0, centerY - half);
  const right = Math.min(width, centerX + half + 1);
  const bottom = Math.min(height, centerY + half + 1);
  if (right <= left || bottom <= top) return null;

  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    const rowStart = (y * width + left) * 4;
    for (let x = left; x < right; x++) {
      const index = rowStart + (x - left) * 4;
      red += data[index];
      green += data[index + 1];
      blue += data[index + 2];
      count++;
    }
  }
  if (count === 0) return null;

  // The CENTRE pixel's alpha, not the block's mean: the Eyedropper reads this same byte and refuses
  // the sample when it is zero. A block whose edges are transparent and whose centre is opaque is a
  // real and common case — a 1-pixel object on a transparent layer — and averaging the transparent
  // surround into it would report black.
  const centerIndex = (centerY * width + centerX) * 4;
  if (data[centerIndex + 3] === 0) return null;

  return toHexColor(roundChannel(red, count), roundChannel(green, count), roundChannel(blue, count));
};

/** `null` while there is room for another sampler, and a reason string once there is not. */
export type SamplerCapResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether another sampler may be placed.
 *
 * **The refusal is a refusal, not a replacement.** No source — Adobe's pages, Adobe's own blogger,
 * or any third party — describes Photoshop silently replacing the oldest sampler or silently
 * deleting it. The one observation of the cap being reached (a third-party tutorial screenshot) shows
 * a message, so the message is what this returns, and the caller refuses loudly with it rather than
 * doing either of the two things no source supports.
 */
export const samplerCapReached = (count: number): SamplerCapResult =>
  count < COLOR_SAMPLER_MAX_SAMPLES ? { ok: true } : { ok: false, reason: COLOR_SAMPLER_CAP_REFUSAL };

/** The refusal reason string, exported so a test pins the exact value. */
export const COLOR_SAMPLER_CAP_REFUSAL = 'color-sampler-cap-reached';

/**
 * How close the pointer must be to a sampler for a press to grab it rather than place a new one.
 *
 * **This is an app decision and not Adobe's**, for the same reason the Ruler's protractor radius is
 * not Adobe's: Adobe states the gesture — "To move a color sampler, drag the sampler to the new
 * location" — and publishes no tolerance. The number is a fixed count of DOCUMENT pixels, not a
 * screen size, for the Ruler's reason: the marker belongs to the image, so an 8-pixel grab radius
 * is the same gesture at 100% and at 25%.
 */
export const COLOR_SAMPLER_HIT_RADIUS = 8;

/** The sampler nearest `point` within the hit radius, or `null`. */
export const samplerAt = (samplers: readonly ColorSampler[], point: Point): ColorSampler | null => {
  let nearest: ColorSampler | null = null;
  let nearestDistance = COLOR_SAMPLER_HIT_RADIUS;
  for (const sampler of samplers) {
    const distance = Math.hypot(point.x - sampler.point.x, point.y - sampler.point.y);
    if (distance <= nearestDistance) {
      nearest = sampler;
      nearestDistance = distance;
    }
  }
  return nearest;
};

/**
 * The readouts one sampler contributes to the options bar.
 *
 * **RGB and hex, and only those.** Adobe's Info panel offers a colour-mode switcher, and its
 * categories are documented; the concrete models are not, and this app has no colour-management
 * model at all. Every number below is a channel value of the sampled pixel, which is a fact rather
 * than a conversion: an invented Lab or XYZ would be this app's arithmetic presented as Adobe's.
 * `hex` is Adobe's own name for the pair — its readout set is "RGB/CMYK, HSB, Lab, XYZ, Web Hex" —
 * and both halves of it come from the same four bytes.
 */
export type ColorSamplerReadout = {
  red: number;
  green: number;
  blue: number;
  hex: string;
};

/** Splits a `#rrggbb` string into the three channels the readout prints. */
export const parseHexColor = (hex: string): ColorSamplerReadout => {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return { red, green, blue, hex: hex.toLowerCase() };
};

/**
 * The six numbers a sampler places in the bar, in Adobe's own order.
 *
 * Adobe's list is a set of COLOUR MODES rather than of fields, so "Adobe's order" here is the order
 * the app can render: the X and Y of the point, then the three channels and the hex, then nothing.
 * The channels are whole numbers because the sampled pixel is 8-bit and the mean is rounded — see
 * `roundChannel`.
 */
export const samplerReadout = (sampler: ColorSampler): ColorSamplerReadout => {
  const { red, green, blue, hex } = parseHexColor(sampler.color);
  return { red, green, blue, hex };
};
