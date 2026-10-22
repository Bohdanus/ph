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
import { resetOverlayAlpha } from './canvas.ts';
import type { DocumentFrame } from '../contexts/document-frame.ts';
import { documentToCanvasPoint } from '../contexts/document-frame.ts';

export const SELECTION_ANCHOR_RADIUS = 5;
export const SELECTION_ANCHOR_HIT_RADIUS = 8;

// The anchor rim's stroke width, in CSS px. The tool overlay is sized to the DOCUMENT and displayed
// with `object-contain`, so a context draws in document px while this is CSS px, and
// `drawSelectionAnchors` divides it by the contain fit before it reaches a context. The border's own
// chrome is not here: `useAnts.ts` owns those constants and `useSelectionAnts` divides them the
// same way, because the ants are what draws the border now.
const OUTLINE_LINE_WIDTH = 2;

export function normalizeSelectionPoints(points: Point[]): Pick<Selection, 'points' | 'pos'> | null {
  if (points.length < 3) return null;

  const pos = pointsBoundingPos({ points });
  const normalizedPoints = points.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));

  return { points: [normalizedPoints], pos };
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
      [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
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
  return selection.points.flat().map((point) => ({
    x: point.x + selection.pos.x,
    y: point.y + selection.pos.y,
  }));
}

/**
 * The draggable vertices of a committed selection, drawn on the tool overlay.
 *
 * Only the anchors. The border itself is the animated marching-ants outline owned
 * by `useSelectionMarchingAnts` on its own canvas, so painting a second static
 * stroke here would show both.
 *
 * `scale` is CSS px per document px, the same divisor `useSelectionAnts` takes: the dot has to be
 * the same size on screen as the dashes it belongs to, and below a scale of 1 an undivided radius
 * puts a sub-pixel dot inside a hit target that does not move with it.
 */
export function drawSelectionAnchors(
  ctx: CanvasRenderingContext2D,
  selection: Selection,
  frame?: DocumentFrame,
  scale = 1
): void {
  if (!selection.isActive) return;
  // A traced boundary can carry hundreds of sampled points, so freehand and the
  // magic wand get a border and no handles.
  if (selection.sourceTool === 'freehand-lasso' || selection.sourceTool === 'magic-wand') return;

  const points = getSelectionAbsolutePoints(selection).map((point) =>
    frame ? documentToCanvasPoint(point, frame) : point
  );
  if (points.length < 3) return;

  const lineWidth = OUTLINE_LINE_WIDTH / scale;
  const anchorRadius = SELECTION_ANCHOR_RADIUS / scale;

  ctx.save();
  // The tool overlay is one 2D context for the whole session and every tool area is handed the
  // same object, so an anchor drawn with no `globalAlpha` of its own renders at whatever the last
  // painting tool left behind. Resetting HERE rather than at the call sites is what makes the
  // anchors correct for every tool that draws one; the per-caller resets this retires were added
  // one tool at a time and were missing the magic wand's.
  resetOverlayAlpha(ctx);
  ctx.setLineDash([]);

  points.forEach((point, index) => {
    ctx.beginPath();
    ctx.fillStyle = 'white';
    ctx.strokeStyle = index === 0 ? 'rgba(0,123,255,1)' : 'rgba(0,0,0,0.65)';
    ctx.lineWidth = lineWidth;
    ctx.arc(point.x, point.y, anchorRadius, 0, Math.PI * 2);
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

/**
 * The anchor whose point falls within the grab radius, or null.
 *
 * `scale` is CSS px per document px, the same divisor `drawSelectionAnchors` uses. It is a parameter
 * rather than a measurement because this function and that one receive a document-space point from
 * the same caller, and a hit target that is not the same size on screen as the dot it is meant to
 * grab is a worse defect than the one the divisor fixes: making the dot constant on screen while
 * leaving the radius in document px shrinks the target below the visible dot at every zoom below 1.
 */
export function findSelectionAnchorAtPoint(selection: Selection, point: Point, scale = 1): number | null {
  if (selection.sourceTool === 'freehand-lasso' || selection.sourceTool === 'magic-wand') return null;

  const hitRadius = SELECTION_ANCHOR_HIT_RADIUS / scale;
  const points = getSelectionAbsolutePoints(selection);
  const anchorIndex = points.findIndex((anchor) => distanceBetweenPoints(anchor, point) <= hitRadius);

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
        [
          { x: 0, y: 0 },
          { x: pos.width, y: 0 },
          { x: pos.width, y: pos.height },
          { x: 0, y: pos.height },
        ],
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

/**
 * Whether two selections occupy the same geometry: the same `pos` and the same
 * `points`, element for element.
 *
 * `metadata` is deliberately excluded, and that exclusion is the whole point.
 * Both move builders bump `metadata.movedAtVersion` on every call, including a
 * zero delta, so a deep comparison of a dragged selection against the one it
 * came from can never report "unchanged" and the selection writers' own
 * deep-equal guard cannot suppress a drag that moved nothing. Geometry is what
 * the move builders actually change, so it is the only comparison a drag commit
 * can be gated on.
 */
export function hasSameSelectionGeometry(a: Selection, b: Selection): boolean {
  if (a === b) return true;

  const { pos: aPos, points: aPoints } = a;
  const { pos: bPos, points: bPoints } = b;
  if (aPos.x !== bPos.x || aPos.y !== bPos.y || aPos.width !== bPos.width || aPos.height !== bPos.height) return false;
  if (aPoints.length !== bPoints.length) return false;

  return aPoints.every((contour, index) => {
    const other = bPoints[index];
    if (contour.length !== other.length) return false;
    return contour.every((point, i) => point.x === other[i].x && point.y === other[i].y);
  });
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

/**
 * A canvas this module must draw into handed back no 2D context.
 *
 * `getSelectionCanvasContext` admits null, so every call site has to decide what a
 * context-less canvas means. Naming the condition here keeps the failure readable
 * from a stack trace instead of arriving as a `TypeError` from deep inside a canvas
 * internals call, which names neither the operation nor the real cause.
 */
export class SelectionCanvasContextError extends Error {
  readonly operation: string;

  constructor(operation: string, width: number, height: number) {
    super(
      `${operation}: the ${width}x${height} selection canvas returned no 2D context ` +
        `(getContext('2d') was null), so this copy cannot be produced`
    );
    this.name = 'SelectionCanvasContextError';
    this.operation = operation;
  }
}

/**
 * For the copy paths that have no in-band failure channel.
 *
 * `cloneBitmapToCanvas` returns a `ClipboardCanvas`, so there is no `null` to hand
 * back, and both production callers already wrap it in a `try`/`catch` that logs and
 * returns `false` from the selection-copy helpers. A
 * named throw is therefore recoverable there, while returning a stand-in canvas would
 * paste a layer of silently wrong pixels.
 */
function requireSelectionCanvasContext(canvas: ClipboardCanvas, operation: string): Ctx2D {
  const ctx = getSelectionCanvasContext(canvas);
  if (!ctx) throw new SelectionCanvasContextError(operation, canvas.width, canvas.height);

  return ctx;
}

/**
 * For the snapshot-returning copy paths, which report the failure in band.
 *
 * `copyPolygonSelectionToCanvas`, `copyFeatheredPolygonSelectionToCanvas` and
 * `copyRectSelectionToCanvas` already return `null` for every other "no snapshot is
 * possible" case, and their one production consumer, `copySelectionToCanvas`, is itself
 * consumed through a null check: `copySelection` and `layerViaCopy` in
 * `src/contexts/useSelectionClipboard.ts` both return `false` when the snapshot is null.
 * So `null` is a real in-band channel on this path, and the named error is logged to
 * keep the cause readable instead of surfacing as a bare `null`.
 *
 * The bitmap-only wrappers `copyPolygonToCanvas` / `copyFeatheredPolygonToCanvas` cannot
 * use it. Their return value is committed as a layer's `tmpCanvas` with no null check
 * anywhere on the way, so they throw. The throw is what carries the named error out of the
 * tool processor: the only caller of `copyPolygonToCanvas` is the polygon processor
 * (`polygonSelection`), reached solely from `tempUpdateLayer()`, whose `catch`
 * inside `tempUpdateLayer()` logs it and returns. Nothing else observes it, which
 * is exactly why a stand-in canvas cannot be substituted here: a `null` would leave the
 * error with no in-band consumer at all. The outermost UI callers are a separate channel
 * and never reach these wrappers — they go through `copyActiveSelection`, whose `false`
 * return every caller now reads and reports: `Lasso.tsx`, `FreehandLasso.tsx`,
 * `FeatherMagneticLasso.tsx`, `MagicWand.tsx`, `QuickSelection.tsx`,
 * `EllipticalSelection.tsx`, `RectangularSelection.tsx` and the `AppKeyboardShortcuts.tsx`
 * copy shortcut each log it. That channel is therefore not silent, but it is not this one
 * either: it reports the missing snapshot, and says nothing about the context failure below.
 */
function unavailableSelectionCanvasContext(operation: string, canvas: ClipboardCanvas): null {
  console.error(new SelectionCanvasContextError(operation, canvas.width, canvas.height));
  return null;
}

/**
 * The margin the feathered copy path adds around the polygon's own bounds, shared so the
 * bitmap-only wrapper can tell a degenerate polygon from a context failure the same way
 * the snapshot function it delegates to does.
 */
function featheredBoundsPadding(antiAlias: boolean, featherRadius: number): number {
  return Math.max(antiAlias ? 1 : 0, Math.ceil(featherRadius));
}

function drawPolygonPath(ctx: Ctx2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

/**
 * The snapshot the selection would occupy, or `null` when the polygon encloses nothing.
 *
 * The `null` cases are states rather than failures — too few points to bound, or bounds
 * that collapse or clamp to zero — so a caller that must hand back a canvas anyway can
 * tell them apart from a context failure, which has to be reported.
 */
function getSelectionCanvasBounds(points: Point[], padding = 0, imageSize?: Size): Pos | null {
  if (points.length < 3) return null;

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
  const ctx = requireSelectionCanvasContext(destCanvas, 'cloneBitmapToCanvas');

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

  const ctx = getSelectionCanvasContext(destCanvas);
  if (!ctx) return unavailableSelectionCanvasContext('copyPolygonSelectionToCanvas', destCanvas);

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
  // The bounds are derived here as well as inside `copyPolygonSelectionToCanvas`, and
  // the arguments match, so a null snapshot beside a non-null `bounds` is exactly the
  // null-context failure and nothing else.
  const bounds = getSelectionCanvasBounds(points, 0);
  const snapshot = copyPolygonSelectionToCanvas(sourceCanvas, points);
  if (snapshot) return snapshot.bitmap;

  // A polygon that encloses nothing is a real state rather than a failure: every lasso
  // tool seeds `points: []`, and a click commits the tool with whatever the drag
  // accumulated, so this case still has to hand back a canvas.
  if (!bounds) return createSelectionCanvas(1, 1);

  // Every other null is a failure, and a stand-in bitmap would be published as pixels:
  // `tempUpdateLayer` (src/contexts/useLayer.ts), the `kind: 'tool'` arm of
  // `createLayerSource` (src/contexts/layer-utils.ts) and `applyRasterTool`
  // (src/contexts/useHistory.ts) all take this return value unchecked, and
  // `layer-renderer.ts` rejects only zero dimensions, so a blank 1x1 survives as a
  // permanently transparent layer. Fail loud instead.
  throw new SelectionCanvasContextError('copyPolygonToCanvas', bounds.width, bounds.height);
}

type RasterizedPolygonMask = {
  values: Uint8Array;
  preservesCoverage: boolean;
};

function rasterizePolygonMask(points: Point[], width: number, height: number): RasterizedPolygonMask {
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
        mask[i] = imageData.data[i * 4 + 3];
      }

      return { values: mask, preservesCoverage: true };
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

  return { values: mask, preservesCoverage: false };
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
  antiAlias = true,
  preservesCoverage = false
): Uint8Array {
  // Canvas read-back stores coverage as 0-255 alpha, while the CPU fallback deliberately
  // remains a 0/1 mask. The explicit flag keeps a canvas pixel with alpha 1 distinguishable
  // from that fallback's selected value.
  const useCoverage = preservesCoverage || binaryMask.some((value) => value > 1);
  const outsideSeeds = new Uint8Array(binaryMask.length);
  const insideSeeds = new Uint8Array(binaryMask.length);

  for (let i = 0; i < binaryMask.length; i++) {
    if (useCoverage) {
      insideSeeds[i] = binaryMask[i] === 255 ? 1 : 0;
      outsideSeeds[i] = binaryMask[i] === 0 ? 1 : 0;
    } else {
      insideSeeds[i] = binaryMask[i];
      outsideSeeds[i] = binaryMask[i] ? 0 : 1;
    }
  }

  const distanceToOutside = chamferDistanceFromSeeds(outsideSeeds, width, height);
  const distanceToInside = chamferDistanceFromSeeds(insideSeeds, width, height);
  const alphaMask = new Uint8Array(binaryMask.length);

  for (let i = 0; i < binaryMask.length; i++) {
    const coverage = binaryMask[i] / 255;
    const signedDistance =
      useCoverage && binaryMask[i] > 0 && binaryMask[i] < 255
        ? coverage - 0.5
        : binaryMask[i]
          ? distanceToOutside[i]
          : -distanceToInside[i];
    alphaMask[i] = alphaFromSignedDistance(signedDistance, featherRadius, antiAlias);
  }

  return alphaMask;
}

/**
 * Builds the alpha coverage a raster operation should receive from a committed polygon selection.
 * The points are local to the destination raster, so the same snapshot can be replayed without
 * consulting the live selection store.
 */
export function createSelectionAlphaMask(
  points: Point[],
  size: Size,
  { featherRadius = 0, antiAlias = true }: { featherRadius?: number; antiAlias?: boolean } = {}
): Uint8Array {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  const rasterized = rasterizePolygonMask(points, width, height);
  return createFeatheredAlphaMask(
    rasterized.values,
    width,
    height,
    featherRadius,
    antiAlias,
    rasterized.preservesCoverage
  );
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
  // Derived with the same rule `copyFeatheredPolygonSelectionToCanvas` uses, so the two
  // agree on which nulls are a polygon that encloses nothing and which are a failure.
  const bounds = getSelectionCanvasBounds(points, featheredBoundsPadding(antiAlias, featherRadius), imageSize);
  const snapshot = copyFeatheredPolygonSelectionToCanvas(sourceCanvas, points, {
    antiAlias,
    featherRadius,
    imageSize,
  });
  if (snapshot) return snapshot.bitmap;

  if (!bounds) return createSelectionCanvas(1, 1);

  // A `ClipboardCanvas` return has no null channel, and every consumer of it commits it
  // as a layer bitmap, so a context failure here cannot degrade into a stand-in bitmap.
  throw new SelectionCanvasContextError('copyFeatheredPolygonToCanvas', bounds.width, bounds.height);
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

  const padding = featheredBoundsPadding(antiAlias, featherRadius);
  const bounds = getSelectionCanvasBounds(points, padding, imageSize);
  if (!bounds) return null;

  const { x, y, width, height } = bounds;
  const relativePoints = points.map((point) => ({ x: point.x - x, y: point.y - y }));
  const destCanvas = createSelectionCanvas(width, height);
  const ctx = getSelectionCanvasContext(destCanvas);
  if (!ctx) return unavailableSelectionCanvasContext('copyFeatheredPolygonSelectionToCanvas', destCanvas);

  ctx.drawImage(sourceCanvas as CanvasImageSource, x, y, width, height, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const mask = rasterizePolygonMask(relativePoints, width, height);
  const alphaMask = createFeatheredAlphaMask(
    mask.values,
    width,
    height,
    featherRadius,
    antiAlias,
    mask.preservesCoverage
  );

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
  const ctx = getSelectionCanvasContext(destCanvas);
  if (!ctx) return unavailableSelectionCanvasContext('copyRectSelectionToCanvas', destCanvas);

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
