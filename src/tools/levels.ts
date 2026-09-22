import { exp1_1 } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

export type LevelsToolArgs = { brightness: number; contrast: number; toolName: 'levels' };

export const levels =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ brightness, contrast }: LevelsToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = `brightness(${exp1_1(brightness, 1.9)}) contrast(${exp1_1(contrast, 2.2)})`;
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
