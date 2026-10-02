import { buildLevelsFilter } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type LevelsToolArgs = { brightness: number; contrast: number; toolName: 'levels' };

export const levels =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ brightness, contrast }: LevelsToolArgs) => {
    requireCanvasFilter('levels');

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildLevelsFilter({ brightness, contrast });
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
