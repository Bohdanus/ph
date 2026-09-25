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
  ({ move }: RepositionToolArgs) => {
    if (move) {
      // do nothing to do with the canvas and bitmap, just move the position
      return [bitmap, move];
    }
    // Reposition commits as `commit: 'geometry'` and is handled structurally
    // (pos patch only) in useLayer.ts / history-replay.ts, which rematerializes
    // vector sources rather than stretching a bitmap. This image processor is
    // never invoked for reposition, and resize must not rasterize here.
  };
