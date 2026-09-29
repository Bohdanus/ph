import { describe, expect, it } from 'vitest';
import {
  MAGNETIC_LASSO_FREQUENCY_MAX,
  MAGNETIC_LASSO_FREQUENCY_MIN,
  featherMagneticLasso,
  magneticLassoAnchorSpan,
} from '../featherMagneticLasso.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

const bitmap = 'BITMAP' as unknown as ProcessorToolParams['bitmap'];

/**
 * Photoshop's Frequency is a RATE, not a distance: "A higher value anchors the selection
 * border in place more quickly."
 *
 * The number the tool area gates an automatic fastening point on is a path LENGTH in pixels,
 * so the two run in opposite directions and the conversion has to invert the control. This
 * file pins that inversion, because the slider, the readout and the gate are three separate
 * places and only the middle one is the user's to see.
 */
describe('magneticLassoAnchorSpan', () => {
  it('spans the 0-100 range Photoshop documents', () => {
    expect(MAGNETIC_LASSO_FREQUENCY_MIN).toBe(0);
    expect(MAGNETIC_LASSO_FREQUENCY_MAX).toBe(100);
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
    // The old control's own floor was 8px, and a span below it would anchor on every
    // sub-pixel jitter, which is the "too many anchors" failure Frequency exists to prevent.
    expect(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)).toBeGreaterThanOrEqual(8);
  });

  it.each([
    ['below the range', -40],
    ['above the range', 4000],
  ])('clamps a value %s rather than returning a span that cannot be met', (_name, frequency) => {
    expect(magneticLassoAnchorSpan(frequency)).toBe(
      frequency < MAGNETIC_LASSO_FREQUENCY_MIN
        ? magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN)
        : magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MAX)
    );
  });

  it('falls back to the longest span for a non-finite setting, so the lasso can still anchor', () => {
    // `NaN` in a comparison is always false, so a NaN span would silently disable
    // automatic fastening for the whole gesture.
    expect(Number.isNaN(magneticLassoAnchorSpan(Number.NaN))).toBe(false);
    expect(magneticLassoAnchorSpan(Number.NaN)).toBe(magneticLassoAnchorSpan(MAGNETIC_LASSO_FREQUENCY_MIN));
  });
});

describe('featherMagneticLasso processor', () => {
  it('hands the source bitmap straight through, as every selection creator does', () => {
    expect(featherMagneticLasso({ bitmap } as ProcessorToolParams)()).toEqual([bitmap]);
  });
});
