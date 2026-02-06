import { exp1_1 } from './functions.ts';
import type { ImageProcParams } from './toolsMap.ts';

export type LevelsToolArgs = { brightness: number; contrast: number };

export const levels =
  ({ ctx, bitmap }: ImageProcParams) =>
  ({ brightness, contrast }: LevelsToolArgs) => {
    ctx.filter = `brightness(${exp1_1(brightness, 1.9)}) contrast(${exp1_1(contrast, 2.2)})`;
    ctx.drawImage(bitmap, 0, 0);
  };
