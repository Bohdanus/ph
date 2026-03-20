import { trimRect } from '../util/rect.ts';
import type { ProcessorToolParams } from './toolsMap.ts';
import type { RectXYSorted } from '../contexts/general-types.ts';

export type CropToolArgs = {
  rect?: RectXYSorted | null;
  aspectRatio?: number | null;
};

export const crop =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ rect }: CropToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);

    const { x, y, width, height } = trimRect(rect!, size);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

    return [canvas, { width, height }];
  };
