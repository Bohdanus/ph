import type { TextToolArgs, DrawToolArgs, ShapeToolArgs, CropToolArgs, TransformToolArgs, ColorsToolArgs, BlurToolArgs, LevelsToolArgs, RepositionToolArgs } from '../tools';
import type { ToolArgs } from '../contexts/tool-types';

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
