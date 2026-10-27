import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useContainScale } from '../../hooks/useContainScale.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import type { FeatherMagneticLassoToolArgs } from '../../tools/featherMagneticLasso.ts';
import { magneticLassoAnchorSpan } from '../../tools/featherMagneticLasso.ts';
import { createCommittedPolygonSelection, distanceBetweenPoints, drawSelectionAnchors } from '../../util/selection.ts';
import {
  createEdgeMapFromCanvas,
  createMagneticSegment,
  pathLength,
  simplifyPath,
  type EdgeMap,
  type MagneticPathOptions,
  type MagneticSegmentResult,
} from '../../util/magneticLasso.ts';
import { canvasToDocumentPoint, documentFrameFromSize, type DocumentFrame } from '../../contexts/document-frame.ts';
import { resetOverlayAlpha } from '../../util/canvas.ts';

const MIN_POINTS_FOR_SELECTION = 3;
const CLOSE_START_THRESHOLD = 10;
const DOUBLE_CLICK_DISTANCE_THRESHOLD = 12;
const DOUBLE_CLICK_TIME_THRESHOLD_MS = 300;
const MIN_AUTO_ANCHOR_TIME_MS = 70;

type FeatherMagneticLassoToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

type LastClickState = {
  point: Point;
  time: number;
};

type PendingPointerMove = {
  coords: Point;
  magneticEnabled: boolean;
};

function drawFeatherMagneticOverlay({
  ctx,
  selections,
  anchors,
  points,
  preview,
  args,
  documentFrame,
  scale,
}: {
  ctx: CanvasRenderingContext2D;
  selections: Selection[];
  anchors: Point[];
  points: Point[];
  preview: MagneticSegmentResult | null;
  args: FeatherMagneticLassoToolArgs;
  documentFrame: DocumentFrame;
  scale: number;
}) {
  const drawPath = (path: Point[]) => {
    if (path.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
  };

  const draftPoints = [...points];
  const previewPath = preview?.path;
  if (previewPath && previewPath.length > 1) {
    draftPoints.push(...previewPath.slice(1));
  }

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // `drawSelectionAnchors` resets the alpha itself, but the draft path below is stroked by this
  // function on the same shared context and writes `strokeStyle`/`lineWidth` with no alpha of its
  // own, so the reset has to happen before both rather than only inside the anchors.
  resetOverlayAlpha(ctx);
  selections.forEach((selection) => drawSelectionAnchors(ctx, selection, documentFrame, scale));
  if (draftPoints.length === 0) return;

  ctx.save();
  if (args.previewFeather && args.featherRadius > 0 && draftPoints.length >= MIN_POINTS_FOR_SELECTION) {
    ctx.strokeStyle = 'rgba(0,123,255,0.14)';
    ctx.lineWidth = Math.max(1, args.featherRadius * 2);
    ctx.setLineDash([]);
    drawPath(draftPoints);
  }

  if (points.length >= 2) {
    ctx.strokeStyle = 'rgba(0,123,255,0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    drawPath(points);
  }

  if (preview?.path && preview.path.length >= 2) {
    ctx.strokeStyle = preview.snap.usedMagnetic ? 'rgba(0,170,90,0.95)' : 'rgba(230,130,0,0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    drawPath(preview.path);
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.fillStyle = preview.snap.usedMagnetic ? 'rgba(0,170,90,0.95)' : 'rgba(230,130,0,0.95)';
    ctx.arc(preview.snappedPoint.x, preview.snappedPoint.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (anchors.length >= MIN_POINTS_FOR_SELECTION && preview?.snappedPoint) {
    const start = anchors[0];
    const canClose = distanceBetweenPoints(preview.snappedPoint, start) <= CLOSE_START_THRESHOLD;
    if (canClose) {
      ctx.beginPath();
      ctx.fillStyle = 'rgba(0,200,0,0.85)';
      ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    ctx.beginPath();
    ctx.fillStyle = i === 0 ? 'white' : 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = i === 0 ? 'rgba(0,123,255,1)' : 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2;
    ctx.arc(anchor.x, anchor.y, i === 0 ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

export const FeatherMagneticLassoToolArea = ({ className, overlayCtxRef }: FeatherMagneticLassoToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize, documentFrame: currentFrame }, dispatch] = useStore();
  // `clearSelections` is gone with `removeLastAnchor`'s empty-list arm: a
  // Backspace aimed at nothing is a no-op now, not a deselect. `commitSelection`
  // stays, and is the one writer this component owns.
  const { commitSelection } = useSelectionHistory();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { toolArgs } = useCurrentTool();
  const args = toolArgs as FeatherMagneticLassoToolArgs;

  const anchorsRef = useRef<Point[]>([]);
  const segmentsRef = useRef<Point[][]>([]);
  const pointsRef = useRef<Point[]>([]);
  const previewRef = useRef<MagneticSegmentResult | null>(null);
  const edgeMapRef = useRef<EdgeMap | null>(null);
  const lastClickRef = useRef<LastClickState | null>(null);
  const lastAutoAnchorTimeRef = useRef(0);
  const pendingPointerMoveRef = useRef<PendingPointerMove | null>(null);
  const pointerMoveFrameRef = useRef<number | null>(null);

  // The draft's anchors live in `anchorsRef`, and a render may not read a ref
  // (`react-hooks/refs`), so the `Backspace`/`Delete` registrations cannot gate
  // on the list itself. This mirrors "the draft has an anchor to pop" into
  // state, written by the same handlers that mutate the list, and it is the
  // draft's own value: nothing outside this component can clear it, so the
  // registrations cannot close while the anchors are still on the overlay.
  // The store's `selectionDraft` could — the sidebar deselect writes `idle` to
  // it without touching the draft — which left `Backspace` silently doing
  // nothing.
  const [hasDraftAnchors, setHasDraftAnchors] = useState(false);

  function syncDraftAnchorGate() {
    setHasDraftAnchors(anchorsRef.current.length > 0);
  }

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });
  const containScale = useContainScale(containerRef, totalSize);

  function clampToImage(point: Point): Point {
    return {
      x: Math.max(0, Math.min(totalSize.width - 1, point.x)),
      y: Math.max(0, Math.min(totalSize.height - 1, point.y)),
    };
  }

  function getMagneticPathOptions(): MagneticPathOptions {
    return {
      edgeContrast: args.edgeContrast,
      maxArea: 32_000,
      searchRadius: args.magneticWidth,
      snapStrength: args.snapStrength,
    };
  }

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  const redrawOverlay = useCallback(() => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    drawFeatherMagneticOverlay({
      anchors: anchorsRef.current,
      args,
      ctx,
      points: pointsRef.current,
      preview: previewRef.current,
      selections,
      documentFrame,
      scale: containScale.current,
    });
  }, [args, documentFrame, overlayCtxRef, selections, containScale]);

  function rebuildPointsFromSegments() {
    const anchors = anchorsRef.current;
    if (anchors.length === 0) {
      pointsRef.current = [];
      return;
    }

    const points: Point[] = [anchors[0]];
    for (const segment of segmentsRef.current) {
      points.push(...segment.slice(1));
    }

    pointsRef.current = points;
  }

  function resetInteractionState() {
    cancelPendingPointerMoveFrame();
    anchorsRef.current = [];
    syncDraftAnchorGate();
    segmentsRef.current = [];
    pointsRef.current = [];
    previewRef.current = null;
    edgeMapRef.current = null;
    lastClickRef.current = null;
    lastAutoAnchorTimeRef.current = 0;
    clearOverlay();
  }

  function cancelPendingPointerMoveFrame() {
    if (pointerMoveFrameRef.current !== null) {
      cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    pendingPointerMoveRef.current = null;
  }

  function processPointerMovePreview({ coords, magneticEnabled }: PendingPointerMove) {
    if (anchorsRef.current.length === 0) return;

    const start = anchorsRef.current[0];
    const shouldClose =
      anchorsRef.current.length >= MIN_POINTS_FOR_SELECTION &&
      distanceBetweenPoints(coords, start) <= CLOSE_START_THRESHOLD;
    const target = shouldClose ? start : coords;
    const segment = makeSegment(target, magneticEnabled);
    if (!segment) return;

    previewRef.current = segment;

    if (!shouldClose && magneticEnabled && maybeCommitAutoAnchor(segment)) {
      redrawOverlay();
      return;
    }

    redrawOverlay();
  }

  function flushPointerMoveFrame() {
    pointerMoveFrameRef.current = null;

    const pending = pendingPointerMoveRef.current;
    pendingPointerMoveRef.current = null;
    if (!pending) return;

    processPointerMovePreview(pending);
  }

  function flushPendingPointerMoveFrame() {
    if (pointerMoveFrameRef.current !== null) {
      cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    const pending = pendingPointerMoveRef.current;
    pendingPointerMoveRef.current = null;
    if (!pending) return;

    processPointerMovePreview(pending);
  }

  function cancelSelectionDraft() {
    if (anchorsRef.current.length === 0) return;

    resetInteractionState();
    dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
  }

  function makeSegment(target: Point, magneticEnabled: boolean): MagneticSegmentResult | null {
    const from = anchorsRef.current[anchorsRef.current.length - 1];
    if (!from) return null;

    return createMagneticSegment({
      cursor: clampToImage(target),
      edgeMap: edgeMapRef.current,
      from,
      magneticEnabled,
      options: getMagneticPathOptions(),
    });
  }

  function commitSegment(segment: MagneticSegmentResult) {
    if (segment.path.length < 2) return;

    segmentsRef.current.push(segment.path);
    anchorsRef.current.push(segment.snappedPoint);
    syncDraftAnchorGate();
    previewRef.current = null;
    rebuildPointsFromSegments();
  }

  function removeLastAnchor() {
    // An empty anchor list does not prove no frame is in flight, so this runs on
    // every path through the handler, before anything else.
    cancelPendingPointerMoveFrame();

    // No draft means no anchor to remove. The registration is also gated off in
    // that state, so this only guards the handler itself: a stray Backspace
    // reaches the whole app, and clearing the document's committed selections
    // from it appends a deselect the user never asked for. Matches the
    // self-guard `cancelSelectionDraft` and `finishSelection` already have.
    if (anchorsRef.current.length === 0) return;

    if (segmentsRef.current.length === 0) {
      cancelSelectionDraft();
      return;
    }

    segmentsRef.current.pop();
    anchorsRef.current.pop();
    syncDraftAnchorGate();
    previewRef.current = null;
    rebuildPointsFromSegments();
    redrawOverlay();
  }

  function appendClosingPath(points: Point[]): Point[] {
    const start = anchorsRef.current[0];
    const last = points[points.length - 1];

    if (!start || !last || distanceBetweenPoints(last, start) <= 1) return points;

    const closingSegment = createMagneticSegment({
      cursor: start,
      edgeMap: edgeMapRef.current,
      from: last,
      magneticEnabled: true,
      options: getMagneticPathOptions(),
    });

    if (closingSegment.path.length <= 2) return points;

    return [...points, ...closingSegment.path.slice(1, -1)];
  }

  function finishSelection() {
    if (anchorsRef.current.length === 0) return;

    flushPendingPointerMoveFrame();

    if (previewRef.current && pathLength(previewRef.current.path) > 1) {
      commitSegment(previewRef.current);
    }

    const rawPoints = appendClosingPath(pointsRef.current);
    if (rawPoints.length < MIN_POINTS_FOR_SELECTION) return;

    const simplifiedPoints = simplifyPath(rawPoints, args.smoothing);
    const finalPoints = simplifiedPoints.length >= MIN_POINTS_FOR_SELECTION ? simplifiedPoints : rawPoints;
    const selection = createCommittedPolygonSelection({
      id: uuidv4(),
      metadata: {
        featherRadius: args.featherRadius,
        magneticLasso: {
          antiAlias: args.antiAlias,
          contrast: args.edgeContrast,
          frequency: args.frequency,
          pathPointCount: finalPoints.length,
          smoothing: args.smoothing,
          snapStrength: args.snapStrength,
          width: args.magneticWidth,
        },
      },
      points: finalPoints.map((point) => canvasToDocumentPoint(point, documentFrame)),
      sourceTool: 'feather-magnetic-lasso',
    });

    if (!selection) {
      cancelSelectionDraft();
      return;
    }

    // This is the ONE commit point for the whole component, and the only place
    // the lasso writes history. Every step before it is transient draft state:
    // `startDraft`, `commitSegment` (per click and per auto-anchor),
    // `maybeCommitAutoAnchor` (per `requestAnimationFrame` flush) and
    // `appendClosingPath` all mutate refs and the overlay, and never dispatch —
    // so the store's selection state is byte-identical at this line however many
    // clicks, moves or frames the gesture took. That is what makes one call here
    // — not one per anchor or per frame — the whole story for the gesture.
    //
    // Every route into it is a gesture end: the close-anchor click and the
    // double-click in `handlePointerDown`, `handleContextMenu`, and the Enter
    // shortcut. The `before` snapshot is not captured here — `commitSelection`
    // reads the live store, exactly as the magic wand and the rectangle call
    // sites do.
    //
    // `'create'`, never `'move'`: the payload is a freshly minted `uuidv4()`
    // polygon, so it appends and activates a new selection. This component has
    // no anchor/geometry drag path at all — `UPDATE_SELECTION` is never
    // dispatched here — so a `'move'` commit is unreachable from this file.
    commitSelection(selection, 'create');
    resetInteractionState();
  }

  function isDoubleClick(coords: Point): boolean {
    const lastClick = lastClickRef.current;
    if (!lastClick || anchorsRef.current.length < MIN_POINTS_FOR_SELECTION) return false;

    return (
      Date.now() - lastClick.time <= DOUBLE_CLICK_TIME_THRESHOLD_MS &&
      distanceBetweenPoints(coords, lastClick.point) <= DOUBLE_CLICK_DISTANCE_THRESHOLD
    );
  }

  function recordClick(coords: Point) {
    lastClickRef.current = { point: coords, time: Date.now() };
  }

  function startDraft(coords: Point, event: PointerEvent<HTMLDivElement>) {
    edgeMapRef.current = createEdgeMapFromCanvas(canvasRef.current, totalSize);

    const segment = createMagneticSegment({
      cursor: coords,
      edgeMap: edgeMapRef.current,
      from: coords,
      magneticEnabled: !event.altKey,
      options: getMagneticPathOptions(),
    });
    const startPoint = segment.snappedPoint;

    anchorsRef.current = [startPoint];
    syncDraftAnchorGate();
    segmentsRef.current = [];
    pointsRef.current = [startPoint];
    previewRef.current = null;
    lastAutoAnchorTimeRef.current = Date.now();
    dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'feather-magnetic-lasso' } });
    redrawOverlay();
  }

  function maybeCommitAutoAnchor(segment: MagneticSegmentResult) {
    const now = Date.now();
    if (now - lastAutoAnchorTimeRef.current < MIN_AUTO_ANCHOR_TIME_MS) return false;
    if (pathLength(segment.path) < magneticLassoAnchorSpan(args.frequency)) return false;

    commitSegment(segment);
    lastAutoAnchorTimeRef.current = now;
    return true;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    cancelPendingPointerMoveFrame();

    const coords = clampToImage(getLocalCoords(event));
    if (anchorsRef.current.length === 0) {
      startDraft(coords, event);
      recordClick(coords);
      return;
    }

    const start = anchorsRef.current[0];
    if (
      anchorsRef.current.length >= MIN_POINTS_FOR_SELECTION &&
      distanceBetweenPoints(coords, start) <= CLOSE_START_THRESHOLD
    ) {
      finishSelection();
      return;
    }

    if (isDoubleClick(coords)) {
      finishSelection();
      return;
    }

    const segment = makeSegment(coords, !event.altKey);
    if (segment) {
      commitSegment(segment);
      redrawOverlay();
    }
    recordClick(coords);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = clampToImage(getLocalCoords(event));
    if (anchorsRef.current.length === 0) return;

    pendingPointerMoveRef.current = { coords, magneticEnabled: !event.altKey };
    if (pointerMoveFrameRef.current !== null) return;

    pointerMoveFrameRef.current = requestAnimationFrame(flushPointerMoveFrame);
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    finishSelection();
  };

  // `mutatesDocument: false` on all four, and every one of them is a shortcut
  // about THIS component's own gesture, which is the only reason to claim the
  // exemption. `useKeyboardEvents` refuses document-mutating shortcuts while a
  // document-committing gesture holds the document, and a lasso here is built
  // click by click with the anchors on the overlay: refusing `Escape` would leave
  // no way to cancel it, `Enter` no way to finish it, and `Backspace` no way to
  // remove a vertex placed against the wrong edge. This component claims no
  // gesture of its own — every step between the first click and `finishSelection`
  // mutates refs and the overlay and dispatches nothing — so the exemption costs
  // nothing: there is no window here for a shortcut to corrupt.
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
    onKeyDown: finishSelection,
  });

  // `enabled` gates the registration on the draft itself: there is an anchor to
  // pop or there is not, and the mirror above is the draft's own count, so no
  // reducer or sidebar action that clears `selectionDraft` can close the key
  // while the anchors are still on the overlay. `allowInInput` stays off:
  // removing an anchor is text editing from the field's point of view, and
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
      if (pointerMoveFrameRef.current !== null) {
        cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }
      pendingPointerMoveRef.current = null;
      anchorsRef.current = [];
      segmentsRef.current = [];
      pointsRef.current = [];
      previewRef.current = null;
      edgeMapRef.current = null;
      lastClickRef.current = null;
      lastAutoAnchorTimeRef.current = 0;

      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    };
  }, [overlayCtxRef]);

  return (
    <div
      className={`${className} cursor-crosshair`}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      style={{ userSelect: 'none' }}
    />
  );
};
