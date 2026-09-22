import type { Point } from '../contexts/general-types.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

export type FeatherMagneticLassoToolArgs = {
  points?: Point[];
  featherRadius: number;
  magneticWidth: number;
  edgeContrast: number;
  frequency: number;
  snapStrength: number;
  smoothing: number;
  antiAlias: boolean;
  previewFeather: boolean;
  toolName: 'feather-magnetic-lasso';
};

export type FeatherMagneticLassoToolSettings = Omit<FeatherMagneticLassoToolArgs, 'points'>;

export const featherMagneticLasso =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
