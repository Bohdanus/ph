import { buildColorsFilter, normalizeColorsFilterArgs } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type ColorsToolArgs = { grayscale: number; sepia: number; saturation: number; toolName: 'color' };

/** Neutralize malformed values and clamp every control to its slider range. */
export function normalizeColorsToolArgs(args: ColorsToolArgs): ColorsToolArgs {
  return {
    ...args,
    ...normalizeColorsFilterArgs(args),
  };
}

export const colors =
  ({ bitmap, size }: ProcessorToolParams) =>
  (args: ColorsToolArgs) => {
    if (!bitmap) throw new Error('Color tool requires a source bitmap');

    requireCanvasFilter('color');
    const normalizedArgs = normalizeColorsToolArgs(args);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildColorsFilter(normalizedArgs);
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
