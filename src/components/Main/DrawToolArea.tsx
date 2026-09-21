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

    const drawArgs = { ...args, points: pointsRef.current };
    drawLine({
      args: drawArgs,
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
      frameRequested.current = null;
    }

    const coords = getLocalCoords(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    const oldPoints = pointsRef.current.slice();
    const pos = pointsBoundingPos({ points: oldPoints, lineWidth: args.lineWidth });
    const newPoints = oldPoints.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));

    const finalArgs = { ...args, points: newPoints };
    const fullArgs: FullArgs = {
      args: finalArgs,
      pos,
    };

    createLayerFromTool(fullArgs);

    pointsRef.current = [];
    overlayCtxRef.current?.clearRect(0, 0, totalSize.width, totalSize.height);
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
