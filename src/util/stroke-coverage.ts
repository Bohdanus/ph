import { brushDabCenters, tipAlphaAt, type BrushTipSettings } from './brush-engine.ts';
import { forEachPixelInRect } from './pixels.ts';
import type { Point, Size } from '../contexts/general-types.ts';

/**
 * The per-pixel coverage field of a brush STROKE: a `Float32Array` of the size's pixel
 * count where every entry is the tip's 0-1 falloff at that pixel, and `null` when the
 * stroke lands nowhere.
 *
 * It exists here rather than inside the tool that first needed it because two tools now
 * want the same field and neither of them wants the other's arithmetic. `dodgeBurn.ts`
 * carried it privately, and the Sponge wants the identical field to scale chroma with,
 * so the shape moved out rather than being written twice.
 *
 * **The field is GEOMETRY, not paint.** It is the answer to "how strongly does the tip
 * touch this pixel", which is a question about the tip and the path alone. It carries no
 * colour and no mode, so a tool whose effect is a per-pixel AMOUNT (the Dodge and Burn
 * scale channels, the Sponge scales chroma) consumes it directly instead of compositing
 * something over the destination first. Compositing a colour would also premultiply by
 * the destination's alpha and make the answer depend on the layer's transparency rather
 * than on the tonal band or the mode the user picked.
 *
 * **Dabs are UNIONED, not summed.** Overlapping dabs take the larger coverage rather than
 * adding. Summing would make the amount a function of how many dabs happened to land on a
 * pixel, which is a function of the pointer's own sample rate — the same defect
 * `brushDabCenters` exists to rule out for the dab SPACING. Unioning also makes a commit
 * idempotent under the registry's replay, because a sum would compound every time the
 * same args were rendered again.
 *
 * Only the two geometric halves of the shared engine are used: `brushDabCenters` for the
 * centres along the path and `tipAlphaAt` for the falloff, which is that module's single
 * definition of a soft edge and is deliberately not re-derived here.
 *
 * **PRECONDITION: `size` must already be integral.** `new Float32Array(width * height)`
 * throws a `RangeError` on a fractional product, and this function only guards `=== 0`, so it
 * is not total over `Size`. That is a contract rather than a hole: both callers reduce to
 * integers first through their own `pixelExtent` (`dodgeBurn.ts:208`, `sponge.ts:288`), and the
 * two implementations of that reduction are what decide it. Flooring here instead would have
 * meant the returned field's length no longer matched the extent the caller walks it with.
 */
export const buildStrokeCoverage = (size: Size, points: Point[], settings: BrushTipSettings): Float32Array | null => {
  const centers = brushDabCenters(points, settings.size, settings.spacing);
  if (centers.length === 0 || size.width === 0 || size.height === 0) return null;

  const radius = settings.size / 2;
  const coverage = new Float32Array(size.width * size.height);
  let touched = false;

  for (const center of centers) {
    forEachPixelInRect(
      size,
      { left: center.x - radius, top: center.y - radius, right: center.x + radius, bottom: center.y + radius },
      (x, y) => {
        const distanceY = y - center.y;
        const distance = Math.sqrt((x - center.x) * (x - center.x) + distanceY * distanceY);
        const weight = tipAlphaAt(distance, radius, settings.hardness);
        if (!(weight > 0)) return;

        const index = y * size.width + x;
        if (weight > coverage[index]) coverage[index] = weight;
        touched = true;
      }
    );
  }

  return touched ? coverage : null;
};
