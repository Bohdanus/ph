import type { CropToolArgs } from '../tools/crop.ts';
import type { DrawToolArgs, PaintToolArgs } from '../tools/draw.ts';
import type { FigureType, ShapeToolArgs } from '../tools/shape.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import type { LassoToolArgs } from '../tools/polygonSelection.ts';
import type { RectangularSelectionToolArgs } from '../tools/rectangularSelection.ts';
import type { FeatherMagneticLassoToolArgs } from '../tools/featherMagneticLasso.ts';
import type { MagicWandToolArgs } from '../tools/magicWand.ts';

import type { BitmapSource, Pos, Size } from './general-types.ts';

export type ToolArgsByName = {
  reposition: RepositionToolArgs;
  blur: BlurToolArgs;
  color: ColorsToolArgs;
  levels: LevelsToolArgs;
  transform: TransformToolArgs;
  crop: CropToolArgs;
  draw: DrawToolArgs;
  shape: ShapeToolArgs;
  text: TextToolArgs;
  'polygonal-lasso': LassoToolArgs & { toolName: 'polygonal-lasso' };
  'freehand-lasso': LassoToolArgs & { toolName: 'freehand-lasso' };
  'feather-magnetic-lasso': FeatherMagneticLassoToolArgs;
  'magic-wand': MagicWandToolArgs;
  'rectangular-selection': RectangularSelectionToolArgs;
  brush: PaintToolArgs;
  pencil: PaintToolArgs;
  'color-replacement': PaintToolArgs;
  pen: { toolName: 'pen' };
  'freeform-pen': { toolName: 'freeform-pen' };
  'curvature-pen': { toolName: 'curvature-pen' };
  'add-anchor-point': { toolName: 'add-anchor-point' };
  'delete-anchor-point': { toolName: 'delete-anchor-point' };
  'convert-point': { toolName: 'convert-point' };
  rectangle: Omit<ShapeToolArgs, 'toolName' | 'figure'> & {
    toolName: 'rectangle';
    figure: Extract<FigureType, 'rectangle'>;
  };
  ellipse: Omit<ShapeToolArgs, 'toolName' | 'figure'> & { toolName: 'ellipse'; figure: Extract<FigureType, 'oval'> };
  triangle: { toolName: 'triangle' };
  polygon: { toolName: 'polygon' };
  line: Omit<ShapeToolArgs, 'toolName' | 'figure'> & { toolName: 'line'; figure: Extract<FigureType, 'line'> };
  'custom-shape': { toolName: 'custom-shape' };
};

export type ToolName = keyof ToolArgsByName;

export type ToolArgsFor<TName extends ToolName> = ToolArgsByName[TName];

export type ToolArgs = ToolArgsByName[ToolName];

export type ToolSettings = ToolArgs;

export type ToolPatch<TName extends ToolName> = Partial<Omit<ToolArgsFor<TName>, 'toolName'>>;

export type FullArgs = {
  args: ToolArgs;
  canvas?: HTMLCanvasElement;
  pos: Pos; // honestly, this should be copied from args :/
};

export type NewBedrockSize = {
  size: Size;
  isBedrock: true;
};
export type NewLayerPos = {
  pos: Pos;
  isBedrock?: false;
};
export type NewLayerData = NewBedrockSize | NewLayerPos;

export type BlankImageParams = {
  color: string;
  opacity: number;
} & NewLayerData;

export type FileImageParams = {
  bitmap: BitmapSource;
  name?: string;
} & NewLayerData;
