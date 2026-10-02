import { describe, expect, it } from 'vitest';

import { MAX_AFFINE_COORDINATE, MAX_AFFINE_PIXELS, type AffineTransform } from '../affine-transform.ts';
import { getPresentationFilter, evaluatePresentation, evaluatePresentationForDraw } from '../presentation-evaluator.ts';
import { FilterArgumentUnrenderableError } from '../../util/canvas-filter.ts';

const position = { x: 0, y: 0, width: 9000, height: 9000 };
const documentTarget = { kind: 'document' as const };
const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
const zeroMatrix: AffineTransform = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

const layer = (operations: Parameters<typeof evaluatePresentation>[0]['operations']) => ({
  position,
  sourceSize: { width: position.width, height: position.height },
  operations,
});

describe('evaluatePresentationForDraw bounds contract', () => {
  it('draws a source larger than the affine pixel cap that the validating path refuses', () => {
    const over = position.width * position.height;
    expect(over).toBeGreaterThan(MAX_AFFINE_PIXELS);
    // The cap is the answer for a caller that allocates from the extent, and it is still
    // there: nothing about the draw path may weaken it for them.
    expect(() => evaluatePresentation(layer([{ kind: 'affine-transform', transform: scale }]))).toThrow(
      /raster bounds/
    );
  });

  it('reports the true post-affine extent, not a fabricated one, for an over-cap layer', () => {
    const evaluation = evaluatePresentationForDraw(
      layer([{ kind: 'affine-transform', transform: scale }]),
      documentTarget
    );

    // 2x of a 9000x9000 source: 324 Mpx, four times the cap. The bounds are computed, not
    // copied from the source rectangle, which is what a caller reading them would expect.
    expect(evaluation.localBounds).toEqual({ x: 0, y: 0, width: 18000, height: 18000 });
    expect(evaluation.bounds).toEqual({ x: 0, y: 0, width: 18000, height: 18000 });
    expect(evaluation.localBounds.width * evaluation.localBounds.height).toBeGreaterThan(MAX_AFFINE_PIXELS);
  });

  it('bypasses the coordinate cap the same way it bypasses the area cap', () => {
    const translated: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: MAX_AFFINE_COORDINATE * 2, f: 0 };

    expect(() => evaluatePresentation(layer([{ kind: 'affine-transform', transform: translated }]))).toThrow(
      /coordinate limits/
    );
    expect(
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: translated }]), documentTarget)
        .localBounds.x
    ).toBe(MAX_AFFINE_COORDINATE * 2);
  });

  it('still refuses a degenerate extent on the draw path', () => {
    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: zeroMatrix }]), documentTarget)
    ).toThrow(/degenerate bounds/);
  });

  it('still refuses a non-finite extent on the draw path', () => {
    const nonFinite: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: Number.NaN, f: 0 };

    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: nonFinite }]), documentTarget)
    ).toThrow(/degenerate bounds/);
  });

  it('refuses a bounds draw target, because that caller sizes a surface from the answer', () => {
    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: scale }]), { kind: 'bounds' })
    ).toThrow(/document draw target/);
  });
});

describe('presentation filter arguments', () => {
  it('coerces a JSON-round-tripped number instead of emitting it into the CSS', () => {
    const padded = getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: { radius: '  3  ' } }]);

    expect(padded).toBe('blur(3px)');
  });

  it('refuses a filter argument that will not coerce, naming the tool and the field', () => {
    const refuse = () => getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: { radius: 'wide' } }]);

    expect(refuse).toThrow(FilterArgumentUnrenderableError);
    expect(refuse).toThrow(/non-numeric radius/);
  });

  it('refuses a non-numeric colour adjustment, which would drop the whole filter stack', () => {
    expect(() => getPresentationFilter([{ kind: 'filter', toolName: 'color', args: { sepia: 'warm' } }])).toThrow(
      /non-numeric sepia/
    );
    expect(() => getPresentationFilter([{ kind: 'filter', toolName: 'levels', args: { contrast: 'x' } }])).toThrow(
      /non-numeric contrast/
    );
  });

  it('coerces a boolean adjustment, which used to reach the CSS as `sepia(false%)`', () => {
    // saturation defaults to 0, which is `expAdjustment`'s neutral 1.0 -> 100%.
    expect(getPresentationFilter([{ kind: 'filter', toolName: 'color', args: { sepia: false } }])).toBe(
      'grayscale(0%) sepia(0%) saturate(100%)'
    );
  });
});
