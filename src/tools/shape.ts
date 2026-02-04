import { applyFilter } from './applyFilter.ts';
import type { Point } from '../contexts/ImageContext.tsx';

export type FigureType = 'line' | 'circle' | 'rectangle' | 'square' | 'oval';

export type ShapeToolType = {
  alpha: number;
  lineColor: string;
  fillColor: null | string;
  figure: FigureType;
  lineWidth: number;
  lineDash?: null | number[];
  start: Point;
  end: Point;
};

export const setShapeTool = (ctx: CanvasRenderingContext2D, args: ShapeToolType) => {
  const { alpha, lineColor, fillColor, lineWidth, lineDash } = args;

  ctx.strokeStyle = lineColor;
  if (fillColor) {
    ctx.fillStyle = fillColor;
  }
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;
  lineDash && ctx.setLineDash(lineDash);
};

export const drawShape = (ctx: CanvasRenderingContext2D, args: ShapeToolType) => {
  const { figure, fillColor, start, end } = args;

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
    if (fillColor) {
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
    if (fillColor) {
      ctx.fill();
    }
    ctx.stroke();
  }
};

export const shape = (canvas: HTMLCanvasElement, source: ImageBitmap) => (args: ShapeToolType) => {
  return applyFilter(canvas, (ctx) => {
    ctx.drawImage(source, 0, 0);

    setShapeTool(ctx, args);

    drawShape(ctx, args);
  });
};
