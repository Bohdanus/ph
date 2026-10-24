import type {
  Point,
  Pos,
  RasterSelectionMask,
  Selection,
  SelectionPointPaths,
  Size,
} from '../contexts/general-types.ts';
import {
  appendBrushDabCenters,
  brushDabCenters,
  createBrushDabCenterSampler,
  type BrushDabCenterSampler,
} from '../util/brush-engine.ts';
import {
  createContiguousFloodFillWorkspace,
  getIndex,
  getPixelColor,
  getToleranceDistance,
  visitContiguousMaskPixels,
  type ContiguousFloodFillWorkspace,
} from '../util/flood-fill.ts';
import { forEachPixelInRect } from '../util/pixels.ts';
import { getSelectionAbsoluteContours, isPointInContours, selectionPointPathsToContours } from '../util/selection.ts';
import {
  decodeRasterSelectionMask,
  encodeRasterSelectionMask,
  isRasterSelectionPixelSelected,
  MAX_VECTOR_SELECTION_BOUNDARY_EDGES,
} from '../util/selection-mask.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

export type QuickSelectionToolArgs = {
  size: number;
  tolerance: number;
  mode: 'add' | 'subtract';
  alpha: number;
  toolName: 'quick-selection';
};

/**
 * Hands the source bitmap straight through, exactly as `rectangularSelection` does.
 *
 * The tool is a `creator`: the growing region's marching-ants boundary is the output,
 * so the processor has no pixels to produce. Everything that decides the region lives in
 * the pure helpers below, which is why the behaviour is testable without React, without
 * a canvas and without a store.
 */
export const quickSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };

/**
 * The source label is persisted with the selection, so keep it distinct from Magic Wand even
 * though both tools can produce the same compound or packed-mask geometry.
 */
export const QUICK_SELECTION_SOURCE_TOOL = 'quick-selection' as const;

export const QUICK_SELECTION_MODES: readonly { value: QuickSelectionToolArgs['mode']; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
];

export const isQuickSelectionMode = (value: string): value is QuickSelectionToolArgs['mode'] =>
  QUICK_SELECTION_MODES.some((mode) => mode.value === value);

export const QUICK_SELECTION_SIZE_MIN = 1;
export const QUICK_SELECTION_SIZE_MAX = 500;
export const QUICK_SELECTION_TOLERANCE_MIN = 0;
export const QUICK_SELECTION_TOLERANCE_MAX = 100;

/**
 * Dabs this far apart along the stroke, as a percentage of the brush diameter.
 *
 * It is the same knob the brush engine exposes (`BRUSH_SPACING_DEFAULT` is 25), and it
 * matters more here than it does for paint: a fill is re-seeded at every dab, so spacing
 * sets how many full-image region grows one drag performs. A quarter of the diameter is
 * dense enough that a fast stroke cannot jump a thin edge, and it is the density
 * Photoshop's own brush engine defaults to.
 */
export const QUICK_SELECTION_SPACING_PERCENT = 25;
const MAX_CACHED_QUICK_SELECTION_SEEDS = 4_096;

export function sampleStrokeDabCenters(
  points: Point[],
  size: number,
  spacingPercent: number = QUICK_SELECTION_SPACING_PERCENT,
  includeEndpoint = true
): Point[] {
  return brushDabCenters(points, size, spacingPercent, includeEndpoint);
}

/**
 * The seed points a drag hands to region growth: nine points sampled inside each round
 * brush stamp, with stamp centres spaced by arc length along the path. The sparse interior
 * pattern gives Size a real spatial effect without directly painting a circular selection;
 * each point still grows its own contiguous image region. Arc length rather than one
 * stamp per pointer event keeps identical paths independent of pointer sample rate.
 */
export function sampleStrokeSeeds(
  points: Point[],
  size: number,
  spacingPercent: number = QUICK_SELECTION_SPACING_PERCENT,
  includeEndpoint = true
): Point[] {
  const sampler = createQuickSelectionStrokeSeedSampler(size, spacingPercent);
  const seeds: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    seeds.push(
      ...appendQuickSelectionStrokeSeeds(sampler, points[index], includeEndpoint && index === points.length - 1)
    );
  }
  return seeds;
}

export type QuickSelectionStrokeSeedSampler = {
  centers: BrushDabCenterSampler;
  offsets: Point[];
  /** Bounded exact-pixel cache; misses after it fills only repeat work, never change the mask. */
  emittedPixels: Set<string>;
};

/** Create per-stroke sampler state so pointer events never rewalk old path segments. */
export function createQuickSelectionStrokeSeedSampler(
  size: number,
  spacingPercent: number = QUICK_SELECTION_SPACING_PERCENT
): QuickSelectionStrokeSeedSampler {
  const diameter = Number.isFinite(size) && size > 0 ? size : 1;
  const offsets =
    diameter < 2
      ? [{ x: 0, y: 0 }]
      : [
          { x: 0, y: 0 },
          { x: diameter * 0.4, y: 0 },
          { x: -diameter * 0.4, y: 0 },
          { x: 0, y: diameter * 0.4 },
          { x: 0, y: -diameter * 0.4 },
          { x: diameter * 0.28, y: diameter * 0.28 },
          { x: diameter * 0.28, y: -diameter * 0.28 },
          { x: -diameter * 0.28, y: diameter * 0.28 },
          { x: -diameter * 0.28, y: -diameter * 0.28 },
        ];

  return {
    centers: createBrushDabCenterSampler(size, spacingPercent),
    offsets,
    emittedPixels: new Set(),
  };
}

/** Extend one stroke path point and return only seed pixels not emitted by earlier events. */
export function appendQuickSelectionStrokeSeeds(
  sampler: QuickSelectionStrokeSeedSampler,
  point: Point,
  includeEndpoint = false
): Point[] {
  const centers = appendBrushDabCenters(sampler.centers, [point], includeEndpoint);
  const seeds: Point[] = [];
  for (const center of centers) {
    for (const offset of sampler.offsets) {
      const seed = { x: center.x + offset.x, y: center.y + offset.y };
      const pixel = `${Math.floor(seed.x)},${Math.floor(seed.y)}`;
      if (sampler.emittedPixels.has(pixel)) continue;
      if (sampler.emittedPixels.size < MAX_CACHED_QUICK_SELECTION_SEEDS) sampler.emittedPixels.add(pixel);
      seeds.push(seed);
    }
  }
  return seeds;
}

const toPixelExtent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * The mask a stroke accumulates into, seeded with whatever the active selection already
 * covers.
 *
 * `baseMask` is the rasterized active selection, so a second stroke can extend or shrink
 * the first one instead of replacing it. It is `null` when nothing is active, which
 * leaves an empty mask — and therefore makes a `'subtract'` stroke with nothing selected
 * a no-op, exactly as Photoshop's is.
 */
export type QuickSelectionAccumulator = {
  mask: Uint8Array;
  width: number;
  height: number;
  /** Reused scratch buffers; lazily allocated because an empty subtract stroke needs none. */
  floodFillWorkspace: ContiguousFloodFillWorkspace | null;
  /** Pixels already included by zero-tolerance fills, separate from a pre-existing base selection. */
  exactFilledPixels: Uint8Array | null;
  /** Exact source pixels already grown at nonzero tolerance; bounded so this cache cannot grow unchecked. */
  processedSeedIndices: Set<number>;
  selectedPixelCount: number;
};

export function createQuickSelectionAccumulator(
  size: Size,
  baseMask: Uint8Array | null = null
): QuickSelectionAccumulator {
  const width = toPixelExtent(size.width);
  const height = toPixelExtent(size.height);
  const mask = new Uint8Array(width * height);
  let selectedPixelCount = 0;
  if (baseMask) {
    const copyLength = Math.min(mask.length, baseMask.length);
    for (let index = 0; index < copyLength; index += 1) {
      if (!baseMask[index]) continue;
      mask[index] = 1;
      selectedPixelCount += 1;
    }
  }

  return {
    mask,
    width,
    height,
    floodFillWorkspace: null,
    exactFilledPixels: null,
    processedSeedIndices: new Set(),
    selectedPixelCount,
  };
}

/**
 * The whole re-seeding problem, in one function: grow a region from every seed the
 * stroke has produced and combine the results.
 *
 * Each seed grows against the ORIGINAL image, and two adjacent seeds do not imply one
 * region. A region that is reachable from seed `k`
 * but not from seed `k + 1` — a thin bridge, a one-pixel gap, an edge the pointer
 * crossed between two dabs — is simply absent from both masks individually, so taking
 * the last mask, or the largest, silently loses it. The combination is therefore an
 * explicit union (`'add'`) or difference (`'subtract'`) over the seed's own pixels, and
 * The caller may provide only newly sampled seeds on each pointer event. A zero-tolerance
 * fill records its entire connected component, so later seeds in that component can be
 * skipped safely without confusing pixels from the pre-existing base selection. At higher
 * tolerances, only exact repeated seed pixels are cached; that cache is capped, affecting
 * speed but never results. The queue and generation-marked visited map are reused.
 */
export function growAlongStroke(
  accumulator: QuickSelectionAccumulator,
  imageData: ImageData,
  seeds: Point[],
  { tolerance, mode }: { tolerance: number; mode: QuickSelectionToolArgs['mode'] }
): number {
  const { mask, width, height } = accumulator;
  if (width <= 0 || height <= 0) return 0;
  // The document can be resized between two pointer moves, which leaves the pixels the
  // stroke sampled against a differently sized buffer. Filling from a stale buffer would
  // index a mask the grown region does not describe.
  if (imageData.width !== width || imageData.height !== height) return 0;

  let changedRegions = 0;
  const toleranceDistance = getToleranceDistance(tolerance);
  for (const seed of seeds) {
    if (mode === 'add' && accumulator.selectedPixelCount === mask.length) break;
    if (mode === 'subtract' && accumulator.selectedPixelCount === 0) break;
    const seedX = Math.floor(seed.x);
    const seedY = Math.floor(seed.y);
    if (
      !Number.isFinite(seedX) ||
      !Number.isFinite(seedY) ||
      seedX < 0 ||
      seedY < 0 ||
      seedX >= width ||
      seedY >= height
    ) {
      continue;
    }
    const sampleColor = getPixelColor(imageData.data, getIndex(seedX, seedY, width));
    const seedIndex = getIndex(seedX, seedY, width);
    let exactFilledPixels: Uint8Array | null = null;
    if (toleranceDistance === 0) {
      exactFilledPixels =
        accumulator.exactFilledPixels ?? (accumulator.exactFilledPixels = new Uint8Array(Math.ceil(mask.length / 8)));
      if ((exactFilledPixels[seedIndex >>> 3] & (1 << (seedIndex & 7))) !== 0) continue;
    } else if (accumulator.processedSeedIndices.has(seedIndex)) {
      continue;
    }

    const workspace =
      accumulator.floodFillWorkspace ??
      (accumulator.floodFillWorkspace = createContiguousFloodFillWorkspace(width * height));
    let changed = false;
    const selectedPixelCount = visitContiguousMaskPixels(
      imageData,
      seedX,
      seedY,
      sampleColor,
      toleranceDistance,
      workspace,
      (pixel) => {
        if (exactFilledPixels) {
          const byteIndex = pixel >>> 3;
          exactFilledPixels[byteIndex] |= 1 << (pixel & 7);
        }
        const nextValue = mode === 'subtract' ? 0 : 1;
        if (mask[pixel] !== nextValue) {
          changed = true;
          accumulator.selectedPixelCount += nextValue === 1 ? 1 : -1;
        }
        mask[pixel] = nextValue;
      }
    );
    if (selectedPixelCount > 0 && changed) changedRegions += 1;
    if (
      toleranceDistance > 0 &&
      selectedPixelCount > 0 &&
      accumulator.processedSeedIndices.size < MAX_CACHED_QUICK_SELECTION_SEEDS
    ) {
      accumulator.processedSeedIndices.add(seedIndex);
    }
  }

  return changedRegions;
}

function pointsBounds(points: Point[]) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  return { left, top, right, bottom };
}

/**
 * Rasterize a committed polygon's absolute points into a one-byte-per-pixel mask.
 *
 * This is how a stroke gets something to union into or subtract from: `Selection` stores
 * contour paths and no pixels, so the paths have to become a mask before they can be
 * combined with a grown region. Only the contours' shared bounding box is visited, never the whole
 * canvas, and each pixel is tested at its centre (`x + 0.5`, `y + 0.5`) because the
 * polygon traces pixel corners — a test at the integer coordinate would sample the
 * corner shared with the neighbouring pixel instead of the pixel itself.
 *
 * If none of the contours has at least three points, the selection has no interior and
 * yields an empty mask rather than a throw, which is the same state a fresh document is in.
 */
export function rasterizeSelectionMask(points: SelectionPointPaths, size: Size): Uint8Array {
  const width = toPixelExtent(size.width);
  const height = toPixelExtent(size.height);
  const mask = new Uint8Array(width * height);
  const contours = selectionPointPathsToContours(points);
  if (!contours.some((contour) => contour.length >= 3) || width === 0 || height === 0) return mask;

  forEachPixelInRect({ width, height }, pointsBounds(contours.flat()), (x, y, offset) => {
    // `forEachPixelInRect` hands a byte offset, the mask is one byte per pixel.
    if (isPointInContours({ x: x + 0.5, y: y + 0.5 }, contours)) mask[offset / 4] = 1;
  });

  return mask;
}

/** Rasterize either a vector selection or its authoritative packed mask in document-frame space. */
export function rasterizeSelectionState(selection: Selection, size: Size, documentOrigin: Point): Uint8Array {
  const width = toPixelExtent(size.width);
  const height = toPixelExtent(size.height);
  if (!selection.rasterMask) {
    const contours = getSelectionAbsoluteContours(selection).map((contour) =>
      contour.map((point) => ({ x: point.x - documentOrigin.x, y: point.y - documentOrigin.y }))
    );
    return rasterizeSelectionMask(contours, { width, height });
  }

  const mask = new Uint8Array(width * height);
  const packed = decodeRasterSelectionMask(selection.rasterMask);
  if (!packed || width === 0 || height === 0) return mask;

  const localLeft = selection.pos.x - documentOrigin.x;
  const localTop = selection.pos.y - documentOrigin.y;
  const left = Math.max(0, Math.floor(localLeft));
  const top = Math.max(0, Math.floor(localTop));
  const right = Math.min(width, Math.ceil(localLeft + selection.rasterMask.width));
  const bottom = Math.min(height, Math.ceil(localTop + selection.rasterMask.height));

  for (let y = top; y < bottom; y += 1) {
    const sourceY = Math.floor(documentOrigin.y + y + 0.5 - selection.pos.y);
    for (let x = left; x < right; x += 1) {
      const sourceX = Math.floor(documentOrigin.x + x + 0.5 - selection.pos.x);
      if (isRasterSelectionPixelSelected(selection.rasterMask, packed, sourceX, sourceY)) mask[y * width + x] = 1;
    }
  }

  return mask;
}

/**
 * The four sides of a selected pixel, in the order their directed edges are emitted.
 *
 * Every selected pixel contributes a directed edge along each side that faces an
 * unselected pixel, and the four run top→right, right→down, bottom→left, left→up. An
 * edge therefore always has the region on its right in screen coordinates, which is what
 * makes the walk below deterministic and what gives an outer contour a positive signed
 * area and an enclosed hole a negative one.
 */
const SIDE_TOP = 0;
const SIDE_RIGHT = 1;
const SIDE_BOTTOM = 2;
const SIDE_LEFT = 3;

type EdgeMap = {
  /** Vertex id -> the edge ids that start there, in emission order. */
  outgoing: Map<number, number[]>;
  used: Set<number>;
  stride: number;
  edgeCount: number;
};

function addEdge(outgoing: Map<number, number[]>, vertex: number, edgeId: number) {
  const existing = outgoing.get(vertex);
  if (existing) existing.push(edgeId);
  else outgoing.set(vertex, [edgeId]);
}

function buildEdgeMap(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): EdgeMap {
  const stride = width + 1;
  const outgoing = new Map<number, number[]>();
  const isSelected = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  let edgeCount = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!isSelected(x, y)) continue;

      const pixelIndex = y * width + x;
      const topVertex = y * stride + x;

      if (!isSelected(x, y - 1)) {
        addEdge(outgoing, topVertex, pixelIndex * 4 + SIDE_TOP);
        edgeCount += 1;
      }
      if (!isSelected(x + 1, y)) {
        addEdge(outgoing, topVertex + 1, pixelIndex * 4 + SIDE_RIGHT);
        edgeCount += 1;
      }
      if (!isSelected(x, y + 1)) {
        addEdge(outgoing, topVertex + stride + 1, pixelIndex * 4 + SIDE_BOTTOM);
        edgeCount += 1;
      }
      if (!isSelected(x - 1, y)) {
        addEdge(outgoing, topVertex + stride, pixelIndex * 4 + SIDE_LEFT);
        edgeCount += 1;
      }
    }
  }

  return { outgoing, used: new Set<number>(), stride, edgeCount };
}

function vertexToPoint(vertex: number, stride: number): Point {
  return { x: vertex % stride, y: Math.floor(vertex / stride) };
}

function takeUnusedEdge(candidates: number[] | undefined, used: Set<number>): number | null {
  if (!candidates) return null;

  while (candidates.length > 0) {
    const edgeId = candidates[0];
    if (used.has(edgeId)) {
      candidates.shift();
      continue;
    }
    candidates.shift();

    return edgeId;
  }

  return null;
}

function signedArea(points: Point[]): number {
  let area = 0;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }

  return area / 2;
}

function traceLoops(edges: EdgeMap): Point[][] {
  const { outgoing, used, stride, edgeCount } = edges;
  const vertexDeltas = [1, stride, -1, -stride];
  const loops: Point[][] = [];

  for (const startVertex of outgoing.keys()) {
    let vertex = startVertex;
    const loop: Point[] = [vertexToPoint(startVertex, stride)];
    let closed = false;

    // Every edge is consumed at most once, so a loop takes at most `edgeCount` steps. The
    // bound is what stops a vertex that several contours funnel into from producing an
    // open trail instead of ending, and a start vertex whose edges are all spent falls
    // out on the first `null` without a loop.
    for (let step = 0; step <= edgeCount; step++) {
      const edgeId = takeUnusedEdge(outgoing.get(vertex), used);
      if (edgeId === null) break;

      vertex += vertexDeltas[edgeId % 4];
      loop.push(vertexToPoint(vertex, stride));
      if (vertex === startVertex) {
        closed = true;
        break;
      }
    }

    if (closed && loop.length >= 4) loops.push(loop.slice(0, -1));
  }

  return loops;
}

export type TracedMaskBoundary = {
  /** Every closed boundary loop, with no repeated first vertex. */
  points: Point[][];
  /** Exact packed pixels when tracing would exceed the safe vector boundary budget. */
  rasterMask?: RasterSelectionMask;
  pixelCount: number;
  boundaryEdgeCount: number;
  bounds: Pos;
  /**
   * Whether the mask contains one or more enclosed hole loops. The corresponding paths are
   * included in `points` and interpreted with the even-odd rule.
   */
  hasHoles: boolean | null;
  loopCount: number | null;
};

/**
 * Trace every boundary loop in the mask into a closed point path.
 *
 * A mask has no single outline: it can be several disjoint regions and each can have
 * holes. The directed-edge walk turns every selected/unselected adjacency into an edge
 * and chains them, which yields one loop per contour, and the signed area of each loop
 * is what tells an outer contour (positive, because the region is on the edge's right)
 * from an enclosed hole (negative). This is the same classification the Magic Wand's
 * tracer performs on the same edge orientation. Keeping all loops lets the consumer use an
 * even-odd compound path for disconnected regions, holes and nested islands.
 *
 * The chain takes the first unused edge leaving a vertex, which is ambiguous at a pinch
 * — two regions touching only diagonally. Both continuations describe the same pixels,
 * so the loop comes back self-touching at that one vertex and the region is still right.
 */
export function traceMaskBoundary(mask: Uint8Array, width: number, height: number): TracedMaskBoundary | null {
  if (width <= 0 || height <= 0 || mask.length < width * height) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixelCount = 0;
  let boundaryEdgeCount = 0;
  let vectorLimitExceeded = false;
  const isSelected = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      pixelCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (!vectorLimitExceeded) {
        if (!isSelected(x, y - 1)) boundaryEdgeCount += 1;
        if (boundaryEdgeCount > MAX_VECTOR_SELECTION_BOUNDARY_EDGES) {
          vectorLimitExceeded = true;
          continue;
        }
        if (!isSelected(x + 1, y)) boundaryEdgeCount += 1;
        if (boundaryEdgeCount > MAX_VECTOR_SELECTION_BOUNDARY_EDGES) {
          vectorLimitExceeded = true;
          continue;
        }
        if (!isSelected(x, y + 1)) boundaryEdgeCount += 1;
        if (boundaryEdgeCount > MAX_VECTOR_SELECTION_BOUNDARY_EDGES) {
          vectorLimitExceeded = true;
          continue;
        }
        if (!isSelected(x - 1, y)) boundaryEdgeCount += 1;
        if (boundaryEdgeCount > MAX_VECTOR_SELECTION_BOUNDARY_EDGES) vectorLimitExceeded = true;
      }
    }
  }
  if (pixelCount === 0) return null;

  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  if (vectorLimitExceeded) {
    const rasterMask = encodeRasterSelectionMask(mask, width, height, bounds);
    if (!rasterMask) return null;

    return {
      points: [],
      rasterMask,
      pixelCount,
      boundaryEdgeCount,
      bounds,
      hasHoles: null,
      loopCount: null,
    };
  }

  const edges = buildEdgeMap(mask, width, height, { minX, minY, maxX, maxY });
  const loops = traceLoops(edges);
  if (loops.length === 0) return null;

  const points: Point[][] = [];
  let hasHoles = false;
  for (const loop of loops) {
    const area = signedArea(loop);
    if (area <= 0) hasHoles = true;
    if (loop.length >= 3) points.push(loop);
  }
  if (points.length === 0) return null;

  return {
    points,
    pixelCount,
    boundaryEdgeCount,
    hasHoles,
    loopCount: loops.length,
    // Bound every returned contour, including disconnected regions and enclosed holes.
    bounds: (() => {
      const { left, top, right, bottom } = pointsBounds(points.flat());

      return { x: left, y: top, width: right - left, height: bottom - top };
    })(),
  };
}

export type QuickSelectionPolygon = {
  points: Point[][];
  rasterMask?: RasterSelectionMask;
  pixelCount: number;
  bounds: Pos;
  boundaryEdgeCount: number;
  /**
   * Describes whether one or more nested loops exclude pixels. The full geometry is in `points`.
   */
  hasHoles: boolean | null;
};

/**
 * The compound polygon a stroke's accumulated mask commits. Every loop is retained, so a
 * disconnected selection and a hole have the same pixel coverage as the accumulated mask.
 */
export function createQuickSelectionPolygon(
  mask: Uint8Array,
  width: number,
  height: number
): QuickSelectionPolygon | null {
  const traced = traceMaskBoundary(mask, width, height);
  if (!traced) return null;

  return {
    points: traced.points,
    ...(traced.rasterMask ? { rasterMask: traced.rasterMask } : {}),
    pixelCount: traced.pixelCount,
    bounds: traced.bounds,
    boundaryEdgeCount: traced.boundaryEdgeCount,
    hasHoles: traced.hasHoles,
  };
}
