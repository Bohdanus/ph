import type { Point, RectXYSorted } from '../contexts/general-types.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';

/**
 * Photoshop's marquee `Style` dropdown. `fixed-ratio` locks the drag to `fixedRatio`
 * and `fixed-size` locks it to `fixedWidth` x `fixedHeight`; `normal` constrains
 * neither and leaves all three sliders inert.
 */
export type MarqueeStyle = 'normal' | 'fixed-ratio' | 'fixed-size';

export type EllipticalSelectionToolArgs = {
  style: MarqueeStyle;
  fixedRatio: number;
  fixedWidth: number;
  fixedHeight: number;
  toolName: 'elliptical-selection';
};

/**
 * Hands the source bitmap straight through, exactly as `rectangularSelection` does.
 *
 * The tool is a `creator`: it publishes a selection through
 * `useSelectionHistory().commitSelection`, not pixels, so there is nothing for the
 * processor to rasterize. Every piece of behaviour below lives in the pure helpers
 * the tool area calls, which is why this file is importable from a unit test with no
 * React and no canvas.
 */
export const ellipticalSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };

/**
 * The `SelectionSourceTool` the elliptical marquee commits under.
 *
 * `SelectionSourceTool` in `src/contexts/general-types.ts:17` has no
 * `'elliptical-selection'` member, and that union is the integration's file rather than
 * this tool's, so the commit borrows `'magic-wand'` instead of inventing a cast. The
 * borrow pays for exactly the two `selection.ts` exclusions keyed on that source —
 * `drawSelectionAnchors` returns before painting for `'magic-wand'` and
 * `'freehand-lasso'` (`src/util/selection.ts:155`) and `findSelectionAnchorAtPoint`
 * returns `null` for them (`src/util/selection.ts:203`) — and a tessellated ellipse must
 * carry neither per-vertex handles nor an anchor hit-test. Nothing else consults the
 * source: the border is the marching ants, and `useSelectionAnts` strokes every active
 * selection whatever made it. Adding the real member to the union and adding it to those
 * two exclusions is the whole follow-up; until then every reference goes through this
 * one constant.
 */
export const ELLIPTICAL_SELECTION_SOURCE_TOOL = 'magic-wand' as const;

/** The Style dropdown's options, in the order the options bar renders them. */
export const MARQUEE_STYLES: readonly { value: MarqueeStyle; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fixed-ratio', label: 'Fixed Ratio' },
  { value: 'fixed-size', label: 'Fixed Size' },
];

export const isMarqueeStyle = (value: string): value is MarqueeStyle =>
  MARQUEE_STYLES.some((style) => style.value === value);

/** Photoshop's marquee Ratio field spans 1:20 to 20:1. */
export const MARQUEE_RATIO_MIN = 0.05;
export const MARQUEE_RATIO_MAX = 20;
export const MARQUEE_RATIO_STEP = 0.05;

export const MARQUEE_SIZE_MIN = 1;
export const MARQUEE_SIZE_MAX = 2000;
export const MARQUEE_SIZE_STEP = 1;

/**
 * How far the inscribed polygon may sit inside the true ellipse, in pixels.
 *
 * A polygon chord of a circle of radius `r` subtending `2 * PI / n` misses the arc by
 * the sagitta `r * (1 - cos(PI / n))` at its midpoint, so a quarter of a pixel keeps
 * the flat visible only to a magnifying glass while costing a vertex count that grows
 * as the square root of the radius.
 */
export const ELLIPSE_MAX_SAGITTA_PX = 0.25;

/**
 * Below this the sagitta bound is already satisfied by a coarse ring, and 16 is also
 * the smallest ring that reads as a curve rather than a diamond.
 */
export const ELLIPSE_MIN_VERTICES = 16;

/**
 * The cap, and the reason the count is a function of the radius and not of the ratio.
 * The bound only reaches this many vertices at a radius of roughly 5.7k px, which no
 * document this editor can open is; the cap is here so a corrupted persisted size
 * cannot make a commit allocate an unbounded point array.
 */
export const ELLIPSE_MAX_VERTICES = 720;

/** One drag, with the modifier state Photoshop reads at the same moment. */
export type EllipticalMarqueeDrag = {
  start: Point;
  end: Point;
  style: MarqueeStyle;
  fixedRatio: number;
  fixedWidth: number;
  fixedHeight: number;
  /** Shift: hold the drag to a circle, whatever the Style says. */
  constrainToCircle?: boolean;
  /** Alt: grow the marquee from the press point out to the pointer. */
  fromCentre?: boolean;
};

/**
 * Grow the short side of a drag's size until `width / height` is the locked ratio.
 *
 * The zero cases are the reason this is not the one-line division it looks like. A drag
 * that has moved on one axis only still has to produce a closed ellipse under a locked
 * ratio, and there are two defensible answers: push the missing side out to one side of
 * the press point, or centre it. Centring is what Photoshop draws — a straight-down drag
 * of a 1:1 ratio is a circle hanging below the press point, not a circle to its right —
 * and the caller applies it by comparing the DRAGGED extent against zero, so the rule
 * stays here as pure arithmetic and the anchoring stays at the call site.
 *
 * A drag that moved on neither axis has no ratio to apply, so it comes back untouched
 * and the caller turns it into the defined no-op every zero-size drag is.
 */
export function applyMarqueeRatio(size: { width: number; height: number }, ratio: number | null) {
  if (ratio === null) return size;
  const { width, height } = size;
  if (width > 0 && height > 0) {
    return width / height > ratio ? { width, height: width / ratio } : { width: height * ratio, height };
  }
  if (width > 0) return { width, height: width / ratio };
  if (height > 0) return { width: height * ratio, height };

  return size;
}

function marqueeRatio({ style, fixedRatio, constrainToCircle }: EllipticalMarqueeDrag): number | null {
  if (constrainToCircle) return 1;
  if (style !== 'fixed-ratio') return null;

  return Number.isFinite(fixedRatio) && fixedRatio > 0 ? fixedRatio : null;
}

/**
 * The bounding box the ellipse is inscribed in, or `null` for a drag that encloses
 * nothing.
 *
 * `null` is the whole degenerate contract, and it is a real state rather than a failure:
 * a click has no extent on either axis, and a drag can return to its press point. Both
 * produce a zero-width or zero-height box, which has no ellipse to inscribe and whose
 * polygon would collapse to a line — a degenerate `Selection` that the outline renderer
 * and `isPointInPolygon` both have to special-case. The tool area reads `null` as
 * "cancel the draft and commit nothing".
 *
 * `fixed-size` ignores the drag entirely, as Photoshop does: the press point only
 * supplies the centre, and the box is `fixedWidth` x `fixedHeight` whatever the pointer
 * does. It is the one style where a click is a complete gesture.
 */
export function resolveEllipseRect({
  start,
  end,
  style,
  fixedRatio,
  fixedWidth,
  fixedHeight,
  constrainToCircle = false,
  fromCentre = false,
}: EllipticalMarqueeDrag): RectXYSorted | null {
  if (style === 'fixed-size') {
    const width = Number.isFinite(fixedWidth) ? fixedWidth : 0;
    const height = Number.isFinite(fixedHeight) ? fixedHeight : 0;
    if (!(width > 0) || !(height > 0)) return null;

    return {
      x1: start.x - width / 2,
      y1: start.y - height / 2,
      x2: start.x + width / 2,
      y2: start.y + height / 2,
    };
  }

  const ratio = marqueeRatio({ start, end, style, fixedRatio, fixedWidth, fixedHeight, constrainToCircle, fromCentre });
  const draggedX = end.x - start.x;
  const draggedY = end.y - start.y;
  const constrained = applyMarqueeRatio({ width: Math.abs(draggedX), height: Math.abs(draggedY) }, ratio);
  if (!(constrained.width > 0) || !(constrained.height > 0)) return null;

  if (fromCentre) {
    return {
      x1: start.x - constrained.width / 2,
      y1: start.y - constrained.height / 2,
      x2: start.x + constrained.width / 2,
      y2: start.y + constrained.height / 2,
    };
  }

  // An axis the pointer never moved along is centred on the press point when the ratio
  // grew it out of nothing, and is otherwise laid out from the press point towards the
  // pointer. The two are told apart by whether the DRAG moved on that axis, not by how far
  // the ratio ended up stretching it: a 100x10 drag at 2:1 has a 2:1 box and is still a
  // corner drag, and only a 0x40 drag at 1:1 has an axis the ratio invented.
  const draggedWidth = Math.abs(draggedX);
  const draggedHeight = Math.abs(draggedY);
  const x1 = draggedWidth > 0 ? Math.min(start.x, end.x) : start.x - constrained.width / 2;
  const y1 = draggedHeight > 0 ? Math.min(start.y, end.y) : start.y - constrained.height / 2;

  return { x1, y1, x2: x1 + constrained.width, y2: y1 + constrained.height };
}

/**
 * How many vertices inscribe an ellipse of these radii inside the sagitta bound.
 *
 * Solving `r * (1 - cos(PI / n)) <= ELLIPSE_MAX_SAGITTA_PX` for `n` gives
 * `n >= PI / acos(1 - sagitta / r)`, and the bound uses the larger of the two radii so
 * that the minor axis is held to the same error as the major one rather than being
 * tessellated at the major axis's density. The result is clamped at both ends: 16 is the
 * coarsest ring that still reads as a curve, and the sagitta bound asks for more the
 * larger the radius gets, which is what keeps a 20px marquee at 16 vertices instead of
 * spending 60 on an invisible difference.
 */
export function ellipseVertexCount(radiusX: number, radiusY: number): number {
  const radius = Math.max(Math.abs(radiusX), Math.abs(radiusY));
  if (!(radius > 0)) return ELLIPSE_MIN_VERTICES;

  const sagittaRatio = Math.min(ELLIPSE_MAX_SAGITTA_PX / radius, 1);
  const needed = Math.ceil(Math.PI / Math.acos(1 - sagittaRatio));

  return Math.min(ELLIPSE_MAX_VERTICES, Math.max(ELLIPSE_MIN_VERTICES, needed));
}

/**
 * The inscribed polygon, as a point path with NO repeated closing vertex.
 *
 * A `Selection.points` array is an open polyline that the renderer and the hit test
 * both wrap from the last vertex back to the first: `useSelectionAnts`'s `shapePath`
 * calls `closePath` (`src/hooks/useSelectionAnts.ts:46`) and `isPointInPolygon` seeds `j`
 * at `length - 1` (`src/util/selection.ts:217`). Appending the first point again would
 * therefore add a zero-length closing segment and a duplicated handle at the top of the
 * ellipse, and `pointsBoundingPos` would see the same vertex twice. The loop is closed
 * by the wrap instead, and because the angles are `i / n * 2 * PI` the wrapped segment
 * is exactly the same angular step as every other one — there is no gap to leave.
 */
export function ellipsePointsInRect(rect: RectXYSorted): Point[] {
  const centerX = (rect.x1 + rect.x2) / 2;
  const centerY = (rect.y1 + rect.y2) / 2;
  const radiusX = Math.abs(rect.x2 - rect.x1) / 2;
  const radiusY = Math.abs(rect.y2 - rect.y1) / 2;
  const vertexCount = ellipseVertexCount(radiusX, radiusY);
  const points: Point[] = [];

  for (let index = 0; index < vertexCount; index++) {
    const angle = (index / vertexCount) * Math.PI * 2;
    points.push({ x: centerX + radiusX * Math.cos(angle), y: centerY + radiusY * Math.sin(angle) });
  }

  return points;
}

/**
 * The committed path for a finished drag, or `null` for a drag that encloses nothing.
 *
 * This is the one call the tool area makes: preview and commit both go through it with
 * the same arguments, so the outline the user watched being drawn and the polygon that
 * lands in the store are the same points by construction rather than by agreement.
 */
export function ellipsePointsFromDrag(drag: EllipticalMarqueeDrag): Point[] | null {
  const rect = resolveEllipseRect(drag);

  return rect ? ellipsePointsInRect(rect) : null;
}
