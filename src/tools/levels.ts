import { buildLevelsFilter } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type LevelsToolArgs = { brightness: number; contrast: number; toolName: 'levels' };

/** Keep malformed runtime values neutral before they reach a filter or history operation. */
export function normalizeLevelsToolArgs(args: LevelsToolArgs): LevelsToolArgs {
  const finiteOrNeutral = (value: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  return {
    ...args,
    brightness: finiteOrNeutral(args.brightness),
    contrast: finiteOrNeutral(args.contrast),
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
