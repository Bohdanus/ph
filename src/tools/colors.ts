import { buildColorsFilter } from './functions.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type ColorsToolArgs = { grayscale: number; sepia: number; saturation: number; toolName: 'color' };

/** Neutralize malformed values and clamp the bounded grayscale/sepia controls. */
export function normalizeColorsToolArgs(args: ColorsToolArgs): ColorsToolArgs {
  const finiteOrNeutral = (value: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  };
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  return {
    ...args,
    grayscale: clamp(finiteOrNeutral(args.grayscale), 0, 100),
    sepia: clamp(finiteOrNeutral(args.sepia), 0, 100),
    saturation: finiteOrNeutral(args.saturation),
  };
}

export const colors =
  ({ bitmap, size }: ProcessorToolParams) =>
  (args: ColorsToolArgs) => {
    requireCanvasFilter('color');
    const normalizedArgs = normalizeColorsToolArgs(args);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildColorsFilter(normalizedArgs);
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
