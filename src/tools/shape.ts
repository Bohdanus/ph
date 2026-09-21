import type { CreatorToolParams, ToolResult } from './toolsMap.ts';
import type { Ctx2D, Point } from '../contexts/general-types.ts';

export type FigureType = 'line' | 'circle' | 'rectangle' | 'square' | 'oval';

export type ShapeToolArgs = {
  alpha: number;
  color: string;
  backgroundColor: null | string;
  hasFill?: boolean;
  figure: FigureType;
  lineWidth: number;
  lineDash?: null | number[];
  start?: Point;
  end?: Point;

  toolName: 'shape';
};

export type ShapeToolSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end'>;

export const setShapeCtx = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { alpha, color, backgroundColor, hasFill, lineWidth, lineDash } = args;

  ctx.strokeStyle = color;
  if (hasFill && backgroundColor) {
    ctx.fillStyle = backgroundColor;
  }
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  if (lineDash) ctx.setLineDash(lineDash);
};

export const drawShape = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { figure, hasFill, start, end } = args;

  if (!start || !end) return;

  if (figure === 'line') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (figure === 'rectangle' || figure === 'square') {
    let w = end.x - start.x;
    let h = end.y - start.y;
    if (figure === 'square') {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w) * side;
      h = Math.sign(h) * side;
    }
    if (hasFill) {
      ctx.fillRect(start.x, start.y, w, h);
    }
    ctx.strokeRect(start.x, start.y, w, h);
  } else if (figure === 'circle' || figure === 'oval') {
    let rx = Math.abs(end.x - start.x) / 2;
    let ry = Math.abs(end.y - start.y) / 2;
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    if (figure === 'circle') {
      const r = Math.max(rx, ry);
      rx = ry = r;
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (hasFill) {
      ctx.fill();
    }
    ctx.stroke();
  }
};

export const shape =
  ({ size }: CreatorToolParams): ((args: ShapeToolArgs | any) => ToolResult) =>
  (args) => {
    const shapeArgs = args as ShapeToolArgs;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    setShapeCtx(ctx, shapeArgs);

    drawShape(ctx, shapeArgs);

    return [canvas, { x: 0, y: 0 } as never] as ToolResult;
  };
