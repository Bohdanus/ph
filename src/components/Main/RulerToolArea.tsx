import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import {
  RULER_ENDPOINT_HIT_RADIUS,
  carryRulerLeg,
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
 * reads no CSS custom property of its own. `CASING_EXTRA_CSS` is the TOTAL extra, not a per-side one:
 * four CSS px wider than the core, which leaves two device px of white on each side of it.
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

/**
 * Moves every point of a measurement by `(dx, dy)`, so a moved line keeps its angle and length.
 *
 * `carryRulerLeg` rather than `legAt: measurement.legAt`, because an object literal writes the key
 * even when the value is `undefined` and `legAt` is documented as ABSENT unless it says `'start'`.
 */
const translateMeasurement = (measurement: RulerMeasurement, dx: number, dy: number): RulerMeasurement => {
  const moved: RulerMeasurement = {
    start: { x: measurement.start.x + dx, y: measurement.start.y + dy },
    end: { x: measurement.end.x + dx, y: measurement.end.y + dy },
  };
  if (measurement.legEnd === undefined) return moved;
  return carryRulerLeg({
    ...moved,
    legEnd: { x: measurement.legEnd.x + dx, y: measurement.legEnd.y + dy },
    legAt: measurement.legAt,
  });
};

/**
 * The measurement a `resize` drag publishes with `endpoint` at `pointer`.
 *
 * The two ends are not symmetric, and the asymmetry is the whole reason this is a function rather
 * than an assignment. Which end is the protractor's VERTEX is `legAt`, not `endpoint`: a leg can hang
 * off either end, so the two are independent and this function has to consult both.
 *
 * So the rule is one sentence: **the leg follows the vertex, and only the vertex.** Dragging the end
 * that carries the leg carries the leg with it, or the angle the protractor was measuring silently
 * becomes a different angle. Dragging the other end leaves the vertex — and therefore A and D2 —
 * exactly where it was, while W and H change.
 *
 * Getting that backwards is not hypothetical. The first version assumed the vertex was always `end`,
 * so dragging `end` always dragged the leg: on a line whose leg hangs off its `start`, dragging the
 * far end slid the leg sideways by a delta the vertex never made, and D2 and A both moved for no
 * reason the user could see.
 *
 * A leg is carried rather than dropped in either case for the same reason: the user pulled that leg
 * out deliberately, and discarding it because they adjusted the line would be the tool deciding that
 * their intent was a plain measuring line again.
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
  const plain = {
    start: endpoint === 'start' ? pointer : measurement.start,
    end: endpoint === 'start' ? measurement.end : pointer,
  };
  if (measurement.legEnd === undefined) return plain;
  // The leg rides on the vertex, so it moves only when the vertex is the end being dragged.
  const movesVertex = (endpoint === 'start' ? 'start' : 'end') === (measurement.legAt === 'start' ? 'start' : 'end');
  if (!movesVertex) return carryRulerLeg({ ...plain, legEnd: measurement.legEnd, legAt: measurement.legAt });
  const from = endpoint === 'start' ? measurement.start : measurement.end;
  return carryRulerLeg({
    ...plain,
    legEnd: { x: measurement.legEnd.x + (pointer.x - from.x), y: measurement.legEnd.y + (pointer.y - from.y) },
    legAt: measurement.legAt,
  });
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
  /**
   * The fit the paint effect draws at, as state rather than off `dimensionsRef`.
   *
   * A ref is the wrong source for it here because a ref that changes without a render cannot be an
   * effect dependency: reading it left the line at the width it was drawn with until the next pointer
   * event, so a window resize showed a hairline on screen.
   *
   * It starts at 1 and is corrected in a layout effect below, which is the sanctioned way to derive
   * state from a ref — seeding the `useState` initializer would read `dimensionsRef.current` during
   * render, which `react-hooks/immutability` forbids, and a plain `useEffect` is too late to matter.
   * Declared above the resize callback because that callback closes over `setFitScale`.
   */
  const [fitScale, setFitScale] = useState(1);

  // The hook holds `onResize` in a ref, so this only has to be stable enough not to churn anything —
  // an empty dependency list is that, and there is no per-render identity to pay for.
  const handleFitResize = useCallback((fit: { scale: number }) => setFitScale(fit.scale), []);
  const { toolArgs } = useCurrentTool();
  const measurement = useRulerMeasurement();

  const { getLocalCoords, dimensionsRef, isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } =
    usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: handleFitResize });

  const draftRef = useRef<RulerDraft | null>(null);

  // Before paint, so the first painted frame is already at the fitted width rather than a frame late.
  useLayoutEffect(() => {
    setFitScale(dimensionsRef.current.scale);
  }, [dimensionsRef]);

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
    /**
     * `Shift` is a no-op on a MOVE, and deliberately so.
     *
     * Adobe's sentence for the modifier is "holding the Shift key while you drag has the additional
     * function of ensuring that the line is kept straight" — the LINE, and a move cannot change the
     * line's straightness because it translates the line rather than redrawing it. Snapping the
     * pointer about the press point instead constrains the direction of TRAVEL, which is not what
     * Shift says and is visibly wrong: the 45-degree snap of a travel vector moves the line somewhere
     * other than under the cursor, leaving a dragged line tens of pixels away from the pointer that
     * is dragging it. For a `resize` the modifier does the documented thing, because there the
     * dragged end really is the line's angle.
     */
    if (!event.shiftKey || draft.mode === 'move') return pointer;
    return constrainRulerAngle(draft.anchor, pointer);
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
      const endpoint = nearestEndpoint(measurement, pointer);
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
    //
    // ONLY THOSE TWO. Adobe scopes the gesture to the LINE, and a resize or a protractor drag is not
    // the line — applying this to all four modes meant that a line lying within a pixel of the frame
    // border lost its whole measurement because the user dragged one END one pixel out, and that
    // Alt-dragging a leg past the edge deleted the line and the leg together. Both were deletions the
    // user did not ask for, unrecoverable, because the tool records no history and Clear is then the
    // only route left.
    if (draft.mode !== 'resize' && draft.mode !== 'protractor' && !isInsideFrame(pointer, totalSize)) {
      clearRulerMeasurement();
      return;
    }

    /**
     * A press that never moved is a CLICK, and a click is not one of Adobe's four gestures.
     *
     * Left as a published measurement it is the worst outcome available: a zero-length line the bar
     * reports as 0 px, which then owns the pointer's next drag — the press that made it lands on its
     * endpoint, so the line the user is trying to draw is MOVED instead of replaced — and which has
     * to be dismissed with Clear before measuring anything else. So a collapsed release puts back the
     * line that stood before the press, which is nothing when there was nothing.
     *
     * It is stated for `measure` AND `protractor` because an Option-click on an endpoint is the same
     * non-gesture, and treating it as one used to publish `draft.base` — a line carrying
     * `legAt: 'start'` with NO `legEnd`, which is the one shape the field's own contract forbids: a
     * vertex with no leg to hang off. `draft.replaced` is the untouched measurement instead, so an
     * Alt-click leaves the line exactly as it was.
     */
    const collapsed = pointer.x === draft.from.x && pointer.y === draft.from.y;
    if ((draft.mode === 'measure' || draft.mode === 'protractor') && collapsed) {
      setRulerMeasurement(draft.replaced);
      return;
    }

    // Published from the same expression as the last move, so a released line is exactly the line
    // the pointer was holding.
    setRulerMeasurement(lineFor(draft, pointer));
  };

  /**
   * A gesture that ended without a release — a touch pan, or a browser-taken pointer.
   *
   * Both halves, and what each is for is NOT the same reason.
   *
   * The hook's own `pointercancel` listener (`src/hooks/usePointerPosition.ts`, the
   * `addEventListener('pointercancel', …)` effect beside `isPointerUpValid`) releases the pointer it
   * was tracking, so on its own it is enough for the CAPTURE and not for the DRAFT: the ref below
   * would survive, and the next `pointermove` carrying a reused mouse pointer id would republish the
   * abandoned line. `releasePointer()` is here for symmetry with the sibling tool areas and for the
   * case where the React handler runs for a pointer the hook had already let go; the draft clearing
   * is the half that is genuinely this component's to do.
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

/**
 * Which end of `line` a press at `point` grabs, or `null` when it is near neither.
 *
 * The NEAREST one, and the comparison is by distance rather than by testing `start` first. The two
 * radii are the same size, so on any line shorter than twice it both ends are within reach at once —
 * a 10 px line is inside both almost everywhere — and checking `start` first makes the FAR end win
 * whenever the two overlap, which is the case the comment above the call site names: a press near
 * the middle of a short line would pivot about the endpoint the pointer is not on.
 */
const nearestEndpoint = (line: RulerMeasurement, point: Point): 'start' | 'end' | null => {
  const toStart = Math.hypot(point.x - line.start.x, point.y - line.start.y);
  const toEnd = Math.hypot(point.x - line.end.x, point.y - line.end.y);
  if (toStart > RULER_ENDPOINT_HIT_RADIUS && toEnd > RULER_ENDPOINT_HIT_RADIUS) return null;
  return toStart <= toEnd ? 'start' : 'end';
};
