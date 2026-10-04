/**
 * The Magic Wand is the polygon layer over a region fill, and it is the only thing left here.
 * The fill itself -- the tolerance mapping, the colour metric, and the 4-neighbour and global
 * mask builders -- moved to `./flood-fill.ts`, because a Paint Bucket needs the mask with no
 * outline at all and a Quick Selection needs to re-seed the same growth along a stroke, and
 * neither can be served by a traced polygon. What follows turns a mask into a single closed
 * point path, which is the part that was always specific to the wand.
 */
import type { Point, Pos } from '../contexts/general-types.ts';
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
  points: Point[];
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

type ClassifiedBoundaryLoops = {
  outer: Point[][];
  holes: Point[][];
};

/**
 * Splits traced loops by winding direction, which is the only signal distinguishing an enclosed
 * hole from a disjoint sibling region. `createBoundaryLoops` emits a directed edge for every
 * selected/unselected adjacency (top->right, right->down, bottom->left, left->up), so an outer
 * contour and the hole it encloses come out with opposite signed areas, while two disjoint
 * regions are two independent outer contours and share a sign. Discarding the sign is what let a
 * hole's loop lose to the outer loop on magnitude and then get dropped on the floor.
 */
function classifyBoundaryLoops(loops: Point[][]): ClassifiedBoundaryLoops {
  const signed = loops.map((loop) => ({ loop, area: getPolygonArea(loop) }));
  const outer = signed.filter((entry) => entry.area > 0);
  const holes = signed.filter((entry) => entry.area <= 0);

  return { outer: outer.map((entry) => entry.loop), holes: holes.map((entry) => entry.loop) };
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
  const { outer, holes } = classifyBoundaryLoops(loops);
  const boundaryPoints = selectLargestBoundaryLoop(outer);
  if (boundaryPoints.length < 3) return null;
  // `Selection` carries a single point path, so an enclosed hole cannot be represented: committing
  // the outer contour alone would cover pixels this mask reported as unselected, and would make
  // `selectedPixelCount` under-report the committed polygon's area. Refuse the selection instead,
  // which the caller already handles as a cancelled selection draft.
  if (holes.length > 0) return null;

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
  } catch (error) {
    // `getImageData` throws on a tainted or zero-area canvas, and the caller
    // (`MagicWandToolArea.tsx:58`) reads `null` as "no selection", so a failure
    // here is a click that selects nothing and says nothing. HANDOFF.md §98: the
    // console is the only error channel, so the null is not the report. One line
    // per click, and a click is one user intent.
    console.error(error);
    return null;
  }
}
