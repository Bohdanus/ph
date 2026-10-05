import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  RULER_ENDPOINT_HIT_RADIUS,
  constrainRulerAngle,
  isOnRulerLine,
  rulerLegVertex,
  withRulerLegVertex,
  type RulerMeasurement,
} from '../../tools/ruler.ts';
import {
  clearRulerMeasurement,
  setRulerMeasurement,
  syncRulerFrame,
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
 * `lineWidth: 1` is one DOCUMENT pixel — a hairline at 100% and all but invisible at 25%.
 * Dividing by `fit.scale` makes it one CSS px instead, which is the weight Photoshop's own line is.
 */
const RULE_WIDTH_CSS = 1;

/**
 * The tick at each end, in CSS px before the fit division.
 *
 * Eight, not six, because this is the one dimension a screenshot can be measured against. At six the
 * tick was the same weight as the rule and read as a nick in the line rather than as a crossbar; the
 * marks are what make the line read as a MEASUREMENT rather than as a stray mark on the canvas, and
 * they have to be visibly longer than the line is wide to do that.
 */
const CAP_LENGTH_CSS = 8;

/**
 * The rule's two colours: a BLACK core inside a LIGHT casing.
 *
 * **The core is black because that is what Photoshop draws**, and this was the one thing the previous
 * version got visibly wrong — it had the pair the other way round, a light core in a dark casing,
 * which made the line a translucent GREY over a white page rather than the crisp black line the tool
 * is known by. Adobe's Ruler page documents every readout and every gesture and says nothing at all
 * about how the line is painted, so the authority for the colour is the operator's "must look similar
 * to Photoshop" and the picture beside it, not a quotation.
 *
 * **The casing stays, because it costs nothing and Photoshop does not have it.** On a white page —
 * which is what the rule is drawn over almost all of the time, and what the picture shows — a white
 * casing under a black line is invisible, so the line looks exactly like Photoshop's. Over a dark
 * region the casing is what keeps the line visible at all: with the core alone the line crossed a
 * black band in the previous picture and simply stopped existing, which the casing turns into a white
 * line with a dark edge.
 *
 * These are the overlay's own constants rather than theme tokens because the overlay is a canvas and
 * reads no CSS custom property of its own. The casing is two backing pixels wider than the core, so
 * on the fitted canvas a pixel of white shows on each side.
 */
const RULER_RULE_CORE = '#000000';
const RULER_RULE_CASING = '#ffffff';

/**
 * How much wider the casing is than the core, in CSS px.
 *
 * Four, not two, and the reason is arithmetic rather than taste. The stroke is centred on a device
 * pixel, so a three-CSS-px casing spans one and a half pixels either side of that centre: its middle
 * row is solid and its outer rows are half covered. Over a black region that measured — in the
 * screenshot's own pixels — a maximum of **163**, which is half-white rather than white, so the line
 * crossing a dark band read as a grey smear instead of a line. Four makes the casing five device px
 * wide, which puts a solid row either side of the core with the antialiased edges outside them.
 *
 * It is invisible on the light page the casing exists to be invisible on, which is the property that
 * makes it safe to widen.
 */
const CASING_EXTRA_CSS = 4;

/** One drawn segment: from the measuring line's start to its end, or a protractor's second leg. */
type RulerLeg = [from: Point, to: Point];

/**
 * What a drag in progress does to the measurement.
 *
 * These are Adobe's four distinct gestures on one tool, not variants of one: "Drag from the
 * beginning point to the ending point" measures, "To resize the line, drag one end of an existing
 * measuring line" resizes, "To move the line, place the pointer on the line away from either
 * endpoint and drag the line" moves, and "Alt-drag at an angle from one end of the measuring line"
 * pulls a protractor leg. The first version implemented only the first and the fourth, which meant
 * that with a line on the canvas ANY drag replaced it — so the two editing gestures were unreachable
 * and a measurement could not be corrected in place, only redone from nothing.
 */
type RulerDraftMode = 'measure' | 'move' | 'resize' | 'protractor';

/**
 * The gesture in progress.
 *
 * A ref rather than state, because it changes on every pointer move and a state write per move
 * re-renders this area on every frame for a value nothing here renders. What the options bar reads
 * is the published measurement, which goes through the store.
 */
type RulerDraft = {
  /**
   * The measurement as it stood when the drag began: the line being moved, the line being resized,
   * and the line a protractor leg hangs off. For `measure` it is the collapsed line at the press
   * point, which is what keeps `move` and `resize` from having to carry a second copy of it.
   */
  base: RulerMeasurement;
  /**
   * The line that was standing before this drag, and the answer to "what does a gesture that turned
   * out to change nothing put back". It is a separate field rather than something derived from
   * `base` because for `measure` the two differ by exactly the collapsed line this drag published.
   */
  replaced: RulerMeasurement | null;
  /** Where the pointer went down. */
  from: Point;
  /**
   * The fixed end of the dragged segment, which is what `Shift` rotates the pointer about.
   *
   * It is `from` for every mode but `resize`: a resize drags one end while the OTHER stays put, so
   * constraining from the press point would snap the pointer's ray about the end that is moving and
   * the line's far end would swing. Kept as its own field rather than derived at use, because the
   * release path has already cleared the ref by the time it needs this and a line whose last point
   * escaped the constraint would end a fraction of a degree off the multiple it spent the drag on.
   */
  anchor: Point;
  /** Which end a `resize` drags, and `null` for the modes that are not one. */
  endpoint: 'start' | 'end' | null;
  mode: RulerDraftMode;
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
  if (measurement.legEnd) {
    const vertex = rulerLegVertex(measurement);
    legs.push([vertex, measurement.legEnd]);
  }
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
    /**
     * Snap the rule to the DEVICE pixel grid, by half a device pixel along each axis.
     *
     * This is what turns a grey hairline into a crisp line, and it is the whole difference between
     * this rule and Photoshop's. A stroke is centred on its path, so a one-CSS-px rule whose path sits
     * on a whole coordinate straddles two device rows and each gets half the coverage — which is why
     * the previous picture shows a 50% grey line rather than a black one. Translating the path by half
     * a device pixel centres it on one row instead.
     *
     * The offset is `0.5 / scale` and not `0.5` because the canvas carries no transform: its backing
     * store is document-sized and CSS scales it, so one BACKING pixel is `scale` device pixels and half
     * a device pixel is half a backing pixel divided by the fit.
     *
     * It cannot be perfect for a diagonal, because no single offset puts every point of a sloping line
     * on the grid — and that is true of the same technique in any renderer. It is exact for the
     * horizontal and vertical lines this tool spends most of its time on, which is the axis-aligned
     * case and the protractor legs.
     */
    const snap = 0.5 / scale;
    ctx.translate(snap, snap);
    ctx.lineCap = 'butt';

    // Casing first, so the black core is laid over it rather than under it.
    ctx.lineWidth = (RULE_WIDTH_CSS + CASING_EXTRA_CSS) / scale;
    ctx.strokeStyle = RULER_RULE_CASING;
    strokeRulerLegs(ctx, rulerLegs(measurement), cap);

    ctx.lineWidth = RULE_WIDTH_CSS / scale;
    ctx.strokeStyle = RULER_RULE_CORE;
    strokeRulerLegs(ctx, rulerLegs(measurement), cap);
  } finally {
    ctx.restore();
  }
};

/** Moves every point of a measurement by `(dx, dy)`, so a moved line keeps its angle and length. */
const translateMeasurement = (measurement: RulerMeasurement, dx: number, dy: number): RulerMeasurement => {
  const moved: RulerMeasurement = {
    start: { x: measurement.start.x + dx, y: measurement.start.y + dy },
    end: { x: measurement.end.x + dx, y: measurement.end.y + dy },
  };
  if (measurement.legEnd === undefined) return moved;
  return {
    ...moved,
    legEnd: { x: measurement.legEnd.x + dx, y: measurement.legEnd.y + dy },
    legAt: measurement.legAt,
  };
};

/**
 * The measurement a `resize` drag publishes with `endpoint` at `pointer`.
 *
 * The two ends are not symmetric, and the asymmetry is the whole reason this is a function rather
 * than an assignment. Dragging `start` leaves the vertex `end` — and any protractor leg hanging off
 * it — exactly where it was, so A and D2 do not move while W and H do. Dragging `end` moves the
 * vertex, and a leg hanging off that vertex has to move WITH it or the angle the protractor was
 * measuring silently becomes a different angle.
 *
 * A leg is carried rather than dropped in the second case for the same reason: the user pulled that
 * leg out deliberately, and discarding it because they adjusted the line would be the tool deciding
 * that their intent was a plain measuring line again.
 *
 * NEITHER branch translates the whole measurement, which is the bug the test caught when this was
 * written as one `translateMeasurement` call: that moved the far end as well, so a resize turned
 * into a move whenever the dragged end was the vertex.
 */
const resizeMeasurement = (
  measurement: RulerMeasurement,
  endpoint: 'start' | 'end',
  pointer: Point
): RulerMeasurement => {
  if (endpoint === 'start') {
    return measurement.legEnd === undefined
      ? { start: pointer, end: measurement.end }
      : { start: pointer, end: measurement.end, legEnd: measurement.legEnd, legAt: measurement.legAt };
  }
  if (measurement.legEnd === undefined) return { start: measurement.start, end: pointer };
  const dx = pointer.x - measurement.end.x;
  const dy = pointer.y - measurement.end.y;
  return {
    start: measurement.start,
    end: pointer,
    legEnd: { x: measurement.legEnd.x + dx, y: measurement.legEnd.y + dy },
    legAt: measurement.legAt,
  };
};

/**
 * The Ruler records NO history state.
 *
 * Adobe calls the measuring line a **nonprinting** line and gives its removals as dragging it out
 * of the image and clicking Clear in the options bar — neither of which is an undo. So this area
 * dispatches nothing at all: no `COMMIT_DOCUMENT_EDIT`, no `TOOL_ACTION`, no layer, no durable
 * operation. That is also why there is no entry in `src/tools/toolProcessors.ts` — the Ruler is in
 * `PIXEL_FREE_TOOLS` — and why there is no `updateLayerByTool` call here to make. It is why
 * measuring a line and then closing the tab raises no unload prompt either, which
 * `e2e/ruler.spec.ts` pins through the app's own `beforeunload` handler.
 */
export const RulerToolArea = ({ className, overlayCtxRef }: RulerToolAreaProps) => {
  const [{ containerRef, documentId, totalSize }] = useStore();
  const { toolArgs } = useCurrentTool();
  const measurement = useRulerMeasurement();

  const [fitScale, setFitScale] = useState(1);

  // The paint effect needs the fit as state rather than off `dimensionsRef`, because a ref that
  // changes without a render cannot be a dependency: reading the ref left the line at the width it
  // was drawn with until the next pointer event, so a window resize left a hairline on screen. The
  // hook holds this callback in a ref, so its identity changing per render costs nothing.
  const handleFitResize = useCallback((fit: { scale: number }) => setFitScale(fit.scale), []);

  const { getLocalCoords, isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } =
    usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: handleFitResize });

  const draftRef = useRef<RulerDraft | null>(null);

  // A document or frame change is the signal that the line under this gesture is a different one's,
  // so the line is dropped rather than measured against an origin that has moved.
  useEffect(() => {
    syncRulerFrame(documentId, totalSize);
  }, [documentId, totalSize]);

  useEffect(() => {
    const ctx = overlayCtxRef?.current;
    if (!ctx) return;
    // `resetOverlayAlpha` before the clear, not after: the overlay is ONE 2D context for the whole
    // session, so a previous tool's `globalAlpha` leaks into this one's stroke.
    resetOverlayAlpha(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (measurement) drawRulerRule(ctx, measurement, fitScale);
  }, [measurement, fitScale, overlayCtxRef]);

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
  const lineFor = (draft: RulerDraft, pointer: Point): RulerMeasurement => {
    switch (draft.mode) {
      case 'measure':
        return { start: draft.from, end: pointer };
      case 'move':
        return translateMeasurement(draft.base, pointer.x - draft.from.x, pointer.y - draft.from.y);
      case 'resize':
        return draft.endpoint === null ? draft.base : resizeMeasurement(draft.base, draft.endpoint, pointer);
      case 'protractor':
        return { ...draft.base, legEnd: pointer };
    }
  };

  /**
   * The pointer in overlay-canvas pixels, under the 45° constraint while Shift is held.
   *
   * The draft is an ARGUMENT rather than read from the ref, because the release path has already
   * cleared the ref by the time it needs this: a line whose last point escaped the constraint would
   * end a fraction of a degree off the multiple it spent the whole drag on.
   */
  const constrainedPoint = (event: PointerEvent<HTMLDivElement>, draft: RulerDraft): Point => {
    const pointer = getLocalCoords(event);
    return event.shiftKey ? constrainRulerAngle(draft.anchor, pointer) : pointer;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (toolArgs.toolName !== 'ruler') return;
    if (!isPointerDownValid(event)) return;
    event.preventDefault();

    const pointer = getLocalCoords(event);

    /**
     * A press on the PASTEBOARD is not a gesture on the image, so it starts nothing.
     *
     * The area is the whole workspace, not the document, so without this the press is accepted
     * anywhere: a drag from outside the image inwards publishes a line whose `start` is off-frame
     * and the bar then reports a negative X or Y — a measurement of a point the user cannot see.
     * The RELEASE already had this check, which is why the defect was only ever half-present.
     */
    if (!isInsideFrame(pointer, totalSize)) {
      releasePointer();
      return;
    }

    if (measurement) {
      /**
       * Adobe's protractor gesture: "Alt-drag (Windows) or Option-drag (Mac OS) at an angle from
       * one end of the measuring line". The hit radius is what keeps an ordinary Alt-drag elsewhere
       * on the canvas able to start a fresh measurement.
       *
       * `legAt` records which end became the vertex rather than the endpoints being swapped, and
       * swapping is shorter and was the first version: it silently redefines X and Y — "the starting
       * location" — to the far end at the moment the protractor is pulled from the near one, which
       * the readouts then report as fact.
       */
      if (event.altKey && isNearEitherEnd(measurement, pointer)) {
        const atStart = isNear(pointer, measurement.start);
        const vertex = atStart ? measurement.start : measurement.end;
        draftRef.current = {
          base: withRulerLegVertex(measurement, atStart ? 'start' : 'end'),
          replaced: measurement,
          from: vertex,
          anchor: vertex,
          endpoint: null,
          mode: 'protractor',
        };
        setRulerMeasurement(lineFor(draftRef.current, pointer));
        return;
      }

      /**
       * An endpoint resizes and the body moves, checked in that order because the two radii are the
       * same size and meet in the middle of a short line — so the nearest END must win, or a press
       * near the middle of a 10 px line would move the whole thing instead of dragging the end the
       * pointer is plainly on.
       */
      const endpoint = isNear(pointer, measurement.start) ? 'start' : isNear(pointer, measurement.end) ? 'end' : null;
      if (endpoint !== null) {
        draftRef.current = {
          base: measurement,
          replaced: measurement,
          from: endpoint === 'start' ? measurement.start : measurement.end,
          anchor: endpoint === 'start' ? measurement.end : measurement.start,
          endpoint,
          mode: 'resize',
        };
        setRulerMeasurement(measurement);
        return;
      }
      if (isOnRulerLine(measurement, pointer)) {
        draftRef.current = {
          base: measurement,
          replaced: measurement,
          from: pointer,
          anchor: pointer,
          endpoint: null,
          mode: 'move',
        };
        setRulerMeasurement(measurement);
        return;
      }
    }

    const draft: RulerDraft = {
      base: { start: pointer, end: pointer },
      replaced: measurement,
      from: pointer,
      anchor: pointer,
      endpoint: null,
      mode: 'measure',
    };
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
    // a drag out and back is one ordinary gesture and only the end of it is a decision. It covers
    // moving an existing line as well as drawing one, which is how Adobe words it: "place the
    // pointer on the line away from either endpoint, drag the line out of the image".
    if (!isInsideFrame(pointer, totalSize)) {
      clearRulerMeasurement();
      return;
    }

    /**
     * A press that never moved is a CLICK, and a click is not one of Adobe's four gestures.
     *
     * Left as a published measurement it is the worst outcome available: a zero-length line the bar
     * reports as 0 px, which then owns the pointer's next drag — the press that made it lands on its
     * endpoint, so the line the user is trying to draw is MOVED instead of replaced — and which has
     * to be dismissed with Clear before measuring anything else. So a collapsed `measure` release
     * puts back the line that stood before the press, which is nothing when there was nothing.
     */
    if (draft.mode === 'measure' && pointer.x === draft.from.x && pointer.y === draft.from.y) {
      setRulerMeasurement(draft.replaced);
      return;
    }

    // Published from the same expression as the last move, so a released line is exactly the line
    // the pointer was holding. A protractor released where it started keeps the line it was pulled
    // from, because a zero-length leg is not a protractor.
    setRulerMeasurement(
      draft.mode === 'protractor' && pointer.x === draft.from.x && pointer.y === draft.from.y
        ? draft.base
        : lineFor(draft, pointer)
    );
  };

  /**
   * A gesture that ended without a release — a touch pan, a browser-taken pointer, an unmount.
   *
   * Both halves, and what each is for is NOT the same reason.
   *
   * `releasePointer` covers the routes the hook's own `pointercancel` listener never sees. That
   * listener (`src/hooks/usePointerPosition.ts`, the `addEventListener('pointercancel', …)` effect
   * beside `isPointerUpValid`) calls `clearEvent()` itself whenever the cancelled pointer is the
   * active one, so the hook does NOT keep claiming the pointer across a cancel and every later
   * `isPointerDownValid` still returns true. What no native listener sees is the unmount, and a
   * ref that outlives its area is the residue of that.
   *
   * Clearing `draftRef` is the half that is load-bearing today: a surviving draft would be read by
   * the next `pointermove` that passes `isPointerMoveValid`, republishing a measurement the user
   * abandoned. Both lines are kept because the sibling areas keep them and because each covers a
   * route the other does not — but neither is here to stop the area wedging, because the hook
   * already does that.
   */
  const handlePointerCancel = () => {
    releasePointer();
    draftRef.current = null;
  };

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
