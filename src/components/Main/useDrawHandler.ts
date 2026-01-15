import { type PointerEvent, type RefObject, useRef } from 'react';
import { type Point, type ToolArgs } from '../../contexts/ImageContext';
import { type DrawToolType, setDrawTool } from '../../tools/draw.ts';
import { savedLastSettings } from '../../tools/settings.ts';

interface DrawHandlerProps {
  addCanvasToHistory: (tool: string, args: ToolArgs) => void;
  getCanvasCoordinates: (event: PointerEvent<HTMLCanvasElement>) => Point;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
}

export const useDrawHandler = ({
  getCanvasCoordinates,
  overlayCtxRef,
  addCanvasToHistory,
  canvasCtxRef,
  overlayRef,
}: DrawHandlerProps) => {
  const isMouseDown = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const pendingPoints = useRef<Point[]>([]);
  const frameRequested = useRef(false);

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

  const handleMouseDown = (event: PointerEvent<HTMLCanvasElement>) => {
    isMouseDown.current = true;

    const alpha = (savedLastSettings.draw as DrawToolType).alpha;
    const ctx = alpha === 1 ? canvasCtxRef.current! : overlayCtxRef.current!;
    setDrawTool(ctx, savedLastSettings.draw as DrawToolType);

    const coords = getCanvasCoordinates(event);
    pointsRef.current = [];
    pendingPoints.current = [coords];

    if (alpha === 1) {
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
    }
    draw();
  };

  const handleMouseMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isMouseDown.current) return;

    const coords = getCanvasCoordinates(event);
    pendingPoints.current.push(coords);

    if (!frameRequested.current) {
      frameRequested.current = true;
      requestAnimationFrame(draw);
    }
  };

  const handleMouseUp = () => {
    if (!isMouseDown.current) return;
    draw();

    canvasCtxRef.current!.drawImage(overlayRef.current!, 0, 0);
    overlayCtxRef.current!.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

    const args = savedLastSettings.draw as DrawToolType;
    addCanvasToHistory('draw', { ...args, points: pointsRef.current });

    isMouseDown.current = false;
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};
