import { type PointerEvent, type RefObject, useContext, useRef } from 'react';
import { ImageContext, type Point } from '../../contexts/ImageContext';
import { type DrawToolSettings, setDrawTool } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { hexToRgb } from '../../util/rect.ts';
import { bezierSmoothedLine } from '../../util/draw.ts';

type DrawHandlerProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export const DrawToolArea = ({ className, canvasCtxRef, overlayCtxRef, overlayRef }: DrawHandlerProps) => {
  const { addCanvasToHistory, containerRef, size, toolArgs } = useContext(ImageContext);
  const args = toolArgs as DrawToolSettings;
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

    const ctx = overlayCtxRef.current!;

    ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
    ctx.beginPath();
    const points = pointsRef.current;
    ctx.moveTo(points[0].x, points[0].y);
    bezierSmoothedLine(ctx, points);
    ctx.stroke();
  };

  const drawSpray = () => {
    const pp = pendingPoints.current;
    pointsRef.current.push(...pp);

    const alpha = args.alpha;
    const color = hexToRgb(args.color);
    const colorStart = `rgba(${color}, ${alpha / 4})`;
    const colorStop = `rgba(${color}, 0)`;
    const radius = args.lineWidth;
    const ctx = overlayCtxRef.current!;

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

    const penType = args.penType;
    if (penType === 'pen' || penType === 'pen-dashed') {
      drawPen();
    } else if (penType === 'spray') {
      drawSpray();
    }

    pendingPoints.current = [];
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerDown(event)) return;

    const ctx = overlayCtxRef.current!;
    setDrawTool(ctx, args);

    const coords = getLocalCoords(event);
    pointsRef.current = [];
    pendingPoints.current = [coords];

    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current) return;

    const coords = getLocalCoords(event);
    pendingPoints.current.push(coords);

    if (frameRequested.current !== null) return;

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

    addCanvasToHistory({ ...args, points: pointsRef.current });
  };

  return (
    <div
      className={`${className} cursor-draw`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    ></div>
  );
};
