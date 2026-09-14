import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../util/draw.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useDoubleClick } from '../../hooks/useDoubleClick.ts';

const MIN_POINTS_FOR_SELECTION = 3;
const CLOSE_START_THRESHOLD = 10; // px in image coordinate space
const DOUBLE_CLICK_DISTANCE_THRESHOLD = 12;

type PolygonClickToolProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const PolygonClickToolArea = ({ className, overlayCtxRef }: PolygonClickToolProps) => {
  const [{ containerRef, totalSize }, dispatch] = useStore();
  const { toolArgs } = useCurrentTool();

  const isFreehand = (toolArgs?.toolName ?? '') === 'freehand-lasso';

  const pointsRef = useRef<Point[]>([]);
  const previewRef = useRef<Point | null>(null);

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const finishSelection = () => {
    const oldPoints = pointsRef.current;
    if (oldPoints.length < MIN_POINTS_FOR_SELECTION) return;

    const pos = pointsBoundingPos({ points: oldPoints });
    const newPoints: Point[] = oldPoints.map((p) => ({ x: p.x - pos.x, y: p.y - pos.y }));

    // commit selection into global store
    // `dispatch` obtained from top-level useStore() call to avoid invalid hook calls
    dispatch({
      type: 'ADD_SELECTION',
      payload: {
        id: uuidv4(),
        points: newPoints,
        isActive: true,
        pos,
      },
    });

    resetInteractionState();
  };

  const doubleClick = useDoubleClick(finishSelection, {
    distanceThreshold: DOUBLE_CLICK_DISTANCE_THRESHOLD,
    minPointsForDetection: MIN_POINTS_FOR_SELECTION - 1,
  });

  function distance(a: Point, b: Point) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clearOverlay() {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function resetInteractionState() {
    pointsRef.current = [];
    previewRef.current = null;
    doubleClick.reset();
    clearOverlay();
  }

  function redrawOverlay({ closePath = false }: { closePath?: boolean } = {}) {
    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    // Draw anchors
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

    // Draw preview edge
    const preview = previewRef.current;
    if (preview) {
      const last = pts[pts.length - 1];

      // If preview is near the first point, highlight it
      const canCloseAtStart = pts.length >= MIN_POINTS_FOR_SELECTION && distance(preview, pts[0]) < CLOSE_START_THRESHOLD;
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

    if (doubleClick.handleClick(coords, pointsRef)) {
      return;
    }

    pointsRef.current.push(coords);
    previewRef.current = null;

    redrawOverlay();
  };

  const handlePointerUp = () => {
    if (isFreehand) {
      finishSelection();
    }
  };

  const handlePointerLeave = () => {
    if (isFreehand) {
      finishSelection();
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = getLocalCoords(event);

    // In freehand-lasso mode collect points continuously after the initial click
    if (isFreehand) {
      if (pointsRef.current.length === 0) return;

      pointsRef.current.push(coords);
      redrawOverlay();
      return;
    }

    // Polygonal mode: only preview line
    if (pointsRef.current.length === 0) return;

    previewRef.current = coords;

    // show pointer hint when near start
    const canClose = pointsRef.current.length >= MIN_POINTS_FOR_SELECTION && distance(coords, pointsRef.current[0]) < CLOSE_START_THRESHOLD;
    try {
      (event.currentTarget as HTMLDivElement).style.cursor = canClose ? 'pointer' : 'crosshair';
    } catch {
      // Ignore cursor updates in non-DOM test environments.
    }

    redrawOverlay();
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    finishSelection();
  };

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
      style={{ userSelect: 'none' }}
    />
  );
};
