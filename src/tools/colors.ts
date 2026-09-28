import { buildColorsFilter } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

export type ColorsToolArgs = { grayscale: number; sepia: number; saturation: number; toolName: 'color' };

export const colors =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ grayscale, sepia, saturation }: ColorsToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildColorsFilter({ grayscale, sepia, saturation });
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
