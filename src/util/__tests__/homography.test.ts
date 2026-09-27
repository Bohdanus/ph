import { describe, expect, it } from 'vitest';

import { getTrapezoidQuad } from '../../tools/transform.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  IDENTITY_HOMOGRAPHY,
  applyHomography,
  differentiateHomography,
  homographyDeterminant,
  invertHomography,
  isInvertibleHomography,
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

    it('returns null for a non-finite mapped coordinate', () => {
      expect(applyHomography(IDENTITY_HOMOGRAPHY, { x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull();
      expect(applyHomography(IDENTITY_HOMOGRAPHY, { x: 0, y: Number.NaN })).toBeNull();
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
