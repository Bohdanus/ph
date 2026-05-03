import { type PointerEvent, type RefObject, useRef } from 'react';
import { type DrawToolArgs, setupDrawCtx } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine, pointsBoundingPos } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';

type DrawHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const DrawToolArea = ({ className, overlayCtxRef }: DrawHandlerProps) => {
  const [{ containerRef, totalSize }] = useStore();
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as DrawToolArgs;
  const pointsRef = useRef<Point[]>([]);
  const frameRequested = useRef<number | null>(null);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const flushDrawingFrame = () => {
    frameRequested.current = null;

    overlayCtxRef.current!.clearRect(0, 0, totalSize.width, totalSize.height);

    args.points = pointsRef.current;
    drawLine({
      args,
      ctx: overlayCtxRef.current!,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    const ctx = overlayCtxRef.current!;
    setupDrawCtx(ctx, args);

    const coords = getLocalCoords(event);
    pointsRef.current = [coords];

    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    const coords = getLocalCoords(event);
    pointsRef.current.push(coords);

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }

    // flushDrawingFrame();

    // canvasCtxRef.current!.drawImage(toolOverlayRef.current!, 0, 0);
    // overlayCtxRef.current!.clearRect(0, 0, toolOverlayRef.current!.width, toolOverlayRef.current!.height);

    const coords = getLocalCoords(event);
    pointsRef.current.push(coords);
    const oldPoints = pointsRef.current;
    const newPoints = []; // avoid passing the original array

    const pos = pointsBoundingPos(args);
    for (let i = 0; i < oldPoints.length; i++) {
      newPoints.push({ x: oldPoints[i].x - pos.x, y: oldPoints[i].y - pos.y });
    }
    args.points = newPoints;

    const fullArgs: FullArgs = {
      args,
      pos,
    };
    createLayerFromTool(fullArgs);
  };

  return (
    <div
      className={`${className} cursor-draw`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
};
