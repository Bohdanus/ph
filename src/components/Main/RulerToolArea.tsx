import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';

import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import { RULER_ENDPOINT_HIT_RADIUS, constrainRulerAngle, type RulerMeasurement } from '../../tools/ruler.ts';
import {
  clearRulerMeasurement,
  setRulerMeasurement,
  syncRulerFrameSize,
  useRulerMeasurement,
} from '../../tools/ruler-measurement-store.ts';

type RulerToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The measuring line's rule, one CSS px at every contain fit.
 *
 * Divided by the contain fit for the reason `CropToolArea` divides its own chrome: the overlay
 * canvas is sized to the DOCUMENT (`resizeCanvas` in `src/util/canvas.ts` sets the backing store
 * 1:1 with document pixels and CSS `object-contain` does the fitting), so a line drawn at
 * `lineWidth: 1` is one document pixel — a hairline at 100% and all but invisible at 25%.
 * Dividing by `fit.scale` makes it one CSS px instead, the same weight as the marching ants and
 * the crop outline.
 */
const RULE_WIDTH_CSS = 1;

/** The tick at each end of the line, in CSS px before the fit division. */
const CAP_LENGTH_CSS = 6;

/**
 * The rule colour.
 *
 * Photoshop's measuring line is chrome drawn over an image, so it has to be readable over a white
 * page and over a dark photograph alike. The crop outline beside it uses one flat colour, so this
 * follows that precedent rather than inventing a two-tone rule with a shadow: a light rule reads
 * on a dark photograph, and `RULER_RULE_DARK` beneath it — one pixel wider — keeps it off a white
 * one. These are the overlay's own constants rather than theme tokens because the overlay is a
 * canvas and reads no CSS custom property of its own.
 */
const RULER_RULE_LIGHT = '#f0f0f0';
const RULER_RULE_DARK = '#1a1a1a';

/** One drawn segment: from the measuring line's start to its end, or a protractor's second leg. */
type RulerLeg = [from: Point, to: Point];

/**
 * The gesture in progress.
 *
 * A ref rather than state, because it changes on every pointer move and a state write per move
 * re-renders this area on every frame for a value nothing here renders. What the options bar reads
 * is the published measurement, which goes through the store.
 */
type RulerDraft = {
  /** The line the drag starts from: empty for a fresh measurement, the first leg for a protractor. */
  base: { start: Point; end: Point };
  /** Where the dragged segment starts. */
  from: Point;
  /** Whether the dragged segment is a protractor's second leg rather than a measuring line. */
  protractor: boolean;
};

/** A tick of `cap` px across the segment's direction, centred on its end. */
const drawRulerCap = (ctx: CanvasRenderingContext2D, at: Point, towards: Point, cap: number): void => {
  const dx = towards.x - at.x;
  const dy = towards.y - at.y;
  const length = Math.hypot(dx, dy);
  // A collapsed segment has no direction, so a perpendicular is undefined and the tick is omitted
  // rather than drawn at the origin.
  if (length === 0) return;
  const half = cap / 2;
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;
  ctx.moveTo(at.x - nx, at.y - ny);
  ctx.lineTo(at.x + nx, at.y + ny);
};

const strokeRulerLegs = (ctx: CanvasRenderingContext2D, legs: readonly RulerLeg[], cap: number): void => {
  ctx.beginPath();
  for (const [from, to] of legs) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();

  // A tick at each OUTER end. A protractor's legs meet at their shared end, so capping all three
  // points would draw a mark across the vertex the two legs already meet at.
  const first = legs[0];
  const last = legs[legs.length - 1];
  ctx.beginPath();
  drawRulerCap(ctx, first[0], first[1], cap);
  drawRulerCap(ctx, last[1], last[0], cap);
  ctx.stroke();
};

/** The legs one measurement draws: the line, then the protractor's second leg when there is one. */
export const rulerLegs = (measurement: RulerMeasurement): RulerLeg[] => {
  const legs: RulerLeg[] = [[measurement.start, measurement.end]];
  if (measurement.legEnd) legs.push([measurement.end, measurement.legEnd]);
  return legs;
};

/**
 * Draws the rule for one measurement, dark edge first and light face over it.
 *
 * Exported so the geometry can be pinned without a canvas in the test: a stub context records the
 * path, and the test asserts the segments and the fit division rather than pixels.
 */
export const drawRulerRule = (ctx: CanvasRenderingContext2D, measurement: RulerMeasurement, fitScale: number): void => {
  // A 0 fit is the unmeasured case `cropOverhangPieces` also guards, and dividing by it would put
  // `Infinity` into every line width.
  const scale = fitScale || 1;
  const cap = CAP_LENGTH_CSS / scale;

  ctx.save();
  try {
    ctx.lineCap = 'butt';
    ctx.lineWidth = RULE_WIDTH_CSS / scale + 2 / scale;
    ctx.strokeStyle = RULER_RULE_DARK;
    strokeRulerLegs(ctx, rulerLegs(measurement), cap);

    ctx.lineWidth = RULE_WIDTH_CSS / scale;
    ctx.strokeStyle = RULER_RULE_LIGHT;
    strokeRulerLegs(ctx, rulerLegs(measurement), cap);
  } finally {
    ctx.restore();
  }
};

/**
 * The Ruler records NO history state.
 *
 * Adobe calls the measuring line a **nonprinting** line and gives its removals as dragging it out
 * of the image and clicking Clear in the options bar — neither of which is an undo. So this area
 * dispatches nothing at all: no `COMMIT_DOCUMENT_EDIT`, no `TOOL_ACTION`, no layer, no durable
 * operation. That is also why there is no entry in `src/tools/toolProcessors.ts` — the Ruler is in
 * `PIXEL_FREE_TOOLS` — and why there is no `updateLayerByTool` call here to make.
 *
 * The gesture is the whole tool: pointer-down fixes the start, a move extends the line under a 45°
 * constraint while Shift is held, and pointer-up leaves the line standing.
 */
export const RulerToolArea = ({ className, overlayCtxRef }: RulerToolAreaProps) => {
  const [{ containerRef, totalSize }] = useStore();
  const { toolArgs } = useCurrentTool();
  const measurement = useRulerMeasurement();

  const { getLocalCoords, dimensionsRef, isPointerDownValid, isPointerMoveValid, isPointerUpValid } =
    usePointerPosition({ ref: containerRef, imageSize: totalSize });

  const draftRef = useRef<RulerDraft | null>(null);

  // A size change is the signal that the document under this line is a different one, so the line
  // is dropped rather than measured against an origin that has moved. See the store's own doc.
  useEffect(() => {
    syncRulerFrameSize(totalSize);
  }, [totalSize]);

  useEffect(() => {
    const ctx = overlayCtxRef?.current;
    if (!ctx) return;
    // `resetOverlayAlpha` before the clear, not after: the overlay is ONE 2D context for the whole
    // session, so a previous tool's `globalAlpha` leaks into this one's stroke.
    resetOverlayAlpha(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (measurement) drawRulerRule(ctx, measurement, dimensionsRef.current.scale);
  }, [measurement, dimensionsRef, overlayCtxRef]);

  // The overlay canvas is shared, so this area owns clearing what it drew. The size is read off the
  // canvas at call time rather than off `totalSize`, which is what keeps a resize from under-clearing.
  useEffect(
    () => () => {
      const ctx = overlayCtxRef?.current;
      if (!ctx) return;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    },
    [overlayCtxRef]
  );

  /** The measurement the drag in progress publishes for a pointer at `pointer`. */
  const lineFor = (draft: RulerDraft, pointer: Point): RulerMeasurement =>
    draft.protractor ? { ...draft.base, legEnd: pointer } : { start: draft.from, end: pointer };

  /**
   * The pointer in overlay-canvas pixels, under the 45° constraint while Shift is held.
   *
   * The draft is an ARGUMENT rather than read from the ref, because the release path has already
   * cleared the ref by the time it needs this: a line whose last point escaped the constraint would
   * end a fraction of a degree off the multiple it spent the whole drag on.
   */
  const constrainedPoint = (event: PointerEvent<HTMLDivElement>, draft: RulerDraft): Point => {
    const pointer = getLocalCoords(event);
    return event.shiftKey ? constrainRulerAngle(draft.from, pointer) : pointer;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (toolArgs.toolName !== 'ruler') return;
    if (!isPointerDownValid(event)) return;
    event.preventDefault();

    const pointer = getLocalCoords(event);

    /**
     * Adobe's protractor gesture: "Alt-drag (Windows) or Option-drag (Mac OS) at an angle from
     * one end of the measuring line". The hit radius is what keeps an ordinary Alt-drag elsewhere
     * on the canvas able to start a fresh measurement.
     */
    if (measurement && event.altKey && isNearEitherEnd(measurement, pointer)) {
      const atStart = isNear(pointer, measurement.start);
      const from = atStart ? measurement.start : measurement.end;
      const other = atStart ? measurement.end : measurement.start;
      const draft: RulerDraft = { base: { start: other, end: from }, from, protractor: true };
      draftRef.current = draft;
      setRulerMeasurement(lineFor(draft, pointer));
      return;
    }

    const draft: RulerDraft = { base: { start: pointer, end: pointer }, from: pointer, protractor: false };
    draftRef.current = draft;
    setRulerMeasurement(lineFor(draft, pointer));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerMoveValid(event)) return;
    const draft = draftRef.current;
    if (!draft) return;
    setRulerMeasurement(lineFor(draft, constrainedPoint(event, draft)));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;
    const draft = draftRef.current;
    draftRef.current = null;
    if (!draft) return;
    const pointer = constrainedPoint(event, draft);
    // Adobe's first removal is to drag the line away: "To remove the line, drag it outside the
    // image area or press the Clear button". Tested on RELEASE rather than during the move, because
    // a drag out and back is one ordinary gesture and only the end of it is a decision.
    if (!isInsideFrame(pointer, totalSize)) {
      clearRulerMeasurement();
      return;
    }
    // Published from the same expression as the last move, so a released line is exactly the line
    // the pointer was holding. A protractor released where it started keeps the line it was pulled
    // from, because a zero-length leg is not a protractor.
    setRulerMeasurement(
      draft.protractor && pointer.x === draft.from.x && pointer.y === draft.from.y
        ? draft.base
        : lineFor(draft, pointer)
    );
  };

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ userSelect: 'none' }}
    />
  );
};

/**
 * Whether a point is inside the document frame.
 *
 * The frame is `[0, 0, totalSize]` in overlay-canvas pixels: `totalSize` is
 * `documentFrameSize(documentFrame)`, so the origin here is the FRAME origin and this deliberately
 * does not subtract `documentFrame.x` — the same rule `CropToolArea` states, for the same reason.
 */
const isInsideFrame = (point: Point, frame: Size): boolean =>
  point.x >= 0 && point.y >= 0 && point.x <= frame.width && point.y <= frame.height;

const isNear = (point: Point, end: Point): boolean =>
  Math.hypot(point.x - end.x, point.y - end.y) <= RULER_ENDPOINT_HIT_RADIUS;

/** Whether an Alt-drag at `point` is close enough to either end of `line` to pull a leg from it. */
export const isNearEitherEnd = (line: RulerMeasurement, point: Point): boolean =>
  isNear(point, line.start) || isNear(point, line.end);
