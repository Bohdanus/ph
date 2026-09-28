import type { CreatorToolParams } from './toolProcessors.ts';
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

  toolName: 'draw';
};

export type PaintToolName = 'brush' | 'pencil' | 'color-replacement';

export type PaintToolArgs = Omit<DrawToolArgs, 'toolName'> & {
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

  // The overlay context is shared between strokes and between tools, so the pattern is always
  // set, never merely appended: an undashed pen must clear the previous stroke's dash.
  if (penType === 'pen-dashed' && lineDash) ctx.setLineDash(lineDash);
  else ctx.setLineDash([]);
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
