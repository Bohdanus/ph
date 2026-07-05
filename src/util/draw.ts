import type { Ctx2D, Point, Pos } from '../contexts/general-types.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import { hexToRgb } from './rect.ts';

export function pointsBoundingPos({ lineWidth = 1, points }: { lineWidth?: number; points: Point[] }): Pos {
  const pp = points!;
  let minX = pp[0].x;
  let minY = pp[0].y;
  let maxX = pp[0].x;
  let maxY = pp[0].y;

  for (let i = 1; i < pp.length; i++) {
    const p = pp[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX - lineWidth,
    y: minY - lineWidth,
    width: maxX - minX + 2 * lineWidth,
    height: maxY - minY + 2 * lineWidth,
  };
}

export function bezierSmoothedLine(ctx: Ctx2D, points: Point[]) {
  const lengthBy2 = Math.ceil(points.length / 2);
  let firstFreePoint = 0;

  for (let i = 0; i < lengthBy2; i++) {
    const j = i * 2;
    if (j + 2 < points.length) {
      const p1 = points[j];
      const p2 = points[j + 1];
      const p3 = points[j + 2];
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      firstFreePoint = j + 3;
    } else {
      for (let k = firstFreePoint; k < points.length; k++) {
        ctx.lineTo(points[k].x, points[k].y);
      }
    }
  }
}

export function drawSmoothLine(ctx: Ctx2D, points: Point[]) {
  if (points.length < 1) return;
  if (points.length < 2) {
    ctx.lineTo(points[0].x, points[0].y);
    return;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;

    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
}

export function catmullRomToBezier(ctx: CanvasRenderingContext2D, pts: Point[], tension = 0.5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

export type DrawStrokeParams = {
  args: DrawToolArgs;
  ctx: Ctx2D; // overlay ctx
};

export const drawLine = (params: DrawStrokeParams) => {
  const {
    args: { penType },
  } = params;

  if (penType === 'pen' || penType === 'pen-dashed') {
    drawPen(params);
  } else if (penType === 'spray') {
    drawSpray(params);
  }
};

export const drawPen = ({ args, ctx }: DrawStrokeParams) => {
  const points = args.points!;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  bezierSmoothedLine(ctx, points);
  ctx.stroke();
};

export const drawSpray = ({ args, ctx }: DrawStrokeParams) => {
  const points = args.points!;

  const alpha = args.alpha;
  const color = hexToRgb(args.color);
  const colorStart = `rgba(${color}, ${alpha / 4})`;
  const colorStop = `rgba(${color}, 0)`;
  const radius = args.lineWidth;

  for (let i = 0; i < points.length; i++) {
    const g = ctx.createRadialGradient(points[i].x, points[i].y, 0, points[i].x, points[i].y, radius);
    g.addColorStop(0, colorStart);
    g.addColorStop(1, colorStop);

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
};
