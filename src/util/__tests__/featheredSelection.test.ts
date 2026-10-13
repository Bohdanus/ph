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

  it('preserves fractional canvas coverage through feathering instead of thresholding to binary', () => {
    const width = 5;
    const height = 1;
    // Use actual 8-bit values that canvas read-back produces
    const coverageMask = Uint8Array.from([0, 64, 128, 192, 255]);

    const alphaMask = createFeatheredAlphaMask(coverageMask, width, height, 2, true);

    // Without the fix, these would all be thresholded to 0 or 255 before feathering,
    // producing only the binary ramp. With the fix, each fractional value produces
    // a distinct alpha value through the signed distance path.
    expect(alphaMask[0]).toBeLessThan(alphaMask[1]);
    expect(alphaMask[1]).toBeLessThan(alphaMask[2]);
    expect(alphaMask[2]).toBeLessThan(alphaMask[3]);
    expect(alphaMask[3]).toBeLessThan(alphaMask[4]);

    // Verify exact values with 8-bit precision (64/255, 128/255, 192/255 not exact fractions)
    // featherRadius=2: t = (sd + 2) / 4 where sd = (coverage - 0.5) * 2
    expect(alphaMask[0]).toBe(40); // coverage=0: sd=-1.0 -> t=0.25 -> 40
    expect(alphaMask[1]).toBe(81); // coverage=64/255: sd≈-0.498 -> t≈0.375 -> 81
    expect(alphaMask[2]).toBe(128); // coverage=128/255: sd≈0.004 -> t≈0.5 -> 128
    expect(alphaMask[3]).toBe(175); // coverage=192/255: sd≈0.506 -> t≈0.626 -> 175
    expect(alphaMask[4]).toBe(215); // coverage=1.0: sd=1.0 -> t=0.75 -> 215
  });

  it('applies feather radius to expand the antialiased transition zone', () => {
    const width = 5;
    const height = 1;
    const coverageMask = Uint8Array.from([0, 64, 128, 192, 255]);

    const alphaMask = createFeatheredAlphaMask(coverageMask, width, height, 4, true);

    // With larger feather radius, the transition zone expands
    // featherRadius=4: t = (sd + 4) / 8
    expect(alphaMask[0]).toBe(81); // coverage=0: sd=-1.0 -> t=0.375 -> 81
    expect(alphaMask[1]).toBe(104); // coverage=64/255: sd≈-0.498 -> t≈0.438 -> 104
    expect(alphaMask[2]).toBe(128); // coverage=128/255: sd≈0.004 -> t≈0.5 -> 128
    expect(alphaMask[3]).toBe(152); // coverage=192/255: sd≈0.506 -> t≈0.563 -> 152
    expect(alphaMask[4]).toBe(174); // coverage=1.0: sd=1.0 -> t=0.625 -> 174
  });

  it('falls back to binary chamfer path when preservesCoverage is false', () => {
    const binaryMask = createCenteredSquareMask(5, 5, 1, 3);
    const alphaMask = createFeatheredAlphaMask(binaryMask, 5, 5, 2, true, false);

    // Binary path should still produce the exact chamfer values
    expect(alphaMask[2 * 5 + 2]).toBe(255);
    expect(alphaMask[1 * 5 + 1]).toBe(215);
    expect(alphaMask[0]).toBe(15);
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
  it('maps fractional coverage to anti-aliased output at zero feather radius', () => {
    const coverageMask = Uint8Array.from([0, 64, 128, 255]);

    const alphaMask = createFeatheredAlphaMask(coverageMask, 4, 1, 0, true);

    // With featherRadius=0 and antiAlias=true, the coverage-preserving algorithm
    // maps coverage to signedDistance = (coverage - 0.5) * 2, then applies
    // half-pixel anti-aliasing: output = round(clamp(sd + 0.5, 0, 1) * 255)
    // 0: sd=-1.0 -> clamp(-0.5)=0 -> 0
    // 64/255: sd≈-0.498 -> clamp(0.002) -> 0 (rounds down due to floating point)
    // 128/255: sd≈0.004 -> clamp(0.504)=0.504 -> 129
    // 255/255: sd=1.0 -> clamp(1.5)=1 -> 255
    expect(alphaMask[0]).toBe(0);
    expect(alphaMask[1]).toBe(0);
    expect(alphaMask[2]).toBe(129);
    expect(alphaMask[3]).toBe(255);

    // Verify monotonic mapping preserves ordering
    expect(alphaMask[0]).toBeLessThanOrEqual(alphaMask[1]);
    expect(alphaMask[1]).toBeLessThan(alphaMask[2]);
    expect(alphaMask[2]).toBeLessThan(alphaMask[3]);
  });

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
