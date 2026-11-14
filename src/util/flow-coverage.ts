/** Fixed-point scale shared by Flow-aware raster tools for per-pixel stroke coverage. */
export const FLOW_COVERAGE_SCALE = 0xffff;

/**
 * Deposits one dab into the current stroke's coverage for a pixel, returning fixed-point units.
 * The deposited amount builds toward the remaining unpainted coverage and never exceeds the
 * stroke's Opacity ceiling. Callers keep the returned value in stroke-local state; starting a
 * new stroke starts from zero.
 */
export const advanceFlowCoverage = (previousUnits: number, depositedCoverage: number, opacity: number): number => {
  const ceiling = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const ceilingUnits = Math.floor(ceiling * FLOW_COVERAGE_SCALE);
  if (ceilingUnits === 0) return 0;

  const previous = Number.isFinite(previousUnits) ? Math.min(ceilingUnits, Math.max(0, Math.round(previousUnits))) : 0;
  const deposit = Number.isFinite(depositedCoverage) ? Math.min(1, Math.max(0, depositedCoverage)) : 0;
  if (!(deposit > 0)) return previous;

  const previousCoverage = previous / FLOW_COVERAGE_SCALE;
  const nextCoverage = Math.min(ceiling, previousCoverage + (1 - previousCoverage) * deposit);

  return Math.min(Math.round(nextCoverage * FLOW_COVERAGE_SCALE), ceilingUnits);
};
