import type { CreatorToolParams, ToolResult } from './toolProcessors.ts';
import type { Ctx2D, Point } from '../contexts/general-types.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

export type FigureType = 'line' | 'circle' | 'rectangle' | 'square' | 'oval' | 'triangle' | 'polygon';

export type ShapeToolMode = 'shape' | 'path' | 'pixels';
export type ShapeLineCap = CanvasLineCap;

export type ShapeToolArgs = {
  alpha: number;
  color: string;
  backgroundColor: null | string;
  hasFill?: boolean;
  figure: FigureType;
  lineWidth: number;
  lineDash?: null | number[];
  lineCap?: ShapeLineCap;
  cornerRadius?: number;
  toolMode?: ShapeToolMode;
  start?: Point;
  end?: Point;

  toolName: 'shape';
};

export type ShapeToolSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end'>;

export const setShapeCtx = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { alpha, color, backgroundColor, hasFill, lineWidth, lineDash, lineCap } = args;

  ctx.strokeStyle = color;
  if (hasFill && backgroundColor) {
    ctx.fillStyle = backgroundColor;
  }
  ctx.lineWidth = lineWidth;
  ctx.lineCap = lineCap ?? 'butt';
  ctx.globalAlpha = alpha;
  ctx.setLineDash(lineDash ?? []);
};

const roundedRectPath = (ctx: Ctx2D, x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Math.max(0, radius));
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(right - r, y);
  ctx.quadraticCurveTo(right, y, right, y + r);
  ctx.lineTo(right, bottom - r);
  ctx.quadraticCurveTo(right, bottom, right - r, bottom);
  ctx.lineTo(x + r, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const drawShape = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { figure, start, end } = args;
  const hasFill = args.toolMode !== 'path' && args.hasFill;

  if (!start || !end) return;

  if (figure === 'line') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (figure === 'triangle' || figure === 'polygon') {
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    const sides = figure === 'triangle' ? 3 : 5;

    ctx.beginPath();
    for (let index = 0; index < sides; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const point = {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      };
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    if (hasFill) ctx.fill();
    ctx.stroke();
  } else if (figure === 'rectangle' || figure === 'square') {
    let w = end.x - start.x;
    let h = end.y - start.y;
    if (figure === 'square') {
      const side = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w) * side;
      h = Math.sign(h) * side;
    }
    const radius = args.cornerRadius ?? 0;
    if (radius > 0) {
      roundedRectPath(ctx, start.x, start.y, w, h, radius);
      if (hasFill) ctx.fill();
      ctx.stroke();
    } else {
      if (hasFill) ctx.fillRect(start.x, start.y, w, h);
      ctx.strokeRect(start.x, start.y, w, h);
    }
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
  ({ size }: CreatorToolParams): ((args: ToolArgs) => ToolResult) =>
  (args) => {
    if (!('figure' in args)) {
      throw new Error(`Tool "${args.toolName}" does not provide shape arguments`);
    }

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    const shapeArgs = { ...args, toolName: 'shape' } as ShapeToolArgs;

    setShapeCtx(ctx, shapeArgs);

    drawShape(ctx, shapeArgs);

    return [canvas];
  };
