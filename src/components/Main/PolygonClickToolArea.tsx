import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { useDoubleClick } from '../../hooks/useDoubleClick.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { clearSelectionDragPreview, publishSelectionDragPreview } from '../../hooks/selection-drag-preview.ts';
import {
  createCommittedPolygonSelection,
  distanceBetweenPoints,
  drawSelectionAnchors,
  findSelectionAnchorAtPoint,
  getSelectionAtPoint,
  hasSameSelectionGeometry,
  moveSelectionAnchor,
  moveSelectionByDelta,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, type DocumentFrame } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';

const MIN_POINTS_FOR_SELECTION = 3;
const CLOSE_START_THRESHOLD = 10; // px in image coordinate space
const DOUBLE_CLICK_DISTANCE_THRESHOLD = 12;
const FREEHAND_MIN_POINT_DISTANCE = 2;

type PolygonClickToolProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * What every drag carries, whichever of the two kinds it is.
 *
 * `pointerId` is what makes the drag belong to one pointer: a second pointer's
 * move or release reaches these handlers and neither may steer or end a gesture
 * it did not start, and the drag is captured on `handlePointerDown` so the
 * release reaches this surface even from outside it — but capture is per-element
 * and does not make a second pointer's events about this drag. `baseline` is the
 * store's selection the drag began on, kept beside the moving `selection`
 * because the move builders replace the latter with a new object on every
 * pointer move — the geometry the gesture started from is otherwise gone by the
 * time the drag is committed.
 */
type SelectionDragBase = {
  pointerId: number | null;
  baseline: Selection;
  selection: Selection;
};

type SelectionDragState =
  | ({
      type: 'anchor';
      anchorIndex: number;
    } & SelectionDragBase)
  | ({
      type: 'selection';
      origin: Point;
    } & SelectionDragBase);

function drawPolygonOverlay({
  ctx,
  selections,
  points,
  preview,
  isFreehand,
  closePath,
  documentFrame,
  scale,
}: {
  ctx: CanvasRenderingContext2D;
  selections: Selection[];
  points: Point[];
  preview: Point | null;
  isFreehand: boolean;
  closePath: boolean;
  documentFrame: DocumentFrame;
  scale: number;
}) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // `drawSelectionAnchors` resets the alpha itself, but the draft polygon below is drawn by this
  // function on the same shared context and writes `strokeStyle`/`lineWidth` with no alpha of its
  // own, so the reset has to happen before both rather than only inside the anchors.
  resetOverlayAlpha(ctx);
  selections.forEach((selection) => drawSelectionAnchors(ctx, selection, documentFrame, scale));

  if (points.length === 0) return;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  if (closePath && points.length >= MIN_POINTS_FOR_SELECTION) {
    ctx.lineTo(points[0].x, points[0].y);
  }

  ctx.strokeStyle = 'rgba(0,123,255,0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();

  if (isFreehand && points.length >= MIN_POINTS_FOR_SELECTION) {
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,123,255,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(points[0].x, points[0].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw anchors for polygonal lasso only. Freehand paths can have hundreds of sampled points.
  if (isFreehand) {
    const start = points[0];
    const end = points[points.length - 1];
    [start, end].forEach((point, index) => {
      ctx.beginPath();
      ctx.fillStyle = index === 0 ? 'white' : 'rgba(0,123,255,0.9)';
      ctx.strokeStyle = index === 0 ? 'rgba(0,123,255,1)' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.arc(point.x, point.y, index === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  } else {
    for (let i = 0; i < points.length; i++) {
      ctx.beginPath();
      ctx.fillStyle = 'white';
      ctx.strokeStyle = i === 0 ? 'rgba(0,123,255,1)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 2;
      ctx.arc(points[i].x, points[i].y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (!preview) return;

  const last = points[points.length - 1];
  const canCloseAtStart =
    points.length >= MIN_POINTS_FOR_SELECTION && distanceBetweenPoints(preview, points[0]) < CLOSE_START_THRESHOLD;
  if (canCloseAtStart) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,200,0,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(points[0].x, points[0].y);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,200,0,0.9)';
    ctx.arc(points[0].x, points[0].y, 7, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(preview.x, preview.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

export const PolygonClickToolArea = ({ className, overlayCtxRef }: PolygonClickToolProps) => {
  const [{ containerRef, selections, totalSize, documentFrame: currentFrame }, dispatch] = useStore();
  // `clearSelections` is gone with `removeLastAnchor`'s empty-list arm: a
  // Backspace aimed at nothing is a no-op now, not a deselect. `commitSelection`
  // stays, and is the one writer this component owns.
  const { commitSelection } = useSelectionHistory();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { toolArgs } = useCurrentTool();

  const isFreehand = (toolArgs?.toolName ?? '') === 'freehand-lasso';
  const selectionSourceTool = isFreehand ? 'freehand-lasso' : 'polygonal-lasso';

  const pointsRef = useRef<Point[]>([]);
  const previewRef = useRef<Point | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const freehandDrawingRef = useRef(false);
  const freehandPointerIdRef = useRef<number | null>(null);
  const selectionPointerIdRef = useRef<number | null>(null);
  const doubleClickResetRef = useRef<() => void>(() => {});

  // The draft's anchors live in `pointsRef`, and a render may not read a ref
  // (`react-hooks/refs`), so the `Backspace`/`Delete` registrations cannot gate
  // on the list itself. This mirrors "the draft has an anchor to pop" into
  // state, written by the same handlers that mutate the list, and it is the
  // draft's own value: nothing outside this component can clear it, so the
  // registrations cannot close while the anchors are still on the overlay.
  // The store's `selectionDraft` could — the `'move'` commit a selection drag
  // publishes at release, and the sidebar deselect, both write `idle` to it
  // without touching this draft, and a drag is reachable mid-draft because
  // `handlePointerDown` hit-tests committed selections before it refuses to
  // start a point. Either left `Backspace` silently doing nothing against
  // anchors that were still on the overlay.
  const [hasDraftAnchors, setHasDraftAnchors] = useState(false);

  function syncDraftAnchorGate() {
    setHasDraftAnchors(pointsRef.current.length > 0);
  }

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });
  const containScale = useContainScale(containerRef, totalSize);

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Give up the selection capture and the claim it took, and only if both are ours.
   *
   * Memoized with an empty dependency list because it reads only refs and calls only
   * module functions — which is what makes it a STABLE dependency rather than a
   * missing one. `takeSelectionDrag` below and the unmount cleanup both name it, and
   * an unmemoized version would mean either an eslint warning or an effect that
   * re-ran — and therefore released, and ended a live drag — on every render.
   */
  const releaseSelectionPointer = useCallback((event?: PointerEvent<HTMLDivElement>) => {
    const pointerId = selectionPointerIdRef.current;
    selectionPointerIdRef.current = null;

    releaseDocumentGesture('polygon-selection', pointerId);

    if (pointerId === null || !event) return;

    try {
      event.currentTarget.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released.
    }
  }, []);

  /**
   * Take the running drag out of the ref in one synchronous step, and give up the
   * document claim it holds.
   *
   * Read and clear are the same step on purpose. `handlePointerUp` is the only
   * commit point, and every other route out of a gesture is an abort, so a route
   * that read the drag and cleared it in two statements could interleave with a
   * later event between them and hand the same drag to a second commit. Handing
   * the drag out of the ref is the only thing any of these routes does: the
   * abort routes call this and drop the result, `handlePointerUp` calls this and
   * commits the result, and the first of the two to run wins.
   *
   * THE RELEASE LIVES HERE, NOT AT THE COMMIT. Every route that ENDS a drag
   * passes through this function — pointerup, pointercancel, the pointerdown that
   * displaces a running one, and the unmount cleanup — so one call covers all of
   * them at zero added cost. `pointerleave` is deliberately not on that list: a
   * captured drag is interrupted by it, not ended by it, and the release still
   * arrives. A gate with no cancel route is worse than no gate: the claim would
   * outlive the gesture and the keyboard would stay dead with nothing on screen to
   * explain it. `releaseSelectionPointer` is idempotent and ignores a release it
   * does not own, so the abort routes can call it unconditionally.
   *
   * The ants preview is dropped here too, and UNCONDITIONALLY, for the reason
   * `releaseDocumentGesture` is: a conditional clear is a site a later route can forget,
   * and a leaked entry has no local symptom to point at it — the ants loop reads the
   * slot fresh every frame, so a stale one keeps painting a frozen border for the rest of
   * the session. Every route that ENDS a drag arrives here, so this is the whole teardown.
   *
   * Memoized, and so is the release it calls, so the identity below is stable for the
   * component's lifetime: the unmount cleanup can name this function as a dependency
   * and therefore still run ONCE, while a plain component-body function could only be
   * omitted — and re-running that cleanup on every render would end a live drag, which
   * is exactly what the cleanup is for.
   */
  const takeSelectionDrag = useCallback(
    (event?: PointerEvent<HTMLDivElement>): SelectionDragState | null => {
      releaseSelectionPointer(event);
      clearSelectionDragPreview();

      const drag = selectionDragRef.current;
      selectionDragRef.current = null;

      return drag;
    },
    [releaseSelectionPointer]
  );

  const finishSelection = ({ cancelIncomplete = false }: { cancelIncomplete?: boolean } = {}) => {
    const oldPoints = pointsRef.current;
    if (oldPoints.length < MIN_POINTS_FOR_SELECTION) {
      if (cancelIncomplete && oldPoints.length > 0) {
        resetInteractionState();
        dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      }

      return;
    }

    const selection = createCommittedPolygonSelection({
      id: uuidv4(),
      points: oldPoints.map((point) => canvasToDocumentPoint(point, documentFrame)),
      sourceTool: selectionSourceTool,
    });
    if (!selection) return;

    // One of the two commit points in this component — the other is
    // `handlePointerUp`, which commits a drag of an already-committed selection
    // as a `'move'`. Between them, every gesture path is transient draft state:
    // the per-anchor `pointsRef.current.push` in `handlePointerDown`, the
    // per-sample `appendFreehandPoint` in `handlePointerMove`, and the
    // `START_SELECTION_DRAFT` dispatch that opens the draft all leave the store's
    // selection state untouched, so the store is byte-identical at this line no
    // matter how many clicks or pointer moves the gesture took. That is what makes
    // one call here — not one per anchor — the whole story for a multi-click
    // gesture.
    //
    // Every route into it is a gesture end, not a step: the `useDoubleClick`
    // close in `handlePointerDown`, `handleContextMenu`, the Enter shortcut, and
    // `finishFreehandSelection` on pointer release/leave. The `before` snapshot is
    // not captured here — `commitSelection` reads the live store, exactly as the
    // magic wand and the rectangle call sites do.
    //
    // `'create'`, never `'move'`: the payload is a freshly minted `uuidv4()`
    // polygon, so it appends and activates a new selection rather than replacing
    // the geometry of an existing one. An anchor or geometry drag reuses an
    // existing selection's `id` instead, and reaches the writer through the other
    // commit point.
    commitSelection(selection, 'create');

    resetInteractionState();
  };

  const doubleClick = useDoubleClick(finishSelection, {
    distanceThreshold: DOUBLE_CLICK_DISTANCE_THRESHOLD,
    minPointsForDetection: MIN_POINTS_FOR_SELECTION - 1,
  });
  const { handleClick: handleDoubleClick, reset: resetDoubleClick } = doubleClick;

  useEffect(() => {
    doubleClickResetRef.current = resetDoubleClick;
  }, [resetDoubleClick]);

  function getPointerId(event: PointerEvent<HTMLDivElement>): number | null {
    return typeof event.pointerId === 'number' ? event.pointerId : null;
  }

  function isActiveFreehandPointer(event: PointerEvent<HTMLDivElement>): boolean {
    const activePointerId = freehandPointerIdRef.current;

    return activePointerId === null || activePointerId === getPointerId(event);
  }

  /**
   * Take the surface's pointer capture for a freehand stroke, and claim the
   * document.
   *
   * THE CLAIM IS TAKEN FIRST, AND THE REF ONLY WHEN IT SUCCEEDS. Every other claim
   * site in the app — `DrawToolArea`, `ShapeToolArea`, `EraserToolArea`,
   * `RectangularSelectionToolArea`, and the drag-handle half of `MoveToolArea` —
   * writes its ref under `if (claim(...))`; this one wrote it before the call and
   * threw the answer away, and the ref is what every release route names. A press
   * that lost the race therefore left the ref on a pointer that owns nothing: the
   * winner's release then read a ref that was not its own and returned without
   * releasing, and the loser's release named an id the claim was never taken with.
   * Nothing after that could release the claim, and with `KeyboardEventsProvider`
   * mounted once in `App.tsx` every document-mutating shortcut stayed dead until a
   * page reload. `handlePointerDown` refuses a second press while a stroke is
   * running, so the race is unreachable here — but a discarded return value is a
   * defect on its own, and the guard that closes it belongs to the call, not to the
   * caller. (The selection-drag pair below writes its ref the same unsafe way and is
   * left alone: `handlePointerDown` displaces a running drag on every press before it
   * reaches there, so its claim is always closed first, and there is no second
   * claimant for this kind.)
   *
   * The capture is not conditional on the pointer id being real, because the two
   * answer different questions: capture needs a real pointer id to ask the browser
   * for, and the document claim only needs an identity to record.
   *
   * Returns whether this press owns the document, so a caller can decline to draw
   * a stroke it cannot close.
   */
  function captureFreehandPointer(event: PointerEvent<HTMLDivElement>): boolean {
    const pointerId = getPointerId(event);

    if (!claimDocumentGesture('freehand-lasso', pointerId)) return false;

    freehandPointerIdRef.current = pointerId;
    freehandDrawingRef.current = true;

    if (pointerId === null) return true;

    try {
      event.currentTarget.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is not available in some test/browser fallback environments.
    }

    return true;
  }

  /**
   * Give up the freehand capture and the claim it took.
   *
   * Memoized with an empty dependency list for the reason
   * `releaseSelectionPointer` below spells out: the unmount cleanup names it, and
   * stability is what makes naming it correct rather than a warning — or an effect
   * that re-ran the release on every render.
   */
  const releaseFreehandPointer = useCallback((event?: PointerEvent<HTMLDivElement>) => {
    const pointerId = freehandPointerIdRef.current;
    freehandPointerIdRef.current = null;
    freehandDrawingRef.current = false;

    // A release that names no open claim, a different kind, or a different
    // pointer is ignored by `releaseDocumentGesture`, so every abort route can
    // call this unconditionally — and the claim is given up BEFORE the capture,
    // so the keyboard is never unblocked by a route that then fails to tear the
    // stroke down.
    releaseDocumentGesture('freehand-lasso', pointerId);

    if (pointerId === null || !event) return;

    try {
      event.currentTarget.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released.
    }
  }, []);

  /**
   * Take the surface's pointer capture for a selection drag, and claim the
   * document.
   *
   * The capture is what makes a drag released outside the surface still arrive:
   * without it `pointerleave` is the last event this surface ever sees, so a
   * completed move — one the user watched happen — was discarded with no history
   * entry at all, while the rectangle (which captures) committed the identical
   * gesture. This is the freehand pair above, copied rather than generalised: two
   * of the same shape, differing only in what they release, is easier to keep
   * honest than one pair with a flag.
   */
  function captureSelectionPointer(event: PointerEvent<HTMLDivElement>) {
    const pointerId = getPointerId(event);
    selectionPointerIdRef.current = pointerId;

    claimDocumentGesture('polygon-selection', pointerId);

    if (pointerId === null) return;

    try {
      event.currentTarget.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is not available in some test/browser fallback environments.
    }
  }

  function clampToImage(point: Point): Point {
    const maxX = Math.max(0, totalSize.width);
    const maxY = Math.max(0, totalSize.height);

    return {
      x: Math.max(0, Math.min(maxX, point.x)),
      y: Math.max(0, Math.min(maxY, point.y)),
    };
  }

  function isPointInsideImage(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x <= totalSize.width && point.y <= totalSize.height;
  }

  function setCursor(event: PointerEvent<HTMLDivElement>, cursor: string) {
    try {
      event.currentTarget.style.cursor = cursor;
    } catch {
      // Ignore cursor updates in non-DOM test environments.
    }
  }

  function getAnchorSelectionAtPoint(point: Point): Selection | null {
    return (
      selections.find((selection) =>
        selection.isActive ? findSelectionAnchorAtPoint(selection, point, containScale.current) !== null : false
      ) ?? null
    );
  }

  function appendFreehandPoint(point: Point, { force = false }: { force?: boolean } = {}): boolean {
    const points = pointsRef.current;
    const lastPoint = points[points.length - 1];
    if (!lastPoint) {
      points.push(point);
      syncDraftAnchorGate();
      return true;
    }

    if (!force && distanceBetweenPoints(lastPoint, point) < FREEHAND_MIN_POINT_DISTANCE) {
      return false;
    }

    points.push(point);
    syncDraftAnchorGate();
    return true;
  }

  function startFreehandSelection(event: PointerEvent<HTMLDivElement>, coords: Point) {
    // The claim first, and the draft after it: a press that does not own the
    // document must not open a draft and reset the path, because it has no claim
    // to release and its stroke could never be closed out.
    if (!captureFreehandPointer(event)) return;

    pointsRef.current = [coords];
    syncDraftAnchorGate();
    previewRef.current = null;
    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'freehand-lasso' } });
    redrawOverlay();
  }

  function finishFreehandSelection(event: PointerEvent<HTMLDivElement>) {
    if (!freehandDrawingRef.current || !isActiveFreehandPointer(event)) return;

    appendFreehandPoint(clampToImage(getLocalCoords(event)));
    releaseFreehandPointer(event);
    finishSelection({ cancelIncomplete: true });
  }

  function cancelFreehandSelection(event: PointerEvent<HTMLDivElement>) {
    if (!freehandDrawingRef.current || !isActiveFreehandPointer(event)) return;

    releaseFreehandPointer(event);
    const hadDraft = pointsRef.current.length > 0;
    pointsRef.current = [];
    syncDraftAnchorGate();
    previewRef.current = null;
    clearOverlay();

    if (hadDraft) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
    }
  }

  /**
   * The store's selections with the dragged one substituted in.
   *
   * The dragged selection always came out of `selections` — by id, from either
   * `getSelectionAtPoint` or `getAnchorSelectionAtPoint` in `handlePointerDown` —
   * so the substitution replaces exactly the entry that would have been drawn and
   * leaves every other selection's outline alone.
   */
  function withDraggedSelection(dragged: Selection): Selection[] {
    return selections.map((selection) => (selection.id === dragged.id ? dragged : selection));
  }

  /**
   * Repaint the whole overlay.
   *
   * `selectionOverride` exists for the drag branch only. The running drag lives
   * in `selectionDragRef` and never reaches the store until gesture end, so the
   * preview has to be painted from the ref's geometry while every other committed
   * selection still comes from the store. It is a parameter rather than a second
   * drawing path because `drawPolygonOverlay` already takes its `selections` as
   * an argument, so substituting the array is the whole difference between
   * "preview at the dragged position" and "repaint at the committed position".
   */
  const redrawOverlay = useCallback(
    ({ closePath = false, selectionOverride }: { closePath?: boolean; selectionOverride?: Selection[] } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;
      drawPolygonOverlay({
        closePath,
        ctx,
        isFreehand,
        points: pointsRef.current,
        preview: previewRef.current,
        selections: selectionOverride ?? selections,
        documentFrame,
        scale: containScale.current,
      });
    },
    [documentFrame, isFreehand, overlayCtxRef, selections, containScale]
  );

  /**
   * Abandon the running drag, if any, and repaint the overlay from the store.
   *
   * The repaint is the load-bearing part, and it is `redrawOverlay` rather than
   * `clearOverlay`. The store is never written during a drag, so `selections` —
   * and with it `redrawOverlay`'s identity and the effect that calls it — does
   * not change while the pointer is down. An abort that only cleared would wipe
   * the whole overlay, including the committed selections' outlines, with no
   * state change to bring them back, and they would stay gone until something
   * else repainted. Repainting from the store is also exactly the right picture:
   * the drag never reached the store, so the overlay must show the un-moved
   * selection, which is the snap-back an abandoned drag now gets.
   */
  function abortSelectionDrag(): SelectionDragState | null {
    const drag = takeSelectionDrag();
    if (!drag) return null;

    redrawOverlay();

    return drag;
  }

  function resetInteractionState() {
    pointsRef.current = [];
    // Every route that ends a draft lands here — the commit at
    // `finishSelection`, Escape, and `removeLastAnchor`'s last vertex — so this
    // is where the gate closes. It is the only one of the two `pointsRef.current
    // = []` sites that runs while the component is still mounted; the other is
    // the unmount cleanup, where the registrations are already gone.
    syncDraftAnchorGate();
    previewRef.current = null;
    // The route, not the two ref writes this used to inline: only the route gives
    // up the document claim, and a draft reset with a freehand stroke's claim
    // still open is exactly how a leaked claim outlives its gesture.
    releaseFreehandPointer();
    doubleClickResetRef.current();
    clearOverlay();
    // The repaint is UNCONDITIONAL, and that is the whole guarantee. `clearOverlay`
    // has just wiped the committed outlines, and the only other repaint in this
    // component is an effect keyed on `redrawOverlay`, whose identity depends on
    // `selections` — the dispatch that usually accompanies a reset
    // (`CANCEL_SELECTION_DRAFT`) returns the SAME `selections` array, so that
    // effect provably cannot re-run and the outlines have no other path back to
    // the canvas. `abortSelectionDrag` alone is not enough: it returns `null` and
    // repaints nothing when no drag was running, which is every route that reaches
    // this while a polygon is being drawn.
    //
    // `redrawOverlay` is idempotent — `drawPolygonOverlay` clears the canvas
    // itself before it draws — so calling it after `abortSelectionDrag`'s own
    // repaint costs one clear and one outline walk, and buys a reset that always
    // restores what it cleared. `abortSelectionDrag` KEEPS its repaint: it is on
    // `handlePointerCancel` and `handlePointerDown`, neither of which routes
    // through here.
    abortSelectionDrag();
    redrawOverlay();
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    // A freehand stroke owns this surface for as long as it runs, and this
    // component cannot ask the hook the question every other tool area asks:
    // `usePointerPosition` is destructured for `getLocalCoords` alone, so no
    // `isPointerDownValid` refuses the second press for it. The stroke owns the
    // pointer ref every release route names, so a press that displaced it left the
    // drawing pointer unable to release its own claim — a leaked claim, and a
    // document with no working shortcuts until the page reloads. This is the
    // `isPointerDownValid` discipline, enforced here against this surface's own
    // stroke; the displacement rules below are the same discipline for the drag.
    if (freehandDrawingRef.current) return;

    // A drag belongs to one pointer. This surface captures a selection drag on
    // pointerdown, so a second primary press is what displaces the running one
    // rather than a stray move: without this, the second press would be assigned
    // `selectionDragRef` below, over the running drag with no commit, and its
    // accumulated geometry would be dropped silently while pointer 1's release
    // committed pointer 2's gesture, whose origin was hit-tested against the
    // geometry the store is still showing — so the preview snaps backwards before
    // it lands. Ending the displaced drag through the shared abort makes the
    // outcome deterministic instead, and the repaint is what snaps the abandoned
    // preview back.
    abortSelectionDrag();

    const coords = getLocalCoords(event);
    const documentCoords = canvasToDocumentPoint(coords, documentFrame);

    const activeSelection = getSelectionAtPoint(selections, documentCoords);
    const activeAnchorSelection = getAnchorSelectionAtPoint(documentCoords);

    if (activeAnchorSelection) {
      const anchorIndex = findSelectionAnchorAtPoint(activeAnchorSelection, documentCoords, containScale.current);
      if (anchorIndex !== null) {
        selectionDragRef.current = {
          type: 'anchor',
          anchorIndex,
          pointerId: getPointerId(event),
          baseline: activeAnchorSelection,
          selection: activeAnchorSelection,
        };
        // Captured HERE and not at the top of the handler: the branches below
        // that add an anchor are the multi-click polygonal workflow, and
        // capturing a click that is not a drag would keep the surface capturing
        // across an arbitrarily long run of clicks.
        captureSelectionPointer(event);
        return;
      }
    }

    if (activeSelection) {
      selectionDragRef.current = {
        type: 'selection',
        origin: documentCoords,
        pointerId: getPointerId(event),
        baseline: activeSelection,
        selection: activeSelection,
      };
      captureSelectionPointer(event);
      return;
    }

    if (selections.some((selection) => selection.isActive) && pointsRef.current.length === 0) {
      return;
    }

    if (isFreehand) {
      if (!isPointInsideImage(coords)) return;

      startFreehandSelection(event, clampToImage(coords));
      return;
    }

    if (handleDoubleClick(coords, pointsRef)) {
      return;
    }

    if (pointsRef.current.length === 0) {
      dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: selectionSourceTool } });
    }

    pointsRef.current.push(coords);
    syncDraftAnchorGate();
    previewRef.current = null;

    redrawOverlay();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    // The single commit point for a drag, and the reason a selection drag is
    // captured on pointerdown: with the capture, a release that lands outside the
    // surface still arrives here, so a move the user watched happen commits
    // exactly as it would have inside. That is the same guarantee `useRect`
    // already gives the rectangle, and the two selection tools disagreeing about
    // it was an accident of implementation, not a decision.
    //
    // The ref is read rather than taken here on purpose. A release from a pointer
    // that did not start the drag must not consume it either: taking it
    // unconditionally would let pointer 1's release destroy pointer 2's gesture,
    // so ownership is checked first and only the owning release ends the drag.
    // `takeSelectionDrag` also gives up the document claim, so the keyboard is
    // open again by the time `commitSelection` appends.
    const runningDrag = selectionDragRef.current;
    if (runningDrag && runningDrag.pointerId === getPointerId(event)) {
      takeSelectionDrag(event);

      // Gated on DISPLACEMENT, not on the drag having been started. Every real
      // click emits at least one pointer move, and each one rebuilds the
      // selection through a builder that bumps `metadata.movedAtVersion`, so
      // `commitSelection`'s deep-equal guard cannot tell a drag that moved from
      // one that moved by nothing — and `COMMIT_DOCUMENT_EDIT` always sets
      // `hasUnsavedChanges`, so a click that only selected something would
      // otherwise add an undo step and raise the discard-unsaved-changes prompt.
      // Geometry is what the move builders actually change, and the preview is
      // already drawn from the final geometry, so a suppressed commit leaves the
      // overlay showing exactly the picture it is skipping the append for — no
      // repaint needed on this path.
      if (!hasSameSelectionGeometry(runningDrag.baseline, runningDrag.selection)) {
        // `'move'`, not `'create'`: the dragged selection carries the id of the
        // already-committed selection the drag began on, so this replaces its
        // geometry instead of appending a second selection.
        commitSelection(runningDrag.selection, 'move');
      }
      return;
    }

    if (isFreehand) {
      finishFreehandSelection(event);
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    // Freehand only, and that is a consequence of the capture rather than a
    // policy. A selection drag captured on pointerdown is not ended by leaving
    // the surface: the browser follows an interruption of a captured pointer with
    // a release on the CAPTURING element, so the `up` still arrives and
    // `handlePointerUp` commits the move — which is the rectangle's behaviour and
    // the reason a move the user watched happen is not thrown away here. The
    // freehand stroke below takes its own capture, but finishing on leave is its
    // design: a lasso closed by leaving the surface is a gesture the user
    // completed, and it is finished by the same call on leave and on release.
    if (isFreehand) {
      finishFreehandSelection(event);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    // UNCHANGED by the capture, deliberately. A cancel is genuinely terminal
    // even for a captured pointer — the browser has decided this gesture will
    // never complete, which is the one case where a leave and a release really
    // are the same thing — and `takeSelectionDrag` inside the abort gives up the
    // document claim on the way out.
    if (abortSelectionDrag()) return;

    if (isFreehand) {
      cancelFreehandSelection(event);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = getLocalCoords(event);
    const documentCoords = canvasToDocumentPoint(coords, documentFrame);

    const selectionDrag = selectionDragRef.current;
    if (selectionDrag) {
      // A drag belongs to the pointer that started it. Capture stops the events
      // leaving the surface, not a second pointer's events from arriving, and
      // honouring a foreign move would steer a gesture it has no claim to.
      if (selectionDrag.pointerId !== getPointerId(event)) return;
      // The running drag stays in the ref and the store is left alone, so a move
      // of N pointer events writes N previews and no history. The overlay is
      // repainted on every move from the ref's geometry; the store repaint below
      // cannot do it, because nothing about the store changed.
      //
      // Both arms below also publish the geometry to the ants loop, which is the only
      // way the border can follow this drag at all: `useSelectionMarchingAnts` reads
      // `selection-drag-preview.ts` every frame, so it has to be handed geometry the
      // store has never seen. It cannot be handed it by the overlay instead, because
      // `drawPolygonOverlay` above paints anchors and the draft path and never a dashed
      // contour, and the ants paint onto a canvas of their own that this component
      // holds no reference to.
      //
      // ONLY these two arms. The arms further down are building a new path, which is
      // not the committed selection moved but a different shape, so a `follow` there
      // would drag a border the user never touched — the distinction
      // `SelectionDragPreview`'s docblock spells out, and the reason they publish
      // nothing rather than publishing a second kind.
      if (selectionDrag.type === 'anchor') {
        const nextSelection = moveSelectionAnchor(selectionDrag.selection, selectionDrag.anchorIndex, documentCoords);
        selectionDragRef.current = { ...selectionDrag, selection: nextSelection };
        publishSelectionDragPreview({ kind: 'follow', selection: nextSelection });
        redrawOverlay({ selectionOverride: withDraggedSelection(nextSelection) });
        return;
      }

      const delta = { x: documentCoords.x - selectionDrag.origin.x, y: documentCoords.y - selectionDrag.origin.y };
      const nextSelection = moveSelectionByDelta(selectionDrag.selection, delta);
      selectionDragRef.current = { ...selectionDrag, origin: documentCoords, selection: nextSelection };
      publishSelectionDragPreview({ kind: 'follow', selection: nextSelection });
      redrawOverlay({ selectionOverride: withDraggedSelection(nextSelection) });
      return;
    }

    // In freehand-lasso mode collect points continuously after the initial click
    if (isFreehand) {
      if (!freehandDrawingRef.current || !isActiveFreehandPointer(event)) {
        if (getAnchorSelectionAtPoint(documentCoords)) {
          setCursor(event, 'grab');
        } else if (getSelectionAtPoint(selections, documentCoords)) {
          setCursor(event, 'move');
        } else {
          setCursor(event, 'crosshair');
        }

        return;
      }

      if (appendFreehandPoint(clampToImage(coords))) {
        redrawOverlay();
      }
      return;
    }

    // Polygonal mode: only preview line
    if (pointsRef.current.length === 0) {
      if (getAnchorSelectionAtPoint(documentCoords)) {
        setCursor(event, 'grab');
      } else if (getSelectionAtPoint(selections, documentCoords)) {
        setCursor(event, 'move');
      } else {
        setCursor(event, 'crosshair');
      }
      return;
    }

    previewRef.current = coords;

    // show pointer hint when near start
    const canClose =
      pointsRef.current.length >= MIN_POINTS_FOR_SELECTION &&
      distanceBetweenPoints(coords, pointsRef.current[0]) < CLOSE_START_THRESHOLD;
    setCursor(event, canClose ? 'pointer' : 'crosshair');

    redrawOverlay();
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    finishSelection();
  };

  function cancelSelectionDraft() {
    if (pointsRef.current.length === 0 && !selectionDragRef.current) return;

    // Escape is an abort, not a commit: a drag caught by this is dropped by
    // `resetInteractionState`, which repaints the store's unchanged selections
    // rather than the dragged one.
    resetInteractionState();
    dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
  }

  function removeLastAnchor() {
    if (isFreehand || selectionDragRef.current) return;

    // No draft means no anchor to remove. The registration is also gated off in
    // that state, so this only guards the handler itself: a stray Backspace
    // reaches the whole app, and clearing the document's committed selections
    // from it appends a deselect the user never asked for. Matches the
    // self-guard `cancelSelectionDraft` and `finishSelection` already have.
    if (pointsRef.current.length === 0) return;

    pointsRef.current.pop();
    syncDraftAnchorGate();
    previewRef.current = null;

    if (pointsRef.current.length === 0) {
      resetInteractionState();
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
      return;
    }

    redrawOverlay();
  }

  // `mutatesDocument: false` on all four, and every one of them is a shortcut
  // about THIS component's own gesture, which is the only reason to claim the
  // exemption. `useKeyboardEvents` refuses document-mutating shortcuts while a
  // gesture holds the document, and a draft is built click by click with the
  // anchors on the overlay: refusing `Escape` would leave no way to cancel it,
  // `Enter` would leave no way to finish it, and `Backspace` would leave no way
  // to fix a misplaced vertex. A drag is not exempt — nothing here ends one —
  // and the drag's own claim is what keeps `mod+z` from landing on the document
  // the pending commit is about to append to.
  useKeyDownShortcut({
    key: 'Escape',
    preventDefault: true,
    allowInInput: true,
    mutatesDocument: false,
    onKeyDown: cancelSelectionDraft,
  });

  useKeyDownShortcut({
    key: 'Enter',
    preventDefault: true,
    allowInInput: true,
    mutatesDocument: false,
    onKeyDown: () => finishSelection(),
  });

  // `enabled` gates the registration on the draft itself: there is an anchor to
  // pop or there is not, and the mirror above is the draft's own count, so no
  // reducer or sidebar action that clears `selectionDraft` can close the key
  // while the anchors are still on the overlay. `allowInInput` stays off:
  // removing a vertex is text editing from the field's point of view, and
  // `preventDefault` would cancel the character the field was asked to delete.
  useKeyDownShortcut({
    key: 'Backspace',
    preventDefault: true,
    enabled: hasDraftAnchors,
    mutatesDocument: false,
    onKeyDown: removeLastAnchor,
  });

  useKeyDownShortcut({
    key: 'Delete',
    preventDefault: true,
    enabled: hasDraftAnchors,
    mutatesDocument: false,
    onKeyDown: removeLastAnchor,
  });

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      // An unmount mid-drag is an abort like any other: the running drag is
      // dropped through the same primitive every other route uses, so a gesture
      // that ends here can never reach the commit point — and that primitive also
      // gives up the document claim, which is what stops an unmount mid-gesture
      // from leaving the keyboard gated for the rest of the session. The freehand
      // route is called for the same reason. The clear below tears the overlay
      // down, so there is nothing left to repaint.
      //
      // Both are named as dependencies because they are memoized with empty
      // dependency lists, so every identity in this array is stable and the
      // cleanup still runs ONCE. The opposite arrangement — leaving a
      // component-body function out of the list — is what this effect used to do,
      // and a `useEffect` that re-ran would run the code above on every render:
      // ending a live drag and releasing its claim mid-gesture.
      takeSelectionDrag();
      // Module state that outlives this mount gets its own reset here, the same shape
      // as `resetDocumentGestures` on `KeyboardEventsProvider`'s cleanup. `takeSelectionDrag`
      // above already drops it for every route that ends a drag; naming it again keeps this
      // effect's guarantee — nothing this component published survives its mount — resting
      // on no other function's internals, which is the whole job of a teardown that can run
      // mid-gesture.
      clearSelectionDragPreview();
      pointsRef.current = [];
      previewRef.current = null;
      releaseFreehandPointer();
      resetDoubleClick();

      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef, releaseFreehandPointer, resetDoubleClick, takeSelectionDrag]);

  return (
    <div
      className={`${className} cursor-crosshair`}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      style={{ userSelect: 'none' }}
    />
  );
};
