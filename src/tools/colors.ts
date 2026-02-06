import { exp1_1 } from './functions.ts';
import type { ImageProcParams } from './toolsMap.ts';

export type ColorsToolArgs = { grayscale: number; sepia: number; saturation: number };

export const colors =
  ({ ctx, bitmap }: ImageProcParams) =>
  ({ grayscale, sepia, saturation }: ColorsToolArgs) => {
    ctx.filter = `grayscale(${grayscale}%) sepia(${sepia}%) saturate(${exp1_1(saturation, 2.1)})`;
    ctx.drawImage(bitmap, 0, 0);
  };
