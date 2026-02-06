import type { Point } from '../contexts/ImageContext.tsx';
import type { ImageProcParams } from './toolsMap.ts';

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

export const setDrawTool = (ctx: CanvasRenderingContext2D, args: DrawToolSettings) => {
  const { alpha, color, penType, lineDash, lineWidth } = args;

  if (penType === 'spray') return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha;

  lineDash && ctx.setLineDash(lineDash);
};

export const draw =
  ({ ctx, bitmap }: ImageProcParams) =>
  (args: DrawToolArgs) => {
    ctx.drawImage(bitmap, 0, 0);

    // if (args.penType === 'spray') {
    throw 'rewriting from history not implemented';
    // }

    const { points } = args;
    if (!points || points.length === 0) return;

    setDrawTool(ctx, args);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  };
