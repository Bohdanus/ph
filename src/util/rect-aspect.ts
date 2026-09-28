import type { RectXY } from '../contexts/general-types.ts';

/**
 * The one aspect-ratio refit for a drag rect, shared by the overlay hook and the Crop panel.
 *
 * Convention: `width = height * ratio`, holding the height and moving both horizontal edges
 * symmetrically about the centre. It is deliberately the SAME convention `adjustFreePoint`
 * applies to a fresh drag (`src/hooks/useRect.ts`), so a free drag's output is a fixed point of
 * this function and the effect that refits `initialRect` is a no-op for a rect the overlay itself
 * produced. Before the two agreed, only a square drag round-tripped: every non-square drag was
 * refitted into a different shape on release, the user saw the overlay snap, and the refitted
 * rect is the one `Apply` committed.
 *
 * The inverse of this is `adjustHeightRatio` (`height = width / ratio`), which is what a
 * `left`/`right` edge drag needs because there the width is the free axis.
 *
 * Returns only the two edges it moves so both callers can spread it over the rect they already
 * hold. A falsy `aspectRatio` is the "no constraint" case and returns the edges untouched, which
 * is what the hook's `null` default and the panel's `Free` option both mean.
 */
export function refitRectWidthToAspect(
  { x1, y1, x2, y2 }: RectXY,
  aspectRatio: number | null
): { x1: number; x2: number } {
  if (aspectRatio) {
    const height = Math.abs(y2 - y1);
    const currentWidth = Math.abs(x2 - x1);
    const wantedWidth = height * aspectRatio;
    const diff = (wantedWidth - currentWidth) / 2;
    if (x1 < x2) {
      x1 -= diff;
      x2 += diff;
    } else {
      x1 += diff;
      x2 -= diff;
    }
  }
  return { x1, x2 };
}
