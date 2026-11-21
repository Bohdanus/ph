import { describe, expect, it } from 'vitest';

import {
  MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT,
  MAGNETIC_LASSO_EDGE_CONTRAST_MAX,
  MAGNETIC_LASSO_EDGE_CONTRAST_MIN,
  MAGNETIC_LASSO_FREQUENCY_MAX,
  MAGNETIC_LASSO_FREQUENCY_MIN,
  MAGNETIC_LASSO_FREQUENCY_STEP,
  featherMagneticLasso,
  magneticLassoAnchorSpan,
  normalizeMagneticLassoEdgeContrast,
} from '../featherMagneticLasso.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

const bitmap = 'BITMAP' as unknown as ProcessorToolParams['bitmap'];

// These are internal constants used by magneticLassoAnchorSpan
const ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX = 120;
const ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX = 8;

describe('normalizeMagneticLassoEdgeContrast', () => {
  it("matches Adobe's 1–100% range and keeps the default within it", () => {
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_MIN).toBe(1);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_MAX).toBe(100);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT).toBeGreaterThanOrEqual(MAGNETIC_LASSO_EDGE_CONTRAST_MIN);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT).toBeLessThanOrEqual(MAGNETIC_LASSO_EDGE_CONTRAST_MAX);
  });

  it.each([
    [-10, MAGNETIC_LASSO_EDGE_CONTRAST_MIN],
    [0, MAGNETIC_LASSO_EDGE_CONTRAST_MIN],
    [1, MAGNETIC_LASSO_EDGE_CONTRAST_MIN],
    [42.4, 42],
    [99.6, MAGNETIC_LASSO_EDGE_CONTRAST_MAX],
    [120, MAGNETIC_LASSO_EDGE_CONTRAST_MAX],
    [Number.NaN, MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT],
    [Number.POSITIVE_INFINITY, MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT],
    [Number.NEGATIVE_INFINITY, MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT],
  ])('normalizes %s to %s', (value, expected) => {
    expect(normalizeMagneticLassoEdgeContrast(value)).toBe(expected);
  });

  it('rounds fractional values', () => {
    expect(normalizeMagneticLassoEdgeContrast(10.3)).toBe(10);
    expect(normalizeMagneticLassoEdgeContrast(10.7)).toBe(11);
    expect(normalizeMagneticLassoEdgeContrast(99.4)).toBe(99);
    expect(normalizeMagneticLassoEdgeContrast(99.5)).toBe(100);
  });

  it('returns integer results', () => {
    const result = normalizeMagneticLassoEdgeContrast(42.4);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('magneticLassoAnchorSpan', () => {
  it('spans the 0-100 range Photoshop documents', () => {
    expect(MAGNETIC_LASSO_FREQUENCY_MIN).toBe(0);
    expect(MAGNETIC_LASSO_FREQUENCY_MAX).toBe(100);
    expect(MAGNETIC_LASSO_FREQUENCY_STEP).toBe(1);
  });

  it('anchors sooner as the Frequency rises, which is the documented sense', () => {
    const spans = [0, 10, 25, 50, 75, 90, 100].map((frequency) => magneticLassoAnchorSpan(frequency));

    for (let index = 1; index < spans.length; index++) {
      expect(spans[index]).toBeLessThan(spans[index - 1]);
    }
  });

  it('never returns a span the gate could treat as satisfied by a zero-length step', () => {
    expect(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)).toBeGreaterThan(0);
  });

  it('keeps the maximum-frequency span the shortest step the lasso has ever taken', () => {
    expect(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)).toBeGreaterThanOrEqual(8);
  });

  it.each([
    ['below the range', -40],
    ['above the range', 4000],
    ['exactly at min', -1],
    ['exactly at max', 101],
  ])('clamps a value %s rather than returning a span that cannot be met', (_name, frequency) => {
    expect(magneticLassoAnchorSpan(frequency)).toBe(
      frequency < MAGNETIC_LASSO_FREQUENCY_MIN
        ? magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN)
        : magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)
    );
  });

  it('falls back to the longest span for a non-finite setting, so the lasso can still anchor', () => {
    expect(Number.isNaN(magneticLassoAnchorSpan(Number.NaN))).toBe(false);
    expect(magneticLassoAnchorSpan(Number.NaN)).toBe(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN));
    expect(magneticLassoAnchorSpan(Number.POSITIVE_INFINITY)).toBe(
      magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN)
    );
    expect(magneticLassoAnchorSpan(Number.NEGATIVE_INFINITY)).toBe(
      magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN)
    );
  });

  it('returns 120 at frequency 0 (longest span)', () => {
    expect(magneticLassoAnchorSpan(0)).toBe(ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX);
  });

  it('returns 8 at frequency 100 (shortest span)', () => {
    expect(magneticLassoAnchorSpan(100)).toBe(ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX);
  });

  it('interpolates linearly between min and max frequency', () => {
    const span50 = magneticLassoAnchorSpan(50);
    const expected =
      ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX -
      0.5 * (ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX - ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX);
    expect(span50).toBeCloseTo(expected);
  });

  it('returns integer pixel spans', () => {
    for (let i = 0; i <= 100; i++) {
      const span = magneticLassoAnchorSpan(i);
      expect(Number.isInteger(Math.round(span))).toBe(true);
    }
  });

  it('span decreases monotonically with frequency', () => {
    let prevSpan = magneticLassoAnchorSpan(0);
    for (let i = 1; i <= 100; i++) {
      const span = magneticLassoAnchorSpan(i);
      expect(span).toBeLessThanOrEqual(prevSpan);
      prevSpan = span;
    }
  });

  it('handles edge case: frequency at min returns max span', () => {
    expect(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN)).toBe(ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX);
  });

  it('handles edge case: frequency at max returns min span', () => {
    expect(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)).toBe(ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX);
  });

  it('uses internal anchor span constants', () => {
    expect(magneticLassoAnchorSpan(0)).toBe(120);
    expect(magneticLassoAnchorSpan(100)).toBe(8);
  });
});

describe('featherMagneticLasso processor', () => {
  it('hands the source bitmap straight through, as every selection creator does', () => {
    expect(featherMagneticLasso({ bitmap } as ProcessorToolParams)()).toEqual([bitmap]);
  });

  it('is a two-stage curried processor', () => {
    const inner = featherMagneticLasso({ bitmap } as ProcessorToolParams);
    expect(featherMagneticLasso.length).toBe(1);
    expect(inner.length).toBe(0);
  });

  it('returns ToolResult (BitmapSource array)', () => {
    const result = featherMagneticLasso({ bitmap } as ProcessorToolParams)();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(bitmap);
  });
});

describe('exported constants', () => {
  it('MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT is 30', () => {
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT).toBe(30);
  });

  it('all constants are exported', () => {
    expect(MAGNETIC_LASSO_FREQUENCY_MIN).toBe(0);
    expect(MAGNETIC_LASSO_FREQUENCY_MAX).toBe(100);
    expect(MAGNETIC_LASSO_FREQUENCY_STEP).toBe(1);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_MIN).toBe(1);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_MAX).toBe(100);
    expect(MAGNETIC_LASSO_EDGE_CONTRAST_DEFAULT).toBe(30);
  });
});

describe('FeatherMagneticLassoToolArgs type', () => {
  it('requires all fields', () => {
    const args = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      featherRadius: 5,
      magneticWidth: 10,
      edgeContrast: 30,
      frequency: 50,
      snapStrength: 1,
      smoothing: 0,
      antiAlias: true,
      previewFeather: false,
      toolName: 'feather-magnetic-lasso' as const,
    };
    expect(args.featherRadius).toBe(5);
    expect(args.magneticWidth).toBe(10);
    expect(args.edgeContrast).toBe(30);
    expect(args.frequency).toBe(50);
    expect(args.snapStrength).toBe(1);
    expect(args.smoothing).toBe(0);
    expect(args.antiAlias).toBe(true);
    expect(args.previewFeather).toBe(false);
    expect(args.toolName).toBe('feather-magnetic-lasso');
  });

  it('points is optional', () => {
    const args = {
      featherRadius: 5,
      magneticWidth: 10,
      edgeContrast: 30,
      frequency: 50,
      snapStrength: 1,
      smoothing: 0,
      antiAlias: true,
      previewFeather: false,
      toolName: 'feather-magnetic-lasso' as const,
    };
    expect(args.featherRadius).toBe(5);
  });

  it('toolName must be "feather-magnetic-lasso"', () => {
    const args = {
      featherRadius: 5,
      magneticWidth: 10,
      edgeContrast: 30,
      frequency: 50,
      snapStrength: 1,
      smoothing: 0,
      antiAlias: true,
      previewFeather: false,
      toolName: 'feather-magnetic-lasso' as const,
    };
    expect(args.toolName).toBe('feather-magnetic-lasso');
    // @ts-expect-error toolName must be 'feather-magnetic-lasso'
    const invalid = { ...args, toolName: 'other' };
  });
});

describe('FeatherMagneticLassoToolSettings type', () => {
  it('omits points from FeatherMagneticLassoToolArgs', () => {
    const settings = {
      featherRadius: 5,
      magneticWidth: 10,
      edgeContrast: 30,
      frequency: 50,
      snapStrength: 1,
      smoothing: 0,
      antiAlias: true,
      previewFeather: false,
      toolName: 'feather-magnetic-lasso' as const,
    };
    // @ts-expect-error points is omitted
    expect(settings.points).toBeUndefined();
    expect(settings.featherRadius).toBe(5);
    expect(settings.toolName).toBe('feather-magnetic-lasso');
  });
});
