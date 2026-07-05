import { type PointerEvent, type RefObject, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useMarchingPath } from '../../hooks/usePolylineAnts.ts';
import { useDoubleClick } from '../../hooks/useDoubleClick.ts';
import type { Point } from '../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../util/draw.ts';

const MIN_POINTS_FOR_SELECTION = 3;

type PolygonClickToolProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const PolygonClickToolArea = ({ className, overlayCtxRef }: PolygonClickToolProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }, dispatch] = useStore();

  const pointsRef = useRef<Point[]>([]);

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const { draw: drawAnts, clear: clearAnts } = useMarchingPath({
    canvasRef: toolOverlayRef,
    points: pointsRef.current,
    isPaused: false,
  });

  const finishSelection = () => {
    const oldPoints = pointsRef.current;
    if (oldPoints.length < MIN_POINTS_FOR_SELECTION) return;

    const pos = pointsBoundingPos({ points: oldPoints });
    const newPoints: Point[] = oldPoints.map((p) => ({ x: p.x - pos.x, y: p.y - pos.y }));

    dispatch({
      type: 'ADD_SELECTION',
      payload: {
        id: uuidv4(),
        points: newPoints,
        isActive: true,
        pos,
      },
    });

    pointsRef.current = [];
  };

  const { handleClick: handleDoubleClick } = useDoubleClick(finishSelection);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    const coords = getLocalCoords(event);
    const isDouble = handleDoubleClick(coords, pointsRef);

    if (!isDouble) {
      pointsRef.current.push(coords);
      drawAnts();
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const coords = getLocalCoords(event);
    pointsRef.current.push(coords);
    drawAnts();
  };

  const handleContextMenu = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    finishSelection();
  };

  useEffect(() => {
    return () => {
      clearAnts();
    };
  }, [clearAnts]);

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
