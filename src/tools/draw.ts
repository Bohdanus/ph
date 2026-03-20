import type { CreatorToolParams } from './toolsMap.ts';
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
};

export type DrawToolSettings = Omit<DrawToolArgs, 'points'>;

export const setupDrawCtx = (ctx: Ctx2D, args: DrawToolSettings) => {
  const { alpha, color, penType, lineDash, lineWidth } = args;

  if (penType === 'spray') return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = penType === 'pen' ? 'round' : 'square';
  ctx.globalAlpha = alpha;

  lineDash && ctx.setLineDash(lineDash);
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
