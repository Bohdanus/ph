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
import type { Point, Pos } from '../contexts/general-types.ts';

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

/**
 * A focus-family stroke carries local points plus the document-space frame they address.
 *
 * Which tools may answer true at all is the focus family — `blur`, `sharpen` and `smudge` —
 * and NOT a capability flag, because this codebase's registry carries no per-args stroke
 * capability. Six classifiers depend on the answer (`history-replay.ts`, `useLayer.ts`,
 * `useHistory.ts`, `materialization.ts`, `history-adapter.ts` and `history-append.ts`), and a
 * name list in this predicate is six places to forget the same tool, with the durable and legacy
 * paths free to disagree about whether an edit was a stroke. Registering a new focus tool is the
 * whole of that change here: add its name to the list below.
 *
 * `draw` and the tonal tools carry `points` too, so the name list is the only thing separating a
 * focus-family stroke from an ordinary paint one. Without it every paint tool would start widening
 * its layer to the frame the brush happens to be inside.
 */
export function isRasterStrokeArgs(
  args: ToolArgs | null | undefined
): args is ToolArgs & { points: Point[]; rasterBounds: Pos } {
  if (!args || typeof args !== 'object' || !('toolName' in args)) return false;
  if (!['blur', 'sharpen', 'smudge'].includes(args.toolName as string)) return false;
  const candidate = args as unknown as { points?: unknown; rasterBounds?: unknown };
  const points = candidate.points;
  const bounds = candidate.rasterBounds;
  return (
    // `length > 0`, not merely `isArray`. An empty stroke passes a vacuous `every`, and an empty
    // `points` takes each processor's WHOLE-FRAME branch — so an entry that reached this guard
    // with no points would be a whole-layer blur or sharpen over the widened frame, which is
    // precisely the retained-filter semantics this predicate exists to distinguish a stroke from.
    Array.isArray(points) &&
    points.length > 0 &&
    points.every(
      (point) =>
        !!point &&
        typeof point === 'object' &&
        Number.isFinite((point as Point).x) &&
        Number.isFinite((point as Point).y)
    ) &&
    !!bounds &&
    typeof bounds === 'object' &&
    ['x', 'y', 'width', 'height'].every((key) => Number.isFinite((bounds as Pos)[key as keyof Pos])) &&
    (bounds as Pos).width > 0 &&
    (bounds as Pos).height > 0
  );
}

export function isLevelsToolArgs(args: ToolArgs | null | undefined): args is LevelsToolArgs & { toolName: 'levels' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'levels';
}

export function isRepositionToolArgs(
  args: ToolArgs | null | undefined
): args is RepositionToolArgs & { toolName: 'reposition' } {
  return !!args && typeof args === 'object' && 'toolName' in args && args.toolName === 'reposition';
}
