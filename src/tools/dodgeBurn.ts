import { BRUSH_SPACING_DEFAULT, clampBrushTipSettings, type BrushTipSettings } from '../util/brush-engine.ts';
import { buildStrokeCoverage } from '../util/stroke-coverage.ts';
import { computeLuma } from '../util/magneticLasso.ts';
import { clampChannel, forEachPixelInSize, readRgba, writeRgba } from '../util/pixels.ts';
import type { BitmapSource, Point, Size } from '../contexts/general-types.ts';
import type { Rgba } from '../util/pixels.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * The tonal bands Photoshop's `Range` dropdown isolates. A dodge or burn stroke only
 * touches pixels inside the selected band, which is what makes the same tool usable on
 * a face without blowing out the specular highlights.
 */
export type TonalRange = 'shadows' | 'midtones' | 'highlights';

/**
 * One args type, two tool names, exactly as `shape.ts` serves the five figure tools:
 * dodge and burn are the same operation with a different sign, and giving them a shared
 * shape keeps the options bar from having to special-case either one.
 */
export type DodgeBurnToolArgs = {
  exposure: number;
  range: TonalRange;
  size: number;
  hardness: number;
  points: Point[];
  toolName: 'dodge' | 'burn';
};

export type DodgeBurnToolSettings = Omit<DodgeBurnToolArgs, 'points'>;

/** The two names this module serves; `DodgeBurnToolArgs['toolName']` is exactly this union. */
export type DodgeBurnToolName = DodgeBurnToolArgs['toolName'];

export const isDodgeBurnToolName = (name: string): name is DodgeBurnToolName => name === 'dodge' || name === 'burn';

/**
 * The luma at which the `shadows` band ends and `midtones` begins, and where
 * `midtones` ends and `highlights` begins. Photoshop splits the two halves of the band
 * dropdown at the SAME luminance rather than at thirds, so the shadow curve is a half
 * and the highlight curve is the other half.
 */
export const TONAL_SPLIT = 128;

/** The `midtones`->`highlights` half is `255 - 128` wide, not `128`. */
const UPPER_HALF = 255 - TONAL_SPLIT;

/** Photoshop's `Exposure` slider, 0-100. */
export const DODGE_BURN_EXPOSURE_MIN = 0;
export const DODGE_BURN_EXPOSURE_MAX = 100;

/**
 * The seeded default, and what a non-finite `exposure` falls back to.
 *
 * 50 is `defaultSettings.dodge.exposure` / `defaultSettings.burn.exposure` in
 * `src/tools/settings.ts`, restated here because `clampSlider` in
 * `src/util/brush-engine.ts` needs a fallback to substitute and importing the settings
 * map into a tool module would invert the dependency (`settings.ts` imports this type).
 */
export const DODGE_BURN_EXPOSURE_DEFAULT = 50;

/**
 * The multiplier applied to the normalized exposure, i.e. the most a pixel can be
 * shifted by one commit at Exposure 100. At 1 a fully-weighted pixel reaches white
 * under dodge and black under burn, which is the ceiling a one-shot commit should have:
 * anything above it would only ever be clipped away by the buffer.
 */
const EXPOSURE_GAIN = 1;

/**
 * The curve exponent at Exposure 100, i.e. how sharply the band narrows as exposure
 * rises.
 *
 * Photoshop drives the band's POWER with Exposure, and it is the exponent, not a linear
 * scale, because a linear scale would leave the band's edges moving at a constant rate
 * and the tool would drag a visible hard edge across the picture. At 4 the peak of the
 * chosen band still moves at full strength while a quarter of the way down the band
 * moves at `0.25^4 = 0.4%`, which is the soft shoulder the tool is for. The value is
 * bounded rather than equal to the raw slider precisely because the slider's own range
 * (0-100) would make any pixel off the peak a complete no-op above exposure 2.
 */
const EXPOSURE_EXPONENT = 4;

/** The `Range` dropdown, in Photoshop's order, for the options bar to render. */
export const DODGE_BURN_RANGES: readonly { value: TonalRange; label: string }[] = [
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' },
];

/** Narrow an arbitrary string off the dropdown, for a `<select>` that only knows strings. */
export const isTonalRange = (value: string): value is TonalRange =>
  DODGE_BURN_RANGES.some((entry) => entry.value === value);

/**
 * The band's weight over luma, 0-1 — the tool, stated as one pure function.
 *
 * A band is a QUADRATIC, not a flat step. Each curve is 0, peak, 0 at the luma values
 * Photoshop's split points name, and the piecewise form below hits all three exactly
 * rather than approximately:
 *
 * ```
 *   shadows     w = ((128 - l) / 128)^2   for l <= 128, else 0
 *   midtones    w = (l / 128)^2           for l <= 128
 *               w = ((255 - l) / 127)^2   for l >  128
 *   highlights  w = 0                     for l <= 128
 *               w = ((l - 128) / 127)^2   for l >  128
 * ```
 *
 * So `tonalWeight(0, *)` is 1 for shadows and 0 for the other two, `tonalWeight(128, *)`
 * is 1 for midtones and 0 for the other two, and `tonalWeight(255, *)` is 1 for
 * highlights and 0 for the other two. A flat band would put a step discontinuity at
 * each split, and the discontinuity is what makes a dodge look like a mask edge rather
 * than like light.
 *
 * The denominators are asymmetric on purpose: the lower half is 128 wide and the upper
 * half is 127, because luma 255 is the top of the range and the band has to reach 1
 * there rather than at 256.
 */
export const tonalWeight = (luma: number, range: TonalRange): number => {
  if (!Number.isFinite(luma)) return 0;

  const level = Math.min(255, Math.max(0, luma));

  switch (range) {
    case 'shadows':
      return level >= TONAL_SPLIT ? 0 : ((TONAL_SPLIT - level) / TONAL_SPLIT) ** 2;
    case 'midtones':
      return level <= TONAL_SPLIT ? (level / TONAL_SPLIT) ** 2 : ((255 - level) / UPPER_HALF) ** 2;
    case 'highlights':
      return level <= TONAL_SPLIT ? 0 : ((level - TONAL_SPLIT) / UPPER_HALF) ** 2;
    default:
      // Not reachable from the union, and a weight of 0 is the safe reading of a range
      // this module does not know: a stroke that does nothing beats one that lightens
      // an arbitrary band.
      return 0;
  }
};

/** Clamp `Exposure` into the slider's range, substituting the default for a non-finite value. */
const clampExposure = (exposure: number): number =>
  Number.isFinite(exposure)
    ? Math.min(DODGE_BURN_EXPOSURE_MAX, Math.max(DODGE_BURN_EXPOSURE_MIN, exposure))
    : DODGE_BURN_EXPOSURE_DEFAULT;

/**
 * The effective amount a single commit shifts one channel by, 0-1.
 *
 * This is the second half of the tool's curve: `tonalWeight` says WHERE the stroke acts
 * and `tonalAmount` says HOW MUCH, which is where `exposure` and the brush coverage
 * both enter.
 *
 * ```
 *   level  = exposure / 100                     in [0, 1]
 *   amount = tonalWeight(luma, range) ^ (level * EXPOSURE_EXPONENT) * level * EXPOSURE_GAIN * coverage
 * ```
 *
 * `amount <= 1` always, and that bound is what makes the two channel rules safe to
 * write unclamped: dodge's `c + (255 - c) * amount` cannot exceed 255 and burn's
 * `c - c * amount` cannot go below 0, at any exposure, in any band.
 *
 * `exposure` 0 is an EXACT no-op and not merely a small one: `level` is 0, so the
 * product is 0 whatever the power evaluates to. That is deliberate — reading the
 * exponent alone (`band ^ 0` is 1 in JavaScript, the empty product) would make Exposure
 * 0 the STRONGEST setting the tool has, and the bar's own left end would invert the
 * tool.
 *
 * `coverage` is the brush tip's 0-1 falloff at this pixel, so a soft rim and a
 * mid-stroke pixel run the same arithmetic at different strengths instead of running
 * two different algorithms.
 */
export const tonalAmount = (luma: number, range: TonalRange, exposure: number, coverage: number = 1): number => {
  const band = tonalWeight(luma, range);
  if (!(band > 0)) return 0;

  const paint = Number.isFinite(coverage) ? Math.min(1, Math.max(0, coverage)) : 0;
  if (!(paint > 0)) return 0;

  const level = clampExposure(exposure) / DODGE_BURN_EXPOSURE_MAX;
  if (!(level > 0)) return 0;

  return Math.min(1, band ** (level * EXPOSURE_EXPONENT) * level * EXPOSURE_GAIN * paint);
};

/**
 * Rec.709 luma of one pixel, 0-255, in the ENCODED sRGB space this editor stores.
 *
 * Deliberately not linear light. The repo has no colour-space module — no sRGB/linear
 * transfer, no HSV, no LAB — and the dodge and burn tools are one of the few places
 * where that absence is defensible rather than merely convenient: Photoshop's own dodge
 * and burn scale the stored channel values towards 255 and towards 0, and it composites
 * the result the same way. Converting to linear light first would change every result
 * this tool produces away from what the reference tool does, in exchange for a
 * photometric correctness the feature does not claim. The choice is recorded here so a
 * future colour-space module has to confront it instead of inheriting it silently.
 *
 * Alpha is folded in by `computeLuma`, which composites towards WHITE: a fully
 * transparent pixel reads as luma 255 rather than as luma 0. That is the right reading
 * for a band tool, because a transparent pixel has no colour to move and treating it as
 * black would put a dodge at full strength on every cut-out edge.
 */
const encodedLuma = (rgba: Rgba): number => computeLuma(rgba.r, rgba.g, rgba.b, rgba.a);

/** A `Size` reduced to the integer extents a pixel buffer can be addressed with. */
const pixelExtent = (size: Size): Size => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/**
 * The tip settings a dodge or burn stroke runs with.
 *
 * `DodgeBurnToolArgs` has no `spacing` and no `opacity` field — Photoshop's dodge and
 * burn bars have neither, the tools build up by holding the button rather than by flow
 * — so both come from the shared engine's defaults and are clamped by it. The clamp is
 * not decoration: `exposure`, `size` and `hardness` arrive from persisted settings, and
 * a `NaN` radius would make every bounding-box bound `NaN`, which is a loop that
 * silently paints nothing.
 */
const tipSettings = (args: DodgeBurnToolArgs): BrushTipSettings =>
  clampBrushTipSettings({
    size: args.size,
    hardness: args.hardness,
    opacity: 1,
    spacing: BRUSH_SPACING_DEFAULT,
  });

/**
 * The stroke's per-pixel coverage field comes from `src/util/stroke-coverage.ts`.
 *
 * It used to be built here, privately, and moved out because the Sponge
 * (`src/tools/sponge.ts`) needs the identical field to scale chroma with and must not
 * carry a second copy of the same union-over-dabs loop. The reasoning that justified the
 * shape — this is where the shared brush engine is used as a GEOMETRY rather than as a
 * painter, so `stampBrushStroke` is deliberately not called; and dabs are UNIONED rather
 * than summed so a commit is idempotent under replay — moved with it and is recorded
 * there.
 */

/**
 * Shift every painted channel towards white (dodge) or towards black (burn), in place.
 *
 * The two rules are the same line with the other endpoint, which is the whole reason one
 * module can serve both names:
 *
 * ```
 *   dodge   c' = c + (255 - c) * amount
 *   burn    c' = c - c * amount
 * ```
 *
 * Alpha is never touched, and a pixel whose amount is 0 is left byte-for-byte alone:
 * `c + (255 - c) * 0` is exactly `c` in IEEE 754 for every `c` a `Uint8ClampedArray`
 * can hold, so a pixel outside the selected band cannot drift by a quantization step.
 */
const shiftPaintedChannels = (
  data: Uint8ClampedArray,
  size: Size,
  coverage: Float32Array,
  range: TonalRange,
  exposure: number,
  towardWhite: boolean
): void => {
  forEachPixelInSize(size, (x, y) => {
    const paint = coverage[y * size.width + x];
    if (!(paint > 0)) return;

    const rgba = readRgba(data, x, y, size.width);
    const amount = tonalAmount(encodedLuma(rgba), range, exposure, paint);
    if (!(amount > 0)) return;

    writeRgba(data, x, y, size.width, {
      r: clampChannel(towardWhite ? rgba.r + (255 - rgba.r) * amount : rgba.r - rgba.r * amount),
      g: clampChannel(towardWhite ? rgba.g + (255 - rgba.g) * amount : rgba.g - rgba.g * amount),
      b: clampChannel(towardWhite ? rgba.b + (255 - rgba.b) * amount : rgba.b - rgba.b * amount),
      a: rgba.a,
    });
  });
};

/**
 * The one implementation both exports reach.
 *
 * `towardWhite` is a parameter here and NOT a parameter of the two exported processors,
 * which are separate function references by design: `src/tools/__tests__/tool-processors.test.ts`
 * pins processor identity and only the lasso pair and the shape/figure family are allowed
 * to share one.
 *
 * `points` are in the same space as `size` and the buffer: the registry hands a raster
 * tool the layer's own bitmap and extent (`src/contexts/useLayer.ts:730-734`), so a point is
 * addressed against this buffer and not against the document.
 *
 * There is no build-up. Photoshop's dodge and burn accumulate for as long as the button
 * is held, which is a per-frame effect with no single end value; a one-shot commit has
 * to be a pure function of its args instead, which is also what makes the registry's
 * `requiresRaster: true` replay reproduce the commit exactly.
 */
const applyDodgeBurn = (
  bitmap: BitmapSource,
  size: Size,
  args: DodgeBurnToolArgs,
  towardWhite: boolean,
  previousCanvas?: BitmapSource
): ToolResult => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return [canvas];

  // Use previousCanvas as the source for incremental rendering, otherwise use the layer bitmap
  const source = previousCanvas ?? bitmap;
  ctx.drawImage(source, 0, 0);

  // A reduced canvas environment has no read-back at all
  // (`src/test/setup.ts:185` documents that the global mock deliberately omits it, and
  // production guards on exactly this). The drawn source is then the best answer
  // available, and handing it back unchanged is a no-op rather than a throw.
  if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

  const extent = pixelExtent(size);
  if (extent.width === 0 || extent.height === 0) return [canvas];

  const settings = tipSettings(args);
  const coverage = buildStrokeCoverage(extent, Array.isArray(args.points) ? args.points : [], settings);
  if (!coverage) return [canvas];

  const imageData = ctx.getImageData(0, 0, extent.width, extent.height);
  if (!imageData.data || imageData.data.length === 0) return [canvas];

  shiftPaintedChannels(imageData.data, extent, coverage, args.range, args.exposure, towardWhite);
  ctx.putImageData(imageData, 0, 0);

  return [canvas];
};

/**
 * Dodge: scale each painted channel towards white, 255, by the band weight scaled by
 * `exposure` and by the tip's coverage. Returns a full-`size` raster.
 */
export const dodge =
  ({ bitmap, size, previousCanvas }: ProcessorToolParams) =>
  (args: DodgeBurnToolArgs): ToolResult =>
    applyDodgeBurn(bitmap, size, args, true, previousCanvas);

/**
 * Burn: the same arithmetic measured from black instead of from white. Returns a
 * full-`size` raster.
 *
 * Burn is not the inverse of dodge, and is not meant to be: with `q` the amount, dodge
 * maps `c` to `255 - (255 - c)(1 - q)` and burn maps `c` to `c(1 - q)`, so
 * `burn(dodge(c)) = [c + (255 - c)q](1 - q)`, which equals `c` only at `q = 0` and
 * `q = 1`. They are the two ends of one axis, and a stroke in one is undone by a stroke
 * in the other, not by the arithmetic above.
 */
export const burn =
  ({ bitmap, size, previousCanvas }: ProcessorToolParams) =>
  (args: DodgeBurnToolArgs): ToolResult =>
    applyDodgeBurn(bitmap, size, args, false, previousCanvas);
