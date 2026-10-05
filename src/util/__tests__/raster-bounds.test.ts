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

  it('never shrinks a frame that was already staged earlier in the stroke', () => {
    expect(
      rasterBoundsForStroke({ x: 10, y: 20, width: 40, height: 30 }, [{ x: 20, y: 30 }], 5, {
        x: -5,
        y: 10,
        width: 95,
        height: 50,
      })
    ).toEqual({ x: -5, y: 10, width: 95, height: 50 });
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
});
