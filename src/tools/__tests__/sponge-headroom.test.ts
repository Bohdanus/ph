import { describe, expect, it } from 'vitest';

import { chromaHeadroom, chromaScale, spongeLuma } from '../sponge.ts';

describe('chromaHeadroom', () => {
  it('returns the tightest upper channel bound for a computed luma', () => {
    const red = 200;
    const green = 100;
    const blue = 50;
    const luma = spongeLuma(red, green, blue);

    // The red channel limits the scale: (255 - 117.65) / (200 - 117.65).
    expect(luma).toBeCloseTo(117.65, 10);
    expect(chromaHeadroom(red, green, blue, luma)).toBeCloseTo(137.35 / 82.35, 10);
  });

  it('uses a lower channel bound when it is tighter than the upper bound', () => {
    const red = 200;
    const green = 0;
    const blue = 0;
    const luma = spongeLuma(red, green, blue);
    const redUpperBound = (255 - luma) / (red - luma);
    const headroom = chromaHeadroom(red, green, blue, luma);

    // Green and blue reach zero at scale 1; the red upper bound is greater than 1.
    expect(headroom).toBe(1);
    expect(headroom).toBeLessThan(redUpperBound);
  });
});

describe('chromaScale Vibrance', () => {
  it('limits saturation at the first channel boundary before other channels clip', () => {
    const pixel = { r: 200, g: 100, b: 50, a: 173 };

    const withVibrance = chromaScale(pixel, 'saturate', 1, true);
    const withoutVibrance = chromaScale(pixel, 'saturate', 1, false);

    expect(withVibrance).toMatchObject({ r: 255, a: 173 });
    expect(withVibrance.g).toBeCloseTo(88.2119, 4);
    expect(withVibrance.b).toBeCloseTo(4.81785, 4);

    expect(withoutVibrance).toMatchObject({ r: 255, b: 0, a: 173 });
    expect(withoutVibrance.g).toBeCloseTo(82.35, 8);
  });
});
