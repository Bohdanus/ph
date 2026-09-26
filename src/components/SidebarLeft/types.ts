import type { ReactElement } from 'react';

export type ToolIconName =
  | 'reposition'
  | 'rectangular-selection'
  | 'freehand-lasso'
  | 'polygonal-lasso'
  | 'feather-magnetic-lasso'
  | 'magic-wand'
  | 'crop'
  | 'draw'
  | 'shape'
  | 'shape-rectangle'
  | 'shape-oval'
  | 'shape-line'
  | 'shape-triangle'
  | 'shape-polygon'
  | 'text'
  | 'color'
  | 'blur'
  | 'levels'
  | 'transform'
  | 'brush'
  | 'pencil'
  | 'color-replacement'
  | 'pen'
  | 'freeform-pen'
  | 'curvature-pen'
  | 'add-anchor-point'
  | 'delete-anchor-point'
  | 'convert-point'
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'line'
  | 'custom-shape';

export type ToolIconProps = {
  title: string;
};

export type SvgIconFactory = (props: ToolIconProps) => ReactElement;
