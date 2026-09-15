import { describe, expect, it } from 'vitest';
import { alphaFromSignedDistance, createFeatheredAlphaMask } from '../selection.ts';

describe('feathered selection masks', () => {
  it('maps signed distance to a smooth Photoshop-like feather ramp', () => {
    expect(alphaFromSignedDistance(-5, 5)).toBe(0);
    expect(alphaFromSignedDistance(0, 5)).toBeCloseTo(128, 0);
    expect(alphaFromSignedDistance(5, 5)).toBe(255);
  });

  it('creates softer alpha values around binary mask edges', () => {
    const width = 5;
    const height = 5;
    const binaryMask = new Uint8Array(width * height);

    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        binaryMask[y * width + x] = 1;
      }
    }

    const alphaMask = createFeatheredAlphaMask(binaryMask, width, height, 2, true);
    const centerAlpha = alphaMask[2 * width + 2];
    const edgeAlpha = alphaMask[1 * width + 1];
    const cornerAlpha = alphaMask[0];

    expect(centerAlpha).toBeGreaterThan(edgeAlpha);
    expect(edgeAlpha).toBeGreaterThan(cornerAlpha);
    expect(cornerAlpha).toBeGreaterThan(0);
  });
});
