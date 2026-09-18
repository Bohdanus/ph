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
  | 'shape-square'
  | 'shape-circle'
  | 'shape-line'
  | 'text'
  | 'color'
  | 'blur'
  | 'levels'
  | 'transform';

export type ToolIconProps = {
  title: string;
};

export type SvgIconFactory = (props: ToolIconProps) => ReactElement;
