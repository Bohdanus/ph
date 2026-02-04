import type { Point } from '../contexts/ImageContext.tsx';

export function bezierSmoothedLine(ctx: CanvasRenderingContext2D, points: Point[]) {
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

export function drawSmoothLine(ctx: CanvasRenderingContext2D, points: Point[]) {
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
