import type { RectXYSorted } from '../contexts/general-types.ts';
import type { ProcessorToolParams } from './toolsMap.ts';

export type RectangularSelectionToolArgs = {
  rect?: RectXYSorted | null;
  toolName: 'rectangular-selection';
};

export const rectangularSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
