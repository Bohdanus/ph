import { type PointerEvent, type RefObject, useCallback, useEffect, useRef } from 'react';
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
  const { clearSelections } = useSelectionHistory();
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

  function resetInteractionState() {
    pointsRef.current = [];
    previewRef.current = null;
    freehandPointerIdRef.current = null;
    freehandDrawingRef.current = false;
    selectionDragRef.current = null;
    doubleClickResetRef.current();
    clearOverlay();
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

  const redrawOverlay = useCallback(
    ({ closePath = false }: { closePath?: boolean } = {}) => {
      const ctx = overlayCtxRef.current;
      if (!ctx) return;
      drawPolygonOverlay({
        closePath,
        ctx,
        isFreehand,
        points: pointsRef.current,
        preview: previewRef.current,
        selections,
        documentFrame,
      });
    },
    [documentFrame, isFreehand, overlayCtxRef, selections]
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    const coords = getLocalCoords(event);
    const documentCoords = canvasToDocumentPoint(coords, documentFrame);

    const activeSelection = getSelectionAtPoint(selections, documentCoords);
    const activeAnchorSelection = getAnchorSelectionAtPoint(documentCoords);

    if (activeAnchorSelection) {
      const anchorIndex = findSelectionAnchorAtPoint(activeAnchorSelection, documentCoords);
      if (anchorIndex !== null) {
        selectionDragRef.current = { type: 'anchor', anchorIndex, selection: activeAnchorSelection };
        return;
      }
    }

    if (activeSelection) {
      selectionDragRef.current = { type: 'selection', origin: documentCoords, selection: activeSelection };
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
    const documentCoords = canvasToDocumentPoint(coords, documentFrame);

    const selectionDrag = selectionDragRef.current;
    if (selectionDrag) {
      if (selectionDrag.type === 'anchor') {
        const nextSelection = moveSelectionAnchor(selectionDrag.selection, selectionDrag.anchorIndex, documentCoords);
        selectionDragRef.current = { ...selectionDrag, selection: nextSelection };
        updateSelection(nextSelection);
        return;
      }

      const delta = { x: documentCoords.x - selectionDrag.origin.x, y: documentCoords.y - selectionDrag.origin.y };
      const nextSelection = moveSelectionByDelta(selectionDrag.selection, delta);
      selectionDragRef.current = { ...selectionDrag, origin: documentCoords, selection: nextSelection };
      updateSelection(nextSelection);
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

    resetInteractionState();
    dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
  }

  function removeLastAnchor() {
    if (isFreehand || selectionDragRef.current) return;

    if (pointsRef.current.length === 0) {
      // Routed through the single-writer hook rather than the raw
      // `CLEAR_SELECTIONS` action, so a Backspace deselect appends the history
      // entry that makes it undoable. Scope is unchanged — the hook clears every
      // selection, exactly as the raw action's reducer arm did — and the draft
      // is already empty here, so there is no draft reset to keep. The hook's own
      // guard makes the "nothing selected" case dispatch nothing, which is
      // stronger than the raw action: that used to bump the `selectionCleared`
      // repaint marker over an already-empty selection.
      clearSelections();
      return;
    }

    pointsRef.current.pop();
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

  useKeyDownShortcut({
    key: 'Backspace',
    preventDefault: true,
    allowInInput: true,
    onKeyDown: removeLastAnchor,
  });

  useKeyDownShortcut({
    key: 'Delete',
    preventDefault: true,
    allowInInput: true,
    onKeyDown: removeLastAnchor,
  });

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      pointsRef.current = [];
      previewRef.current = null;
      freehandPointerIdRef.current = null;
      freehandDrawingRef.current = false;
      selectionDragRef.current = null;
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
