import type { BitmapSource, Point } from '../contexts/general-types.ts';
import { pointsBoundingPos } from './draw.ts';

export function copyPolygonToCanvas(sourceCanvas: BitmapSource, points: Point[]): OffscreenCanvas {
  const bounds = pointsBoundingPos({ points, lineWidth: 0 });

  const destCanvas = new OffscreenCanvas(bounds.width, bounds.height);
  const { x: minX, y: minY } = bounds;

  const ctx = destCanvas.getContext('2d')!;
  ctx.save();

  // Build polygon path relative to new canvas
  ctx.beginPath();
  ctx.moveTo(points[0].x - minX, points[0].y - minY);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x - minX, points[i].y - minY);
  }

  ctx.closePath();

  // Clip drawing to polygon
  ctx.clip();

  // Draw source canvas shifted so polygon aligns
  ctx.drawImage(sourceCanvas, -minX, -minY);

  ctx.restore();

  return destCanvas;
}
