import { type PointerEvent, type RefObject, useRef } from 'react';
import { type DrawToolArgs, setupDrawCtx } from '../../tools/draw.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { drawLine, pointsBoundingPos } from '../../util/draw.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type DrawHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const DrawToolArea = ({ className, overlayCtxRef }: DrawHandlerProps) => {
  const [{ containerRef, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as DrawToolArgs;
  const pointsRef = useRef<Point[]>([]);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  // Repaints synchronously on every pointer move. The overlay is a cheap
  // clearRect + stroke of the accumulated points, so this stays interactive
  // without frame batching; ShapeToolArea batches via requestAnimationFrame.
  const flushDrawingFrame = () => {
    if (!overlayCtxRef.current) return;

    overlayCtxRef.current.clearRect(0, 0, totalSize.width, totalSize.height);

    const drawArgs = { ...args, points: pointsRef.current };
    drawLine({
      args: drawArgs,
      ctx: overlayCtxRef.current,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;
    setupDrawCtx(ctx, args);

    const coords = getLocalCoords(event);
    pointsRef.current = [coords];

    flushDrawingFrame();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    const coords = getLocalCoords(event);
    pointsRef.current.push(coords);

    flushDrawingFrame();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    const coords = getLocalCoords(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];
    if (!lastPoint || lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
      pointsRef.current.push(coords);
    }

    const oldPoints = pointsRef.current.map((point) => canvasToDocumentPoint(point, documentFrame));
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
