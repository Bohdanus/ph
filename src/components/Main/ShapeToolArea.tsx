import { type PointerEvent, type RefObject, useRef } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { drawShape, setShapeCtx, type ShapeToolArgs } from '../../tools/shape.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';

type ShapeHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const ShapeToolArea = ({ className, overlayCtxRef }: ShapeHandlerProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }] = useStore();
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as ShapeToolArgs;
  const startRef = useRef<Point | null>(null);
  const endRef = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current!;
    ctx.clearRect(0, 0, toolOverlayRef.current!.width, toolOverlayRef.current!.height); // todo you can clear smaller shape

    const newArgs = { ...args, start: startRef.current!, end: endRef.current! };
    drawShape(ctx, newArgs);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    const ctx = overlayCtxRef.current!;
    setShapeCtx(ctx, args);

    startRef.current = getLocalCoords(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    endRef.current = getLocalCoords(event);

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    endRef.current = getLocalCoords(event);

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }
    // flushDrawingFrame();

    const start = { ...startRef.current! };
    const end = { ...endRef.current! };
    // ignore just clicks
    if (start.x === end.x && start.y === end.y) return;

    const halfLineWidth = args.lineWidth / 2;
    const pos = {
      x: Math.min(start.x, end.x) - halfLineWidth - 1,
      y: Math.min(start.y, end.y) - halfLineWidth - 1,
      width: Math.abs(start.x - end.x) + args.lineWidth + 2,
      height: Math.abs(start.y - end.y) + args.lineWidth + 2,
    };

    // For circles, ovals and squares, recalculate the bounding box
    if (args.figure === 'circle' || args.figure === 'oval' || args.figure === 'square') {
      if (args.figure === 'square') {
        let w = end.x - start.x;
        let h = end.y - start.y;
        const side = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w) * side;
        h = Math.sign(h) * side;
        const newEnd = { x: start.x + w, y: start.y + h };

        pos.x = Math.min(start.x, newEnd.x) - halfLineWidth - 1;
        pos.y = Math.min(start.y, newEnd.y) - halfLineWidth - 1;
        pos.width = Math.abs(start.x - newEnd.x) + args.lineWidth + 2;
        pos.height = Math.abs(start.y - newEnd.y) + args.lineWidth + 2;
      } else {
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        let rx = Math.abs(end.x - start.x) / 2;
        let ry = Math.abs(end.y - start.y) / 2;

        if (args.figure === 'circle') {
          const r = Math.max(rx, ry);
          rx = ry = r;
        }

        // Bounding box for circle/oval including line width
        pos.x = Math.floor(cx - rx - args.lineWidth / 2 - 1);
        pos.y = Math.floor(cy - ry - args.lineWidth / 2 - 1);
        pos.width = Math.ceil(2 * rx + args.lineWidth + 2);
        pos.height = Math.ceil(2 * ry + args.lineWidth + 2);
      }
    }

    start.x -= pos.x;
    start.y -= pos.y;
    end.x -= pos.x;
    end.y -= pos.y;
    const newArgs = { ...args, start, end };

    const fullArgs: FullArgs = {
      toolName: 'shape',
      args: newArgs,
      pos: pos,
    };
    createLayerFromTool(fullArgs);
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
