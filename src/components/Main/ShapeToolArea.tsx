import { type PointerEvent, type RefObject, useContext, useRef } from 'react';
import { ImageContext, type Point } from '../../contexts/ImageContext';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { drawShape, setShapeTool, type ShapeToolArgs } from '../../tools/shape.ts';

type ShapeHandlerProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export const ShapeToolArea = ({ className, canvasCtxRef, overlayCtxRef, overlayRef }: ShapeHandlerProps) => {
  const { addCanvasToHistory, containerRef, size, toolArgs } = useContext(ImageContext);
  const args = toolArgs as ShapeToolArgs;
  const startRef = useRef<Point | null>(null);
  const endRef = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

  const { onPointerDown, onPointerUp, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: size,
  });

  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current!;
    ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height); // todo you can clear smaller shape

    const newArgs = { ...args, start: startRef.current!, end: endRef.current! };
    drawShape(ctx, newArgs);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerDown(event)) return;

    const ctx = overlayCtxRef.current!;
    setShapeTool(ctx, args);

    startRef.current = getLocalCoords(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current) return;

    endRef.current = getLocalCoords(event);

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerUp(event)) return;

    endRef.current = getLocalCoords(event);

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }
    flushDrawingFrame();

    canvasCtxRef.current!.drawImage(overlayRef.current!, 0, 0);
    overlayCtxRef.current!.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

    addCanvasToHistory({ ...args, start: startRef.current!, end: endRef.current });
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
