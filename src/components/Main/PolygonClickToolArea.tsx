import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point, Selection } from '../../contexts/general-types.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useDoubleClick } from '../../hooks/useDoubleClick.ts';
import {
  createCommittedPolygonSelection,
  distanceBetweenPoints,
  drawSelectionOutline,
  findSelectionAnchorAtPoint,
  getSelectionAtPoint,
  moveSelectionAnchor,
  moveSelectionByDelta,
} from '../../util/selection.ts';

const MIN_POINTS_FOR_SELECTION = 3;
const CLOSE_START_THRESHOLD = 10; // px in image coordinate space
const DOUBLE_CLICK_DISTANCE_THRESHOLD = 12;
const FREEHAND_MIN_POINT_DISTANCE = 2;

type PolygonClickToolProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

type SelectionDragState =
  | {
      type: 'anchor';
      anchorIndex: number;
      selection: Selection;
    }
  | {
      type: 'selection';
      origin: Point;
      selection: Selection;
    };

export const PolygonClickToolArea = ({ className, overlayCtxRef }: PolygonClickToolProps) => {
  const [{ containerRef, selections, totalSize }, dispatch] = useStore();
  const { toolArgs } = useCurrentTool();

  const isFreehand = (toolArgs?.toolName ?? '') === 'freehand-lasso';
  const selectionSourceTool = isFreehand ? 'freehand-lasso' : 'polygonal-lasso';

  const pointsRef = useRef<Point[]>([]);
  const previewRef = useRef<Point | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const freehandDrawingRef = useRef(false);
  const freehandPointerIdRef = useRef<number | null>(null);

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

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
      points: oldPoints,
      sourceTool: selectionSourceTool,
    });
    if (!selection) return;

    dispatch({
      type: 'COMMIT_SELECTION',
      payload: selection,
    });

    resetInteractionState();
  };

  const doubleClick = useDoubleClick(finishSelection, {
    distanceThreshold: DOUBLE_CLICK_DISTANCE_THRESHOLD,
    minPointsForDetection: MIN_POINTS_FOR_SELECTION - 1,
  });

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

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

  function updateSelection(selection: Selection) {
    dispatch({ type: 'UPDATE_SELECTION', payload: selection });
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

  function redrawCommittedSelections() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    selections.forEach((selection) => drawSelectionOutline(ctx, selection));
  }

  function resetInteractionState() {
    pointsRef.current = [];
    previewRef.current = null;
    releaseFreehandPointer();
    doubleClick.reset();
    clearOverlay();
  }

  function appendFreehandPoint(point: Point, { force = false }: { force?: boolean } = {}): boolean {
    const points = pointsRef.current;
    const lastPoint = points[points.length - 1];
    if (!lastPoint) {
      points.push(point);
      return true;
    }

    if (!force && distanceBetweenPoints(lastPoint, point) < FREEHAND_MIN_POINT_DISTANCE) {
      return false;
    }

    points.push(point);
    return true;
  }

  function startFreehandSelection(event: PointerEvent<HTMLDivElement>, coords: Point) {
    pointsRef.current = [coords];
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
    previewRef.current = null;
    clearOverlay();

    if (hadDraft) {
      dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
    }
  }

  function redrawOverlay({ closePath = false }: { closePath?: boolean } = {}) {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    redrawCommittedSelections();

    const pts = pointsRef.current;
    if (!pts || pts.length === 0) return;

    // Draw completed edges
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }

    if (closePath && pts.length >= MIN_POINTS_FOR_SELECTION) {
      ctx.lineTo(pts[0].x, pts[0].y);
    }

    ctx.strokeStyle = 'rgba(0,123,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();

    if (isFreehand && pts.length >= MIN_POINTS_FOR_SELECTION) {
      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,123,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pts[0].x, pts[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw anchors for polygonal lasso only. Freehand paths can have hundreds of sampled points.
    if (isFreehand) {
      const start = pts[0];
      const end = pts[pts.length - 1];
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
      for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.fillStyle = i === 0 ? 'white' : 'white';
        ctx.strokeStyle = i === 0 ? 'rgba(0,123,255,1)' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2;
        const r = 5;
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Draw preview edge
    const preview = previewRef.current;
    if (preview) {
      const last = pts[pts.length - 1];

      // If preview is near the first point, highlight it
      const canCloseAtStart =
        pts.length >= MIN_POINTS_FOR_SELECTION && distanceBetweenPoints(preview, pts[0]) < CLOSE_START_THRESHOLD;
      if (canCloseAtStart) {
        // indicate closable
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,200,0,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(pts[0].x, pts[0].y);
        ctx.stroke();

        // highlight start anchor
        ctx.beginPath();
        ctx.fillStyle = 'rgba(0,200,0,0.9)';
        ctx.arc(pts[0].x, pts[0].y, 7, 0, Math.PI * 2);
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
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    const coords = getLocalCoords(event);

    const activeSelection = getSelectionAtPoint(selections, coords);
    const activeAnchorSelection = getAnchorSelectionAtPoint(coords);

    if (activeAnchorSelection) {
      const anchorIndex = findSelectionAnchorAtPoint(activeAnchorSelection, coords);
      if (anchorIndex !== null) {
        selectionDragRef.current = { type: 'anchor', anchorIndex, selection: activeAnchorSelection };
        return;
      }
    }

    if (activeSelection) {
      selectionDragRef.current = { type: 'selection', origin: coords, selection: activeSelection };
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

    if (doubleClick.handleClick(coords, pointsRef)) {
      return;
    }

    if (pointsRef.current.length === 0) {
      dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: selectionSourceTool } });
    }

    pointsRef.current.push(coords);
    previewRef.current = null;

    redrawOverlay();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (selectionDragRef.current) {
      selectionDragRef.current = null;
      return;
    }

    if (isFreehand) {
      finishFreehandSelection(event);
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (selectionDragRef.current) {
      selectionDragRef.current = null;
      return;
    }

    if (isFreehand) {
      finishFreehandSelection(event);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (selectionDragRef.current) {
      selectionDragRef.current = null;
      return;
    }

    if (isFreehand) {
      cancelFreehandSelection(event);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = getLocalCoords(event);

    const selectionDrag = selectionDragRef.current;
    if (selectionDrag) {
      if (selectionDrag.type === 'anchor') {
        const nextSelection = moveSelectionAnchor(selectionDrag.selection, selectionDrag.anchorIndex, coords);
        selectionDragRef.current = { ...selectionDrag, selection: nextSelection };
        updateSelection(nextSelection);
        return;
      }

      const delta = { x: coords.x - selectionDrag.origin.x, y: coords.y - selectionDrag.origin.y };
      const nextSelection = moveSelectionByDelta(selectionDrag.selection, delta);
      selectionDragRef.current = { ...selectionDrag, origin: coords, selection: nextSelection };
      updateSelection(nextSelection);
      return;
    }

    // In freehand-lasso mode collect points continuously after the initial click
    if (isFreehand) {
      if (!freehandDrawingRef.current || !isActiveFreehandPointer(event)) {
        if (getAnchorSelectionAtPoint(coords)) {
          setCursor(event, 'grab');
        } else if (getSelectionAtPoint(selections, coords)) {
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
      if (getAnchorSelectionAtPoint(coords)) {
        setCursor(event, 'grab');
      } else if (getSelectionAtPoint(selections, coords)) {
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

  useEffect(() => {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      style={{ userSelect: 'none' }}
    />
  );
};
