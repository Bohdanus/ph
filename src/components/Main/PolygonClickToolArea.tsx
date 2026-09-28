import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { useDoubleClick } from '../../hooks/useDoubleClick.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import {
  createCommittedPolygonSelection,
  distanceBetweenPoints,
  drawSelectionOutline,
  findSelectionAnchorAtPoint,
  getSelectionAtPoint,
  hasSameSelectionGeometry,
  moveSelectionAnchor,
  moveSelectionByDelta,
} from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize, type DocumentFrame } from '../../contexts/document-frame.ts';

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
 * `pointerId` is what makes the drag belong to one pointer: this surface takes
 * no capture for a selection drag, so a second pointer's move or release
 * reaches these handlers too, and neither may steer or end a gesture it did not
 * start. `baseline` is the store's selection the drag began on, kept beside the
 * moving `selection` because the move builders replace the latter with a new
 * object on every pointer move — the geometry the gesture started from is
 * otherwise gone by the time the drag is committed.
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
}: {
  ctx: CanvasRenderingContext2D;
  selections: Selection[];
  points: Point[];
  preview: Point | null;
  isFreehand: boolean;
  closePath: boolean;
  documentFrame: DocumentFrame;
}) {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  selections.forEach((selection) => drawSelectionOutline(ctx, selection, documentFrame));

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

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Take the running drag out of the ref in one synchronous step.
   *
   * Read and clear are the same step on purpose. `handlePointerUp` is the only
   * commit point, and every other route out of a gesture is an abort, so a route
   * that read the drag and cleared it in two statements could interleave with a
   * later event between them and hand the same drag to a second commit. Handing
   * the drag out of the ref is the only thing any of these routes does: the
   * abort routes call this and drop the result, `handlePointerUp` calls this and
   * commits the result, and the first of the two to run wins.
   */
  function takeSelectionDrag(): SelectionDragState | null {
    const drag = selectionDragRef.current;
    selectionDragRef.current = null;

    return drag;
  }

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

  function captureFreehandPointer(event: PointerEvent<HTMLDivElement>) {
    const pointerId = getPointerId(event);
    freehandPointerIdRef.current = pointerId;
    freehandDrawingRef.current = true;

    if (pointerId === null) return;

    try {
      event.currentTarget.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is not available in some test/browser fallback environments.
    }
  }

  function releaseFreehandPointer(event?: PointerEvent<HTMLDivElement>) {
    const pointerId = freehandPointerIdRef.current;
    freehandPointerIdRef.current = null;
    freehandDrawingRef.current = false;

    if (pointerId === null || !event) return;

    try {
      event.currentTarget.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released.
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
        selection.isActive ? findSelectionAnchorAtPoint(selection, point) !== null : false
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
    pointsRef.current = [coords];
    syncDraftAnchorGate();
    previewRef.current = null;
    captureFreehandPointer(event);
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
      });
    },
    [documentFrame, isFreehand, overlayCtxRef, selections]
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
    freehandPointerIdRef.current = null;
    freehandDrawingRef.current = false;
    doubleClickResetRef.current();
    clearOverlay();
    // After the clear, never before: `clearOverlay` has just wiped the committed
    // outlines, so a drag dropped here has to be followed by a repaint that puts
    // them back. `abortSelectionDrag` is a no-op when no drag was running, which
    // is every route that reaches this while drawing a polygon.
    abortSelectionDrag();
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    // A drag belongs to one pointer. This surface takes no capture for a
    // selection drag, so a second primary press arrives here as an ordinary
    // event and would otherwise be assigned `selectionDragRef` below, over the
    // running drag with no commit: its accumulated geometry would be dropped
    // silently and pointer 1's release would commit pointer 2's gesture, whose
    // origin was hit-tested against the geometry the store is still showing —
    // so the preview snaps backwards before it lands. Ending the displaced drag
    // through the shared abort makes the outcome deterministic instead, and the
    // repaint is what snaps the abandoned preview back.
    abortSelectionDrag();

    const coords = getLocalCoords(event);
    const documentCoords = canvasToDocumentPoint(coords, documentFrame);

    const activeSelection = getSelectionAtPoint(selections, documentCoords);
    const activeAnchorSelection = getAnchorSelectionAtPoint(documentCoords);

    if (activeAnchorSelection) {
      const anchorIndex = findSelectionAnchorAtPoint(activeAnchorSelection, documentCoords);
      if (anchorIndex !== null) {
        selectionDragRef.current = {
          type: 'anchor',
          anchorIndex,
          pointerId: getPointerId(event),
          baseline: activeAnchorSelection,
          selection: activeAnchorSelection,
        };
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
    // The single commit point for a drag. The polygon takes no pointer capture, so
    // `pointerleave` is genuinely terminal rather than an interruption the browser
    // will follow with an `up`: a drag that leaves the surface is one the user
    // abandoned, and it is dropped by `handlePointerLeave` instead. Release is
    // therefore the one event that means "this move happened", and it appends one
    // entry for the whole gesture no matter how many pointer moves preceded it.
    //
    // The ref is read rather than taken here on purpose. A release from a pointer
    // that did not start the drag must not consume it either: taking it
    // unconditionally would let pointer 1's release destroy pointer 2's gesture,
    // so ownership is checked first and only the owning release ends the drag.
    const runningDrag = selectionDragRef.current;
    if (runningDrag && runningDrag.pointerId === getPointerId(event)) {
      takeSelectionDrag();

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
    // Abort, not commit. Deliberately terminal: the polygon's drag has no pointer
    // capture, so dragging out of the window abandons the move, and there is no
    // later `up` to distinguish "let go here" from "left the surface". Adding
    // capture to make a leave a commit would also change the freehand gesture
    // below, which is finished on leave by design.
    if (abortSelectionDrag()) return;

    if (isFreehand) {
      finishFreehandSelection(event);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
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
      // A drag belongs to the pointer that started it. Without capture, a second
      // pointer's move reaches this handler too, and honouring it would steer a
      // gesture it has no claim to.
      if (selectionDrag.pointerId !== getPointerId(event)) return;
      // The running drag stays in the ref and the store is left alone, so a move
      // of N pointer events writes N previews and no history. The overlay is
      // repainted on every move from the ref's geometry; the store repaint below
      // cannot do it, because nothing about the store changed.
      if (selectionDrag.type === 'anchor') {
        const nextSelection = moveSelectionAnchor(selectionDrag.selection, selectionDrag.anchorIndex, documentCoords);
        selectionDragRef.current = { ...selectionDrag, selection: nextSelection };
        redrawOverlay({ selectionOverride: withDraggedSelection(nextSelection) });
        return;
      }

      const delta = { x: documentCoords.x - selectionDrag.origin.x, y: documentCoords.y - selectionDrag.origin.y };
      const nextSelection = moveSelectionByDelta(selectionDrag.selection, delta);
      selectionDragRef.current = { ...selectionDrag, origin: documentCoords, selection: nextSelection };
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

  useKeyDownShortcut({
    key: 'Escape',
    preventDefault: true,
    allowInInput: true,
    onKeyDown: cancelSelectionDraft,
  });

  useKeyDownShortcut({
    key: 'Enter',
    preventDefault: true,
    allowInInput: true,
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
    onKeyDown: removeLastAnchor,
  });

  useKeyDownShortcut({
    key: 'Delete',
    preventDefault: true,
    enabled: hasDraftAnchors,
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
      // that ends here can never reach the commit point. The clear below tears the
      // overlay down, so there is nothing left to repaint.
      takeSelectionDrag();
      pointsRef.current = [];
      previewRef.current = null;
      freehandPointerIdRef.current = null;
      freehandDrawingRef.current = false;
      resetDoubleClick();

      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef, resetDoubleClick]);

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
