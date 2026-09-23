import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { drawShape, setShapeCtx, type ShapeToolArgs } from '../../tools/shape.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import type { Point } from '../../contexts/general-types.ts';
import type { FullArgs } from '../../contexts/tool-types.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type ShapeHandlerProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const ShapeToolArea = ({ className, overlayCtxRef }: ShapeHandlerProps) => {
  const [{ containerRef, toolOverlayRef, totalSize, documentFrame: currentFrame }] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as ShapeToolArgs;
  const startRef = useRef<Point | null>(null);
  const endRef = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);
  const spacePressedRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const originalShapeRef = useRef<{ start: Point; end: Point } | null>(null);
  const anchorRef = useRef<Point | null>(null);
  const fromCenterRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const normalize = (anchor: Point, end: Point, constrain: boolean, fromCenter = false) => {
    const start = fromCenter ? { x: anchor.x * 2 - end.x, y: anchor.y * 2 - end.y } : anchor;
    let nextEnd = { ...end };
    if (constrain && args.figure !== 'line') {
      const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      nextEnd = {
        x: start.x + Math.sign(end.x - start.x || 1) * side,
        y: start.y + Math.sign(end.y - start.y || 1) * side,
      };
    }
    return { start, end: nextEnd };
  };

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  const flushDrawingFrame = () => {
    frameRequested.current = null;

    const ctx = overlayCtxRef.current!;
    ctx.clearRect(0, 0, toolOverlayRef.current!.width, toolOverlayRef.current!.height); // todo you can clear smaller shape

    const shape = { start: startRef.current!, end: endRef.current! };
    const newArgs = { ...args, ...shape };
    drawShape(ctx, newArgs);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    const ctx = overlayCtxRef.current!;
    setShapeCtx(ctx, args);

    const point = getLocalCoords(event);
    startRef.current = point;
    endRef.current = point;
    anchorRef.current = point;
    fromCenterRef.current = event.altKey;
    lastPointRef.current = point;
    originalShapeRef.current = null;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current || !isPointerMoveValid(event)) return;

    const point = getLocalCoords(event);
    if (spacePressedRef.current && lastPointRef.current && originalShapeRef.current) {
      const dx = point.x - lastPointRef.current.x;
      const dy = point.y - lastPointRef.current.y;
      startRef.current = { x: startRef.current!.x + dx, y: startRef.current!.y + dy };
      endRef.current = { x: endRef.current!.x + dx, y: endRef.current!.y + dy };
    } else {
      const shape = normalize(anchorRef.current!, point, event.shiftKey, fromCenterRef.current);
      startRef.current = shape.start;
      endRef.current = shape.end;
      originalShapeRef.current = shape;
    }
    lastPointRef.current = point;

    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(flushDrawingFrame);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    const point = getLocalCoords(event);
    const movedBySpace =
      originalShapeRef.current &&
      (startRef.current!.x !== anchorRef.current!.x || startRef.current!.y !== anchorRef.current!.y);
    if (!movedBySpace) {
      const shape = normalize(anchorRef.current!, point, event.shiftKey, fromCenterRef.current);
      startRef.current = shape.start;
      endRef.current = shape.end;
    }

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }
    // flushDrawingFrame();

    const start = canvasToDocumentPoint({ ...startRef.current! }, documentFrame);
    const end = canvasToDocumentPoint({ ...endRef.current! }, documentFrame);
    // A click creates a precise shape, matching Photoshop's single-click workflow.
    if (start.x === end.x && start.y === end.y) {
      const width = Number(window.prompt('Width (px)', '100'));
      const height = Number(window.prompt('Height (px)', '100'));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
      end.x += width;
      end.y += height;
    }

    const halfLineWidth = args.lineWidth / 2;
    const pos = {
      x: Math.min(start.x, end.x) - halfLineWidth - 1,
      y: Math.min(start.y, end.y) - halfLineWidth - 1,
      width: Math.abs(start.x - end.x) + args.lineWidth + 2,
      height: Math.abs(start.y - end.y) + args.lineWidth + 2,
    };

    // For circles and squares, recalculate the bounding box
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
