import type { BitmapSource, Point, Selection, SelectionSourceTool } from '../contexts/general-types.ts';
import { pointsBoundingPos } from './draw.ts';

export const SELECTION_ANCHOR_RADIUS = 5;
export const SELECTION_ANCHOR_HIT_RADIUS = 8;

export function normalizeSelectionPoints(points: Point[]): Pick<Selection, 'points' | 'pos'> | null {
  if (points.length < 3) return null;

  const pos = pointsBoundingPos({ points });
  const normalizedPoints = points.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));

  return { points: normalizedPoints, pos };
}

export function createCommittedPolygonSelection({
  id,
  points,
  sourceTool,
}: {
  id: string;
  points: Point[];
  sourceTool: Extract<SelectionSourceTool, 'polygonal-lasso' | 'freehand-lasso'>;
}): Selection | null {
  const normalized = normalizeSelectionPoints(points);
  if (!normalized) return null;

  return {
    id,
    ...normalized,
    isActive: true,
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool,
  };
}

export function getSelectionAbsolutePoints(selection: Selection): Point[] {
  return selection.points.map((point) => ({
    x: point.x + selection.pos.x,
    y: point.y + selection.pos.y,
  }));
}

export function drawClosedSelectionPath(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.closePath();
  ctx.stroke();
}

export function drawSelectionOutline(ctx: CanvasRenderingContext2D, selection: Selection): void {
  if (!selection.isActive) return;

  const points = getSelectionAbsolutePoints(selection);
  if (points.length < 3) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(0,123,255,0.95)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  drawClosedSelectionPath(ctx, points);

  ctx.setLineDash([]);
  points.forEach((point, index) => {
    ctx.beginPath();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = index === 0 ? 'rgba(0,123,255,1)' : 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2;
    ctx.arc(point.x, point.y, SELECTION_ANCHOR_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

export function distanceBetweenPoints(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function findSelectionAnchorAtPoint(selection: Selection, point: Point): number | null {
  const points = getSelectionAbsolutePoints(selection);
  const anchorIndex = points.findIndex((anchor) => distanceBetweenPoints(anchor, point) <= SELECTION_ANCHOR_HIT_RADIUS);

  return anchorIndex === -1 ? null : anchorIndex;
}

export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let isInside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

export function getSelectionAtPoint(selections: Selection[], point: Point): Selection | null {
  for (let i = selections.length - 1; i >= 0; i--) {
    const selection = selections[i];
    if (!selection.isActive) continue;

    const points = getSelectionAbsolutePoints(selection);
    if (isPointInPolygon(point, points)) {
      return selection;
    }
  }

  return null;
}

export function moveSelectionAnchor(selection: Selection, anchorIndex: number, point: Point): Selection {
  const points = getSelectionAbsolutePoints(selection);
  if (!points[anchorIndex]) return selection;

  points[anchorIndex] = point;

  const normalized = normalizeSelectionPoints(points);
  if (!normalized) return selection;

  return {
    ...selection,
    ...normalized,
    metadata: {
      ...selection.metadata,
      movedAtVersion: (selection.metadata?.movedAtVersion ?? 0) + 1,
    },
  };
}

export function moveSelectionByDelta(selection: Selection, delta: Point): Selection {
  return {
    ...selection,
    pos: {
      ...selection.pos,
      x: selection.pos.x + delta.x,
      y: selection.pos.y + delta.y,
    },
    metadata: {
      ...selection.metadata,
      movedAtVersion: (selection.metadata?.movedAtVersion ?? 0) + 1,
    },
  };
}

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
  // Note: Self-intersecting polygons are handled gracefully using the non-zero winding rule.
  // The clipping will simply exclude regions based on the winding number, which prevents crashes.
  ctx.clip();

  // Draw source canvas shifted so polygon aligns
  ctx.drawImage(sourceCanvas, -minX, -minY);

  ctx.restore();

  return destCanvas;
}

export async function copyCanvasToClipboard(canvas: OffscreenCanvas): Promise<void> {
  try {
    const blob = await canvas.convertToBlob();
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob,
      }),
    ]);
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    throw error;
  }
}
