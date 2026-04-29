import type { CropToolArgs } from '../tools/crop.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';

import { toolsMap } from '../tools/toolsMap.ts';
import type { BitmapSource, Pos, Size } from './general-types.ts';

export type ToolName = keyof typeof toolsMap;

export type ToolArgs = (
  | RepositionToolArgs
  | BlurToolArgs
  | ColorsToolArgs
  | CropToolArgs
  | DrawToolArgs
  | LevelsToolArgs
  | TextToolArgs
  | TransformToolArgs
  | ShapeToolArgs
) & { toolName: ToolName };

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
