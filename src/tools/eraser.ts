import { brushDabCenters, clampBrushTipSettings, tipAlphaAt, type BrushTipSettings } from '../util/brush-engine.ts';
import { pixelIndex } from '../util/pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type EraserToolArgs = {
  size: number;
  hardness: number;
  alpha: number;
  spacing: number;
  /**
   * The stroke, in DOCUMENT space, as `usePaintStroke` hands it over.
   *
   * Stroke geometry rather than a setting, and REQUIRED for exactly the reason it is
   * required on `smudge`, `dodge`, `burn` and `clone-stamp`: no tool in this brush
   * family has an optional stroke. An optional one let a caller reach the processor
   * with no path at all, and the result was an erase that changed no pixels and
   * reported no error — indistinguishable, on screen, from a broken eraser.
   *
   * "No stroke yet" is `[]`, not `undefined`: `defaultSettings.eraser` carries
   * `points: []` (`src/tools/settings.ts`) and `saveLastSettings` empties the field
   * on every persist (`src/util/settings.ts`), so the empty array is both the seeded
   * default and the persisted shape. `eraseStroke` returns immediately on it, which is
   * the same "a stroke that has not happened yet" the engine's own empty polyline means.
   */
  points: Point[];
  toolName: 'eraser';
};

/**
 * Stops a dab from writing outside the raster, returned as an INCLUSIVE pixel span.
 * `null` is the no-op arm: a stroke routinely leaves the canvas, and a tool that threw
 * there would take the whole stroke down for a dab that had nowhere to land.
 *
 * A disc's bounding box is the cheaper filter — one `tipAlphaAt` per covered pixel
 * rather than one per pixel in the square. This is the same shape as the private
 * `stampClampedDab` span in `src/util/brush-engine.ts:252-256`; it is spelled out
 * here rather than imported because that one is private and computes a
 * `destination-over` composite, not this one's coverage.
 */
type PixelSpan = { left: number; top: number; right: number; bottom: number };

const dabSpan = (center: Point, radius: number, width: number, height: number): PixelSpan | null => {
  const left = Math.max(0, Math.ceil(center.x - radius));
  const right = Math.min(width - 1, Math.floor(center.x + radius));
  const top = Math.max(0, Math.ceil(center.y - radius));
  const bottom = Math.min(height - 1, Math.floor(center.y + radius));

  return left > right || top > bottom ? null : { left, top, right, bottom };
};

/** A `Size` reduced to the non-negative integer extents a buffer can address. */
const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * Number of stops the no-read-back path samples `tipAlphaAt` at.
 *
 * Sixteen is enough that the largest single step in the gradient is under 3% of the
 * erase amount, which is below the 8-bit alpha quantum, and it is a compile-time
 * constant so the loop cannot become a per-dab cost proportional to the tip diameter.
 */
const GRADIENT_STOPS = 16;

/**
 * Erase one dab's coverage into an already-read straight-alpha buffer.
 *
 * This is Porter-Duff `destination-out` in straight alpha, which in that space
 * reduces to touching the alpha alone: the composite is `Co_p = Cd_p * (1 - e)` on
 * PREMULTIPLIED colour, so unpremultiplying the result (`Co_p / ao`) cancels the
 * factor and returns the destination's own colour unchanged. Scaling `r`/`g`/`b` here
 * as well would be the bug `premultiplyRgba` exists to prevent, and it shows up as a
 * dark halo around every soft edge rather than as a wrong number.
 *
 * The one colour write is at alpha 0, where there is no colour left to recover and
 * the canvas itself stores transparent black — so a fully erased pixel is
 * `(0, 0, 0, 0)` rather than a stale opaque colour at zero alpha.
 *
 * Overlapping dabs multiply, they do not clamp: two dabs at Opacity 0.5 over the same
 * pixel leave `0.25`, not `0.5`. That is what makes `spacing` a Photoshop `Flow`
 * control — a looser spacing lands fewer dabs on a pixel and erases less of it.
 */
const eraseDabIntoBuffer = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  center: Point,
  settings: BrushTipSettings
): void => {
  const radius = settings.size / 2;
  const span = dabSpan(center, radius, width, height);
  if (!span) return;

  for (let y = span.top; y <= span.bottom; y++) {
    const distanceY = y - center.y;
    for (let x = span.left; x <= span.right; x++) {
      const distanceX = x - center.x;
      const weight =
        tipAlphaAt(Math.sqrt(distanceX * distanceX + distanceY * distanceY), radius, settings.hardness) *
        settings.opacity;
      if (!(weight > 0)) continue;

      const offset = pixelIndex(x, y, width);
      // The same byte-offset guard `readRgba`/`writeRgba` use, and for the same
      // reason: the span is clipped to the buffer, so this only ever fires for a
      // buffer narrower than the span believes it is.
      if (!Number.isInteger(offset) || offset < 0 || offset + 3 >= data.length) continue;

      // Write then read back rather than rounding by hand: `Uint8ClampedArray` owns
      // the quantisation, and deciding "is this pixel fully erased" from a float
      // instead of the byte that actually landed is how a pixel ends up at alpha 0
      // still carrying the colour it was erased from.
      data[offset + 3] = data[offset + 3] * (1 - weight);
      if (data[offset + 3] === 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
};

/**
 * Erase a whole stroke, preferring a read-modify-write on the raster's own pixels.
 *
 * WHY THIS AND NOT A `destination-out` CANVAS COMPOSITE. Both are correct in a
 * browser, and the composite is shorter, but the composite is the wrong half of a
 * round trip for this processor: it can only be verified by reading the result back
 * out of a real canvas, so the erase profile is asserted against whatever the host's
 * gradient rasteriser did rather than against `tipAlphaAt`. Doing the coverage here
 * means the exact number a pixel ends at is `round(a * (1 - tipAlphaAt(d) * opacity))`
 * for the same `tipAlphaAt` the preview ring and every other paint-family tool read,
 * which is testable byte-for-byte. The composite is kept below as the reduced-context
 * path, which is the only environment where the read-back is unavailable.
 */
const eraseStroke = (
  ctx: OffscreenCanvasRenderingContext2D,
  size: Size,
  points: Point[],
  settings: BrushTipSettings
): void => {
  if (points.length === 0 || !(settings.opacity > 0) || settings.size <= 0) return;

  const width = extent(size.width);
  const height = extent(size.height);
  if (width === 0 || height === 0) return;

  const centers = brushDabCenters(points, settings.size, settings.spacing);
  const radius = settings.size / 2;

  if (typeof ctx.getImageData === 'function' && typeof ctx.putImageData === 'function') {
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    // Narrowed to the pixels the buffer really holds. Addressing a buffer with a
    // declared size larger than its capacity would put row `y` in the wrong place
    // rather than out of range — a wrong answer instead of a no-op.
    const capacity = Math.floor(data.length / 4);
    const writableWidth = Math.min(width, capacity);
    const writableHeight = writableWidth === 0 ? 0 : Math.min(height, Math.floor(capacity / writableWidth));

    for (const center of centers) {
      eraseDabIntoBuffer(data, writableWidth, writableHeight, center, settings);
    }

    ctx.putImageData(image, 0, 0);
    return;
  }

  // Reduced 2D context: no `getImageData`/`putImageData`, so the coverage cannot be
  // computed against real pixels. `destination-out` over a radial gradient whose
  // stops are SAMPLED FROM `tipAlphaAt` is the fallback, and sampling rather than
  // picking two stops is what keeps it from being the hard-fringe eraser this tool
  // exists to avoid — a two-stop gradient is a linear ramp and a linear ramp kinks at
  // the hard core, which is the ring `tipAlphaAt`'s cosine-squared curve is built to
  // remove. It cannot reproduce the half-open rim a single-pixel gradient step cannot
  // express, so the read-back path above is the authority and this is the
  // approximation, not the other way round.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  for (const center of centers) {
    if (!dabSpan(center, radius, width, height)) continue;

    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    for (let step = 0; step <= GRADIENT_STOPS; step++) {
      const offset = step / GRADIENT_STOPS;
      const weight = tipAlphaAt(offset * radius, radius, settings.hardness) * settings.opacity;
      gradient.addColorStop(offset, `rgba(0, 0, 0, ${weight})`);
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

/**
 * The Photoshop Eraser: removes pixels to TRANSPARENCY along a stamped tip.
 *
 * `Size` is the tip DIAMETER (not a stroke width), `Hardness` 0-100 is the tip's
 * falloff, `Spacing` is the distance between dabs as a percentage of that diameter,
 * and `alpha` is the erase amount applied per dab. The falloff and the spacing are
 * NOT re-derived here: `clampBrushTipSettings`, `brushDabCenters` and `tipAlphaAt`
 * are the shared tip engine that the Brush, Smudge, Dodge, Burn and Clone Stamp
 * processors use, so a change to the soft edge reaches the Eraser instead of skipping
 * it, and this file contributes only the inverse composite.
 *
 * `alpha` is mapped onto the engine's `opacity` rather than passed under its own
 * name: the two are the same 0-1 coverage (`defaultSettings.eraser.alpha` is 1 and
 * the paint tools' is too — `src/tools/__tests__/tool-settings.test.ts` pins the
 * 0..1 convention), and the engine's field is called `opacity` because the Brush panel
 * labels that control `Flow`. On the Eraser it is the erase amount, which is the same
 * quantity, so the rename is a mapping and not a reinterpretation.
 *
 * The returned canvas is always FULL DOCUMENT SIZE and always freshly allocated, even
 * for an empty path. `tempUpdateLayer` (`src/contexts/useLayer.ts:560`) assigns the
 * result straight to `layer.tmpCanvas`, so handing back the source bitmap instead
 * would leave the layer's `tmpCanvas` holding the very object it already had, and the
 * preview would show no edit at all.
 */
export const eraser =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ size: tipSize, hardness, alpha, spacing, points }: EraserToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.drawImage(bitmap, 0, 0);

    eraseStroke(ctx, size, points, clampBrushTipSettings({ size: tipSize, hardness, opacity: alpha, spacing }));

    return [canvas];
  };
