import { exp1_1 } from './functions.ts';
import type { ProcessorToolParams } from './toolsMap.ts';

export type ColorsToolArgs = { grayscale: number; sepia: number; saturation: number };

export const colors =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ grayscale, sepia, saturation }: ColorsToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = `grayscale(${grayscale}%) sepia(${sepia}%) saturate(${exp1_1(saturation, 2.1)})`;
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
