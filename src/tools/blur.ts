import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import { BLUR_RADIUS_SLIDER_RANGE, buildBlurFilter, normalizeBlurRadius } from './functions.ts';

export type BlurToolArgs = { radius: number; toolName: 'blur' };

export { BLUR_RADIUS_SLIDER_RANGE };

export function normalizeBlurToolArgs(args: BlurToolArgs): BlurToolArgs {
  return { ...args, radius: normalizeBlurRadius(args.radius) };
}

export const blur =
  ({ bitmap, size }: ProcessorToolParams) =>
  (args: BlurToolArgs) => {
    if (!bitmap) throw new Error('Blur tool requires a source bitmap');

    requireCanvasFilter('blur');
    const { radius } = normalizeBlurToolArgs(args);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = buildBlurFilter(radius);
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
