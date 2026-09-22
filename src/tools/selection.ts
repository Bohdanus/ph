import type { ProcessorToolParams } from './toolProcessors.ts';
import { copyPolygonToCanvas } from '../util/selection.ts';
import type { Point } from '../contexts/general-types.ts';

export type SelectionMode = 'fill' | 'outline';

export type SelectionToolArgs = {
  points: Point[];
  mode: SelectionMode;
  toolName: 'selection' | 'polygonal-lasso' | 'freehand-lasso';
};

export type SelectionToolSettings = Omit<SelectionToolArgs, 'points'>;

export const selection =
  ({ bitmap }: ProcessorToolParams) =>
  ({ points }: SelectionToolArgs) => {
    return [copyPolygonToCanvas(bitmap, points)];
  };
