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

export function isTextToolArgs(args: ToolArgs | null | undefined): args is TextToolArgs & { toolName: 'text' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'text';
}

export function hasPendingText(args: ToolArgs | null | undefined): boolean {
  return isTextToolArgs(args) && Boolean(args.text && args.rect);
}

export function isDrawToolArgs(args: ToolArgs | null | undefined): args is DrawToolArgs & { toolName: 'draw' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'draw';
}

export function isShapeToolArgs(args: ToolArgs | null | undefined): args is ShapeToolArgs & { toolName: 'shape' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'shape';
}

export function isCropToolArgs(args: ToolArgs | null | undefined): args is CropToolArgs & { toolName: 'crop' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'crop';
}

export function isTransformToolArgs(
  args: ToolArgs | null | undefined
): args is TransformToolArgs & { toolName: 'transform' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'transform';
}

export function isColorsToolArgs(args: ToolArgs | null | undefined): args is ColorsToolArgs & { toolName: 'color' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'color';
}

export function isBlurToolArgs(args: ToolArgs | null | undefined): args is BlurToolArgs & { toolName: 'blur' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'blur';
}

export function isLevelsToolArgs(args: ToolArgs | null | undefined): args is LevelsToolArgs & { toolName: 'levels' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'levels';
}

export function isRepositionToolArgs(
  args: ToolArgs | null | undefined
): args is RepositionToolArgs & { toolName: 'reposition' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'reposition';
}
