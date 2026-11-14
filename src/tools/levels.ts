import { buildLevelsFilter, normalizeLevelsFilterArgs } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type LevelsToolArgs = { brightness: number; contrast: number; toolName: 'levels' };

/** Keep malformed and out-of-range values inside the Levels slider domain. */
export function normalizeLevelsToolArgs(args: LevelsToolArgs): LevelsToolArgs {
  return {
    ...args,
    ...normalizeLevelsFilterArgs(args),
  };
}

export const levels =
  ({ bitmap, size }: ProcessorToolParams) =>
  (args: LevelsToolArgs) => {
    requireCanvasFilter('levels');
    const normalizedArgs = normalizeLevelsToolArgs(args);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildLevelsFilter(normalizedArgs);
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
