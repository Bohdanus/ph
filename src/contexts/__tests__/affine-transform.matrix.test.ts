/**
 * Matrix-level coverage for `src/contexts/affine-transform.ts`.
 *
 * The sibling `affine-transform.test.ts` is Solid (it pins the two presentation/history
 * fallbacks), so the raw matrix algebra lives here instead: composition order, the inverse
 * and its round-trip, the degenerate/limit guards, and the translation of the UI's normalized
 * tool values into one matrix. Every value is exact or a documented `toBeCloseTo` on
 * trigonometry - nothing here asserts truthiness.
 */
import { describe, expect, it } from 'vitest';

import {
  AFFINE_DETERMINANT_EPSILON,
  IDENTITY_AFFINE_TRANSFORM,
  MAX_AFFINE_COORDINATE,
  MAX_AFFINE_PIXELS,
  applyAffineTransform,
  getAffineBounds,
  getLayerAffineTransform,
  invertAffineTransform,
  isIdentityAffineTransform,
  isPointInLayer,
  isTrapezoidOnlyTransform,
  multiplyAffineTransforms,
  normalizeTransformHistoryArgs,
  rotationAffineAroundPoint,
  transformCorners,
  transformToolArgsToAffine,
  validateAffineTransform,
  worldPointToLayerLocal,
  type AffineTransform,
} from '../affine-transform.ts';
import type { Layer } from '../layer-types.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const transform = (a: number, b: number, c: number, d: number, e = 0, f = 0): AffineTransform => ({ a, b, c, d, e, f });

const translate = (tx: number, ty: number): AffineTransform => transform(1, 0, 0, 1, tx, ty);
const scale = (sx: number, sy: number): AffineTransform => transform(sx, 0, 0, sy);

function makeLayer(operations: Layer['operations'] = [], pos = { x: 100, y: 50, width: 200, height: 100 }): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    presentationBounds: null,
    bitmap: null,
    tmpCanvas: null,
    operations,
  };
}

function toolArgs(patch: Partial<TransformToolArgs> = {}): TransformToolArgs {
  return {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...patch,
  };
}

// `Object.is` distinguishes -0 from 0, and an inverse matrix legitimately produces -0 entries.
const unnegated = (matrix: AffineTransform) =>
  Object.fromEntries(
    Object.entries(matrix).map(([key, value]) => [key, Object.is(value, -0) ? 0 : value])
  ) as unknown as AffineTransform;

const closeToMatrix = (actual: AffineTransform, expected: AffineTransform, digits = 10) => {
  const mismatches = (['a', 'b', 'c', 'd', 'e', 'f'] as const)
    .filter((key) => Math.abs(actual[key] - expected[key]) > 0.5 * 10 ** -digits)
    .map((key) => `${key}: ${actual[key]} instead of ${expected[key]}`);
  expect(mismatches).toEqual([]);
};

describe('affine constants', () => {
  it('pins the identity matrix and the guard limits', () => {
    expect(IDENTITY_AFFINE_TRANSFORM).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(Object.isFrozen(IDENTITY_AFFINE_TRANSFORM)).toBe(true);
    expect(AFFINE_DETERMINANT_EPSILON).toBe(1e-8);
    expect(MAX_AFFINE_COORDINATE).toBe(1_000_000);
    expect(MAX_AFFINE_PIXELS).toBe(64 * 1024 * 1024);
  });
});

describe('rotationAffineAroundPoint', () => {
  it.each([
    ['zero turn', 0, { x: 32, y: 32 }, transform(1, 0, 0, 1, 0, 0)],
    ['clockwise quarter turn', Math.PI / 2, { x: 32, y: 32 }, transform(0, 1, -1, 0, 64, 0)],
    ['half turn', Math.PI, { x: 32, y: 32 }, transform(-1, 0, 0, -1, 64, 64)],
    ['counter-clockwise quarter turn', -Math.PI / 2, { x: 32, y: 32 }, transform(0, -1, 1, 0, 0, 64)],
    ['quarter turn around a negative center', -Math.PI / 2, { x: -32, y: -32 }, transform(0, -1, 1, 0, 0, -64)],
  ])('returns exact matrix values for an exact %s', (_label, angle, center, expected) => {
    expect(rotationAffineAroundPoint(angle, center)).toEqual(expected);
  });

  it('preserves real subpixel rotation around a quarter turn', () => {
    const angle = Math.PI / 2 + 1e-8;

    expect(rotationAffineAroundPoint(angle, { x: 32, y: 32 }).a).toBe(Math.cos(angle));
  });
});

describe('isIdentityAffineTransform', () => {
  it.each([
    ['the exact identity', IDENTITY_AFFINE_TRANSFORM, true],
    ['a scale of one with a translation', transform(1, 0, 0, 1, 12, -4), false],
    ['a uniform double scale', transform(2, 0, 0, 2), false],
    ['a 90 degree rotation', transform(0, 1, -1, 0), false],
  ])('reports %s', (_label, candidate, expected) => {
    expect(isIdentityAffineTransform(candidate)).toBe(expected);
  });

  it('uses the epsilon for values that are close to the identity', () => {
    expect(isIdentityAffineTransform(transform(1 + 1e-12, 1e-12, -1e-12, 1 - 1e-12, 1e-12, -1e-12))).toBe(true);
    expect(isIdentityAffineTransform(transform(1 + 1e-6, 0, 0, 1, 0, 0))).toBe(false);
    expect(isIdentityAffineTransform(transform(1 + 1e-6, 0, 0, 1, 0, 0), 1e-3)).toBe(true);
  });
});

describe('multiplyAffineTransforms', () => {
  it('is the identity on either side of the identity', () => {
    const candidate = transform(2, 3, 4, 5, 6, 7);

    expect(multiplyAffineTransforms(IDENTITY_AFFINE_TRANSFORM, candidate)).toEqual(candidate);
    expect(multiplyAffineTransforms(candidate, IDENTITY_AFFINE_TRANSFORM)).toEqual(candidate);
  });

  it('applies the right matrix first, matching the canvas convention', () => {
    // translate(10, 0) * scale(2, 2): the point is scaled, then translated.
    const composed = multiplyAffineTransforms(translate(10, 0), scale(2, 2));

    expect(composed).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 });
    expect(applyAffineTransform(composed, { x: 3, y: 4 })).toEqual({ x: 16, y: 8 });
  });

  it('does not commute: reversing the operands changes the result', () => {
    const forward = multiplyAffineTransforms(translate(10, 0), scale(2, 2));
    const backward = multiplyAffineTransforms(scale(2, 2), translate(10, 0));

    expect(forward).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 0 });
    expect(backward).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 0 });
    expect(applyAffineTransform(forward, { x: 1, y: 1 })).not.toEqual(applyAffineTransform(backward, { x: 1, y: 1 }));
  });

  it('composes a rotation with a translation about the translated origin', () => {
    const rotation = transform(0, 1, -1, 0);
    const composed = multiplyAffineTransforms(rotation, translate(5, 0));

    expect(composed).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 5 });
    expect(applyAffineTransform(composed, { x: 0, y: 0 })).toEqual({ x: 0, y: 5 });
  });

  it('returns a frozen matrix rather than an alias', () => {
    const composed = multiplyAffineTransforms(IDENTITY_AFFINE_TRANSFORM, IDENTITY_AFFINE_TRANSFORM);

    expect(Object.isFrozen(composed)).toBe(true);
    expect(composed).not.toBe(IDENTITY_AFFINE_TRANSFORM);
  });
});

describe('applyAffineTransform', () => {
  it.each([
    ['the identity', IDENTITY_AFFINE_TRANSFORM, { x: 7, y: -3 }, { x: 7, y: -3 }],
    ['a pure translation', translate(4, -2), { x: 7, y: -3 }, { x: 11, y: -5 }],
    ['a scale', scale(2, 3), { x: 7, y: -3 }, { x: 14, y: -9 }],
    ['a 90 degree rotation', transform(0, 1, -1, 0), { x: 7, y: -3 }, { x: 3, y: 7 }],
    ['a shear on x', transform(1, 0, 1, 1), { x: 0, y: 5 }, { x: 5, y: 5 }],
    ['a shear on y', transform(1, 1, 0, 1), { x: 5, y: 0 }, { x: 5, y: 5 }],
  ])('maps a point through %s', (_label, matrix, point, expected) => {
    expect(applyAffineTransform(matrix, point)).toEqual(expected);
  });
});

describe('invertAffineTransform', () => {
  it('round-trips a point through a general matrix and its inverse', () => {
    const matrix = transform(2, 0.5, -0.25, 3, 17, -9);
    const inverse = invertAffineTransform(matrix);

    expect(inverse).not.toBeNull();
    const point = { x: 13, y: -4 };
    const roundTripped = applyAffineTransform(inverse!, applyAffineTransform(matrix, point));

    expect(roundTripped.x).toBeCloseTo(point.x, 10);
    expect(roundTripped.y).toBeCloseTo(point.y, 10);
  });

  it('produces the identity for the identity matrix', () => {
    expect(unnegated(invertAffineTransform(IDENTITY_AFFINE_TRANSFORM)!)).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    });
  });

  it('undoes a translation exactly', () => {
    const inverse = invertAffineTransform(translate(30, -12));

    expect(unnegated(inverse!)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: -30, f: 12 });
  });

  it('undoes a rotation about an arbitrary pivot', () => {
    const rotated = transform(0, 1, -1, 0, 40, -25);
    const inverse = invertAffineTransform(rotated);

    expect(unnegated(inverse!)).toEqual({ a: 0, b: -1, c: 1, d: 0, e: 25, f: 40 });
  });

  it.each([
    ['a zero determinant', transform(1, 1, 1, 1)],
    ['a fully collapsed matrix', transform(0, 0, 0, 0)],
    ['a determinant below the epsilon', transform(1e-9, 0, 0, 1)],
    ['a determinant exactly at the epsilon', transform(AFFINE_DETERMINANT_EPSILON, 0, 0, 1)],
    ['a non-finite determinant', transform(Number.POSITIVE_INFINITY, 0, 0, 1)],
    ['a non-finite product', transform(Number.POSITIVE_INFINITY, 0, 0, Number.POSITIVE_INFINITY)],
  ])('returns null for %s', (_label, matrix) => {
    expect(invertAffineTransform(matrix)).toBeNull();
  });

  it('inverts a matrix just above the determinant epsilon', () => {
    const inverse = invertAffineTransform(transform(2 * AFFINE_DETERMINANT_EPSILON, 0, 0, 1));

    expect(inverse).not.toBeNull();
    expect(inverse!.a).toBeCloseTo(1 / (2 * AFFINE_DETERMINANT_EPSILON), 0);
  });
});

describe('transformCorners and getAffineBounds', () => {
  it('returns the four corners clockwise from the top-left', () => {
    expect(transformCorners(translate(10, 20), { width: 30, height: 40 })).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
  });

  it('keeps the bounds consistent with the corners for a 90 degree rotation', () => {
    const matrix = transform(0, 1, -1, 0);
    const size = { width: 40, height: 20 };
    const corners = transformCorners(matrix, size);
    const bounds = getAffineBounds(matrix, size);

    expect(corners).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: -20, y: 40 },
      { x: -20, y: 0 },
    ]);
    expect(bounds).toEqual({ x: -20, y: 0, width: 20, height: 40 });
  });

  it('returns the untransformed rectangle for the identity', () => {
    expect(getAffineBounds(IDENTITY_AFFINE_TRANSFORM, { width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it.each([
    ['a matrix that collapses the layer to a point', transform(0, 0, 0, 0), { width: 4, height: 4 }, 'degenerate'],
    ['a zero-extent layer', IDENTITY_AFFINE_TRANSFORM, { width: 4, height: 0 }, 'degenerate'],
    [
      'a matrix whose products overflow to a non-finite bound',
      transform(1e308, 1e308, 0, 1e308),
      { width: 1, height: 1 },
      'degenerate',
    ],
    [
      'a translation beyond the coordinate limit',
      translate(MAX_AFFINE_COORDINATE + 1, 0),
      { width: 4, height: 4 },
      'coordinate limits',
    ],
    [
      'a y translation beyond the coordinate limit',
      translate(0, -(MAX_AFFINE_COORDINATE + 1)),
      { width: 4, height: 4 },
      'coordinate limits',
    ],
    ['a raster that exceeds the pixel budget', scale(1000, 1000), { width: 1000, height: 1000 }, 'raster bounds'],
  ])('rejects %s', (_label, matrix, size, message) => {
    expect(() => getAffineBounds(matrix, size)).toThrow(message);
  });

  it('accepts a raster exactly on the pixel budget', () => {
    // 8192 x 8192 is exactly MAX_AFFINE_PIXELS, so only the strict `>` guards keep it legal.
    expect(getAffineBounds(IDENTITY_AFFINE_TRANSFORM, { width: 8192, height: 8192 })).toEqual({
      x: 0,
      y: 0,
      width: 8192,
      height: 8192,
    });
  });
});

describe('validateAffineTransform', () => {
  it('returns a frozen copy of a valid matrix', () => {
    const candidate = transform(2, 0, 0, 3, 4, 5);
    const validated = validateAffineTransform(candidate);

    expect(validated).toEqual(candidate);
    expect(validated).not.toBe(candidate);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it.each([
    ['a non-finite entry', transform(1, 0, 0, 1, Number.NaN, 0), 'invalid or extreme values'],
    [
      'an entry beyond the coordinate limit',
      transform(MAX_AFFINE_COORDINATE + 1, 0, 0, 1, 0, 0),
      'invalid or extreme values',
    ],
    ['a singular matrix', transform(2, 4, 1, 2), 'is singular'],
  ])('rejects %s', (_label, matrix, message) => {
    expect(() => validateAffineTransform(matrix)).toThrow(message);
  });

  it('rejects a matrix that is legal in isolation but degenerate for the given size', () => {
    expect(() => validateAffineTransform(IDENTITY_AFFINE_TRANSFORM, { width: 0, height: 10 })).toThrow('degenerate');
  });

  it('accepts a matrix that is legal for the given size', () => {
    expect(validateAffineTransform(IDENTITY_AFFINE_TRANSFORM, { width: 10, height: 10 })).toEqual(
      IDENTITY_AFFINE_TRANSFORM
    );
  });
});

describe('transformToolArgsToAffine', () => {
  const size = { width: 200, height: 100 };

  it('returns the identity for default tool values', () => {
    expect(transformToolArgsToAffine(toolArgs(), size)).toEqual(IDENTITY_AFFINE_TRANSFORM);
  });

  it('treats every omitted tool value as the neutral default', () => {
    // `TransformToolArgs` declares all six values as required, but history entries and partial
    // UI state can omit them; each `??` fallback is a documented neutral value.
    const sparse = { toolName: 'transform' } as unknown as TransformToolArgs;

    expect(transformToolArgsToAffine(sparse, size)).toEqual(IDENTITY_AFFINE_TRANSFORM);
  });

  it('scales about the layer centre, leaving the centre fixed', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ resizeX: 50, resizeY: 200 }), size);

    expect(matrix).not.toBeNull();
    closeToMatrix(matrix!, transform(0.5, 0, 0, 2, 50, -50));
    const center = applyAffineTransform(matrix!, { x: 100, y: 50 });
    expect(center.x).toBeCloseTo(100, 10);
    expect(center.y).toBeCloseTo(50, 10);
    expect(getAffineBounds(matrix!, size)).toEqual({ x: 50, y: -50, width: 100, height: 200 });
  });

  it.each([
    ['mirrorH', { mirrorH: true }, transform(-1, 0, 0, 1, 200, 0)],
    ['mirrorV', { mirrorV: true }, transform(1, 0, 0, -1, 0, 100)],
    ['mirrorH and mirrorV', { mirrorH: true, mirrorV: true }, transform(-1, 0, 0, -1, 200, 100)],
  ])('applies %s about the centre', (_label, patch, expected) => {
    const matrix = transformToolArgsToAffine(toolArgs(patch), size);

    expect(matrix).not.toBeNull();
    closeToMatrix(matrix!, expected);
  });

  it('rotates clockwise in the editor coordinate system, about the layer centre', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ rotate: 90 }), size);

    expect(matrix).not.toBeNull();
    // 200x100 rotated a quarter turn becomes a 100x200 box centred on the same point.
    const bounds = getAffineBounds(matrix!, size);
    expect(bounds.x).toBeCloseTo(50, 10);
    expect(bounds.y).toBeCloseTo(-50, 10);
    expect(bounds.width).toBeCloseTo(100, 10);
    expect(bounds.height).toBeCloseTo(200, 10);
    const center = applyAffineTransform(matrix!, { x: 100, y: 50 });
    expect(center.x).toBeCloseTo(100, 10);
    expect(center.y).toBeCloseTo(50, 10);
  });

  it('leaves the layer unrotated after a full turn', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ rotate: 360 }), size);

    expect(matrix).not.toBeNull();
    closeToMatrix(matrix!, IDENTITY_AFFINE_TRANSFORM, 6);
  });

  it('applies skewX as x += tan(skewX) * y', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ skewX: 45 }), size);

    expect(matrix).not.toBeNull();
    // tan(45) == 1, so every row shifts by its own y: the top edge (y = 0) stays put while the
    // bottom edge (y = 100) slides 100px to the right, widening the box from 200 to 300.
    closeToMatrix(matrix!, transform(1, 0, 1, 1, -50, 0));
    const bounds = getAffineBounds(matrix!, size);
    expect(bounds.x).toBeCloseTo(-50, 10);
    expect(bounds.width).toBeCloseTo(300, 10);
    expect(bounds.height).toBeCloseTo(100, 10);
  });

  it('applies skewY as y += tan(skewY) * x', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ skewY: 45 }), size);

    expect(matrix).not.toBeNull();
    // tan(45) == 1, so every column shifts down by its own x, adding 200px of height.
    closeToMatrix(matrix!, transform(1, 1, 0, 1, 0, -100));
    const bounds = getAffineBounds(matrix!, size);
    expect(bounds.x).toBeCloseTo(0, 10);
    expect(bounds.y).toBeCloseTo(-100, 10);
    expect(bounds.width).toBeCloseTo(200, 10);
    expect(bounds.height).toBeCloseTo(300, 10);
  });

  it('composes scale, then rotation, then skew in that order', () => {
    const matrix = transformToolArgsToAffine(toolArgs({ resizeX: 200, rotate: 90, skewX: 45 }), size);

    expect(matrix).not.toBeNull();
    const expected = multiplyAffineTransforms(
      transform(1, 0, 1, 1),
      multiplyAffineTransforms(transform(0, 1, -1, 0), transform(2, 0, 0, 1))
    );
    // `aroundCenter` is a pivot shift, not a matrix product, so the expected translation is
    // recomputed from the linear part rather than copied from the implementation.
    closeToMatrix(matrix!, {
      ...expected,
      e: 100 - expected.a * 100 - expected.c * 50,
      f: 50 - expected.b * 100 - expected.d * 50,
    });
  });

  it('returns null for a trapezoid-only transform, which has no affine form', () => {
    expect(transformToolArgsToAffine(toolArgs({ trapezoid: 0.25 }), size)).toBeNull();
  });

  it.each([
    ['a rotation', { rotate: 10 }],
    ['a mirror', { mirrorH: true }],
    ['a vertical mirror', { mirrorV: true }],
    ['skewX', { skewX: 10 }],
    ['skewY', { skewY: 10 }],
    ['a horizontal scale', { resizeX: 50 }],
    ['a vertical scale', { resizeY: 50 }],
  ])('rejects a trapezoid combined with %s', (_label, patch) => {
    expect(() => transformToolArgsToAffine(toolArgs({ trapezoid: 0.25, ...patch }), size)).toThrow(
      'Trapezoid cannot be combined'
    );
  });

  it.each([
    ['a zero x scale', { resizeX: 0 }],
    ['a zero y scale', { resizeY: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(() => transformToolArgsToAffine(toolArgs(patch), size)).toThrow('Transform scale cannot be zero');
  });

  it.each([
    ['a non-finite rotation', { rotate: Number.NaN }],
    ['a non-finite scale', { resizeY: Number.POSITIVE_INFINITY }],
    ['a non-finite skew', { skewX: Number.NEGATIVE_INFINITY }],
  ])('rejects %s before any trigonometry', (_label, patch) => {
    expect(() => transformToolArgsToAffine(toolArgs(patch), size)).toThrow('Transform values must be finite');
  });

  it('rejects an angle that overflows to a non-finite radian value', () => {
    // Number.MAX_VALUE is finite, but `rotate * Math.PI` is not, so the overflow can only be
    // caught after the finiteness sweep on the tool values.
    expect(() => transformToolArgsToAffine(toolArgs({ rotate: Number.MAX_VALUE }), size)).toThrow(
      'Transform angles are too extreme'
    );
  });

  it('rejects a scale so small that the resulting matrix is singular', () => {
    expect(() => transformToolArgsToAffine(toolArgs({ resizeX: 0.0000001, resizeY: 0.0000001 }), size)).toThrow(
      'Affine transform is singular'
    );
  });
});

describe('isTrapezoidOnlyTransform', () => {
  it.each([
    ['a pure trapezoid', { trapezoid: 0.5 }, true],
    ['a negative trapezoid', { trapezoid: -0.5 }, true],
    ['a zero trapezoid', { trapezoid: 0 }, false],
    ['a non-finite trapezoid', { trapezoid: Number.NaN }, false],
    ['an infinite trapezoid', { trapezoid: Number.POSITIVE_INFINITY }, false],
  ])('reports %s as %s', (_label, patch, expected) => {
    expect(isTrapezoidOnlyTransform(toolArgs(patch))).toBe(expected);
  });

  it.each([
    ['a rotation', { trapezoid: 0.5, rotate: 1 }],
    ['a horizontal mirror', { trapezoid: 0.5, mirrorH: true }],
    ['a vertical mirror', { trapezoid: 0.5, mirrorV: true }],
    ['skewX', { trapezoid: 0.5, skewX: 1 }],
    ['skewY', { trapezoid: 0.5, skewY: 1 }],
    ['a custom x scale', { trapezoid: 0.5, resizeX: 101 }],
    ['a custom y scale', { trapezoid: 0.5, resizeY: 99 }],
  ])('rejects a trapezoid that also carries %s', (_label, patch) => {
    expect(isTrapezoidOnlyTransform(toolArgs(patch))).toBe(false);
  });
});

describe('getLayerAffineTransform', () => {
  it('returns the identity for a layer with no operations field at all', () => {
    const { operations: _operations, ...withoutOperations } = makeLayer();
    void _operations;

    expect(getLayerAffineTransform(withoutOperations as Layer)).toEqual(IDENTITY_AFFINE_TRANSFORM);
  });

  it('returns the identity for an empty operation list', () => {
    expect(getLayerAffineTransform(makeLayer([]))).toEqual(IDENTITY_AFFINE_TRANSFORM);
  });

  it('composes affine operations in order, ignoring filters and disabled entries', () => {
    const layer = makeLayer([
      { id: 'first', kind: 'affine-transform', transform: translate(10, 0), enabled: true },
      { id: 'filter', kind: 'filter', args: { toolName: 'blur', radius: 4 }, enabled: true },
      { id: 'second', kind: 'affine-transform', transform: scale(2, 2), enabled: true },
      { id: 'off', kind: 'affine-transform', transform: scale(10, 10), enabled: false },
    ]);

    // Later operations are left-multiplied: scale(2, 2) * translate(10, 0) puts the translation
    // in the *scaled* space, so the effective offset is 20 rather than 10.
    expect(getLayerAffineTransform(layer)).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 0 });
  });
});

describe('worldPointToLayerLocal and isPointInLayer', () => {
  it('maps a world point into the untransformed layer space', () => {
    const layer = makeLayer();

    expect(worldPointToLayerLocal(layer, { x: 150, y: 100 })).toEqual({ x: 50, y: 50 });
  });

  it('round-trips a world point through the presentation corners', () => {
    const layer = makeLayer([
      { id: 'rotate', kind: 'affine-transform', transform: transform(0, 1, -1, 0, 50, 0), enabled: true },
    ]);
    const world = { x: 137, y: 61 };
    const local = worldPointToLayerLocal(layer, world);

    expect(local).not.toBeNull();
    const back = applyAffineTransform(getLayerAffineTransform(layer), local!);
    expect(back.x + layer.pos.x).toBeCloseTo(world.x, 10);
    expect(back.y + layer.pos.y).toBeCloseTo(world.y, 10);
  });

  it('returns null for a non-invertible layer transform', () => {
    const layer = makeLayer([
      { id: 'flat', kind: 'affine-transform', transform: transform(0, 0, 0, 0), enabled: true },
    ]);

    expect(worldPointToLayerLocal(layer, { x: 0, y: 0 })).toBeNull();
    expect(isPointInLayer(layer, { x: 150, y: 100 })).toBe(false);
  });

  it.each([
    ['the top-left corner', { x: 100, y: 50 }, true],
    ['the bottom-right corner', { x: 300, y: 150 }, true],
    ['the centre', { x: 200, y: 100 }, true],
    ['one pixel left of the layer', { x: 99, y: 100 }, false],
    ['one pixel right of the layer', { x: 301, y: 100 }, false],
    ['one pixel above the layer', { x: 200, y: 49 }, false],
    ['one pixel below the layer', { x: 200, y: 151 }, false],
  ])('reports %s as %s', (_label, point, expected) => {
    expect(isPointInLayer(makeLayer(), point)).toBe(expected);
  });
});

describe('normalizeTransformHistoryArgs', () => {
  const size = { width: 200, height: 100 };

  it('freezes a normalized history entry for a retained transform', () => {
    const entry = normalizeTransformHistoryArgs(toolArgs({ rotate: 90 }), size);

    expect(entry).not.toBeNull();
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry!.transform)).toBe(true);
    expect(entry!.toolName).toBe('transform');
    expect(getAffineBounds(entry!.transform, size).width).toBeCloseTo(100, 10);
  });

  it('returns null for a trapezoid-only transform so the caller keeps the raster path', () => {
    expect(normalizeTransformHistoryArgs(toolArgs({ trapezoid: 0.4 }), size)).toBeNull();
  });

  it('propagates validation failures instead of storing a broken matrix', () => {
    expect(() => normalizeTransformHistoryArgs(toolArgs({ resizeX: 0 }), size)).toThrow(
      'Transform scale cannot be zero'
    );
  });
});
