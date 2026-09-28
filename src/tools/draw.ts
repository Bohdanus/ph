import type { CreatorToolParams } from './toolProcessors.ts';
import type { PaintBlendMode, PaintSettings, PaintToolName } from './brush.ts';
import { drawLine } from '../util/draw.ts';
import type { Ctx2D, Point } from '../contexts/general-types.ts';

export type PenType = 'pen' | 'pen-dashed' | 'spray';

export type DrawToolArgs = {
  alpha: number;
  color: string;
  penType: PenType;
  lineWidth: number;
  lineDash?: null | number[];
  points?: Point[];
  /**
   * Photoshop `Smoothing`, 0-100, applied to the sampled path by
   * `smoothStrokePoints`. Optional because the legacy `draw` tool's per-pen presets
   * (`src/tools/settings.ts:21-25`) predate it; an absent value is no smoothing,
   * which is exactly what those presets render today.
   */
  smoothing?: number;
  /**
   * Photoshop `Mode`, applied when a paint stroke's layer is created. Optional for
   * the same reason as `smoothing`; an absent value composites as Normal.
   */
  blendMode?: PaintBlendMode;

  toolName: 'draw';
};

export type { PaintToolName };

/**
 * A paint tool carries the Photoshop options-bar settings as required, so the bar
 * can read them without a guard and a `draw`-era args object can never satisfy the
 * type by omission.
 */
export type PaintToolArgs = Omit<DrawToolArgs, 'toolName' | 'smoothing' | 'blendMode'> &
  PaintSettings & {
    toolName: PaintToolName;
  };

export type DrawToolSettings = Omit<DrawToolArgs, 'color' | 'points'>;

export const setupDrawCtx = (ctx: Ctx2D, args: DrawToolArgs) => {
  const { alpha, color, penType, lineDash, lineWidth } = args;

  if (penType === 'spray') return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = penType === 'pen' ? 'round' : 'square';
  ctx.globalAlpha = alpha;

  if (lineDash) ctx.setLineDash(lineDash);
};

export const draw =
  ({ size }: CreatorToolParams) =>
  (args: DrawToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    setupDrawCtx(ctx, args);

    drawLine({
      args,
      ctx,
    });

    return [canvas];
  };
