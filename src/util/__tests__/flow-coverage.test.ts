import { describe, expect, it } from 'vitest';

import { advanceFlowCoverage, FLOW_COVERAGE_SCALE } from '../flow-coverage.ts';

const asCoverage = (units: number) => units / FLOW_COVERAGE_SCALE;

describe('advanceFlowCoverage', () => {
  it('builds across dabs but never crosses the stroke opacity ceiling', () => {
    let coverage = 0;

    coverage = advanceFlowCoverage(coverage, 0.2, 0.4);
    expect(asCoverage(coverage)).toBeCloseTo(0.2, 4);

    coverage = advanceFlowCoverage(coverage, 0.2, 0.4);
    expect(asCoverage(coverage)).toBeCloseTo(0.36, 4);

    coverage = advanceFlowCoverage(coverage, 0.2, 0.4);
    expect(coverage).toBe(Math.floor(0.4 * FLOW_COVERAGE_SCALE));

    coverage = advanceFlowCoverage(coverage, 1, 0.4);
    expect(coverage).toBe(Math.floor(0.4 * FLOW_COVERAGE_SCALE));
  });

  it('treats full Flow as one deposit up to Opacity', () => {
    expect(asCoverage(advanceFlowCoverage(0, 1, 0.4))).toBe(0.4);
    expect(advanceFlowCoverage(0, 1, 1)).toBe(FLOW_COVERAGE_SCALE);
  });

  it('does not accumulate outside a stroke-local coverage value', () => {
    const firstStroke = advanceFlowCoverage(0, 0.25, 0.5);
    const nextStroke = advanceFlowCoverage(0, 0.25, 0.5);

    expect(firstStroke).toBe(nextStroke);
    expect(asCoverage(nextStroke)).toBeCloseTo(0.25, 4);
  });

  it('clamps deposits and safely handles non-finite inputs', () => {
    expect(advanceFlowCoverage(0, 4, 0.5)).toBe(Math.floor(0.5 * FLOW_COVERAGE_SCALE));
    expect(advanceFlowCoverage(100, Number.NaN, 1)).toBe(100);
    expect(advanceFlowCoverage(Number.NaN, 0.25, 1)).toBe(Math.round(0.25 * FLOW_COVERAGE_SCALE));
    expect(advanceFlowCoverage(100, 0.25, 0)).toBe(0);
  });
});
