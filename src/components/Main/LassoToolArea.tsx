import { type PointerEvent, type RefObject, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { type SelectionToolArgs } from '../../tools/selection.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useMarchingPath } from '../../hooks/usePolylineAnts.ts';
import type { Point, Pos } from '../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../util/draw.ts';

type PolygonSelectionHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const LassoToolArea = ({ className, overlayCtxRef }: PolygonSelectionHandlerProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }, dispatch] = useStore();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as SelectionToolArgs;
  const currentToolName = (toolArgs as any).toolName as string;
  const pointsRef = useRef<Point[]>([]);
  const lastClickTimeRef = useRef(0);
  const lastClickPosRef = useRef<Point | null>(null);
  const isDrawingContinuousRef = useRef(false);

  const { getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  // Use marching ants hook for animated polyline preview
  const { draw: drawAnts, clear: clearAnts } = useMarchingPath({
    canvasRef: toolOverlayRef,
    points: pointsRef.current,
    isPaused: false,
  });

  const finishSelection = () => {
    clearAnts();

    const oldPoints = pointsRef.current;
    if (oldPoints.length < 3) {
      pointsRef.current = [];
      isDrawingContinuousRef.current = false;
      return;
    }

    // Create selection in store
    const pos = pointsBoundingPos({ points: oldPoints, lineWidth: 1 });
    const newPoints: Point[] = oldPoints.map((p) => ({ x: p.x - pos.x, y: p.y - pos.y }));

    const selectionId = uuidv4();
    dispatch({
      type: 'ADD_SELECTION',
      payload: {
        id: selectionId,
        points: newPoints,
        isActive: true,
        pos,
      },
    });

    pointsRef.current = [];
    isDrawingContinuousRef.current = false;
  };

  const handleClick = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return; // Only left clicks
    // Only polygonal tool uses click-by-click point addition
    if (currentToolName !== 'polygonal-lasso') return;
    if (isDrawingContinuousRef.current) return; // Don't click in continuous mode

    event.preventDefault();

    const coords = getLocalCoords(event as any);
    const points = pointsRef.current;

    // Check for double-click on first point to close loop
    const now = Date.now();
    if (points.length > 2 && lastClickPosRef.current) {
      const dx = coords.x - lastClickPosRef.current.x;
      const dy = coords.y - lastClickPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 10 && now - lastClickTimeRef.current < 300) {
        // Double-click on first point - finish selection
        finishSelection();
        lastClickTimeRef.current = 0;
        lastClickPosRef.current = null;
        return;
      }
    }

    // Add new point
    pointsRef.current.push(coords);
    lastClickTimeRef.current = now;
    lastClickPosRef.current = coords;

    // Trigger redraw with updated points
    drawAnts();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return; // Only left clicks

    // For freehand tool, start continuous drawing on pointer down
    if (currentToolName === 'freehand-lasso') {
      isDrawingContinuousRef.current = true;
      const coords = getLocalCoords(event as any);
      pointsRef.current.push(coords);
      drawAnts();
      return;
    }

    // For polygonal tool: only start continuous mode if shift key held and there are existing points
    if (currentToolName === 'polygonal-lasso' && pointsRef.current.length > 0 && event.shiftKey) {
      isDrawingContinuousRef.current = true;
      const coords = getLocalCoords(event as any);
      pointsRef.current.push(coords);
      drawAnts();
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isDrawingContinuousRef.current) return;

    const coords = getLocalCoords(event as any);
    pointsRef.current.push(coords);
    drawAnts();
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Right-click to finish selection
    finishSelection();
  };

  useEffect(() => {
    return () => {
      clearAnts();
    };
  }, []);

  return (
    <div
      className={`${className} cursor-crosshair`}
      onClick={handleClick}
      onContextMenu={handleContextMenu as any}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      style={{ userSelect: 'none' }}
    />
  );
};
