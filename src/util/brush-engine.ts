import { blendPixel, pixelIndex } from './pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { Rgba } from './pixels.ts';

/**
 * The Photoshop brush TIP engine: spacing, hardness falloff, and soft-edge stamping.
 *
 * The paint tools this replaces drew one `ctx.stroke()` over a smoothed polyline
 * (`src/util/draw.ts:96-104`, with `smoothStrokePoints` in `src/tools/brush.ts:101`
 * pulling the samples together). That path has no tip, no hardness, no spacing and no
 * flow: a stroke is a path with a constant `lineWidth`. Photoshop's Eraser, Smudge,
 * Dodge, Burn and Clone Stamp are the opposite shape — they are not strokes at all,
 * they are a TIP STAMPED along a path, and everything the options bar exposes
 * (`Hardness`, `Spacing`, `Opacity`) is a property of the tip and of the spacing
 * between stamps rather than of the path. This module is the shared stamping half.
 *
 * Two decisions are shared by everything here and are stated once rather than
 * re-derived per tool:
 *
 * - **Straight (unassociated) alpha throughout**, matching what `getImageData`
 *   returns and what `src/util/pixels.ts` stores. Nothing premultiplies, so a caller
 *   can hand this module a buffer it has just read and read the result back into
 *   `putImageData` without a round trip through a premultiplied form.
 * - **One falloff rule**, `tipAlphaAt`. A preview drawn on a canvas and a dab
 *   stamped into a buffer have to agree on what "soft" means, so the soft edge is
 *   defined once and both read it. A second curve for previews would drift.
 */

/**
 * Photoshop's `Size` slider, 1-500px. Photoshop's own ceiling is 5000, but a tip is
 * rasterized into a buffer, so a 5000px tip is a 10000px square for a single dab.
 * `PAINT_SIZE_MAX` in `src/tools/brush.ts:62-63` already caps the legacy paint bar at
 * 500 for the same reason — the stroke-layer padding the path stroke needs is
 * quadratic, and the tip has no such excuse.
 */
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 500;

/** Photoshop's `Hardness` slider, 0-100%. 0 is a fully soft falloff, 100 a hard edge. */
export const BRUSH_HARDNESS_MIN = 0;
export const BRUSH_HARDNESS_MAX = 100;

/** Photoshop's `Spacing` slider, 1-100%, measured as a percentage of the tip diameter. */
export const BRUSH_SPACING_MIN = 1;
export const BRUSH_SPACING_MAX = 100;

/**
 * Photoshop's default brush size on the Brush tool. Also the value a non-finite
 * `Size` falls back to: 13px is a visible dab on any canvas this editor opens, where
 * the 1px floor would be indistinguishable from no stroke at all and the 500px ceiling
 * would allocate a megabyte of buffer to repair one bad number.
 */
export const BRUSH_SIZE_DEFAULT = 13;

/** Photoshop's default `Hardness` for a round brush is 100% — a hard edge. */
export const BRUSH_HARDNESS_DEFAULT = 100;

/** Photoshop's default `Opacity` is 100%. */
export const BRUSH_OPACITY_DEFAULT = 1;

/** Photoshop's default `Spacing` for a round brush is 25% of the tip diameter. */
export const BRUSH_SPACING_DEFAULT = 25;

/**
 * The four tip controls a Photoshop paint bar edits, clamped to the ranges above.
 *
 * `spacing` is a PERCENT OF THE DIAMETER rather than a pixel distance, because that is
 * what the slider means: Photoshop keeps the same visual density when the user changes
 * Size, and a slider whose unit changed with the size would not.
 */
export type BrushTipSettings = {
  /** Tip diameter in px. */
  size: number;
  /** 0 = fully soft falloff to the edge, 100 = hard edge. */
  hardness: number;
  /** 0-1, applied per dab. Photoshop calls this `Flow` on the Brush panel. */
  opacity: number;
  /** 1-100 percent of the tip diameter between dab centres. */
  spacing: number;
};

/** Clamp one slider into `[min, max]`, substituting `fallback` when it is not finite. */
const clampSlider = (value: number | undefined, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value as number)) : fallback;

/**
 * Clamp a partial settings object into Photoshop's legal ranges, so a tool that
 * forwards whatever its own state holds cannot stamp a negative radius or an opacity
 * above 1 into a pixel loop.
 *
 * A non-finite field falls back to the Photoshop default rather than to the near end of
 * its range. `NaN` reaching either end of a range is the dangerous case: `Math.max`
 * propagates it, and a `NaN` radius makes every bounding-box bound `NaN`, which is a
 * loop that silently stamps nothing — a tool that looks broken rather than one that
 * throws. `Infinity` is the same hazard from the other side.
 */
export const clampBrushTipSettings = (settings: Partial<BrushTipSettings>): BrushTipSettings => ({
  size: clampSlider(settings.size, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_DEFAULT),
  hardness: clampSlider(settings.hardness, BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_DEFAULT),
  opacity: clampSlider(settings.opacity, 0, 1, BRUSH_OPACITY_DEFAULT),
  spacing: clampSlider(settings.spacing, BRUSH_SPACING_MIN, BRUSH_SPACING_MAX, BRUSH_SPACING_DEFAULT),
});

/**
 * The falloff weight, 0-1, at `distance` px from a dab centre.
 *
 * `1` inside the hard core of radius `radius * (hardness / 100)`, easing to `0` at
 * `radius`, and flat `1` across the whole radius when `hardness` is 100. `hardness` 0
 * has no core at all, so the entire radius is falloff.
 *
 * The tip is a HALF-OPEN disc: the coverage is 0 for `distance >= radius`, at every
 * hardness, so a pixel sitting exactly on the rim is outside the tip even at hardness
 * 100. Half-open matches `isPointInSize` in `src/util/pixels.ts:205-207`, which is the
 * same choice for the same reason, and it is what makes a hard tip and a 99%-hard tip
 * agree on the rim instead of differing by a one-pixel ring that only hardness 100
 * draws. A consequence worth knowing before asserting on pixel counts: two dabs one
 * full diameter apart, which is `spacing` 100, never overlap, because their shared
 * boundary sits at exactly `radius`.
 *
 * The curve is COSINE-SQUARED, `0.5 * (1 + cos(pi * t))` for `t` the fraction of the
 * falloff band already crossed, chosen over a linear ramp for one reason: its
 * derivative is zero at BOTH ends, so it joins the flat core with matching slope (no
 * ring where the core ends) and reaches the outer edge with zero slope (no aliased
 * 1px rim). A linear ramp is continuous but kinks at both ends, and the kink at the
 * core boundary is exactly the ring this requirement exists to rule out. `t` outside
 * `[0, 1]` is not clamped by `Math.cos`; the two range tests below are what hold the
 * function at 1 and 0, so the profile is continuous there as well.
 *
 * This is the single source of truth for the soft edge. `stampBrushDab` and any
 * on-canvas preview must both call it, or the preview stops predicting the stroke.
 */
export const tipAlphaAt = (distance: number, radius: number, hardness: number): number => {
  if (!(radius > 0) || !(distance < radius)) return 0;

  const core = radius * (clampSlider(hardness, BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_DEFAULT) / 100);
  if (distance <= core) return 1;

  const falloff = radius - core;
  if (!(falloff > 0)) return 1;

  return 0.5 * (1 + Math.cos((Math.PI * (distance - core)) / falloff));
};

/** Two points closer than this are the same dab, so a stroke does not end twice over. */
const SAME_POINT = 1e-9;

/** State carried between pointer events while sampling one brush path. */
export type BrushDabCenterSampler = {
  step: number;
  carried: number;
  lastPoint: Point | null;
  lastCenter: Point | null;
};

/** Create a sampler whose spacing is fixed for the lifetime of a stroke. */
export const createBrushDabCenterSampler = (size: number, spacingPercent: number): BrushDabCenterSampler => {
  const diameter = Number.isFinite(size) && size > 0 ? size : BRUSH_SIZE_DEFAULT;
  const percent = clampSlider(spacingPercent, BRUSH_SPACING_MIN, BRUSH_SPACING_MAX, BRUSH_SPACING_DEFAULT);
  return { step: (diameter * percent) / 100, carried: 0, lastPoint: null, lastCenter: null };
};

/**
 * Append new polyline points and emit only newly reached dab centres.
 *
 * A pointer consumer can pass one point per event. `carried` preserves the partial
 * spacing step across those calls, so resampling the whole accumulated path is not
 * necessary. When `includeEndpoint` is set, the last point is emitted unless a spacing
 * dab already reached it. A replacement within `SAME_POINT` updates the returned batch
 * only; a consumer that already processed an earlier batch has necessarily already
 * applied the previous centre and should treat this near-duplicate as unchanged.
 */
export const appendBrushDabCenters = (
  sampler: BrushDabCenterSampler,
  points: Point[],
  includeEndpoint = false
): Point[] => {
  const centers: Point[] = [];

  for (const point of points) {
    const nextPoint = { x: point.x, y: point.y };
    if (!sampler.lastPoint) {
      sampler.lastPoint = nextPoint;
      sampler.lastCenter = { ...nextPoint };
      centers.push({ ...nextPoint });
      continue;
    }

    const from = sampler.lastPoint;
    const deltaX = nextPoint.x - from.x;
    const deltaY = nextPoint.y - from.y;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (Number.isFinite(length) && length > 0) {
      let travelled = 0;
      while (sampler.carried + (length - travelled) >= sampler.step) {
        travelled += sampler.step - sampler.carried;
        sampler.carried = 0;
        const center = {
          x: from.x + (deltaX * travelled) / length,
          y: from.y + (deltaY * travelled) / length,
        };
        centers.push(center);
        sampler.lastCenter = center;
      }
      sampler.carried += length - travelled;
    }
    sampler.lastPoint = nextPoint;
  }

  if (includeEndpoint && points.length > 0 && sampler.lastPoint) {
    const endpoint = { ...sampler.lastPoint };
    const tail = sampler.lastCenter;
    if (!tail || Math.abs(endpoint.x - tail.x) > SAME_POINT || Math.abs(endpoint.y - tail.y) > SAME_POINT) {
      centers.push(endpoint);
      sampler.lastCenter = endpoint;
    } else if (centers.length > 0) {
      centers[centers.length - 1] = endpoint;
      sampler.lastCenter = endpoint;
    }
  }

  return centers;
};

/**
 * Walk a polyline and emit dab centres `spacingPercent` of the tip diameter apart.
 *
 * The step is measured by ARC LENGTH along the whole polyline, not per segment. A
 * per-segment step would put a dab on every sample the pointer emitted, and since
 * samples arrive at the pointer's own rate, that is a stroke whose density is a
 * function of how fast the user moved — Photoshop does not do that, and it is visible
 * as a fast stroke reading as denser than a slow one over the same path. Arc length
 * makes the count a function of the path alone, so the same path stamped twice
 * produces the same stroke.
 *
 * The first point is always emitted, so a click always leaves a dab. The final point is
 * emitted by default; incremental consumers can omit it until pointer-up so appending
 * samples does not move previously emitted dab indices. Degenerate input cannot throw:
 * an empty array yields none, a single point yields that point, and duplicate points
 * carry no arc length.
 *
 * `spacingPercent` is clamped into Photoshop's 1-100 range and a non-finite or
 * non-positive `size` falls back to `BRUSH_SIZE_DEFAULT`; without that a zero step
 * would loop forever on the first segment.
 */
export const brushDabCenters = (
  points: Point[],
  size: number,
  spacingPercent: number,
  includeEndpoint = true
): Point[] => {
  if (points.length === 0) return [];
  return appendBrushDabCenters(createBrushDabCenterSampler(size, spacingPercent), points, includeEndpoint);
};

/** A `Size` reduced to whole-pixel extents, matching how `canvas.width` truncates. */
const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * The extents a dab may actually write into: the declared `size`, narrowed to the
 * pixel capacity the buffer really holds.
 *
 * A caller can hand over a `Size` from a larger image — a cropped buffer, a preview
 * thumbnail, a layer resized between the two statements — and addressing it with the
 * declared width would put row `y` in the wrong place rather than out of range, which
 * is the worse of the two failures because it is a wrong answer instead of a no-op.
 * Narrowing both axes against the capacity keeps every `pixelIndex` in bounds and
 * keeps a short buffer a partial stamp rather than a corrupted one.
 */
const writableSize = (data: Uint8ClampedArray, size: Size): Size => {
  const capacity = Math.floor(data.length / 4);
  const width = Math.min(extent(size.width), capacity);

  return {
    width,
    height: width === 0 ? 0 : Math.min(extent(size.height), Math.floor(capacity / width)),
  };
};

/**
 * Composite one dab, over the pixels it covers, with settings already clamped. Split
 * out of `stampBrushDab` so a whole stroke clamps once rather than per dab.
 */
const stampClampedDab = (
  data: Uint8ClampedArray,
  writable: Size,
  center: Point,
  settings: BrushTipSettings,
  color: Rgba
): void => {
  const radius = settings.size / 2;

  // A dab is a disc, so its bounding box is the cheaper filter: one `tipAlphaAt` per
  // covered pixel instead of one per pixel in the square. Clipped to the buffer here,
  // which is also the whole no-op arm — a centre outside the buffer clips to an empty
  // span on at least one axis and returns before the loop.
  const fromX = Math.max(0, Math.ceil(center.x - radius));
  const toX = Math.min(writable.width - 1, Math.floor(center.x + radius));
  const fromY = Math.max(0, Math.ceil(center.y - radius));
  const toY = Math.min(writable.height - 1, Math.floor(center.y + radius));
  if (fromX > toX || fromY > toY) return;

  for (let y = fromY; y <= toY; y++) {
    const distanceY = y - center.y;
    for (let x = fromX; x <= toX; x++) {
      const distance = Math.sqrt((x - center.x) * (x - center.x) + distanceY * distanceY);
      const weight = tipAlphaAt(distance, radius, settings.hardness) * settings.opacity;
      // `blendPixel` no-ops on a non-positive weight too; this is the cheap half of it.
      if (!(weight > 0)) continue;
      blendPixel(data, pixelIndex(x, y, writable.width), color, weight);
    }
  }
};

/**
 * Stamp one dab into a straight-alpha RGBA buffer, compositing `color` over what is
 * already there with a coverage of `tipAlphaAt(distance) * opacity`.
 *
 * COMPOSITE, not overwrite. A stroke is many overlapping dabs and the tool's buffer
 * may already hold the layer's content, so replacing the pixel would make the second
 * dab erase the first. The blend itself is `blendPixel` from `src/util/pixels.ts`,
 * which is source-over in straight alpha; the falloff weight rides in as the blend's
 * coverage rather than being applied to the colour afterwards, because scaling the
 * RESULT of a composite darkens it towards black instead of towards the destination.
 *
 * There is deliberately no eraser mode. The Eraser is the same dab with the inverse
 * coverage, and expressing it as a `destination-out` canvas composite (or as stamping
 * a zero-alpha colour) keeps this function the one place a tip is drawn, so a future
 * change to the falloff cannot reach the eraser and skip it.
 *
 * Distance is measured to the pixel's own integer coordinate, the same convention
 * `clampPointToSize` and `forEachPixelInSize` in `src/util/pixels.ts` use, so a dab
 * centred on `(2, 2)` covers pixel `(2, 2)` at full weight rather than at 0.707 of it.
 * The half-pixel this differs from a resampler's texel-centre convention by
 * (`src/util/homography-resample.ts:39`) is a uniform shift of a circular tip, and
 * matching the addressing convention of the buffer is worth more than the sub-pixel
 * accuracy of a term that is symmetric anyway.
 *
 * A tip larger than the buffer, or a centre outside it, is a no-op rather than a
 * throw: a stroke routinely leaves the canvas, and a tool that threw there would take
 * the whole stroke down for a dab that had nowhere to land.
 */
export const stampBrushDab = (
  data: Uint8ClampedArray,
  size: Size,
  center: Point,
  settings: BrushTipSettings,
  color: Rgba
): void => {
  stampClampedDab(data, writableSize(data, size), center, clampBrushTipSettings(settings), color);
};

/**
 * Stamp a whole stroke: `brushDabCenters` over `points`, then one dab per centre.
 *
 * This is the entry point for every stamping tool. The settings are clamped ONCE and
 * the clamped copy drives both the spacing and the dabs, so a caller that forwards
 * unclamped settings gets the same dab positions and the same coverage — two separate
 * clamps would let a `size` and the `spacing` computed from it disagree.
 *
 * A single-point stroke is a click, and a click still lays down exactly one dab —
 * that is the whole point of a tip engine over a `ctx.stroke()`, which draws nothing
 * for a zero-length path unless it is given a line cap.
 */
export const stampBrushStroke = (
  data: Uint8ClampedArray,
  size: Size,
  points: Point[],
  settings: BrushTipSettings,
  color: Rgba
): void => {
  const clamped = clampBrushTipSettings(settings);
  const writable = writableSize(data, size);

  for (const center of brushDabCenters(points, clamped.size, clamped.spacing)) {
    stampClampedDab(data, writable, center, clamped, color);
  }
};
