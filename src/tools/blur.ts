import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';

export type BlurToolArgs = { radius: number; toolName: 'blur' };

export const blur =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ radius }: BlurToolArgs) => {
    requireCanvasFilter('blur');

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
