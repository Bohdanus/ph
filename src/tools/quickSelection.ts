import type { Point, Pos, Size } from '../contexts/general-types.ts';
import { brushDabCenters } from '../util/brush-engine.ts';
import { floodFill } from '../util/flood-fill.ts';
import { forEachPixelInRect } from '../util/pixels.ts';
import { isPointInPolygon } from '../util/selection.ts';
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
 * The `SelectionSourceTool` the quick selection commits under.
 *
 * `SelectionSourceTool` in `src/contexts/general-types.ts:17` has no
 * `'quick-selection'` member and that union is the integration's file, not this tool's.
 * `'magic-wand'` is borrowed because the region this tool commits is a traced mask
 * boundary — the same representation the wand produces — and the borrow pays for the two
 * `selection.ts` exclusions keyed on that source: `drawSelectionAnchors` returns before
 * painting for it and `findSelectionAnchorAtPoint` returns `null` for it
 * (`src/util/selection.ts:155` and `:203`), and a staircase boundary hundreds of
 * vertices long must carry neither. Nothing else consults the source — the border is the
 * marching ants, and `useSelectionAnts` strokes every active selection whatever made it.
 * Adding the real member, plus those two exclusions, is the whole follow-up.
 */
export const QUICK_SELECTION_SOURCE_TOOL = 'magic-wand' as const;

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

/**
 * The seed points a drag hands to the region grow, spaced by ARC LENGTH along the whole
 * path.
 *
 * This is `brushDabCenters`' geometry and nothing else — no dab shape, hardness or
 * falloff, and no colour stamping. Arc length rather than one seed per pointer event is
 * the part that matters: a pointer emits samples at its own rate, so per-sample seeding
 * would make the number of region grows a function of how fast the user moved, and the
 * same path brushed twice would select twice as much the second time.
 */
export function sampleStrokeSeeds(
  points: Point[],
  size: number,
  spacingPercent: number = QUICK_SELECTION_SPACING_PERCENT
): Point[] {
  return brushDabCenters(points, size, spacingPercent);
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
  /** How many of the caller's seeds have already been grown, so a resumed pass skips them. */
  grownSeeds: number;
};

export function createQuickSelectionAccumulator(
  size: Size,
  baseMask: Uint8Array | null = null
): QuickSelectionAccumulator {
  const width = toPixelExtent(size.width);
  const height = toPixelExtent(size.height);
  const mask = new Uint8Array(width * height);
  if (baseMask) mask.set(baseMask.subarray(0, mask.length));

  return { mask, width, height, grownSeeds: 0 };
}

/**
 * The whole re-seeding problem, in one function: grow a region from every seed the
 * stroke has produced and combine the results.
 *
 * Each `floodFill` is computed against the ORIGINAL image and returns its own mask, and
 * two adjacent seeds do not imply one region. A region that is reachable from seed `k`
 * but not from seed `k + 1` — a thin bridge, a one-pixel gap, an edge the pointer
 * crossed between two dabs — is simply absent from both masks individually, so taking
 * the last mask, or the largest, silently loses it. The combination is therefore an
 * explicit union (`'add'`) or difference (`'subtract'`) over the seed's own bounds, and
 * `accumulator.grownSeeds` is what makes the union incremental rather than repeated:
 * appending to the stroke does not move the arc-length positions of the dabs already
 * emitted, so the seeds before the cursor are the same array values they were on the
 * previous pointer move and re-growing them would be pure cost.
 *
 * The one deliberate approximation is the covered-seed skip. A seed whose own pixel is
 * already in the accumulator is not grown again, because its fill can only re-derive
 * pixels that are already there. That is exactly right when the dab is on the region
 * underneath it, which is the case for every dab of a continuous stroke after the first,
 * and it is what makes a drag cost roughly one fill per region entered rather than one
 * per dab. It is an approximation in the strict sense: the fill from an already-covered
 * pixel samples that pixel's own colour, so on a steep gradient it could in principle
 * reach a neighbouring region that the original seed's fill stopped short of. Filling
 * every dab would remove the approximation and make a fast stroke over a photo do
 * thousands of whole-image grows.
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

  let grownRegions = 0;
  for (let index = accumulator.grownSeeds; index < seeds.length; index++) {
    const seed = seeds[index];
    const seedX = Math.floor(seed.x);
    const seedY = Math.floor(seed.y);
    if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) continue;
    if (mode === 'add' && mask[seedY * width + seedX] === 1) continue;

    const result = floodFill(imageData, seed, { tolerance, contiguous: true });
    if (!result) continue;

    for (let y = result.bounds.top; y <= result.bounds.bottom; y++) {
      const row = y * width;
      for (let x = result.bounds.left; x <= result.bounds.right; x++) {
        const pixel = row + x;
        if (result.mask[pixel] !== 1) continue;

        mask[pixel] = mode === 'subtract' ? 0 : 1;
      }
    }
    grownRegions += 1;
  }

  accumulator.grownSeeds = seeds.length;

  return grownRegions;
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
 * a point path and no pixels, so the path has to become a mask before it can be combined
 * with a grown region. Only the polygon's own bounding box is visited, never the whole
 * canvas, and each pixel is tested at its centre (`x + 0.5`, `y + 0.5`) because the
 * polygon traces pixel corners — a test at the integer coordinate would sample the
 * corner shared with the neighbouring pixel instead of the pixel itself.
 *
 * A polygon with fewer than three points has no interior and yields an empty mask rather
 * than a throw, which is the same state a fresh document is in.
 */
export function rasterizeSelectionMask(points: Point[], size: Size): Uint8Array {
  const width = toPixelExtent(size.width);
  const height = toPixelExtent(size.height);
  const mask = new Uint8Array(width * height);
  if (points.length < 3 || width === 0 || height === 0) return mask;

  forEachPixelInRect({ width, height }, pointsBounds(points), (x, y, offset) => {
    // `forEachPixelInRect` hands a byte offset, the mask is one byte per pixel.
    if (isPointInPolygon({ x: x + 0.5, y: y + 0.5 }, points)) mask[offset / 4] = 1;
  });

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
  /** The largest outer contour, as a closed path with no repeated first vertex. */
  points: Point[];
  pixelCount: number;
  bounds: Pos;
  /**
   * Whether the mask encloses anything the returned contour does not describe. A
   * `Selection` is one point path, so a region with a hole cannot be committed exactly.
   */
  hasHoles: boolean;
  loopCount: number;
};

/**
 * Trace a mask's boundary into point paths, largest outer contour first.
 *
 * A mask has no single outline: it can be several disjoint regions and each can have
 * holes. The directed-edge walk turns every selected/unselected adjacency into an edge
 * and chains them, which yields one loop per contour, and the signed area of each loop
 * is what tells an outer contour (positive, because the region is on the edge's right)
 * from an enclosed hole (negative). This is the same classification the Magic Wand's
 * tracer performs on the same edge orientation, and it is why the largest loop is chosen
 * from the outer set rather than from all of them.
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
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      pixelCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (pixelCount === 0) return null;

  const edges = buildEdgeMap(mask, width, height, { minX, minY, maxX, maxY });
  const loops = traceLoops(edges);
  if (loops.length === 0) return null;

  let points: Point[] = [];
  let largestArea = 0;
  let hasHoles = false;
  for (const loop of loops) {
    const area = signedArea(loop);
    if (area <= 0) {
      hasHoles = true;
      continue;
    }
    if (area <= largestArea) continue;

    points = loop;
    largestArea = area;
  }
  if (points.length < 3) return null;

  return {
    points,
    pixelCount,
    hasHoles,
    loopCount: loops.length,
    // The returned points' own bounds, not the mask's: a mask of several disjoint regions
    // has a bounding box far larger than the contour the caller is about to commit, and
    // this is the rectangle the commit has to copy into.
    bounds: (() => {
      const { left, top, right, bottom } = pointsBounds(points);

      return { x: left, y: top, width: right - left, height: bottom - top };
    })(),
  };
}

export type QuickSelectionPolygon = {
  points: Point[];
  pixelCount: number;
  bounds: Pos;
  /**
   * Set when the mask has an enclosed hole, in which case `points` is the outer contour
   * ALONE and does NOT describe the mask. The caller must not commit it.
   */
  hasHoles: boolean;
};

/**
 * The polygon a stroke's accumulated mask may be committed as.
 *
 * `hasHoles` is reported rather than resolved, because this data model cannot resolve
 * it: a `Selection` carries one point path, so committing the outer contour of a region
 * with a hole would cover pixels the mask reports as unselected — the user would drag a
 * brush around a mug handle and select the handle's background with it. Refusing is the
 * same choice `createMagicWandSelectionFromImageData` makes
 * (`src/util/magicWand.ts:218`), and the honest fix is a multi-polygon selection, which
 * is a change to `Selection` itself.
 */
export function createQuickSelectionPolygon(
  mask: Uint8Array,
  width: number,
  height: number
): QuickSelectionPolygon | null {
  const traced = traceMaskBoundary(mask, width, height);
  if (!traced) return null;

  return { points: traced.points, pixelCount: traced.pixelCount, bounds: traced.bounds, hasHoles: traced.hasHoles };
}
