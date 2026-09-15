import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import type { FeatherMagneticLassoToolArgs } from '../../tools/featherMagneticLasso.ts';
import {
  createCommittedPolygonSelection,
  distanceBetweenPoints,
  drawSelectionOutline,
} from '../../util/selection.ts';
import {
  createEdgeMapFromCanvas,
  createMagneticSegment,
  pathLength,
  simplifyPath,
  type EdgeMap,
  type MagneticPathOptions,
  type MagneticSegmentResult,
} from '../../util/magneticLasso.ts';

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

export const FeatherMagneticLassoToolArea = ({ className, overlayCtxRef }: FeatherMagneticLassoToolAreaProps) => {
  const [{ canvasRef, containerRef, selections, totalSize }, dispatch] = useStore();
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

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

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

  function redrawCommittedSelections() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    selections.forEach((selection) => drawSelectionOutline(ctx, selection));
  }

  function getDraftPointsWithPreview(): Point[] {
    const points = [...pointsRef.current];
    const preview = previewRef.current?.path;

    if (preview && preview.length > 1) {
      points.push(...preview.slice(1));
    }

    return points;
  }

  function drawPath(ctx: CanvasRenderingContext2D, points: Point[], closePath: boolean) {
    if (points.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    if (closePath) ctx.closePath();
    ctx.stroke();
  }

  function drawAnchors(ctx: CanvasRenderingContext2D) {
    const anchors = anchorsRef.current;

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
  }

  function redrawOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    redrawCommittedSelections();

    const draftPoints = getDraftPointsWithPreview();
    if (draftPoints.length === 0) return;

    const preview = previewRef.current;
    const fixedPoints = pointsRef.current;

    ctx.save();
    if (args.previewFeather && args.featherRadius > 0 && draftPoints.length >= MIN_POINTS_FOR_SELECTION) {
      ctx.strokeStyle = 'rgba(0,123,255,0.14)';
      ctx.lineWidth = Math.max(1, args.featherRadius * 2);
      ctx.setLineDash([]);
      drawPath(ctx, draftPoints, false);
    }

    if (fixedPoints.length >= 2) {
      ctx.strokeStyle = 'rgba(0,123,255,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      drawPath(ctx, fixedPoints, false);
    }

    if (preview?.path && preview.path.length >= 2) {
      ctx.strokeStyle = preview.snap.usedMagnetic ? 'rgba(0,170,90,0.95)' : 'rgba(230,130,0,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      drawPath(ctx, preview.path, false);
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.fillStyle = preview.snap.usedMagnetic ? 'rgba(0,170,90,0.95)' : 'rgba(230,130,0,0.95)';
      ctx.arc(preview.snappedPoint.x, preview.snappedPoint.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (anchorsRef.current.length >= MIN_POINTS_FOR_SELECTION && preview?.snappedPoint) {
      const start = anchorsRef.current[0];
      const canClose = distanceBetweenPoints(preview.snappedPoint, start) <= CLOSE_START_THRESHOLD;
      if (canClose) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,200,0,0.85)';
        ctx.arc(start.x, start.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawAnchors(ctx);
    ctx.restore();
  }

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
      anchorsRef.current.length >= MIN_POINTS_FOR_SELECTION && distanceBetweenPoints(coords, start) <= CLOSE_START_THRESHOLD;
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
    previewRef.current = null;
    rebuildPointsFromSegments();
  }

  function removeLastAnchor() {
    cancelPendingPointerMoveFrame();

    if (anchorsRef.current.length === 0) {
      dispatch({ type: 'CLEAR_SELECTIONS' });
      return;
    }

    if (segmentsRef.current.length === 0) {
      cancelSelectionDraft();
      return;
    }

    segmentsRef.current.pop();
    anchorsRef.current.pop();
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
      points: finalPoints,
      sourceTool: 'feather-magnetic-lasso',
    });

    if (!selection) {
      cancelSelectionDraft();
      return;
    }

    dispatch({ type: 'COMMIT_SELECTION', payload: selection });
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
    edgeMapRef.current = createEdgeMapFromCanvas(canvasRef.current);

    const segment = createMagneticSegment({
      cursor: coords,
      edgeMap: edgeMapRef.current,
      from: coords,
      magneticEnabled: !event.altKey,
      options: getMagneticPathOptions(),
    });
    const startPoint = segment.snappedPoint;

    anchorsRef.current = [startPoint];
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
    if (pathLength(segment.path) < args.frequency) return false;

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
    if (anchorsRef.current.length >= MIN_POINTS_FOR_SELECTION && distanceBetweenPoints(coords, start) <= CLOSE_START_THRESHOLD) {
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

  useKeyDownShortcut({
    key: 'Escape',
    preventDefault: true,
    enabled: true,
    onKeyDown: cancelSelectionDraft,
  });

  useKeyDownShortcut({
    key: 'Enter',
    preventDefault: true,
    enabled: true,
    onKeyDown: finishSelection,
  });

  useKeyDownShortcut({
    key: 'Backspace',
    preventDefault: true,
    enabled: true,
    onKeyDown: removeLastAnchor,
  });

  useKeyDownShortcut({
    key: 'Delete',
    preventDefault: true,
    enabled: true,
    onKeyDown: removeLastAnchor,
  });

  useEffect(() => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    redrawCommittedSelections();
    redrawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections]);

  useEffect(() => {
    return () => {
      resetInteractionState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
