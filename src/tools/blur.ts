import type { ProcessorToolParams } from './toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import { compositeStrokeFootprint } from '../util/focus-stroke-mask.ts';
import type { Point, Pos } from '../contexts/general-types.ts';

export type BlurToolArgs = {
  radius: number;
  points?: Point[];
  rasterBounds?: Pos;
  toolName: 'blur';
};

/**
 * The kernel floor on the STROKE path only.
 *
 * The whole-layer form treats `radius: 0` as the identity, because that is what the slider's
 * left end says and what an existing filter entry means. A stroke is different: the brush is
 * live under the pointer, so a 0px kernel would make the tool look broken while the bar reads 0.
 * One texel keeps the stroke visible. The floor is therefore a property of the stroke form, and
 * the two forms deliberately disagree at `radius` 0.
 */
const STROKE_KERNEL_FLOOR = 1;

export const blur =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ radius, points }: BlurToolArgs) => {
    requireCanvasFilter('blur');

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    const stroked = Boolean(points?.length);
    ctx.filter = `blur(${stroked ? Math.max(STROKE_KERNEL_FLOOR, radius) : radius}px)`;
    ctx.drawImage(bitmap, 0, 0);

    return [stroked ? compositeStrokeFootprint(bitmap, canvas, size, points!) : canvas];
  };
