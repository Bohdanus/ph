import { describe, expect, it } from 'vitest';

import { getTrapezoidQuad } from '../../tools/transform.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  IDENTITY_HOMOGRAPHY,
  applyHomography,
  differentiateHomography,
  homographyDeterminant,
  homographyMagnitude,
  invertHomography,
  isInvertibleHomography,
  projectiveDenominator,
  projectiveRowScale,
  solveHomography,
  type Homography,
} from '../homography.ts';

function rectCorners(size: Size): Point[] {
  return [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ];
}

function expectPointCloseTo(actual: Point | null, expected: Point, precision = 6): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, precision);
  expect(actual!.y).toBeCloseTo(expected.y, precision);
}

const ninetyDegreeRotation: Homography = { a: 0, b: -1, c: 0, d: 1, e: 0, f: 0, g: 0, h: 0, i: 1 };

describe('homography', () => {
  describe('solveHomography', () => {
    it('maps every correspondence of a rectangle onto a rotated square', () => {
      const source = rectCorners({ width: 40, height: 40 });
      const destination = [
        { x: 10, y: 0 },
        { x: 10, y: 40 },
        { x: -30, y: 40 },
        { x: -30, y: 0 },
      ];

      const matrix = solveHomography(source, destination);

      expect(matrix).not.toBeNull();
      source.forEach((point, index) => expectPointCloseTo(applyHomography(matrix!, point), destination[index]));
    });

    it('rejects correspondences that do not share a source or destination point count', () => {
      const rect = rectCorners({ width: 10, height: 10 });

      expect(solveHomography(rect.slice(0, 3), rect.slice(0, 3))).toBeNull();
      expect(solveHomography([...rect, { x: 5, y: 5 }], rect)).toBeNull();
    });

    it('rejects non-finite correspondences', () => {
      const rect = rectCorners({ width: 10, height: 10 });

      expect(solveHomography(rect, [{ x: Number.NaN, y: 0 }, ...rect.slice(1)])).toBeNull();
      expect(solveHomography(rect, [...rect.slice(0, 3), { x: Number.POSITIVE_INFINITY, y: 10 }])).toBeNull();
    });

    it('rejects a degenerate destination quad whose corners collapse onto each other', () => {
      const size: Size = { width: 100, height: 50 };

      expect(solveHomography(rectCorners(size), getTrapezoidQuad(size, 100))).toBeNull();
      expect(solveHomography(rectCorners(size), getTrapezoidQuad(size, -100))).toBeNull();
    });

    it('rejects a rank-deficient correspondence set instead of returning a singular matrix', () => {
      const collinear = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 0 },
        { x: 0, y: 50 },
      ];

      expect(solveHomography(collinear, getTrapezoidQuad({ width: 100, height: 50 }, 50))).toBeNull();
    });

    it('solves a collimated destination quad without folding inside the source rect', () => {
      const size: Size = { width: 100, height: 50 };
      const matrix = solveHomography(rectCorners(size), getTrapezoidQuad(size, 85));

      expect(matrix).not.toBeNull();
      expect(isInvertibleHomography(matrix!)).toBe(true);
      for (let row = 0; row <= size.height; row += 5) {
        const mapped = applyHomography(matrix!, { x: 0, y: row });
        expect(mapped).not.toBeNull();
        expect(mapped!.x).toBeGreaterThanOrEqual(0);
        expect(mapped!.y).toBeLessThanOrEqual(size.height);
      }
    });

    it.each([
      { width: 6928, height: 3464 },
      { width: 8000, height: 6000 },
    ])('solves the slider-limit taper for a $width x $height layer', (size) => {
      for (const trapezoid of [-85, 85]) {
        const matrix = solveHomography(rectCorners(size), getTrapezoidQuad(size, trapezoid));

        expect(matrix).not.toBeNull();
        expect(invertHomography(matrix!)).not.toBeNull();
      }
    });

    /**
     * The identity, as the exact matrix rather than as a set of mapped corners.
     *
     * Every other case in this file checks that the solution REPRODUCES a known quad, which
     * a solver could do with a wrong-but-consistent normalisation of h8. Mapping four
     * corners onto themselves is satisfied by any scalar multiple of the identity, so it is
     * the coefficient vector itself that has to be checked — and `i` is pinned to 1 by the
     * construction rather than solved for, which is exactly the step a rewrite could get
     * wrong. The mutants: transposed `rows`/`values` (x and y swapped), a missing
     * `-to.x * from.x` sign (the classic DLT sign error, which produces the identity with
     * `g` and `h` negated and still maps the origin correctly), and `i` solved rather than
     * fixed.
     */
    it('solves the identity correspondences back to exactly the identity matrix', () => {
      const rect = rectCorners({ width: 64, height: 32 });

      const matrix = solveHomography(rect, rect)!;

      expect(matrix.a).toBe(1);
      expect(matrix.e).toBe(1);
      expect(matrix.i).toBe(1);
      // The zeros are compared by magnitude because the solver leaves signed zero in a
      // coefficient it never had to move, and `toEqual` distinguishes +0 from -0. That is the
      // only concession: each one is still required to be zero.
      for (const coefficient of ['b', 'c', 'd', 'f', 'g', 'h'] as const) {
        expect(Math.abs(matrix[coefficient]), coefficient).toBe(0);
      }
    });

    it('solves a pure translation to the matrix whose a and e stay exactly 1', () => {
      const rect = rectCorners({ width: 64, height: 32 });
      const moved = rect.map((point) => ({ x: point.x + 1000, y: point.y - 500 }));

      const matrix = solveHomography(rect, moved)!;

      expectPointCloseTo(applyHomography(matrix, { x: 0, y: 0 }), { x: 1000, y: -500 });
      expect(matrix.a).toBeCloseTo(1, 9);
      expect(matrix.e).toBeCloseTo(1, 9);
      expect(matrix.b).toBeCloseTo(0, 9);
      expect(matrix.d).toBeCloseTo(0, 9);
      expect(matrix.c).toBeCloseTo(1000, 6);
      expect(matrix.f).toBeCloseTo(-500, 6);
      // The projective row stays zero, so the translation really is affine. A wrong sign on the
      // `-to.x * from.x` columns would leave a non-zero `g`/`h` here even though the corners
      // would still map.
      //
      // Compared to a tolerance, not to `0`. A pure translation of a rect has an exactly zero
      // projective row in exact arithmetic, but the solver's elimination leaves float residue
      // whose presence depends on the ARITHMETIC rather than on the answer: sweeping
      // translations of this 64x32 rect gives an exactly zero `g` every time, while the same
      // translations of a 32x64 rect leave `g` around 3.5e-18 and some sizes reach 1.4e-17. A
      // legitimate refactor — a different pivot choice in the row search, a different
      // accumulation order — would move this fixture between those two states and turn a
      // matrix that is right to 17 significant figures red. 1e-12 still separates the two
      // cases by ten orders of magnitude, because the mutant this guards against (a sign flip
      // on the `-to.x * from.x` columns) leaves `g`/`h` O(100), not O(1e-17).
      expect(matrix.g).toBeCloseTo(0, 12);
      expect(matrix.h).toBeCloseTo(0, 12);
    });

    it('rejects four correspondences whose destination is a single repeated point', () => {
      const rect = rectCorners({ width: 10, height: 10 });
      const collapsed = [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ];

      expect(solveHomography(rect, collapsed)).toBeNull();
    });

    it('rejects a source quad whose points all repeat, which is rank zero', () => {
      // A different arm from the collinear case above: the pivot search never finds a usable
      // head at all, rather than finding one and losing rank later.
      const repeated = [
        { x: 3, y: 4 },
        { x: 3, y: 4 },
        { x: 3, y: 4 },
        { x: 3, y: 4 },
      ];

      expect(solveHomography(repeated, rectCorners({ width: 10, height: 10 }))).toBeNull();
    });
  });

  /**
   * `homographyMagnitude` is the scale reference the invertibility epsilon is relative to,
   * and its member list is a decision: `c` and `f` are deliberately EXCLUDED because they
   * are translation, and including them would make a matrix with a large offset in pixel
   * units look near-singular and get refused. Nothing else in this file pins the list, since
   * every magnitude it exercises is 1 or 4.
   */
  describe('homographyMagnitude', () => {
    it('reads the largest ABSOLUTE entry of the seven non-translation coefficients', () => {
      const base: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

      expect(homographyMagnitude(base)).toBe(1);
      expect(homographyMagnitude({ ...base, b: 50 })).toBe(50);
      expect(homographyMagnitude({ ...base, g: -100 })).toBe(100);
      expect(homographyMagnitude({ ...base, h: 7 })).toBe(7);
      // Signs are taken out, so a negative projective term does not read as smaller.
      expect(homographyMagnitude({ ...base, g: -2 })).toBe(2);
    });

    it('ignores the translation terms, which are in pixel units rather than scale', () => {
      // The mutant: adding `c` or `f` to the list. A pure translation of 1e9 px would then
      // report a magnitude of 1e9, and `1e-12 * magnitude^3` would exceed any determinant,
      // so `isInvertibleHomography` would refuse a perfectly good matrix.
      const translated: Homography = { a: 1, b: 0, c: 1e9, d: 0, e: 1, f: -1e9, g: 0, h: 0, i: 1 };

      expect(homographyMagnitude(translated)).toBe(1);
      expect(homographyDeterminant(translated)).toBe(1);
      expect(isInvertibleHomography(translated)).toBe(true);
    });
  });

  describe('invertHomography', () => {
    it('round-trips a trapezoid quad so inverse-mapped corners land on the source rect corners', () => {
      const size: Size = { width: 100, height: 50 };
      const quad = getTrapezoidQuad(size, 50);
      const inverse = invertHomography(solveHomography(rectCorners(size), quad)!);

      expect(inverse).not.toBeNull();
      quad.forEach((corner, index) => expectPointCloseTo(applyHomography(inverse!, corner), rectCorners(size)[index]));
    });

    it('round-trips an arbitrary point through the forward and inverse matrices', () => {
      const size: Size = { width: 64, height: 32 };
      const forward = solveHomography(rectCorners(size), getTrapezoidQuad(size, -40))!;
      const inverse = invertHomography(forward)!;

      expectPointCloseTo(applyHomography(inverse, applyHomography(forward, { x: 12.5, y: 7.25 })!), {
        x: 12.5,
        y: 7.25,
      });
    });

    it('keeps every quad edge straight, which is what makes the corner bounding box tight', () => {
      const size: Size = { width: 100, height: 50 };
      const forward = solveHomography(rectCorners(size), getTrapezoidQuad(size, 50))!;
      const corners = rectCorners(size);

      for (let edge = 0; edge < 4; edge++) {
        const from = corners[edge];
        const to = corners[(edge + 1) % 4];
        const midpoint = applyHomography(forward, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })!;
        const mappedFrom = applyHomography(forward, from)!;
        const mappedTo = applyHomography(forward, to)!;
        const cross =
          (mappedTo.x - mappedFrom.x) * (midpoint.y - mappedFrom.y) -
          (mappedTo.y - mappedFrom.y) * (midpoint.x - mappedFrom.x);
        const edgeLength = Math.hypot(mappedTo.x - mappedFrom.x, mappedTo.y - mappedFrom.y);

        expect(Math.abs(cross) / edgeLength).toBeLessThan(1e-9);
      }
    });

    it('returns null for a singular matrix', () => {
      expect(homographyDeterminant({ a: 1, b: 2, c: 3, d: 2, e: 4, f: 6, g: 0, h: 0, i: 1 })).toBe(0);
      expect(isInvertibleHomography({ a: 1, b: 2, c: 3, d: 2, e: 4, f: 6, g: 0, h: 0, i: 1 })).toBe(false);
      expect(invertHomography({ a: 1, b: 2, c: 3, d: 2, e: 4, f: 6, g: 0, h: 0, i: 1 })).toBeNull();
      expect(invertHomography({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0 })).toBeNull();
    });

    it('reports a non-zero determinant for the identity and for a 90 degree rotation', () => {
      expect(homographyDeterminant(IDENTITY_HOMOGRAPHY)).toBe(1);
      expect(homographyDeterminant(ninetyDegreeRotation)).toBe(1);
      expect(applyHomography(ninetyDegreeRotation, { x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
      expectPointCloseTo(applyHomography(invertHomography(ninetyDegreeRotation)!, { x: 0, y: 1 }), {
        x: 1,
        y: 0,
      });
    });

    it('stays invertible for a large pixel-unit determinant and rejects a rank-deficient matrix', () => {
      const layer: Homography = { a: 4, b: 0, c: 0, d: 0, e: 4, f: 0, g: 0, h: 0, i: 1 };
      const scaled: Homography = { a: 4000, b: 0, c: 0, d: 0, e: 4000, f: 0, g: 0, h: 0, i: 1 };
      const singular: Homography = { a: 4000, b: 8000, c: 0, d: 4000, e: 8000, f: 0, g: 0, h: 0, i: 1 };

      expect(isInvertibleHomography(layer)).toBe(true);
      expect(homographyDeterminant(scaled)).toBe(16_000_000);
      expect(isInvertibleHomography(scaled)).toBe(true);
      expect(homographyDeterminant(singular)).toBe(0);
      expect(isInvertibleHomography(singular)).toBe(false);
    });

    it.each([1e2, 1e4, 1e6])('stays invertible under a pure translation of %g', (offset) => {
      const translated: Homography = { a: 1, b: 0, c: offset, d: 0, e: 1, f: offset, g: 0, h: 0, i: 1 };
      const inverse = invertHomography(translated);

      expect(homographyDeterminant(translated)).toBe(1);
      expect(isInvertibleHomography(translated)).toBe(true);
      expect(inverse).not.toBeNull();
      expectPointCloseTo(applyHomography(inverse!, { x: 0, y: 0 }), { x: -offset, y: -offset });
    });
  });

  describe('projective taper', () => {
    it('maps the mid source row to 2(1-f)/(2-f) of the layer width, not the linear 1-f/2', () => {
      const size: Size = { width: 100, height: 100 };
      const factor = 0.5;
      const forward = solveHomography(rectCorners(size), getTrapezoidQuad(size, factor * 100))!;

      const left = applyHomography(forward, { x: 0, y: size.height / 2 })!;
      const right = applyHomography(forward, { x: size.width, y: size.height / 2 })!;
      const projectiveWidth = right.x - left.x;
      const linearWidth = size.width * (1 - factor / 2);

      expect(projectiveWidth).toBeCloseTo((size.width * 2 * (1 - factor)) / (2 - factor), 9);
      expect(projectiveWidth).toBeCloseTo(66.666666666, 6);
      expect(linearWidth).toBe(75);
      expect(projectiveWidth).not.toBeCloseTo(linearWidth, 3);
    });

    it('pushes the mid source row down the destination, so a mid-row feature is not mid-height', () => {
      const size: Size = { width: 100, height: 100 };
      const forward = solveHomography(rectCorners(size), getTrapezoidQuad(size, 50))!;

      const mapped = applyHomography(forward, { x: size.width / 2, y: size.height / 2 })!;

      expect(mapped.y).toBeCloseTo(66.666666666, 6);
      expect(mapped.y).not.toBeCloseTo(size.height / 2, 3);
    });

    it('agrees with the linear taper at both edge rows only', () => {
      const size: Size = { width: 100, height: 100 };
      const forward = solveHomography(rectCorners(size), getTrapezoidQuad(size, 50))!;

      expect(applyHomography(forward, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
      expect(applyHomography(forward, { x: 0, y: size.height })).toEqual({ x: 25, y: 100 });
    });
  });

  describe('applyHomography', () => {
    it('returns null where the homogeneous denominator vanishes', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 1, h: 0, i: 0 };

      expect(applyHomography(matrix, { x: 2, y: 3 })).toEqual({ x: 1, y: 1.5 });
      expect(applyHomography(matrix, { x: 0, y: 0 })).toBeNull();
    });

    /**
     * The whole horizon of a perspective warp, which is where a resampler would either fold
     * or blow up: `x + y - 10` is the denominator, so every point on that LINE is singular,
     * not just the one the existing case finds at the origin.
     */
    it('returns null along the entire denominator-zero line, not only at the origin', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 1, h: 1, i: -10 };

      expect(applyHomography(matrix, { x: 5, y: 5 })).toBeNull();
      expect(applyHomography(matrix, { x: 10, y: 0 })).toBeNull();
      expect(applyHomography(matrix, { x: 0, y: 10 })).toBeNull();
      // Just off the line the denominator is -1 and the coordinate FLIPS SIGN, which is
      // exactly what a horizon does: 5 / -1, not 5 / 1.
      expect(applyHomography(matrix, { x: 5, y: 4 })).toEqual({ x: -5, y: -4 });
    });

    /**
     * The RELATIVE epsilon, which is the only thing that makes the previous line a decision
     * rather than an accident.
     *
     * With `g = -1, i = 0` at `x = 1e-13` the denominator is `-1e-13`: non-zero, so a guard
     * written as `denominator === 0` would sail past it and divide, returning a perfectly
     * finite and completely meaningless coordinate. The threshold is
     * `1e-12 * max(1, |x|, |y|) = 1e-12`, and `1e-13` is below it. This is the case that
     * separates the real implementation from a plausible simplification.
     */
    it('refuses a denominator that is small RELATIVE to the coordinate, not only an exact zero', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: -1, h: 0, i: 0 };

      expect(applyHomography(matrix, { x: 1e-13, y: 0 })).toBeNull();
      // An order of magnitude above the threshold the same matrix maps.
      expect(applyHomography(matrix, { x: 1e-11, y: 0 })).not.toBeNull();
    });

    it('returns null for a non-finite mapped coordinate', () => {
      expect(applyHomography(IDENTITY_HOMOGRAPHY, { x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull();
      expect(applyHomography(IDENTITY_HOMOGRAPHY, { x: 0, y: Number.NaN })).toBeNull();
    });
  });

  /**
   * `projectiveRowScale` and `projectiveDenominator` are exported, and the second one takes
   * an override argument, yet nothing in the suite calls either directly — they are only ever
   * reached through `differentiateHomography`, whose identity case has an all-zero projective
   * row and therefore cannot distinguish a correct threshold from a permissive one.
   */
  describe('projectiveRowScale and projectiveDenominator', () => {
    it('is the epsilon scaled by the LARGEST projective-row entry only', () => {
      // The mutant: reusing `homographyMagnitude` here, which also reads a, b, d and e. For
      // this matrix that would be 100e-12 instead of 1e-12, and every point in the resample
      // loop would be rejected.
      expect(projectiveRowScale(IDENTITY_HOMOGRAPHY)).toBe(1e-12);
      expect(projectiveRowScale({ a: 100, b: 100, c: 0, d: 100, e: 100, f: 0, g: 0, h: 0, i: 1 })).toBe(1e-12);
      expect(projectiveRowScale({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 2, h: 0, i: 1 })).toBe(2e-12);
      expect(projectiveRowScale({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0 })).toBe(0);
    });

    it('returns the raw denominator for an affine matrix, which is scale-independent', () => {
      const translated: Homography = { a: 1, b: 0, c: 100, d: 0, e: 1, f: 100, g: 0, h: 0, i: 1 };

      expect(projectiveDenominator(translated, 0, 0)).toBe(1);
      expect(projectiveDenominator(translated, 1e9, -1e9)).toBe(1);
    });

    it('rejects a denominator at the threshold itself, so the comparison is strict', () => {
      // `1 > 1e-12 * 1e12` is false: exactly equal, and the guard is `>`. A `>=` would accept
      // it and the resampler would divide by a denominator it had just declared singular.
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

      expect(projectiveDenominator(matrix, 1e12, 0)).toBeNull();
      expect(projectiveDenominator(matrix, 1e12 - 1, 0)).toBe(1);
    });

    it('scales the threshold by the largest coordinate, so a far point is judged relatively', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 0.5 };

      // Threshold 0.5e-12 * 1e6 = 5e-7 at |x| = 1e6, and 0.5 is far above it.
      expect(projectiveDenominator(matrix, 1e6, 0)).toBe(0.5);
      // Dropping the `max(1, ...)` would shrink the threshold to 1e-12 at |x| = 1e-12.
      expect(projectiveDenominator(matrix, 1e-12, 0)).toBe(0.5);
    });

    it('honours an OVERRIDDEN row scale, the parameter no other caller in the suite passes', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

      // At x = 1e12 the computed threshold rejects; a caller that knows its own sampling is
      // coarser can pass a smaller scale and keep the point.
      expect(projectiveDenominator(matrix, 1e12, 0)).toBeNull();
      expect(projectiveDenominator(matrix, 1e12, 0, 0)).toBe(1);
      // And a caller that wants to be stricter can pass a larger one and lose the point.
      expect(projectiveDenominator(matrix, 1, 0)).toBe(1);
      expect(projectiveDenominator(matrix, 1, 0, 1)).toBeNull();
    });

    it('returns null for a non-finite denominator rather than propagating NaN', () => {
      const matrix: Homography = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, g: Number.NaN, h: 0, i: 1 };

      expect(projectiveDenominator(matrix, 1, 1)).toBeNull();
    });
  });

  describe('differentiateHomography', () => {
    it('matches central finite differences of the mapped point', () => {
      const size: Size = { width: 100, height: 50 };
      const inverse = invertHomography(solveHomography(rectCorners(size), getTrapezoidQuad(size, 50))!)!;
      const point = { x: 37, y: 19 };
      const step = 1e-4;

      const derivatives = differentiateHomography(inverse, point)!;
      const before = applyHomography(inverse, { x: point.x - step, y: point.y })!;
      const after = applyHomography(inverse, { x: point.x + step, y: point.y })!;
      const below = applyHomography(inverse, { x: point.x, y: point.y - step })!;
      const above = applyHomography(inverse, { x: point.x, y: point.y + step })!;

      expect(derivatives.duDx).toBeCloseTo((after.x - before.x) / (2 * step), 4);
      expect(derivatives.duDy).toBeCloseTo((above.x - below.x) / (2 * step), 4);
      expect(derivatives.dvDx).toBeCloseTo((after.y - before.y) / (2 * step), 4);
      expect(derivatives.dvDy).toBeCloseTo((above.y - below.y) / (2 * step), 4);
    });

    it('reports the identity Jacobian and a unit denominator', () => {
      expect(differentiateHomography(IDENTITY_HOMOGRAPHY, { x: 3, y: 4 })).toEqual({
        u: 3,
        v: 4,
        denominator: 1,
        duDx: 1,
        duDy: 0,
        dvDx: 0,
        dvDy: 1,
      });
    });
  });
});
