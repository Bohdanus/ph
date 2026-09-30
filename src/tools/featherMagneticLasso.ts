import type { Point } from '../contexts/general-types.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

export type FeatherMagneticLassoToolArgs = {
  points?: Point[];
  featherRadius: number;
  magneticWidth: number;
  edgeContrast: number;
  frequency: number;
  snapStrength: number;
  smoothing: number;
  antiAlias: boolean;
  previewFeather: boolean;
  toolName: 'feather-magnetic-lasso';
};

export type FeatherMagneticLassoToolSettings = Omit<FeatherMagneticLassoToolArgs, 'points'>;

/** Adobe's Frequency range: "between 0 and 100". */
export const MAGNETIC_LASSO_FREQUENCY_MIN = 0;
export const MAGNETIC_LASSO_FREQUENCY_MAX = 100;
export const MAGNETIC_LASSO_FREQUENCY_STEP = 1;

/** The span one fastening step may cover at Frequency 0: the longest an unattended edge is followed. */
const ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX = 120;
/** ...and at Frequency 100, the shortest step the lasso takes. The old control's own floor. */
const ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX = 8;

/**
 * The path length, in pixels, that one automatic fastening point may cover at this Frequency.
 *
 * Adobe: "Frequency: the rate at which the lasso sets fastening points … between 0 and 100. A
 * higher value anchors the selection border in place more quickly." The lasso gates on a path
 * LENGTH, so the control and the gate are inverses of one another — the number the user turns up
 * is the number the gate has to turn down, and treating either as the other silently reverses
 * the control. The conversion lives here rather than at either end so there is exactly one place
 * where the direction is decided.
 *
 * A non-finite setting returns the longest span rather than `NaN`: every comparison against
 * `NaN` is false, so a `NaN` span would disable automatic fastening for the whole gesture
 * instead of falling back to something a user can still see working.
 */
export function magneticLassoAnchorSpan(frequency: number): number {
  if (!Number.isFinite(frequency)) return ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX;

  const clamped = Math.min(MAGNETIC_LASSO_FREQUENCY_MAX, Math.max(MAGNETIC_LASSO_FREQUENCY_MIN, frequency));
  const range = MAGNETIC_LASSO_FREQUENCY_MAX - MAGNETIC_LASSO_FREQUENCY_MIN;
  const progress = (clamped - MAGNETIC_LASSO_FREQUENCY_MIN) / range;

  return (
    ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX -
    progress * (ANCHOR_SPAN_AT_LOWEST_FREQUENCY_PX - ANCHOR_SPAN_AT_HIGHEST_FREQUENCY_PX)
  );
}

export const featherMagneticLasso =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
