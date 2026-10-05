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

  /**
   * The same three pixels as the case above, as exact values, because the chamfer distance
   * and the ramp are both fully determined and "greater than 0" is satisfied by any of a
   * dozen wrong implementations.
   *
   * Each number below is derivable by hand from `chamferDistanceFromSeeds` (two passes, 1 for
   * an orthogonal step and `Math.SQRT2` for a diagonal) and `alphaFromSignedDistance`
   * (`t = (d + r) / 2r`, `smoothStep(t) = t^2 * (3 - 2t)`, `round(... * 255)`), at r = 2:
   *
   * - `(2, 2)` is inside; the nearest outside pixel is `(2, 0)`, two orthogonal steps away, so
   *   `d = 2` and `t = min(1, 4/4) = 1` -> `255`.
   * - `(1, 1)` is inside; `(0, 1)` is one step away, so `d = 1` and `t = 3/4`. smoothStep at
   *   3/4 is `0.5625 * 1.5 = 0.84375`, and `0.84375 * 255 = 215.15625` -> `215`.
   * - `(0, 0)` is outside; the nearest inside pixel is `(1, 1)`, one DIAGONAL step away, so
   *   `d = -SQRT2 = -1.4142135` and `t = (2 - 1.4142135) / 4 = 0.1464466`. smoothStep is
   *   `0.0214466 * 2.7071068 = 0.0580577`, and `0.0580577 * 255 = 14.8047` -> `15`.
   *
   * The mutants, none of which the ordering assertions can see:
   * - `Math.SQRT2` replaced by 1 (a Manhattan chamfer) sends the corner to `d = -2`, `t = 0`,
   *   and alpha `0` — which still satisfies `toBeGreaterThan(0)`? No: it fails it, but the
   *   exact `15` also fails an implementation that used a different radius normalisation,
   *   which the ordering assertions accept.
   * - `smoothStep` replaced by a linear ramp gives the edge `round(0.75 * 255) = 191`.
   * - `round` dropped gives `215.15625`, which `Uint8Array` would truncate to 215 and
   *   `toBeCloseTo` would wave through.
   */
  it('lands the centre, edge and corner on their exact chamfer-and-smoothStep values', () => {
    const binaryMask = createCenteredSquareMask(5, 5, 1, 3);

    const alphaMask = createFeatheredAlphaMask(binaryMask, 5, 5, 2, true);

    expect(alphaMask[2 * 5 + 2]).toBe(255);
    expect(alphaMask[1 * 5 + 1]).toBe(215);
    expect(alphaMask[0]).toBe(15);
    // A linear ramp instead of smoothStep would put the edge at 191.
    expect(alphaMask[1 * 5 + 1]).not.toBe(Math.round((3 / 4) * 255));
    // A Manhattan chamfer would put the corner at exactly 0.
    expect(alphaMask[0]).not.toBe(0);
  });

  /**
   * The diagonal term is what makes the feather round rather than diamond-shaped, and it only
   * shows on the corner pixels — the edge and centre values above are the same under either
   * metric. A 7x7 mask with a 3x3 block puts a pixel at signed distance exactly `-SQRT2 * 2`
   * from the block, which is the value a four-neighbour chamfer cannot produce.
   */
  it('measures the diagonal with SQRT2 rather than treating it as two steps', () => {
    // Block at (2..4, 2..4); pixel (0, 0) is two diagonals from (2, 2).
    const binaryMask = createCenteredSquareMask(7, 7, 2, 3);

    const twoSteps = createFeatheredAlphaMask(binaryMask, 7, 7, 3, true);
    // -2 * SQRT2 = -2.8284271, t = (3 - 2.8284271) / 6 = 0.0285955, smoothStep =
    // 0.000817705 * 2.9428090 = 0.0024064, * 255 = 0.61364 -> 1.
    expect(twoSteps[0]).toBe(1);
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
