import { type PointerEvent, type RefObject, useRef } from 'react';
import { type Point, type Size, type ToolArgs } from '../../contexts/ImageContext';
import { type DrawToolType, setDrawTool } from '../../tools/draw.ts';
import { savedLastSettings } from '../../tools/settings.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';

interface DrawHandlerProps {
  addCanvasToHistory: (tool: string, args: ToolArgs) => void;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  size: Size;
}

export const useDrawHandler = ({
  addCanvasToHistory,
  canvasCtxRef,
  containerRef,
  overlayCtxRef,
  overlayRef,
  size,
}: DrawHandlerProps) => {
  const pointsRef = useRef<Point[]>([]);
  const pendingPoints = useRef<Point[]>([]);
  const frameRequested = useRef(false);

  const { onPointerDown, onPointerUp, getLocalCoords, isMouseDown } = usePointerPosition(containerRef, size);

  const draw = () => {
    const pp = pendingPoints.current;
    if (pp.length === 0) return;
    pointsRef.current.push(...pp);

    const alpha = (savedLastSettings.draw as DrawToolType).alpha;
    const ctx = alpha === 1 ? canvasCtxRef.current! : overlayCtxRef.current!;

    if (alpha === 1) {
      for (let i = 0; i < pp.length; i++) {
        ctx.lineTo(pp[i].x, pp[i].y);
      }
      ctx.stroke();
    } else {
      ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
      ctx.beginPath();
      const points = pointsRef.current;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    frameRequested.current = false;
    pendingPoints.current = [];
  };

  const handleMouseDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerDown(event)) return;

    const alpha = (savedLastSettings.draw as DrawToolType).alpha;
    const ctx = alpha === 1 ? canvasCtxRef.current! : overlayCtxRef.current!;
    setDrawTool(ctx, savedLastSettings.draw as DrawToolType);

    const coords = getLocalCoords(event);
    pointsRef.current = [];
    pendingPoints.current = [coords];

    if (alpha === 1) {
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
    }
    draw();
  };

  const handleMouseMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current) return;

    const coords = getLocalCoords(event);
    pendingPoints.current.push(coords);

    if (!frameRequested.current) {
      frameRequested.current = true;
      requestAnimationFrame(draw);
    }
  };

  const handleMouseUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerUp(event)) return;
    draw();

    canvasCtxRef.current!.drawImage(overlayRef.current!, 0, 0);
    overlayCtxRef.current!.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

    const args = savedLastSettings.draw as DrawToolType;
    addCanvasToHistory('draw', { ...args, points: pointsRef.current });
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};
