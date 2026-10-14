import {
  BRUSH_SPACING_DEFAULT,
  brushDabCenters,
  clampBrushTipSettings,
  tipAlphaAt,
  type BrushTipSettings,
} from '../util/brush-engine.ts';
import { blendPixel, clampPointToSize, forEachPixelInRect, readRgba } from '../util/pixels.ts';
import { createSelectionAlphaMask } from '../util/selection.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type CloneStampToolArgs = {
  size: number;
  hardness: number;
  alpha: number;
  source: Point | null;
  aligned: boolean;
  points: Point[];
  toolName: 'clone-stamp';
  /** Selection snapshot in processor-raster coordinates. */
  selection?: {
    points: Point[];
    featherRadius: number;
    antiAlias: boolean;
  };
};

export type CloneStampToolSettings = Omit<CloneStampToolArgs, 'points'>;

/**
 * The dab spacing, as a percentage of the tip diameter.
 *
 * `CloneStampToolArgs` has no `spacing` field, and that is not an oversight to be patched
 * here: Photoshop's Clone Stamp bar exposes `Brush Preset Picker`, `Mode`, `Opacity`,
 * `Aligned`, `Sample: All Layers / Current & Below / Current Layer` and `Flow` and no
 * spacing, because the dabs are not a stamping density the user tunes. So the value is a
 * constant of the tool rather than a setting, and it is `BRUSH_SPACING_DEFAULT` — the same
 * 25% of the diameter Photoshop's round brushes use — so a clone tip lays down dabs at the
 * density the rest of the paint family does. Exported so the fact is visible from the
 * options bar rather than buried at the call site, exactly as `SMUDGE_SPACING_PERCENT` is.
 */
export const CLONE_STAMP_SPACING_PERCENT = BRUSH_SPACING_DEFAULT;

/** `Size` reduced to the integer extents a pixel buffer can address. */
const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * Stops a dab from writing outside the raster, returned as an INCLUSIVE pixel span.
 * `null` is the no-op arm: a stroke routinely leaves the canvas, and a tool that threw
 * there would take the whole stroke down for a dab that had nowhere to land.
 *
 * A disc's bounding box is the cheaper filter — one `tipAlphaAt` per covered pixel rather
 * than one per pixel in the square. This is the same span as the private `dabSpan` in
 * `src/tools/smudge.ts:62-68` and `src/tools/eraser.ts:38-45` and the private
 * `stampClampedDab` span in `src/util/brush-engine.ts:252-256`; it is spelled out again
 * rather than imported because all three are private, and a shared home for it is a change
 * to `pixels.ts` that this file does not own.
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
 * THE OFFSET: where the copy is read from, relative to the destination.
 *
 * `source` is the Alt-clicked point, and the stroke's `points` are the destination. Every
 * dab reads `destination + offset`, so the whole arithmetic of the tool is this one
 * translation, and the only question is which pair of stroke points anchors it:
 *
 * - **Aligned** (`aligned: true`, Photoshop's default): the offset is measured from the
 *   stroke's OWN START, `source - points[0]`, and is therefore constant along the whole
 *   stroke. Each stroke re-derives it, so a second stroke begun somewhere else still lands
 *   its copy on the corresponding part of the same source — the same pattern continues,
 *   which is the entire point of the mode.
 * - **Not aligned**: the offset is measured from the stroke's END, `source - points[n-1]`,
 *   which makes the first dab's delta `source - points[0] + (points[n-1] - points[0])` …
 *   in other words it is the drag's own displacement laid on top of the source offset. Two
 *   consecutive strokes with different drag displacements therefore land their FIRST dab at
 *   different places, which is the drift `Aligned` exists to remove.
 *
 * Both arms are one subtraction, so there is no per-dab branching and no accumulated
 * position: every dab of a stroke reads the same relative place on the source, which is
 * what makes a self-overlapping stroke copy the same texel twice rather than drift.
 *
 * `points` must be non-empty, which the caller has already established; a stroke with no
 * points has no start to anchor to and is refused before it reaches here.
 */
const cloneOffset = (source: Point, points: Point[], aligned: boolean): Point => {
  const anchor = aligned ? points[0] : points[points.length - 1];

  return { x: source.x - anchor.x, y: source.y - anchor.y };
};

/**
 * One dab of clone stamp: for every texel the tip covers at `center`, composite in the
 * SOURCE texel at the same texel translated by `offset`, weighted by the tip's coverage.
 *
 * `out[p] = source_over(out[p], source[p + offset], tipAlphaAt(dist(p, center)) * opacity)`.
 *
 * FOUR THINGS ARE LOAD-BEARING HERE.
 *
 * **This is a COPY, not a paint.** `stampBrushDab` in `src/util/brush-engine.ts` is the
 * wrong primitive: it composites a caller-supplied `Rgba` colour source-over, and the
 * Clone Stamp has no colour to supply — what it supplies is a POSITION. The tip itself is
 * borrowed wholesale from the same module, because the tip is not the part that differs:
 * `clampBrushTipSettings` for the ranges, `brushDabCenters` for the stroke geometry, and
 * `tipAlphaAt` for the coverage, so a soft Clone Stamp edge is the same soft edge the
 * Brush, Eraser, Smudge, Dodge and Burn stamp. The composite that rides on that coverage
 * is `blendPixel` from `src/util/pixels.ts`, which is the one source-over in straight alpha
 * the repo has, and it takes the read texel's own alpha with it — so a clone out of a
 * transparent region leaves the destination transparent rather than painting it opaque
 * black, which is what a straight colour composite would do.
 *
 * **`sourceData` is never the buffer being written.** That is guaranteed by the caller
 * handing this function a COPY (`cloneStroke`), and every `readRgba` below is indexed
 * into `sourceData` while every `blendPixel` is indexed into `outputData`. Sampling the
 * output instead would make each dab read the copy the previous dab just laid down, which
 * compounds: a stroke carries its own tail forward and a drag that overlaps its own source
 * degenerates into one colour smeared along the path. The offset is constant per stroke
 * (see `cloneOffset`), so the read set of a dab and the write set of the NEXT dab overlap
 * heavily and the bug is not a corner case — it is the common case.
 *
 * **The offset is rounded ONCE per dab, not per texel.** A pointer coordinate is
 * fractional, so `offset` usually is, and `readRgba` reads TRANSPARENT for a fractional
 * byte offset rather than rounding — an unrounded offset would punch a hole rather than
 * clone. Rounding the single translation rather than each `(x + offset.x, y + offset.y)` is
 * what keeps the copy rigid: per-texel rounding would shift different texels of the same
 * disc by different amounts, so the disc would no longer be a disc.
 *
 * **`clampPointToSize` on the READ is the same choice the Smudge makes**
 * (`src/tools/smudge.ts:149`): a dab whose footprint hangs over an edge samples the nearest
 * real texel rather than reading out of range, and `clampPointToSize` also guarantees the
 * integer coordinate `readRgba` needs. It clamps against `raster`, the reduced document
 * extents, which is what keeps a `Size` that disagrees with the buffer from wrapping a read
 * onto another row.
 */
const cloneDab = (
  sourceData: Uint8ClampedArray,
  outputData: Uint8ClampedArray,
  raster: Size,
  center: Point,
  offset: Point,
  settings: BrushTipSettings,
  selectionMask: Uint8Array | null
): void => {
  const radius = settings.size / 2;
  const span = dabSpan(center, radius, raster.width, raster.height);
  if (!span) return;

  const deltaX = Math.round(offset.x);
  const deltaY = Math.round(offset.y);

  forEachPixelInRect(raster, span, (x, y, byteOffset) => {
    const distanceX = x - center.x;
    const distanceY = y - center.y;
    const weight =
      tipAlphaAt(Math.sqrt(distanceX * distanceX + distanceY * distanceY), radius, settings.hardness) *
      settings.opacity;
    // `blendPixel` no-ops on a non-positive weight too; this is the cheap half of it.
    if (!(weight > 0)) return;

    const selectionCoverage = selectionMask ? selectionMask[y * raster.width + x] / 255 : 1;
    if (!(selectionCoverage > 0)) return;

    const from = clampPointToSize({ x: x + deltaX, y: y + deltaY }, raster);
    blendPixel(outputData, byteOffset, readRgba(sourceData, from.x, from.y, raster.width), weight * selectionCoverage);
  });
};

/**
 * Clone a whole stroke onto a copy of the source raster.
 *
 * WHY TWO WHOLE RASTERS, NOT A ROW BUFFER. The resampler's row-at-a-time shape
 * (`src/util/homography-resample.ts`) streams because its output row `n` is a function of
 * source row `n` alone. A clone dab has no such locality: dab `k` writes the disc around
 * `centers[k]` and reads the disc around `centers[k] + offset`, and with a constant offset
 * the two discs OVERLAP — dab `k+1`'s reads sit inside dab `k`'s writes. There is no order
 * over rows that keeps a one-row buffer correct. So both buffers are whole: `sourceData` is
 * a fresh copy of the read-back because it is the immutable operand every dab reads, and
 * `outputData` is the one the dabs accumulate into.
 *
 * The copy is what makes the self-reference guarantee structural rather than a promise: the
 * buffer the reads are indexed into is a different object from the buffer the writes are
 * indexed into, and neither line above can reach the other.
 */
const cloneStroke = (
  ctx: OffscreenCanvasRenderingContext2D,
  size: Size,
  source: Point,
  points: Point[],
  aligned: boolean,
  settings: BrushTipSettings,
  selectionMask: Uint8Array | null
): void => {
  if (points.length === 0 || !(settings.opacity > 0) || settings.size <= 0) return;

  // The document size reduced to whole-pixel extents. Flooring is not cosmetic here: it is
  // what makes `clampPointToSize` below hand `readRgba` an INTEGER bound, and a fractional
  // bound clamps a rounded coordinate straight back to a fraction — which `readRgba`
  // answers with transparent rather than a neighbour, so every dab along such a stroke
  // would read a hole and erase instead of cloning.
  const raster: Size = { width: extent(size.width), height: extent(size.height) };
  if (raster.width === 0 || raster.height === 0) return;

  // A single-point stroke is a click, and a click still copies a dab: the anchor for both
  // offset arms is that one point, so the click lands the source exactly under the pointer.
  // `brushDabCenters` emits that one centre.
  const centers = brushDabCenters(points, settings.size, settings.spacing);
  if (centers.length === 0) return;

  const image = ctx.getImageData(0, 0, raster.width, raster.height);
  // A COPY, because the source is the immutable operand every dab reads and the buffer that
  // comes back from `getImageData` is the one the dabs write into. See `cloneDab`.
  const sourceData = new Uint8ClampedArray(image.data);
  const outputData = image.data;

  const offset = cloneOffset(source, points, aligned);
  for (const center of centers) {
    cloneDab(sourceData, outputData, raster, center, offset, settings, selectionMask);
  }

  ctx.putImageData(image, 0, 0);
};

/**
 * Photoshop's Clone Stamp Tool: `source + (pointer - stroke anchor)` is stamped under the
 * pointer along a soft-edged tip.
 *
 * `Size` is the tip DIAMETER (not a stroke width), `Hardness` 0-100 is the tip's falloff,
 * and `alpha` is the per-dab copy strength. All three come from the shared tip engine —
 * `clampBrushTipSettings`, `brushDabCenters` and `tipAlphaAt` — so the Clone Stamp's soft
 * edge is the same soft edge the Brush, Eraser, Smudge, Dodge and Burn stamp, and a change
 * to that curve reaches all of them at once. This file contributes the COPY, not the tip.
 *
 * `alpha` is mapped onto the engine's `opacity` rather than passed under its own name: the
 * two are the same 0-1 per-dab coverage (`defaultSettings['clone-stamp'].alpha` is 1, and
 * `src/tools/__tests__/tool-settings.test.ts` pins the 0..1 convention the whole paint
 * family uses), and the engine's field is called `opacity` because the Brush panel labels
 * that control `Flow`. On the Clone Stamp it is the Opacity the bar exposes, which is the
 * same quantity under the name this tool's bar actually shows. So the rename is a mapping
 * and not a reinterpretation. `clampBrushTipSettings` is what bounds it, which is also what
 * makes a non-finite `size`/`hardness`/`alpha` a defined behaviour (it falls back to the
 * Photoshop default) rather than a `NaN` that makes every bounding box `NaN` and stamps
 * nothing.
 *
 * `source` is nullable because "the user has not Alt-clicked a source yet" is a real state
 * the tool has to carry: with no source there is nothing to copy FROM, so stamping is a
 * no-op and NOT a fill-everything. The source raster has already been drawn into the
 * returned canvas by the caller, so the no-op is the source unchanged rather than a blank
 * layer — `tempUpdateLayer` (`src/contexts/useLayer.ts:560`) assigns the result straight to
 * `layer.tmpCanvas`, so returning an un-drawn canvas would blank the preview.
 *
 * The returned canvas is always FULL DOCUMENT SIZE and always freshly allocated, even for
 * an empty path. Handing back the source bitmap instead would leave the layer's `tmpCanvas`
 * holding the very object it already had, and the preview would show no edit at all.
 */
export const cloneStamp =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ size: tipSize, hardness, alpha, source, aligned, points, selection }: CloneStampToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(bitmap, 0, 0);

    if (!source || points.length === 0) return [canvas];

    // The reduced-canvas guard the raster processors already use
    // (`src/tools/smudge.ts:249`): with no read-back there is no raster to copy texels
    // through, and the source already drawn above is the honest answer rather than a throw.
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

    const settings = clampBrushTipSettings({
      size: tipSize,
      hardness,
      opacity: alpha,
      spacing: CLONE_STAMP_SPACING_PERCENT,
    });

    const selectionMask = selection ? createSelectionAlphaMask(selection.points, size, selection) : null;
    cloneStroke(ctx, size, source, points, aligned, settings, selectionMask);

    return [canvas];
  };
