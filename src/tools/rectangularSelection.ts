import type { RectXYSorted } from '../contexts/general-types.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import {
  applyMarqueeRatio,
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
  isMarqueeStyle,
  type MarqueeStyle,
} from './ellipticalSelection.ts';

export type RectangularSelectionToolArgs = {
  rect?: RectXYSorted | null;
  /** Optional so older persisted/history args retain the Normal marquee behavior. */
  style?: MarqueeStyle;
  fixedRatio?: number;
  fixedWidth?: number;
  fixedHeight?: number;
  toolName: 'rectangular-selection';
};

export {
  applyMarqueeRatio,
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
  isMarqueeStyle,
};

export const rectangularSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
