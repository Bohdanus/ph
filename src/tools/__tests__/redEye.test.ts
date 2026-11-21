import { describe, expect, it } from 'vitest';

import {
  correctRedEyePixels,
  RED_EYE_MAX_PIXELS,
  RED_EYE_PUPIL_SIZE_MIN,
  RED_EYE_PUPIL_SIZE_MAX,
  RED_EYE_DARKEN_AMOUNT_MIN,
  RED_EYE_DARKEN_AMOUNT_MAX,
  RED_EYE_DEFAULT_PUPIL_SIZE,
  RED_EYE_DEFAULT_DARKEN_AMOUNT,
} from '../redEye.ts';

const imageWithPixels = (width: number, height: number, pixels: Record<number, [number, number, number, number]>) => {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (const [index, rgba] of Object.entries(pixels)) {
    image.data.set(rgba, Number(index) * 4);
  }
  return image;
};

describe('correctRedEyePixels constants', () => {
  it('RED_EYE_PUPIL_SIZE_MIN is 0', () => {
    expect(RED_EYE_PUPIL_SIZE_MIN).toBe(0);
  });

  it('RED_EYE_PUPIL_SIZE_MAX is 100', () => {
    expect(RED_EYE_PUPIL_SIZE_MAX).toBe(100);
  });

  it('RED_EYE_DARKEN_AMOUNT_MIN is 0', () => {
    expect(RED_EYE_DARKEN_AMOUNT_MIN).toBe(0);
  });

  it('RED_EYE_DARKEN_AMOUNT_MAX is 100', () => {
    expect(RED_EYE_DARKEN_AMOUNT_MAX).toBe(100);
  });

  it('RED_EYE_DEFAULT_PUPIL_SIZE is 50', () => {
    expect(RED_EYE_DEFAULT_PUPIL_SIZE).toBe(50);
  });

  it('RED_EYE_DEFAULT_DARKEN_AMOUNT is 50', () => {
    expect(RED_EYE_DEFAULT_DARKEN_AMOUNT).toBe(50);
  });

  it('RED_EYE_MAX_PIXELS is 50000', () => {
    expect(RED_EYE_MAX_PIXELS).toBe(50_000);
  });
});

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

  it('does not alter pixels when no red region is found', () => {
    const image = imageWithPixels(3, 3, { 4: [80, 70, 65, 255] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50)).toEqual({ status: 'unchanged', pixelsChanged: 0 });
    expect([...image.data.slice(16, 20)]).toEqual([80, 70, 65, 255]);
  });

  it('does not alter pixels when click point is outside the image', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });

    expect(correctRedEyePixels(image, { x: 3, y: 1 }, 50, 50)).toEqual({ status: 'unchanged', pixelsChanged: 0 });
    expect([...image.data.slice(16, 20)]).toEqual([200, 20, 10, 255]);
  });

  it('clamps non-finite pupilSize to 0 (minimum radius 2)', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });

    // NaN pupilSize -> clampPercent -> 0 -> radius = max(2, ...) = 2
    expect(correctRedEyePixels(image, { x: 1, y: 1 }, Number.NaN, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
  });

  it('clamps non-finite darkenAmount to 0', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });

    // NaN darkenAmount -> clampPercent -> 0 -> darken = 0 -> no change to pixel values
    const result = correctRedEyePixels(image, { x: 1, y: 1 }, 50, Number.NaN);
    expect(result.status).toBe('changed');
    // With darken=0, pixel values should not change (neutralRed + (min(red, neutralRed) - neutralRed) * 0 = neutralRed)
    // But the pixel is still counted as "changed" since we process it
    expect(result.pixelsChanged).toBe(1);
  });

  it('clamps pupilSize to [0, 100] and darkenAmount to [0, 100]', () => {
    // Negative pupilSize clamped to 0
    const img1 = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });
    expect(correctRedEyePixels(img1, { x: 1, y: 1 }, -10, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
    // pupilSize > 100 clamped to 100
    const img2 = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });
    expect(correctRedEyePixels(img2, { x: 1, y: 1 }, 150, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
    // Negative darkenAmount clamped to 0
    const img3 = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });
    const result = correctRedEyePixels(img3, { x: 1, y: 1 }, 50, -10);
    expect(result.status).toBe('changed');
    // With darken=0, pixel becomes neutralRed (20)
    expect(img3.data[16]).toBe(20);
    expect(img3.data[17]).toBe(20);
    expect(img3.data[18]).toBe(10);
    // darkenAmount > 100 clamped to 100
    const img4 = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });
    expect(correctRedEyePixels(img4, { x: 1, y: 1 }, 50, 150)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
  });

  it('RED_EYE_MAX_PIXELS constant is defined', () => {
    expect(RED_EYE_MAX_PIXELS).toBe(50_000);
  });

  it('correctly neutralizes red toward max(green, blue)', () => {
    // Red pixel with green=50, blue=30 -> neutralRed = 50
    const image = imageWithPixels(3, 3, { 4: [200, 50, 30, 255] });

    const result = correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50);
    expect(result.status).toBe('changed');
    // At darken=50%, correctedRed = 50 + (min(200, 50) - 50) * 0.5 = 50 + 0 = 50
    expect(image.data[16]).toBe(50);
    // correctedGreen = 50 * (1 - 0.5) = 25
    expect(image.data[17]).toBe(25);
    // correctedBlue = 30 * (1 - 0.5) = 15
    expect(image.data[18]).toBe(15);
  });

  it('handles fully saturated red (green=0, blue=0)', () => {
    const image = imageWithPixels(3, 3, { 4: [255, 0, 0, 255] });

    const result = correctRedEyePixels(image, { x: 1, y: 1 }, 50, 100);
    expect(result.status).toBe('changed');
    // neutralRed = 0, darken = 1
    // correctedRed = 0 + (min(255, 0) - 0) * 1 = 0
    expect(image.data[16]).toBe(0);
    expect(image.data[17]).toBe(0);
    expect(image.data[18]).toBe(0);
  });

  it('handles non-red pixels correctly (blue eye)', () => {
    // Blue-dominant pixel is not a red-eye pixel
    const image = imageWithPixels(3, 3, { 4: [20, 20, 200, 255] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
    expect([...image.data.slice(16, 20)]).toEqual([20, 20, 200, 255]);
  });

  it('handles transparent pixels (alpha=0)', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 0] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
  });

  it('handles semi-transparent pixels (alpha > 0)', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 128] });

    expect(correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
    expect(image.data[19]).toBe(128); // alpha preserved
  });

  it('finds the best seed pixel (highest red difference) within seed radius', () => {
    // Two red pixels near click, one more red-dominant
    const image = imageWithPixels(5, 5, {
      11: [180, 50, 40, 255], // red diff = 130
      12: [200, 20, 10, 255], // red diff = 180 (better seed)
    });

    const result = correctRedEyePixels(image, { x: 2, y: 2 }, 50, 50);
    expect(result.status).toBe('changed');
    // Both should be corrected since they're connected
    expect(result.pixelsChanged).toBe(2);
  });

  it('handles small images with minimum radius', () => {
    // 5x5 image, pupilSize=0 -> radius = max(2, round(5 * 0.005)) = 2
    const image = imageWithPixels(5, 5, {
      12: [200, 20, 10, 255],
    });

    const result = correctRedEyePixels(image, { x: 2, y: 2 }, 0, 50);
    expect(result.status).toBe('changed');
  });

  it('handles click on exact pixel boundary', () => {
    const image = imageWithPixels(5, 5, {
      12: [200, 20, 10, 255],
    });

    // Click at float coordinates, should be rounded
    expect(correctRedEyePixels(image, { x: 2.3, y: 2.7 }, 50, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
  });

  it('does not modify pixels outside the search radius', () => {
    const image = imageWithPixels(10, 10, {
      12: [200, 20, 10, 255], // Near click
      80: [200, 20, 10, 255], // Far from click (row 8, col 0)
    });

    const result = correctRedEyePixels(image, { x: 2, y: 2 }, 10, 50); // Small pupil size
    expect(result.pixelsChanged).toBe(1); // Only the near one
    // The far one should be unchanged
    expect([...image.data.slice(80 * 4, 80 * 4 + 4)]).toEqual([200, 20, 10, 255]);
  });

  it('preserves alpha channel of corrected pixels', () => {
    const image = imageWithPixels(3, 3, {
      4: [200, 20, 10, 128], // semi-transparent
      5: [200, 20, 10, 200], // different alpha
    });

    correctRedEyePixels(image, { x: 1, y: 1 }, 50, 50);
    expect(image.data[19]).toBe(128);
    expect(image.data[23]).toBe(200);
  });
});

describe('correctRedEyePixels edge cases', () => {
  it('handles zero-width image', () => {
    const image = { width: 0, height: 10, data: new Uint8ClampedArray(0) };
    expect(correctRedEyePixels(image, { x: 0, y: 0 }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
  });

  it('handles zero-height image', () => {
    const image = { width: 10, height: 0, data: new Uint8ClampedArray(0) };
    expect(correctRedEyePixels(image, { x: 0, y: 0 }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
  });

  it('handles non-finite point coordinates', () => {
    const image = imageWithPixels(3, 3, { 4: [200, 20, 10, 255] });
    expect(correctRedEyePixels(image, { x: NaN, y: 1 }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
    expect(correctRedEyePixels(image, { x: 1, y: Infinity }, 50, 50)).toEqual({
      status: 'unchanged',
      pixelsChanged: 0,
    });
  });

  it('handles click at image edge (0,0)', () => {
    const image = imageWithPixels(3, 3, { 0: [200, 20, 10, 255] });
    expect(correctRedEyePixels(image, { x: 0, y: 0 }, 50, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
  });

  it('handles click at bottom-right corner', () => {
    const image = imageWithPixels(3, 3, { 8: [200, 20, 10, 255] });
    expect(correctRedEyePixels(image, { x: 2, y: 2 }, 50, 50)).toEqual({
      status: 'changed',
      pixelsChanged: 1,
    });
  });
});
