import { describe, expect, it } from 'vitest';
import { alphaFromSignedDistance, createFeatheredAlphaMask } from '../selection.ts';

/** A square of set pixels in the middle of an otherwise empty mask. */
function createCenteredSquareMask(width: number, height: number, inset: number, size: number): Uint8Array {
  const mask = new Uint8Array(width * height);

  for (let y = inset; y < inset + size; y++) {
    for (let x = inset; x < inset + size; x++) {
      mask[y * width + x] = 1;
    }
  }

  return mask;
}

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

describe('alphaFromSignedDistance', () => {
  it.each([
    [-6, 0],
    [-5, 0],
    [0, 128],
    [5, 255],
    [6, 255],
  ])('ramps a signed distance of %i to %i at a feather radius of 5', (signedDistance, expected) => {
    expect(alphaFromSignedDistance(signedDistance, 5)).toBe(expected);
  });

  it.each([
    ['a distance well inside the shape', 10, 255],
    ['a distance just inside the shape', 0.5, 255],
    ['a distance just outside the shape', -0.5, 0],
    ['a distance well outside the shape', -10, 0],
  ])('anti-aliases a zero feather radius at the half-pixel boundary (%s)', (_label, signedDistance, expected) => {
    expect(alphaFromSignedDistance(signedDistance, 0)).toBe(expected);
  });

  it.each([
    ['exactly on the boundary', 0, 0],
    ['half a pixel inside', 0.5, 255],
    ['a pixel inside', 5, 255],
  ])('hard-thresholds a zero feather radius without anti-aliasing (%s)', (_label, signedDistance, expected) => {
    expect(alphaFromSignedDistance(signedDistance, 0, false)).toBe(expected);
  });

  it('clamps a negative feather radius to zero, so the ramp becomes the half-pixel step', () => {
    expect(alphaFromSignedDistance(0, -5)).toBe(alphaFromSignedDistance(0, 0));
    expect(alphaFromSignedDistance(0, -5, false)).toBe(0);
    expect(alphaFromSignedDistance(3, -5, false)).toBe(255);
  });

  it('ignores the anti-alias flag once the feather radius is positive', () => {
    for (const signedDistance of [-5, -1, 0, 1, 5]) {
      expect(alphaFromSignedDistance(signedDistance, 3, false)).toBe(alphaFromSignedDistance(signedDistance, 3, true));
    }
  });

  it('stays inside the 0-255 byte range across the whole domain', () => {
    for (let signedDistance = -20; signedDistance <= 20; signedDistance += 0.25) {
      for (const featherRadius of [0, 0.5, 5, 100]) {
        const alpha = alphaFromSignedDistance(signedDistance, featherRadius);

        expect(Number.isInteger(alpha)).toBe(true);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('createFeatheredAlphaMask', () => {
  it('produces only fully opaque pixels when every pixel is inside the mask', () => {
    const mask = new Uint8Array(16).fill(1);

    expect(Array.from(createFeatheredAlphaMask(mask, 4, 4, 2, true))).toEqual(new Array(16).fill(255));
  });

  it('produces only fully transparent pixels when every pixel is outside the mask', () => {
    const mask = new Uint8Array(16);

    // With no selected pixel at all, every "distance to the inside" stays at the
    // 1_000_000 sentinel rather than NaN, so the mask reads as empty, not as garbage.
    expect(Array.from(createFeatheredAlphaMask(mask, 4, 4, 2, true))).toEqual(new Array(16).fill(0));
  });

  it('returns a mask of the same length as the binary mask', () => {
    const binaryMask = createCenteredSquareMask(6, 6, 1, 3);

    expect(createFeatheredAlphaMask(binaryMask, 6, 6, 1, true)).toHaveLength(binaryMask.length);
  });

  it('quantises to a hard 0/255 mask when anti-aliasing is off and the radius is zero', () => {
    const binaryMask = createCenteredSquareMask(5, 5, 1, 3);
    const alphaMask = createFeatheredAlphaMask(binaryMask, 5, 5, 0, false);

    expect(Array.from(new Set(alphaMask)).sort()).toEqual([0, 255]);
  });

  it('still feathers smoothly when anti-aliasing is off but the radius is positive', () => {
    const binaryMask = createCenteredSquareMask(5, 5, 1, 3);
    const hardMask = createFeatheredAlphaMask(binaryMask, 5, 5, 0, false);
    const featheredMask = createFeatheredAlphaMask(binaryMask, 5, 5, 2, false);

    // The anti-alias flag only selects the hard threshold in the zero-radius branch;
    // with a positive radius both flags run the identical smoothStep ramp.
    expect(Array.from(new Set(hardMask)).sort()).toEqual([0, 255]);
    expect(new Set(featheredMask).size).toBeGreaterThan(2);
    expect(featheredMask[2 * 5 + 2]).toBe(255);
  });

  it('never mutates the binary mask it is given', () => {
    const binaryMask = createCenteredSquareMask(5, 5, 1, 3);
    const before = binaryMask.slice();

    createFeatheredAlphaMask(binaryMask, 5, 5, 2, true);

    expect(binaryMask).toEqual(before);
  });

  it('keeps the mask monotonically darker the further a pixel sits from the selection', () => {
    const binaryMask = createCenteredSquareMask(7, 7, 2, 3);
    const alphaMask = createFeatheredAlphaMask(binaryMask, 7, 7, 3, true);
    // The middle row crosses the block horizontally: column 3 is its centre, column 1
    // is one pixel outside it and column 0 is two.
    const row = Array.from(alphaMask.slice(3 * 7, 4 * 7));

    expect(row[3]).toBe(Math.max(...row));
    expect(row[3]).toBeGreaterThan(row[1]);
    expect(row[1]).toBeGreaterThan(row[0]);
  });
});
