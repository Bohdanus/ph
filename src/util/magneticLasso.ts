import type { Point } from '../contexts/general-types.ts';
import { distanceBetweenPoints } from './selection.ts';

const MAX_MAGNETIC_PATH_AREA = 32_000;
const LINE_SAMPLE_STEP = 2;

export type EdgeMap = {
  width: number;
  height: number;
  luma: Float32Array;
  gradientMagnitude: Float32Array;
  gradientDirection: Float32Array;
  maxGradient: number;
};

export type MagneticPathOptions = {
  searchRadius: number;
  edgeContrast: number;
  snapStrength: number;
  maxArea?: number;
};

export type MagneticSnapResult = {
  point: Point;
  confidence: number;
  gradient: number;
  usedMagnetic: boolean;
};

export type MagneticSegmentResult = {
  path: Point[];
  snappedPoint: Point;
  snap: MagneticSnapResult;
};

type HeapNode = {
  index: number;
  priority: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function getIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function heapPush(heap: HeapNode[], node: HeapNode): void {
  heap.push(node);

  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex].priority <= node.priority) break;

    heap[index] = heap[parentIndex];
    index = parentIndex;
  }

  heap[index] = node;
}

function heapPop(heap: HeapNode[]): HeapNode | null {
  if (heap.length === 0) return null;

  const result = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return result;

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= heap.length) break;

    const smallerChildIndex =
      rightIndex < heap.length && heap[rightIndex].priority < heap[leftIndex].priority ? rightIndex : leftIndex;

    if (heap[smallerChildIndex].priority >= last.priority) break;

    heap[index] = heap[smallerChildIndex];
    index = smallerChildIndex;
  }

  heap[index] = last;

  return result;
}

function dedupeSequentialPoints(points: Point[]): Point[] {
  if (points.length < 2) return points;

  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const previous = result[result.length - 1];
    const current = points[i];
    if (Math.round(previous.x) !== Math.round(current.x) || Math.round(previous.y) !== Math.round(current.y)) {
      result.push(current);
    }
  }

  return result;
}

export function createEdgeMapFromCanvas(canvas: HTMLCanvasElement | null): EdgeMap | null {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    return createEdgeMapFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } catch {
    return null;
  }
}

export function createEdgeMapFromImageData(imageData: ImageData): EdgeMap {
  const { width, height, data } = imageData;
  const luma = new Float32Array(width * height);
  const gradientMagnitude = new Float32Array(width * height);
  const gradientDirection = new Float32Array(width * height);
  let maxGradient = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dataIndex = getIndex(x, y, width) * 4;
      const alpha = data[dataIndex + 3] / 255;
      const rgbLuma = data[dataIndex] * 0.2126 + data[dataIndex + 1] * 0.7152 + data[dataIndex + 2] * 0.0722;
      luma[getIndex(x, y, width)] = rgbLuma * alpha + 255 * (1 - alpha);
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const topLeft = luma[getIndex(x - 1, y - 1, width)];
      const top = luma[getIndex(x, y - 1, width)];
      const topRight = luma[getIndex(x + 1, y - 1, width)];
      const left = luma[getIndex(x - 1, y, width)];
      const right = luma[getIndex(x + 1, y, width)];
      const bottomLeft = luma[getIndex(x - 1, y + 1, width)];
      const bottom = luma[getIndex(x, y + 1, width)];
      const bottomRight = luma[getIndex(x + 1, y + 1, width)];

      const gx = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      const index = getIndex(x, y, width);

      gradientMagnitude[index] = magnitude;
      gradientDirection[index] = Math.atan2(gy, gx);
      maxGradient = Math.max(maxGradient, magnitude);
    }
  }

  return { width, height, luma, gradientMagnitude, gradientDirection, maxGradient };
}

export function clampPointToEdgeMap(edgeMap: EdgeMap, point: Point): Point {
  return {
    x: clamp(point.x, 0, Math.max(0, edgeMap.width - 1)),
    y: clamp(point.y, 0, Math.max(0, edgeMap.height - 1)),
  };
}

export function findStrongestGradientPoint(
  edgeMap: EdgeMap,
  point: Point,
  radius: number,
  edgeContrast: number,
  snapStrength: number
): MagneticSnapResult {
  const clampedPoint = clampPointToEdgeMap(edgeMap, point);
  const center = roundPoint(clampedPoint);
  const safeRadius = Math.max(0, Math.round(radius));
  const safeSnapStrength = clamp(snapStrength, 0, 1);
  const contrastThreshold = edgeMap.maxGradient * clamp(edgeContrast, 0, 100) * 0.003;
  let bestPoint = center;
  let bestGradient = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  if (safeRadius === 0 || safeSnapStrength === 0 || edgeMap.maxGradient <= 0) {
    return { point: clampedPoint, confidence: 0, gradient: 0, usedMagnetic: false };
  }

  const minX = Math.max(0, center.x - safeRadius);
  const maxX = Math.min(edgeMap.width - 1, center.x + safeRadius);
  const minY = Math.max(0, center.y - safeRadius);
  const maxY = Math.min(edgeMap.height - 1, center.y + safeRadius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - clampedPoint.x;
      const dy = y - clampedPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > safeRadius) continue;

      const gradient = edgeMap.gradientMagnitude[getIndex(x, y, edgeMap.width)];
      const distancePenalty = safeRadius > 0 ? distance / safeRadius : 0;
      const score = gradient * (1 - distancePenalty * 0.35);

      if (score > bestScore) {
        bestScore = score;
        bestGradient = gradient;
        bestPoint = { x, y };
      }
    }
  }

  if (bestGradient < contrastThreshold) {
    return { point: clampedPoint, confidence: 0, gradient: bestGradient, usedMagnetic: false };
  }

  const snappedPoint = {
    x: clampedPoint.x + (bestPoint.x - clampedPoint.x) * safeSnapStrength,
    y: clampedPoint.y + (bestPoint.y - clampedPoint.y) * safeSnapStrength,
  };
  const confidence = clamp(bestGradient / Math.max(contrastThreshold, 1), 0, 1);

  return { point: snappedPoint, confidence, gradient: bestGradient, usedMagnetic: true };
}

export function sampleLinePath(from: Point, to: Point, maxStep = LINE_SAMPLE_STEP): Point[] {
  const distance = distanceBetweenPoints(from, to);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const result: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    result.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  }

  return result;
}

export function pathLength(points: Point[]): number {
  let length = 0;

  for (let i = 1; i < points.length; i++) {
    length += distanceBetweenPoints(points[i - 1], points[i]);
  }

  return length;
}

export function findMagneticPath(edgeMap: EdgeMap, from: Point, to: Point, options: MagneticPathOptions): Point[] {
  const start = roundPoint(clampPointToEdgeMap(edgeMap, from));
  const end = roundPoint(clampPointToEdgeMap(edgeMap, to));
  const searchRadius = Math.max(4, Math.round(options.searchRadius));
  const minX = Math.max(0, Math.min(start.x, end.x) - searchRadius);
  const minY = Math.max(0, Math.min(start.y, end.y) - searchRadius);
  const maxX = Math.min(edgeMap.width - 1, Math.max(start.x, end.x) + searchRadius);
  const maxY = Math.min(edgeMap.height - 1, Math.max(start.y, end.y) + searchRadius);
  const localWidth = maxX - minX + 1;
  const localHeight = maxY - minY + 1;
  const area = localWidth * localHeight;

  if (area > (options.maxArea ?? MAX_MAGNETIC_PATH_AREA) || edgeMap.maxGradient <= 0) {
    return sampleLinePath(start, end);
  }

  const startIndex = getIndex(start.x - minX, start.y - minY, localWidth);
  const endIndex = getIndex(end.x - minX, end.y - minY, localWidth);
  const openHeap: HeapNode[] = [];
  const costs = new Float32Array(area);
  const cameFrom = new Int32Array(area);
  const visited = new Uint8Array(area);
  const edgeWeight = 2 + clamp(options.edgeContrast, 0, 100) * 0.08;
  const directions = [
    { dx: -1, dy: -1, step: Math.SQRT2 },
    { dx: 0, dy: -1, step: 1 },
    { dx: 1, dy: -1, step: Math.SQRT2 },
    { dx: -1, dy: 0, step: 1 },
    { dx: 1, dy: 0, step: 1 },
    { dx: -1, dy: 1, step: Math.SQRT2 },
    { dx: 0, dy: 1, step: 1 },
    { dx: 1, dy: 1, step: Math.SQRT2 },
  ];

  costs.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(-1);
  costs[startIndex] = 0;
  heapPush(openHeap, { index: startIndex, priority: 0 });

  const heuristic = (index: number) => {
    const x = index % localWidth;
    const y = Math.floor(index / localWidth);
    const dx = x - (end.x - minX);
    const dy = y - (end.y - minY);
    return Math.sqrt(dx * dx + dy * dy);
  };

  const nodeCost = (localX: number, localY: number) => {
    const gradient = edgeMap.gradientMagnitude[getIndex(localX + minX, localY + minY, edgeMap.width)];
    const normalizedGradient = edgeMap.maxGradient > 0 ? gradient / edgeMap.maxGradient : 0;
    return 1 + (1 - normalizedGradient) * edgeWeight;
  };

  while (openHeap.length > 0) {
    const current = heapPop(openHeap)!;
    if (visited[current.index]) continue;
    if (current.index === endIndex) break;

    visited[current.index] = 1;
    const currentX = current.index % localWidth;
    const currentY = Math.floor(current.index / localWidth);

    for (const direction of directions) {
      const nextX = currentX + direction.dx;
      const nextY = currentY + direction.dy;
      if (nextX < 0 || nextY < 0 || nextX >= localWidth || nextY >= localHeight) continue;

      const nextIndex = getIndex(nextX, nextY, localWidth);
      if (visited[nextIndex]) continue;

      const nextCost = costs[current.index] + direction.step * nodeCost(nextX, nextY);
      if (nextCost >= costs[nextIndex]) continue;

      costs[nextIndex] = nextCost;
      cameFrom[nextIndex] = current.index;
      heapPush(openHeap, { index: nextIndex, priority: nextCost + heuristic(nextIndex) });
    }
  }

  if (!Number.isFinite(costs[endIndex])) {
    return sampleLinePath(start, end);
  }

  const result: Point[] = [];
  let cursor = endIndex;
  while (cursor !== -1) {
    result.push({ x: (cursor % localWidth) + minX, y: Math.floor(cursor / localWidth) + minY });
    if (cursor === startIndex) break;
    cursor = cameFrom[cursor];
  }

  return dedupeSequentialPoints(result.reverse());
}

export function createMagneticSegment({
  edgeMap,
  from,
  cursor,
  options,
  magneticEnabled = true,
}: {
  edgeMap: EdgeMap | null;
  from: Point;
  cursor: Point;
  options: MagneticPathOptions;
  magneticEnabled?: boolean;
}): MagneticSegmentResult {
  const snap =
    edgeMap && magneticEnabled
      ? findStrongestGradientPoint(edgeMap, cursor, options.searchRadius, options.edgeContrast, options.snapStrength)
      : { point: cursor, confidence: 0, gradient: 0, usedMagnetic: false };
  const path =
    edgeMap && magneticEnabled && snap.usedMagnetic
      ? findMagneticPath(edgeMap, from, snap.point, options)
      : sampleLinePath(from, snap.point);

  return { path, snappedPoint: snap.point, snap };
}

function getSquaredSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;

  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  const x = a.x + dx * t;
  const y = a.y + dy * t;

  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

export function simplifyPath(points: Point[], tolerance: number): Point[] {
  const dedupedPoints = dedupeSequentialPoints(points);
  if (dedupedPoints.length <= 2 || tolerance <= 0) return dedupedPoints;

  const toleranceSquared = tolerance * tolerance;
  const keep = new Uint8Array(dedupedPoints.length);
  const stack: Array<[number, number]> = [[0, dedupedPoints.length - 1]];
  keep[0] = 1;
  keep[dedupedPoints.length - 1] = 1;

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let farthestIndex = -1;
    let farthestDistance = -1;

    for (let i = startIndex + 1; i < endIndex; i++) {
      const distance = getSquaredSegmentDistance(dedupedPoints[i], dedupedPoints[startIndex], dedupedPoints[endIndex]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = i;
      }
    }

    if (farthestIndex !== -1 && farthestDistance > toleranceSquared) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return dedupedPoints.filter((_point, index) => keep[index]);
}
