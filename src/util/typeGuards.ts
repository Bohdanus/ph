import type { BlurToolArgs } from '../tools/blur.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { CropToolArgs } from '../tools/crop.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

export function isTextToolArgs(args: ToolArgs): args is TextToolArgs & { toolName: 'text' } {
  return args.toolName === 'text' && args !== null && typeof args === 'object';
}

export function isDrawToolArgs(args: ToolArgs): args is DrawToolArgs & { toolName: 'draw' } {
  return args.toolName === 'draw' && args !== null && typeof args === 'object';
}

export function isShapeToolArgs(args: ToolArgs): args is ShapeToolArgs & { toolName: 'shape' } {
  return args.toolName === 'shape' && args !== null && typeof args === 'object';
}

export function isCropToolArgs(args: ToolArgs): args is CropToolArgs & { toolName: 'crop' } {
  return args.toolName === 'crop' && args !== null && typeof args === 'object';
}

export function isTransformToolArgs(args: ToolArgs): args is TransformToolArgs & { toolName: 'transform' } {
  return args.toolName === 'transform' && args !== null && typeof args === 'object';
}

export function isColorsToolArgs(args: ToolArgs): args is ColorsToolArgs & { toolName: 'color' } {
  return args.toolName === 'color' && args !== null && typeof args === 'object';
}

export function isBlurToolArgs(args: ToolArgs): args is BlurToolArgs & { toolName: 'blur' } {
  return args.toolName === 'blur' && args !== null && typeof args === 'object';
}

export function isLevelsToolArgs(args: ToolArgs): args is LevelsToolArgs & { toolName: 'levels' } {
  return args.toolName === 'levels' && args !== null && typeof args === 'object';
}

export function isRepositionToolArgs(args: ToolArgs): args is RepositionToolArgs & { toolName: 'reposition' } {
  return args.toolName === 'reposition' && args !== null && typeof args === 'object';
}
