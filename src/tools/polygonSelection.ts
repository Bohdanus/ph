import type { Point } from '../contexts/general-types.ts';

export type LassoToolArgs = {
  points?: Point[];
  color: string;
  lineWidth: number;
  alpha: number;
  fill: boolean;
  toolName: 'polygonal-lasso' | 'freehand-lasso';
};

export type PolygonSelectionToolSettings = Omit<LassoToolArgs, 'points'>;
