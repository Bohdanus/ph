import { type PointerEvent, type RefObject, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../util/draw.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';

const MIN_POINTS_FOR_SELECTION = 3;
const CLOSE_START_THRESHOLD = 10; // px in image coordinate space

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

  // Custom double-click detection for closing the polygon
  const lastClickTimeRef = useRef(0);
  const lastClickPosRef = useRef<Point | null>(null);

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

     // clear working state
     pointsRef.current = [];
     previewRef.current = null;
     clearOverlay();
   };

   // Check if the current click is a double-click on the first point to close the polygon
   function checkDoubleClickOnFirstPoint(coords: Point): boolean {
     if (pointsRef.current.length < MIN_POINTS_FOR_SELECTION) {
       return false;
     }

     const first = pointsRef.current[0];
     const timeSinceLastClick = Date.now() - lastClickTimeRef.current;
     const distanceToLastClick = lastClickPosRef.current ? distance(coords, lastClickPosRef.current) : Infinity;
     const distanceToFirstPoint = distance(coords, first);

     // Double-click detected if:
     // 1. Current click is close to the FIRST point
     // 2. AND previous click was also close to the first point
     // 3. AND both clicks were within time threshold (300ms)
     const isCurrentOnFirst = distanceToFirstPoint < CLOSE_START_THRESHOLD;
     const isLastOnFirst = lastClickPosRef.current && distanceToLastClick < CLOSE_START_THRESHOLD;

     return isCurrentOnFirst && isLastOnFirst && timeSinceLastClick < 300 && timeSinceLastClick > 0;
   }

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

  function redrawOverlay() {
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
      const nearStart = pts.length >= MIN_POINTS_FOR_SELECTION && distance(preview, pts[0]) < CLOSE_START_THRESHOLD;
      if (nearStart) {
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

      // Check if this is a double-click on the first point to close the polygon
      if (checkDoubleClickOnFirstPoint(coords)) {
        pointsRef.current.pop(); // Remove the duplicate point added on first click
        finishSelection();
        lastClickTimeRef.current = 0;
        lastClickPosRef.current = null;
        return;
      }

      // Record this click for potential double-click detection
      lastClickTimeRef.current = Date.now();
      lastClickPosRef.current = coords;

      // Freehand mode: add point on move as well; polygonal mode: add point only on click
      pointsRef.current.push(coords);
      previewRef.current = null;
      redrawOverlay();
    };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = getLocalCoords(event);

    // In freehand-lasso mode collect points continuously
    if (isFreehand) {
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
      (event.target as HTMLDivElement).style.cursor = canClose ? 'pointer' : 'crosshair';
    } catch {}

    redrawOverlay();
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    finishSelection();
  };

  useEffect(() => {
    return () => {
      clearOverlay();
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
