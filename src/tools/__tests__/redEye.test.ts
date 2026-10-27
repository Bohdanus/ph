import { describe, expect, it } from 'vitest';

import { correctRedEyePixels } from '../redEye.ts';

const imageWithPixels = (width: number, height: number, pixels: Record<number, [number, number, number, number]>) => {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (const [index, rgba] of Object.entries(pixels)) {
    image.data.set(rgba, Number(index) * 4);
  }
  return image;
};

describe('correctRedEyePixels', () => {
  it('neutralizes and darkens the connected red region around the click', () => {
    const image = imageWithPixels(5, 5, {
      12: [240, 24, 18, 255],
      13: [220, 20, 16, 255],
      18: [15, 12, 10, 255],
    });

    expect(correctRedEyePixels(image, { x: 2, y: 2 }, 50, 50)).toEqual({ status: 'changed', pixelsChanged: 2 });
    expect([...image.data.slice(12 * 4, 12 * 4 + 4)]).toEqual([24, 12, 9, 255]);
    expect([...image.data.slice(13 * 4, 13 * 4 + 4)]).toEqual([20, 10, 8, 255]);
    expect([...image.data.slice(18 * 4, 18 * 4 + 4)]).toEqual([15, 12, 10, 255]);
  });

  it('finds a red pixel just beside the click and preserves alpha', () => {
    const image = imageWithPixels(5, 5, { 11: [200, 15, 10, 128] });

    expect(correctRedEyePixels(image, { x: 2, y: 2 }, 50, 100)).toEqual({ status: 'changed', pixelsChanged: 1 });
    expect([...image.data.slice(11 * 4, 11 * 4 + 4)]).toEqual([15, 0, 0, 128]);
  });

  it('does not alter pixels when no red region is found or the point is outside the image', () => {
    const image = imageWithPixels(3, 3, { 4: [80, 70, 65, 255] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50)).toEqual({ status: 'unchanged', pixelsChanged: 0 });
    expect(correctRedEyePixels(image, { x: 3, y: 1 }, 50, 50)).toEqual({ status: 'unchanged', pixelsChanged: 0 });
    expect([...image.data.slice(16, 20)]).toEqual([80, 70, 65, 255]);
  });

  it('clamps non-finite and out-of-range slider values safely', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
    expect([...image.data.slice(16, 20)]).toEqual([20, 20, 10, 255]);
  });
});
