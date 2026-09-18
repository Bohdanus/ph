import type {
  BitmapSource,
  Ctx2D,
  Point,
  Pos,
  RectXYSorted,
  Selection,
  SelectionSourceTool,
  Size,
} from '../contexts/general-types.ts';
import { pointsBoundingPos } from './draw.ts';
import { posToSortedRect, sortRect, trimRect } from './rect.ts';

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
  metadata,
  points,
  sourceTool,
}: {
  id: string;
  metadata?: Selection['metadata'];
  points: Point[];
  sourceTool: Extract<
    SelectionSourceTool,
    'polygonal-lasso' | 'freehand-lasso' | 'feather-magnetic-lasso' | 'magic-wand'
  >;
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
    metadata,
  };
}

export function normalizeRectangleSelectionRect(
  rect: RectXYSorted,
  imageSize: Size
): Pick<Selection, 'points' | 'pos'> | null {
  const { x, y, width, height } = trimRect(sortRect(rect), imageSize);
  if (width <= 0 || height <= 0) return null;

  return {
    pos: { x, y, width, height },
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  };
}

export function createCommittedRectangleSelection({
  id,
  rect,
  imageSize,
  metadata,
}: {
  id: string;
  rect: RectXYSorted;
  imageSize: Size;
  metadata?: Selection['metadata'];
}): Selection | null {
  const normalized = normalizeRectangleSelectionRect(rect, imageSize);
  if (!normalized) return null;

  return {
    id,
    ...normalized,
    isActive: true,
    lifecycle: 'committed',
    geometry: 'rectangle',
    sourceTool: 'rectangular-selection',
    metadata,
  };
}

export function getSelectionRect(selection: Selection): RectXYSorted {
  return posToSortedRect(selection.pos);
}

export function getActiveSelection(selections: Selection[], activeSelectionId: string | null): Selection | null {
  return (
    selections.find((selection) => selection.id === activeSelectionId) ??
    selections.find((selection) => selection.isActive) ??
    null
  );
}

export function getActiveRectangularSelection(
  selections: Selection[],
  activeSelectionId: string | null
): Selection | null {
  const activeSelection = getActiveSelection(selections, activeSelectionId);

  return activeSelection?.geometry === 'rectangle' ? activeSelection : null;
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

  if (selection.sourceTool !== 'freehand-lasso' && selection.sourceTool !== 'magic-wand') {
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
  }

  ctx.restore();
}

export function distanceBetweenPoints(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function findSelectionAnchorAtPoint(selection: Selection, point: Point): number | null {
  if (selection.sourceTool === 'freehand-lasso' || selection.sourceTool === 'magic-wand') return null;

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
      pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;

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

  if (selection.geometry === 'rectangle') {
    const pos = pointsBoundingPos({ points, lineWidth: 0 });

    return {
      ...selection,
      pos,
      points: [
        { x: 0, y: 0 },
        { x: pos.width, y: 0 },
        { x: pos.width, y: pos.height },
        { x: 0, y: pos.height },
      ],
      metadata: {
        ...selection.metadata,
        movedAtVersion: (selection.metadata?.movedAtVersion ?? 0) + 1,
      },
    };
  }

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

export type ClipboardCanvas = OffscreenCanvas | HTMLCanvasElement;

export type SelectionCanvasSnapshot = {
  bitmap: ClipboardCanvas;
  pos: Pos;
};

function createSelectionCanvas(width: number, height: number): ClipboardCanvas {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(safeWidth, safeHeight);
  }

  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;

  return canvas;
}

function getSelectionCanvasContext(canvas: ClipboardCanvas): Ctx2D | null {
  return canvas.getContext('2d') as Ctx2D | null;
}

function drawPolygonPath(ctx: Ctx2D, points: Point[]): void {
  if (points.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function getSelectionCanvasBounds(points: Point[], padding = 0, imageSize?: Size): Pos | null {
  if (points.length === 0) return null;

  const bounds = pointsBoundingPos({ points, lineWidth: padding });
  let minX = Math.floor(bounds.x);
  let minY = Math.floor(bounds.y);
  let maxX = Math.ceil(bounds.x + bounds.width);
  let maxY = Math.ceil(bounds.y + bounds.height);

  if (imageSize) {
    minX = Math.max(0, minX);
    minY = Math.max(0, minY);
    maxX = Math.min(imageSize.width, maxX);
    maxY = Math.min(imageSize.height, maxY);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;

  return { x: minX, y: minY, width, height };
}

export function cloneBitmapToCanvas(source: BitmapSource): ClipboardCanvas {
  const destCanvas = createSelectionCanvas(source.width, source.height);
  const ctx = getSelectionCanvasContext(destCanvas)!;

  ctx.drawImage(source as CanvasImageSource, 0, 0);

  return destCanvas;
}

export function copyPolygonSelectionToCanvas(
  sourceCanvas: BitmapSource,
  points: Point[],
  { imageSize }: { imageSize?: Size } = {}
): SelectionCanvasSnapshot | null {
  if (points.length < 3) return null;

  const bounds = getSelectionCanvasBounds(points, 0, imageSize);
  if (!bounds) return null;

  const destCanvas = createSelectionCanvas(bounds.width, bounds.height);
  const { x: minX, y: minY } = bounds;

  const ctx = getSelectionCanvasContext(destCanvas)!;
  ctx.save();

  // Build polygon path relative to new canvas
  drawPolygonPath(
    ctx,
    points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  );

  // Clip drawing to polygon
  // Note: Self-intersecting polygons are handled gracefully using the non-zero winding rule.
  // The clipping will simply exclude regions based on the winding number, which prevents crashes.
  ctx.clip();

  // Draw source canvas shifted so polygon aligns
  ctx.drawImage(sourceCanvas as CanvasImageSource, -minX, -minY);

  ctx.restore();

  return { bitmap: destCanvas, pos: bounds };
}

export function copyPolygonToCanvas(sourceCanvas: BitmapSource, points: Point[]): ClipboardCanvas {
  return copyPolygonSelectionToCanvas(sourceCanvas, points)?.bitmap ?? createSelectionCanvas(1, 1);
}

function rasterizePolygonMask(points: Point[], width: number, height: number): Uint8Array {
  const canvas = createSelectionCanvas(width, height);
  const ctx = getSelectionCanvasContext(canvas);

  if (ctx) {
    try {
      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'black';
      drawPolygonPath(ctx, points);
      ctx.fill();
      ctx.restore();

      const imageData = ctx.getImageData(0, 0, width, height);
      const mask = new Uint8Array(width * height);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = imageData.data[i * 4 + 3] > 0 ? 1 : 0;
      }

      return mask;
    } catch {
      // Fall through to CPU rasterization for tests and reduced canvas environments.
    }
  }

  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mask[y * width + x] = isPointInPolygon({ x: x + 0.5, y: y + 0.5 }, points) ? 1 : 0;
    }
  }

  return mask;
}

function chamferDistanceFromSeeds(seedMask: Uint8Array, width: number, height: number): Float32Array {
  const distance = new Float32Array(width * height);
  const infinity = 1_000_000;

  for (let i = 0; i < distance.length; i++) {
    distance[i] = seedMask[i] ? 0 : infinity;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let best = distance[index];

      if (x > 0) best = Math.min(best, distance[index - 1] + 1);
      if (y > 0) best = Math.min(best, distance[index - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distance[index - width - 1] + Math.SQRT2);
      if (x < width - 1 && y > 0) best = Math.min(best, distance[index - width + 1] + Math.SQRT2);

      distance[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;
      let best = distance[index];

      if (x < width - 1) best = Math.min(best, distance[index + 1] + 1);
      if (y < height - 1) best = Math.min(best, distance[index + width] + 1);
      if (x < width - 1 && y < height - 1) best = Math.min(best, distance[index + width + 1] + Math.SQRT2);
      if (x > 0 && y < height - 1) best = Math.min(best, distance[index + width - 1] + Math.SQRT2);

      distance[index] = best;
    }
  }

  return distance;
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

export function alphaFromSignedDistance(signedDistance: number, featherRadius: number, antiAlias = true): number {
  const safeFeatherRadius = Math.max(0, featherRadius);

  if (safeFeatherRadius === 0) {
    if (!antiAlias) return signedDistance > 0 ? 255 : 0;

    return Math.round(Math.max(0, Math.min(1, signedDistance + 0.5)) * 255);
  }

  const t = Math.max(0, Math.min(1, (signedDistance + safeFeatherRadius) / (safeFeatherRadius * 2)));

  return Math.round(smoothStep(t) * 255);
}

export function createFeatheredAlphaMask(
  binaryMask: Uint8Array,
  width: number,
  height: number,
  featherRadius: number,
  antiAlias = true
): Uint8Array {
  const outsideSeeds = new Uint8Array(binaryMask.length);
  const insideSeeds = new Uint8Array(binaryMask.length);

  for (let i = 0; i < binaryMask.length; i++) {
    insideSeeds[i] = binaryMask[i];
    outsideSeeds[i] = binaryMask[i] ? 0 : 1;
  }

  const distanceToOutside = chamferDistanceFromSeeds(outsideSeeds, width, height);
  const distanceToInside = chamferDistanceFromSeeds(insideSeeds, width, height);
  const alphaMask = new Uint8Array(binaryMask.length);

  for (let i = 0; i < binaryMask.length; i++) {
    const signedDistance = binaryMask[i] ? distanceToOutside[i] : -distanceToInside[i];
    alphaMask[i] = alphaFromSignedDistance(signedDistance, featherRadius, antiAlias);
  }

  return alphaMask;
}

export function copyFeatheredPolygonToCanvas(
  sourceCanvas: BitmapSource,
  points: Point[],
  {
    antiAlias = true,
    featherRadius = 0,
    imageSize,
  }: {
    antiAlias?: boolean;
    featherRadius?: number;
    imageSize?: Size;
  } = {}
): ClipboardCanvas {
  return (
    copyFeatheredPolygonSelectionToCanvas(sourceCanvas, points, {
      antiAlias,
      featherRadius,
      imageSize,
    })?.bitmap ?? createSelectionCanvas(1, 1)
  );
}

export function copyFeatheredPolygonSelectionToCanvas(
  sourceCanvas: BitmapSource,
  points: Point[],
  {
    antiAlias = true,
    featherRadius = 0,
    imageSize,
  }: {
    antiAlias?: boolean;
    featherRadius?: number;
    imageSize?: Size;
  } = {}
): SelectionCanvasSnapshot | null {
  if (points.length < 3) {
    return null;
  }

  const padding = Math.max(antiAlias ? 1 : 0, Math.ceil(featherRadius));
  const bounds = getSelectionCanvasBounds(points, padding, imageSize);
  if (!bounds) return null;

  const { x, y, width, height } = bounds;
  const relativePoints = points.map((point) => ({ x: point.x - x, y: point.y - y }));
  const destCanvas = createSelectionCanvas(width, height);
  const ctx = getSelectionCanvasContext(destCanvas)!;

  ctx.drawImage(sourceCanvas as CanvasImageSource, x, y, width, height, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = rasterizePolygonMask(relativePoints, width, height);
  const alphaMask = createFeatheredAlphaMask(mask, width, height, featherRadius, antiAlias);

  for (let i = 0; i < alphaMask.length; i++) {
    const alphaIndex = i * 4 + 3;
    imageData.data[alphaIndex] = Math.round((imageData.data[alphaIndex] * alphaMask[i]) / 255);
  }

  ctx.putImageData(imageData, 0, 0);

  return { bitmap: destCanvas, pos: bounds };
}

export function copyRectSelectionToCanvas(
  sourceCanvas: BitmapSource,
  rect: RectXYSorted,
  imageSize: Size
): SelectionCanvasSnapshot | null {
  const { x, y, width, height } = trimRect(sortRect(rect), imageSize);
  if (width <= 0 || height <= 0) return null;

  const destCanvas = createSelectionCanvas(width, height);
  const ctx = getSelectionCanvasContext(destCanvas)!;
  ctx.drawImage(sourceCanvas as CanvasImageSource, x, y, width, height, 0, 0, width, height);

  return { bitmap: destCanvas, pos: { x, y, width, height } };
}

export function copySelectionToCanvas(
  sourceCanvas: BitmapSource | null | undefined,
  selection: Selection,
  imageSize: Size
): SelectionCanvasSnapshot | null {
  if (!sourceCanvas) return null;

  if (selection.geometry === 'rectangle') {
    return copyRectSelectionToCanvas(sourceCanvas, getSelectionRect(selection), imageSize);
  }

  const points = getSelectionAbsolutePoints(selection);
  if (selection.sourceTool === 'feather-magnetic-lasso') {
    return copyFeatheredPolygonSelectionToCanvas(sourceCanvas, points, {
      antiAlias: selection.metadata?.magneticLasso?.antiAlias ?? true,
      featherRadius: selection.metadata?.featherRadius ?? 0,
      imageSize,
    });
  }

  return copyPolygonSelectionToCanvas(sourceCanvas, points, { imageSize });
}

function canvasToBlob(canvas: ClipboardCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to serialize canvas'));
      }
    }, 'image/png');
  });
}

export async function copyCanvasToClipboard(canvas: ClipboardCanvas): Promise<void> {
  try {
    const blob = await canvasToBlob(canvas);
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
