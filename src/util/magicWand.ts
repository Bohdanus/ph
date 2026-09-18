import type { Point, Pos } from '../contexts/general-types.ts';
import { simplifyPath } from './magneticLasso.ts';

const MAX_COLOR_DISTANCE = Math.sqrt(255 * 255 * 4);

export type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type MagicWandSelectionOptions = {
  tolerance?: number;
  smoothing?: number;
  contiguous?: boolean;
};

export type MagicWandSelectionResult = {
  points: Point[];
  selectedPixelCount: number;
  sampleColor: RgbaColor;
  bounds: Pos;
};

type MaskResult = {
  mask: Uint8Array;
  selectedPixelCount: number;
  sampleColor: RgbaColor;
  bounds: Pos;
};

type DirectedEdge = {
  start: Point;
  end: Point;
  key: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

function getPixelColor(data: Uint8ClampedArray, pixelIndex: number): RgbaColor {
  const dataIndex = pixelIndex * 4;

  return {
    r: data[dataIndex],
    g: data[dataIndex + 1],
    b: data[dataIndex + 2],
    a: data[dataIndex + 3],
  };
}

export function getMagicWandColorDistance(a: RgbaColor, b: RgbaColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = a.a - b.a;

  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

function getToleranceDistance(tolerance: number): number {
  return (clamp(tolerance, 0, 100) / 100) * MAX_COLOR_DISTANCE;
}

function isPixelWithinTolerance(
  data: Uint8ClampedArray,
  pixelIndex: number,
  sampleColor: RgbaColor,
  tolerance: number
) {
  return getMagicWandColorDistance(getPixelColor(data, pixelIndex), sampleColor) <= tolerance;
}

function createEmptyBounds(): Pos {
  return { x: 0, y: 0, width: 0, height: 0 };
}

function finalizeBounds(minX: number, minY: number, maxX: number, maxY: number): Pos {
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return createEmptyBounds();
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function createAllMatchingMask(imageData: ImageData, sampleColor: RgbaColor, tolerance: number): MaskResult {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let selectedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = getIndex(x, y, width);
      if (!isPixelWithinTolerance(data, index, sampleColor, tolerance)) continue;

      mask[index] = 1;
      selectedPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return { mask, selectedPixelCount, sampleColor, bounds: finalizeBounds(minX, minY, maxX, maxY) };
}

function createContiguousMask(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  sampleColor: RgbaColor,
  tolerance: number
): MaskResult {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  let selectedPixelCount = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const seedIndex = getIndex(seedX, seedY, width);

  queue[queueEnd++] = seedIndex;
  visited[seedIndex] = 1;

  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    if (!isPixelWithinTolerance(data, index, sampleColor, tolerance)) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    mask[index] = 1;
    selectedPixelCount += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    if (x > 0) queueEnd = enqueuePixel(index - 1, visited, queue, queueEnd);
    if (x < width - 1) queueEnd = enqueuePixel(index + 1, visited, queue, queueEnd);
    if (y > 0) queueEnd = enqueuePixel(index - width, visited, queue, queueEnd);
    if (y < height - 1) queueEnd = enqueuePixel(index + width, visited, queue, queueEnd);
  }

  return { mask, selectedPixelCount, sampleColor, bounds: finalizeBounds(minX, minY, maxX, maxY) };
}

function enqueuePixel(index: number, visited: Uint8Array, queue: Int32Array, queueEnd: number): number {
  if (visited[index]) return queueEnd;

  visited[index] = 1;
  queue[queueEnd] = index;
  return queueEnd + 1;
}

function getVertexKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function getEdgeKey(start: Point, end: Point): string {
  return `${getVertexKey(start)}>${getVertexKey(end)}`;
}

function addEdge(edges: DirectedEdge[], startMap: Map<string, DirectedEdge[]>, start: Point, end: Point) {
  const edge = { start, end, key: getEdgeKey(start, end) };
  const startKey = getVertexKey(start);
  edges.push(edge);
  startMap.set(startKey, [...(startMap.get(startKey) ?? []), edge]);
}

function isMaskSelected(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && mask[getIndex(x, y, width)] === 1;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function getPolygonArea(points: Point[]): number {
  let area = 0;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }

  return area / 2;
}

function traceBoundaryLoops(edges: DirectedEdge[], startMap: Map<string, DirectedEdge[]>): Point[][] {
  const unusedEdgeKeys = new Set(edges.map((edge) => edge.key));
  const loops: Point[][] = [];

  for (const firstEdge of edges) {
    if (!unusedEdgeKeys.has(firstEdge.key)) continue;

    const loop: Point[] = [firstEdge.start];
    let currentEdge: DirectedEdge | null = firstEdge;
    let guard = 0;

    while (currentEdge && guard <= edges.length + 1) {
      guard += 1;
      unusedEdgeKeys.delete(currentEdge.key);
      loop.push(currentEdge.end);

      if (samePoint(currentEdge.end, loop[0])) break;

      const candidates: DirectedEdge[] = (startMap.get(getVertexKey(currentEdge.end)) ?? []).filter((edge) =>
        unusedEdgeKeys.has(edge.key)
      );
      currentEdge = candidates[0] ?? null;
    }

    if (loop.length >= 4 && samePoint(loop[0], loop[loop.length - 1])) {
      loops.push(loop.slice(0, -1));
    }
  }

  return loops;
}

function createBoundaryLoops(mask: Uint8Array, width: number, height: number, bounds: Pos): Point[][] {
  const edges: DirectedEdge[] = [];
  const startMap = new Map<string, DirectedEdge[]>();
  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width - 1;
  const maxY = bounds.y + bounds.height - 1;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isMaskSelected(mask, width, height, x, y)) continue;

      if (!isMaskSelected(mask, width, height, x, y - 1)) {
        addEdge(edges, startMap, { x, y }, { x: x + 1, y });
      }
      if (!isMaskSelected(mask, width, height, x + 1, y)) {
        addEdge(edges, startMap, { x: x + 1, y }, { x: x + 1, y: y + 1 });
      }
      if (!isMaskSelected(mask, width, height, x, y + 1)) {
        addEdge(edges, startMap, { x: x + 1, y: y + 1 }, { x, y: y + 1 });
      }
      if (!isMaskSelected(mask, width, height, x - 1, y)) {
        addEdge(edges, startMap, { x, y: y + 1 }, { x, y });
      }
    }
  }

  return traceBoundaryLoops(edges, startMap);
}

function selectLargestBoundaryLoop(loops: Point[][]): Point[] {
  let bestLoop: Point[] = [];
  let bestArea = 0;

  for (const loop of loops) {
    const area = Math.abs(getPolygonArea(loop));
    if (area <= bestArea) continue;

    bestLoop = loop;
    bestArea = area;
  }

  return bestLoop;
}

function simplifyClosedPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 3 || tolerance <= 0) return points;

  const closedPoints = [...points, points[0]];
  const simplified = simplifyPath(closedPoints, tolerance);
  const lastPoint = simplified[simplified.length - 1];
  const result = lastPoint && samePoint(simplified[0], lastPoint) ? simplified.slice(0, -1) : simplified;

  return result.length >= 3 ? result : points;
}

export function createMagicWandSelectionFromImageData(
  imageData: ImageData,
  seed: Point,
  options: MagicWandSelectionOptions = {}
): MagicWandSelectionResult | null {
  const { data, width, height } = imageData;
  if (width <= 0 || height <= 0) return null;

  const seedX = Math.floor(seed.x);
  const seedY = Math.floor(seed.y);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return null;

  const sampleColor = getPixelColor(data, getIndex(seedX, seedY, width));
  const tolerance = getToleranceDistance(options.tolerance ?? 0);
  const maskResult =
    options.contiguous === false
      ? createAllMatchingMask(imageData, sampleColor, tolerance)
      : createContiguousMask(imageData, seedX, seedY, sampleColor, tolerance);

  if (maskResult.selectedPixelCount === 0) return null;

  const loops = createBoundaryLoops(maskResult.mask, width, height, maskResult.bounds);
  const boundaryPoints = selectLargestBoundaryLoop(loops);
  if (boundaryPoints.length < 3) return null;

  const points = simplifyClosedPath(boundaryPoints, options.smoothing ?? 0);
  if (points.length < 3) return null;

  return {
    points,
    selectedPixelCount: maskResult.selectedPixelCount,
    sampleColor: maskResult.sampleColor,
    bounds: maskResult.bounds,
  };
}

export function createMagicWandSelectionFromCanvas(
  canvas: HTMLCanvasElement | null,
  seed: Point,
  options: MagicWandSelectionOptions = {}
): MagicWandSelectionResult | null {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  try {
    return createMagicWandSelectionFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), seed, options);
  } catch {
    return null;
  }
}
