import { type PointerEvent, type RefObject, useContext, useRef } from 'react';
import { ImageContext, type Point } from '../../contexts/ImageContext';
import { type DrawToolType, setDrawTool } from '../../tools/draw.ts';
import { savedLastSettings } from '../../tools/settings.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { hexToRgb } from '../../contexts/util.ts';

type DrawHandlerProps = {
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export const DrawToolArea = ({ canvasCtxRef, overlayCtxRef, overlayRef, ...rest }: DrawHandlerProps) => {
  const { addCanvasToHistory, containerRef, size } = useContext(ImageContext);
  const pointsRef = useRef<Point[]>([]);
  const pendingPoints = useRef<Point[]>([]);
  const frameRequested = useRef<number | null>(null);

  const { onPointerDown, onPointerUp, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: size,
  });

  const drawPen = () => {
    const pp = pendingPoints.current;
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
  };

  const drawSpray = () => {
    const pp = pendingPoints.current;
    pointsRef.current.push(...pp);

    const settings = savedLastSettings.draw as DrawToolType;

    const alpha = settings.alpha;
    const color = hexToRgb(settings.color);
    const colorStart = `rgba(${color}, ${alpha / 4})`;
    const colorStop = `rgba(${color}, 0)`;
    const radius = settings.size;
    const ctx = canvasCtxRef.current!;

    for (let i = 0; i < pp.length; i++) {
      const g = ctx.createRadialGradient(pp[i].x, pp[i].y, 0, pp[i].x, pp[i].y, radius);
      g.addColorStop(0, colorStart);
      g.addColorStop(1, colorStop);

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pp[i].x, pp[i].y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const flushDrawingFrame = () => {
    frameRequested.current = null;
    // if (pendingPoints.current.length === 0) return;

    const penType = (savedLastSettings.draw as DrawToolType).penType;
    if (penType === 'pen') {
      drawPen();
    } else if (penType === 'spray') {
      drawSpray();
    }

    pendingPoints.current = [];
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
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

    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current) return;

    const coords = getLocalCoords(event);
    pendingPoints.current.push(coords);

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerUp(event)) return;

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }
    flushDrawingFrame();

    canvasCtxRef.current!.drawImage(overlayRef.current!, 0, 0);
    overlayCtxRef.current!.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

    const args = savedLastSettings.draw as DrawToolType;
    addCanvasToHistory('draw', { ...args, points: pointsRef.current });
  };

  return (
    <div
      {...rest}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    ></div>
  );
};
