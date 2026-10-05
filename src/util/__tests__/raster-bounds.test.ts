import { describe, expect, it } from 'vitest';
import { rasterBoundsForStroke, strokeExitsRasterBounds } from '../raster-bounds.ts';

describe('rasterBoundsForStroke', () => {
  it('contains the layer and brush footprint in document space', () => {
    expect(
      rasterBoundsForStroke(
        { x: 10, y: 20, width: 40, height: 30 },
        [
          { x: 0, y: 40 },
          { x: 85, y: 62 },
        ],
        5
      )
    ).toEqual({ x: -5, y: 20, width: 95, height: 47 });
  });

  it('always contains the base frame, so no stroke can crop the layer out of its own raster', () => {
    // This is the containment the removed `previous` parameter was nominally serving, and it is
    // reachable without it: every point outside the layer only ever widens the union, and an
    // empty stroke returns the base box untouched. A stroke that began and ended inside the
    // layer is the case that used to be able to shrink the frame.
    const base = { x: 10, y: 20, width: 40, height: 30 };
    const contains = (frame: { x: number; y: number; width: number; height: number }) =>
      frame.x <= base.x &&
      frame.y <= base.y &&
      frame.x + frame.width >= base.x + base.width &&
      frame.y + frame.height >= base.y + base.height;

    expect(contains(rasterBoundsForStroke(base, [{ x: 20, y: 30 }], 5))).toBe(true);
    expect(contains(rasterBoundsForStroke(base, [{ x: 0, y: 0 }], 5))).toBe(true);
    expect(contains(rasterBoundsForStroke(base, [], 5))).toBe(true);
    expect(rasterBoundsForStroke(base, [], 5)).toEqual(base);
  });

  it('only widens when a stroke crosses outward from the layer', () => {
    const base = { x: 10, y: 20, width: 40, height: 30 };
    expect(
      strokeExitsRasterBounds(base, [
        { x: 20, y: 30 },
        { x: 45, y: 30 },
      ])
    ).toBe(false);
    expect(
      strokeExitsRasterBounds(base, [
        { x: 45, y: 30 },
        { x: 70, y: 30 },
      ])
    ).toBe(true);
  });

  it('treats the exact far corner as inside, so a stroke leaving from it still widens', () => {
    // Both far edges use `<=`. A strict `<` would classify the corner as outside, and a stroke
    // beginning exactly there would silently stop widening — and no other case touches a corner.
    expect(
      strokeExitsRasterBounds({ x: 10, y: 20, width: 40, height: 30 }, [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
      ])
    ).toBe(true);
  });

  it('reports no exit for a stroke that never entered the layer at all', () => {
    // The rule is "started inside, then left", not "is outside somewhere". A stroke begun on empty
    // canvas must not grow the layer around nothing.
    expect(
      strokeExitsRasterBounds({ x: 10, y: 20, width: 40, height: 30 }, [
        { x: 80, y: 80 },
        { x: 90, y: 90 },
      ])
    ).toBe(false);
  });

  it('treats a non-finite radius as zero rather than propagating NaN into the frame', () => {
    // `Math.min(base.x, NaN)` is NaN, and a NaN origin becomes a NaN width downstream, which
    // `stageProcessorInput`'s cap then refuses as unallocatable — silently dropping the stroke
    // rather than erroring where the bad number came from.
    expect(rasterBoundsForStroke({ x: 10, y: 20, width: 40, height: 30 }, [], Number.NaN)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 30,
    });
  });

  it('clamps a negative radius to zero instead of shrinking the frame inward', () => {
    expect(rasterBoundsForStroke({ x: 10, y: 20, width: 40, height: 30 }, [{ x: 0, y: 0 }], -5)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
    });
  });

  it('rounds a fractional footprint OUTWARD, flooring the origin and ceiling the extent', () => {
    // The frame must actually CONTAIN a non-integral brush. Rounding to nearest instead would put
    // the tip's outer half outside the staged raster, where it is clipped by the frame's own edge.
    expect(rasterBoundsForStroke({ x: 10, y: 20, width: 40, height: 30 }, [{ x: 12, y: 22 }], 5.7)).toEqual({
      x: 6,
      y: 16,
      width: 44,
      height: 34,
    });
  });

  it('grows monotonically as the stroke lengthens, which is what keeps the preview from jumping', () => {
    // Production monotonicity comes from `points` being `usePaintStroke`'s append-only live array,
    // not from the `previous` parameter — nothing writes a frame back into the tool args. This
    // asserts the mechanism that actually runs.
    const base = { x: 10, y: 20, width: 40, height: 30 };
    const early = rasterBoundsForStroke(base, [{ x: 20, y: 20 }], 5);
    const late = rasterBoundsForStroke(
      base,
      [
        { x: 20, y: 20 },
        { x: 120, y: 90 },
      ],
      5
    );

    expect(late.x).toBeLessThanOrEqual(early.x);
    expect(late.y).toBeLessThanOrEqual(early.y);
    expect(late.x + late.width).toBeGreaterThanOrEqual(early.x + early.width);
    expect(late.y + late.height).toBeGreaterThanOrEqual(early.y + early.height);
    expect(late.width * late.height).toBeGreaterThan(early.width * early.height);
  });

  it('never returns a degenerate frame, because a zero-extent raster has no pixel (0, 0) to address', () => {
    const frame = rasterBoundsForStroke({ x: 10, y: 20, width: 0, height: 0 }, [], 5);
    expect(frame.width).toBeGreaterThanOrEqual(1);
    expect(frame.height).toBeGreaterThanOrEqual(1);
  });
});
