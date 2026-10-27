/**
 * The Magic Wand is the polygon layer over a region fill, and it is the only thing left here.
 * The fill itself -- the tolerance mapping, the colour metric, and the 4-neighbour and global
 * mask builders -- moved to `./flood-fill.ts`, because a Paint Bucket needs the mask with no
 * outline at all and a Quick Selection needs to re-seed the same growth along a stroke, and
 * neither can be served by a traced polygon. What follows turns a mask into an even-odd set of
 * closed point paths, which is the part that was always specific to the wand.
 */
import type { Point, Pos, RasterSelectionMask, Size } from '../contexts/general-types.ts';
import {
  createAllMatchingMask,
  createContiguousMask,
  getIndex,
  getMagicWandColorDistance,
  getPixelColor,
  getToleranceDistance,
  type RgbaColor,
} from './flood-fill.ts';
import { simplifyPath } from './magneticLasso.ts';
import {
  countSelectionBoundaryEdges,
  encodeRasterSelectionMask,
  isRasterSelectionSizeWithinBudget,
  MAX_VECTOR_SELECTION_BOUNDARY_EDGES,
} from './selection-mask.ts';
import { readCanvasImageDataAtLogicalSize } from './canvas-image-data.ts';

// The colour metric and its colour type now live in `flood-fill.ts` alongside the fill that
// consumes them, so that a Paint Bucket or a Quick Selection can reach them without importing
// the polygon tracer. Re-exported here because `getMagicWandColorDistance` and `RgbaColor`
// have been part of this module's public surface, and its consumers -- the existing test
// suite included -- import them by this name.
export { getMagicWandColorDistance, type RgbaColor };

export type MagicWandSelectionOptions = {
  tolerance?: number;
  smoothing?: number;
  contiguous?: boolean;
};

export type MagicWandSelectionResult = {
  /** Every boundary loop in the matched region, including enclosed holes. */
  points: Point[][];
  /** Exact packed pixels when tracing the boundary would create an unsafe number of vector points. */
  rasterMask?: RasterSelectionMask;
  /** Exact exposed edge count up to the limit; larger counts return the limit plus one sentinel. */
  boundaryEdgeCount: number;
  selectedPixelCount: number;
  sampleColor: RgbaColor;
  bounds: Pos;
};

type DirectedEdge = {
  start: Point;
  end: Point;
  key: string;
};

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
  const { width, height } = imageData;
  if (width <= 0 || height <= 0 || !isRasterSelectionSizeWithinBudget(width, height)) return null;

  const { data } = imageData;

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

  const boundaryEdgeCount = countSelectionBoundaryEdges(maskResult.mask, width, height, maskResult.bounds);
  if (boundaryEdgeCount > MAX_VECTOR_SELECTION_BOUNDARY_EDGES) {
    const rasterMask = encodeRasterSelectionMask(maskResult.mask, width, height, maskResult.bounds);
    if (!rasterMask) return null;

    return {
      points: [],
      rasterMask,
      boundaryEdgeCount,
      selectedPixelCount: maskResult.selectedPixelCount,
      sampleColor: maskResult.sampleColor,
      bounds: maskResult.bounds,
    };
  }

  const loops = createBoundaryLoops(maskResult.mask, width, height, maskResult.bounds);
  const points = loops
    .map((contour) => simplifyClosedPath(contour, options.smoothing ?? 0))
    .filter((contour) => contour.length >= 3);
  if (points.length === 0) return null;

  return {
    points,
    boundaryEdgeCount,
    selectedPixelCount: maskResult.selectedPixelCount,
    sampleColor: maskResult.sampleColor,
    bounds: maskResult.bounds,
  };
}

export function createMagicWandSelectionFromCanvas(
  canvas: HTMLCanvasElement | null,
  seed: Point,
  logicalSize: Size,
  options: MagicWandSelectionOptions = {}
): MagicWandSelectionResult | null {
  const imageData = readCanvasImageDataAtLogicalSize(canvas, logicalSize);
  return imageData ? createMagicWandSelectionFromImageData(imageData, seed, options) : null;
}
