import type { ProcessorToolParams } from './toolProcessors.ts';
import type { Point, Pos } from '../contexts/general-types.ts';

// should be either move or resize, not both, and not none
export type RepositionToolArgs = {
  move?: Point;
  resize?: Pos;

  toolName: 'reposition';
};

export const reposition =
  ({ bitmap }: ProcessorToolParams) =>
  ({ move, resize }: RepositionToolArgs) => {
    if (move) {
      // do nothing to do with the canvas and bitmap, just move the position
      return [bitmap, move];
    }

    if (resize) {
      // draw the resized image to canvas
      const canvas = new OffscreenCanvas(resize.width, resize.height);
      const ctx = canvas.getContext('2d')!;

      ctx.drawImage(bitmap, 0, 0, resize.width, resize.height);

      return [canvas, resize];
    }
  };
