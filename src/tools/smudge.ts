import {
  BRUSH_SPACING_DEFAULT,
  brushDabCenters,
  clampBrushTipSettings,
  tipAlphaAt,
  type BrushTipSettings,
} from '../util/brush-engine.ts';
import { blendPixel, clampPointToSize, pixelIndex, readRgba, type Rgba } from '../util/pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { Pos } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type SmudgeToolArgs = {
  size: number;
  hardness: number;
  strength: number;
  points: Point[];
  rasterBounds?: Pos;
  toolName: 'smudge';
};

export type SmudgeToolSettings = Omit<SmudgeToolArgs, 'points'>;

/**
 * `Strength` is a PERCENTAGE of the carried colour blended per dab, as in Photoshop, and 0
 * is a legal choice: 0% is the identity and is what the slider's own left end says.
 */
export const SMUDGE_STRENGTH_MIN = 0;
export const SMUDGE_STRENGTH_MAX = 100;

/** The divisor that turns the percentage above into the tip engine's 0-1 `opacity`. */
export const SMUDGE_STRENGTH_SCALE = 100;

/**
 * The dab spacing, as a percentage of the tip diameter.
 *
 * `SmudgeToolArgs` has no `spacing` field, and that is not an oversight to be patched here:
 * Photoshop's Smudge bar exposes `Brush Preset Picker`, `Mode`, `Strength` and
 * `Finger Painting` and no spacing, because the smudge dabs are not a stamping density the
 * user tunes. So the value is a constant of the tool rather than a setting, and it is
 * `BRUSH_SPACING_DEFAULT` — the same 25% of the diameter Photoshop's round brushes use — so
 * a smudge tip lays down dabs at the density the rest of the paint family does. It is
 * exported so the fact is visible from the options bar rather than buried at the call site.
 */
export const SMUDGE_SPACING_PERCENT = BRUSH_SPACING_DEFAULT;

/** `Size` reduced to the integer extents a pixel buffer can address. */
const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * Stops a dab from writing outside the raster, returned as an INCLUSIVE pixel span.
 * `null` is the no-op arm: a stroke routinely leaves the canvas, and a tool that threw
 * there would take the whole stroke down for a dab that had nowhere to land.
 *
 * A disc's bounding box is the cheaper filter — one `tipAlphaAt` per covered pixel rather
 * than one per pixel in the square. This is the same span as the private `dabSpan` in
 * `src/tools/eraser.ts:38-45` and the private `stampClampedDab` span in
 * `src/util/brush-engine.ts:252-256`; it is spelled out again rather than imported because
 * all three are private, and a shared home for it is a change to `pixels.ts` that this file
 * does not own.
 */
type PixelSpan = { left: number; top: number; right: number; bottom: number };

const dabSpan = (center: Point, radius: number, width: number, height: number): PixelSpan | null => {
  const left = Math.max(0, Math.ceil(center.x - radius));
  const right = Math.min(width - 1, Math.floor(center.x + radius));
  const top = Math.max(0, Math.ceil(center.y - radius));
  const bottom = Math.min(height - 1, Math.floor(center.y + radius));

  return left > right || top > bottom ? null : { left, top, right, bottom };
};

/**
 * Clamp `strength` into Photoshop's 1-100% and return it as the tip engine's 0-1 coverage.
 *
 * This is the MAPPING between the two vocabularies, and it is a rename rather than a
 * reinterpretation: the brush engine's `BrushTipSettings.opacity` is the per-dab coverage,
 * called `opacity` because the Brush panel labels that control `Flow`, and Photoshop's Smudge
 * bar calls the same per-dab coverage `Strength`. Both are 0-1 by the time they reach a
 * pixel loop, which is what `clampBrushTipSettings` expects.
 *
 * A non-finite `strength` falls to `SMUDGE_STRENGTH_MIN` (0) rather than to 1. That is the
 * same reason `clampSetting` in `src/tools/sharpen.ts` picks the near end: `Math.max`
 * propagates `NaN`, and a `NaN` coverage makes every `tipAlphaAt * opacity` weight `NaN`,
 * which `blendPixel` cannot see as a no-op. 0 is the safe failure — the stroke disappears
 * and the layer is left alone, which is visible and recoverable.
 */
const toTipOpacity = (strength: number): number =>
  (Number.isFinite(strength) ? Math.min(SMUDGE_STRENGTH_MAX, Math.max(SMUDGE_STRENGTH_MIN, strength)) : 0) /
  SMUDGE_STRENGTH_SCALE;

/**
 * One dab of smudge: for every pixel the tip covers at `target`, blend in the SOURCE
 * colour that sat at the same offset inside the tip at `source`, then step forward.
 *
 * `out[p] = blend(out[p], sourceAt(p - (target - source)), strength * tipAlphaAt(dist))`.
 *
 * The two centres are the two ends of one consecutive pair from `brushDabCenters`, so
 * `target - source` IS the segment the pointer travelled, and each covered pixel reads the
 * texel directly behind it. That is the smudge: the brush picks up a disc of colour at
 * `source` and puts the same disc down at `target`, displaced along the drag.
 *
 * THREE THINGS ARE LOAD-BEARING HERE.
 *
 * **The read is from `sourceData`, never from the buffer being written.** Sampling the
 * output would make each dab read the smear the previous dab just laid down, which
 * compounds: the stroke carries its own tail forward and a long drag degenerates into a
 * single colour smeared across the whole path. Reading the untouched source bounds how far
 * colour can travel to exactly one segment per dab, and that is why the dab count matters.
 *
 * **`Math.round` before `clampPointToSize`, not after.** `brushDabCenters` emits fractional
 * centres, so `p - (target - source)` is fractional, and `readRgba` reads TRANSPARENT for a
 * fractional byte offset rather than rounding — which would make every dab read a hole and
 * erase instead of smearing. Rounding matches the engine's own distance convention, which
 * measures to the pixel's integer coordinate so a tip centred on `(2, 2)` covers `(2, 2)` at
 * full weight (`src/util/brush-engine.ts:285-292`); reading the texel one step behind along
 * the same integer grid is the consistent choice. The clamp then keeps the read inside the
 * raster, so a dab whose footprint hangs over an edge samples the nearest real texel rather
 * than reading out of range.
 *
 * **The falloff is `tipAlphaAt`, not a second curve.** The tip shape, the half-open rim and
 * the cosine-squared falloff are the shared engine's, which is what makes the Smudge's soft
 * edge the same soft edge the preview ring and every other paint-family tool draw.
 */
const smudgeDab = (
  sourceData: Uint8ClampedArray,
  outputData: Uint8ClampedArray,
  raster: Size,
  source: Point,
  target: Point,
  settings: BrushTipSettings,
  carried: Rgba | null
): void => {
  const { width, height } = raster;
  const radius = settings.size / 2;
  const span = dabSpan(target, radius, width, height);
  if (!span) return;

  const deltaX = source.x - target.x;
  const deltaY = source.y - target.y;

  for (let y = span.top; y <= span.bottom; y++) {
    const distanceY = y - target.y;
    for (let x = span.left; x <= span.right; x++) {
      const distanceX = x - target.x;
      const weight =
        tipAlphaAt(Math.sqrt(distanceX * distanceX + distanceY * distanceY), radius, settings.hardness) *
        settings.opacity;
      // `blendPixel` no-ops on a non-positive weight too; this is the cheap half of it.
      if (!(weight > 0)) continue;

      const from = clampPointToSize({ x: Math.round(x + deltaX), y: Math.round(y + deltaY) }, raster);
      const sampled = readRgba(sourceData, from.x, from.y, width);
      blendPixel(outputData, pixelIndex(x, y, width), sampled.a > 0 || !carried ? sampled : carried, weight);
    }
  }
};

/**
 * Smudge a whole stroke onto a copy of the source raster.
 *
 * WHY THIS CANNOT BE THE RESAMPLER'S ROW-AT-A-TIME SHAPE.
 * `resampleThroughHomographyRowByRow` (`src/util/homography-resample.ts:128-141`) streams
 * because its output row `n` is a function of source row `n` and nothing else — the strip is
 * allocated once and every pixel of it is final the moment it is written. A smudge dab has no
 * such locality. Dab `k` reads the source texel behind each of its own pixels, so the pixels
 * it writes span the disc around `centers[k]` while the texels it reads span the disc around
 * `centers[k-1]`: output row `n` is written by every dab whose disc reaches row `n`, and
 * each of those dabs reads rows up to a full tip diameter away. A dab near the end of a
 * stroke therefore reads source rows that earlier dabs' output rows are also reading, and
 * there is no order over rows that keeps a one-row buffer correct. Row-at-a-time here would
 * not be a bounded-memory optimization, it would be wrong.
 *
 * So the buffers are the two whole rasters: the source, because it is the immutable operand
 * every dab reads, and a copy of it to write into, because the output is a read-modify-write
 * (`blendPixel` composites over what is already there, and a smudge accumulates along the
 * stroke). Only the FINAL write is row-at-a-time, through the one `ImageData` the context
 * already owns.
 */
const smudgeStroke = (
  ctx: OffscreenCanvasRenderingContext2D,
  size: Size,
  points: Point[],
  settings: BrushTipSettings,
  carryTransparent: boolean
): void => {
  if (points.length === 0 || !(settings.opacity > 0) || settings.size <= 0) return;

  // The document size reduced to whole-pixel extents. Flooring is not cosmetic here: it is
  // what makes `clampPointToSize` below hand `readRgba` an INTEGER bound, and a fractional
  // bound clamps a rounded coordinate straight back to a fraction — which `readRgba` answers
  // with transparent rather than a neighbour, so every dab along such a stroke would read a
  // hole and erase instead of smearing.
  const raster: Size = { width: extent(size.width), height: extent(size.height) };
  if (raster.width === 0 || raster.height === 0) return;

  // A single-point stroke is a click, and a click still picks colour up and puts it down.
  // `brushDabCenters` emits that one centre, and a dab with both ends on the same centre
  // reads each covered texel from itself — which is the identity, because a smudge tool
  // that had something to say about a click would be sampling a different brush than the
  // one the drag uses. The pair is emitted rather than skipped so the click costs one dab
  // of the same work a drag does, and not zero.
  const centers = brushDabCenters(points, settings.size, settings.spacing);
  if (centers.length === 0) return;

  const image = ctx.getImageData(0, 0, raster.width, raster.height);
  // A COPY, because the source is the immutable operand every dab reads and the buffer that
  // comes back from `getImageData` is the one the dabs write into.
  const sourceData = new Uint8ClampedArray(image.data);
  const outputData = image.data;

  let carried: Rgba | null = null;
  for (let i = 0; i + 1 < centers.length; i++) {
    const sample = readRgba(sourceData, Math.round(centers[i].x), Math.round(centers[i].y), raster.width);
    if (sample.a > 0) carried = sample;
    smudgeDab(sourceData, outputData, raster, centers[i], centers[i + 1], settings, carryTransparent ? carried : null);
  }
  if (centers.length === 1) {
    smudgeDab(sourceData, outputData, raster, centers[0], centers[0], settings, null);
  }

  ctx.putImageData(image, 0, 0);
};

/**
 * Photoshop's Smudge Tool: the pixels under the brush are dragged along the drag.
 *
 * `Size` is the tip DIAMETER (not a stroke width) and `Hardness` 0-100 is the tip's falloff,
 * both from the shared tip engine — `clampBrushTipSettings`, `brushDabCenters` and
 * `tipAlphaAt` — so the Smudge's soft edge is the same soft edge the Brush, Eraser, Dodge,
 * Burn and Clone Stamp stamp, and a change to that curve reaches all of them at once. This
 * file contributes the drag, not the tip.
 *
 * `strength` is mapped onto the engine's `opacity` inside `toTipOpacity`, because the args
 * speak Photoshop's Smudge vocabulary and the engine speaks the Brush panel's, and the two
 * name the same per-dab coverage.
 *
 * The returned canvas is always the staged PROCESSING FRAME size and always freshly allocated, even for an
 * empty path. `tempUpdateLayer` (`src/contexts/useLayer.ts:560`) assigns the result straight to
 * `layer.tmpCanvas`, so handing back the source bitmap instead would leave the layer's
 * `tmpCanvas` holding the very object it already had, and the preview would show no edit at
 * all.
 */
export const smudge =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ size: tipSize, hardness, strength, points, rasterBounds }: SmudgeToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(bitmap, 0, 0);

    if (points.length === 0) return [canvas];

    // The reduced-canvas guard the raster processors already use
    // (`src/tools/gradient.ts:126`): with no read-back there is no raster to drag pixels
    // through, and the source already drawn above is the honest answer rather than a throw.
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

    const settings = clampBrushTipSettings({
      size: tipSize,
      hardness,
      opacity: toTipOpacity(strength),
      spacing: SMUDGE_SPACING_PERCENT,
    });

    // Widening an active layer adds transparent addressable pixels. Carry the last opaque
    // active-layer sample across that new area; this preserves active-layer-only sampling while
    // preventing an outward stroke from fading immediately at the old tight edge.
    smudgeStroke(ctx, size, points, settings, Boolean(rasterBounds));

    return [canvas];
  };
