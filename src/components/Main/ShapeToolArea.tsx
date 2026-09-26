import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import {
  drawShape,
  normalizeShapeGeometry,
  setShapeCtx,
  shapeGeometryBounds,
  type ShapeToolArgs,
} from '../../tools/shape.ts';
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
      const shape = normalizeShapeGeometry(anchorRef.current!, point, args.figure, {
        shiftKey: event.shiftKey,
        altKey: fromCenterRef.current,
      });
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
      const shape = normalizeShapeGeometry(anchorRef.current!, point, args.figure, {
        shiftKey: event.shiftKey,
        altKey: fromCenterRef.current,
      });
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

    const pos = shapeGeometryBounds({ start, end }, args.lineWidth);

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
