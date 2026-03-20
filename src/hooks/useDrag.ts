import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { usePointerPosition } from './usePointerPosition.ts';
import type { Point, Size } from '../contexts/general-types.ts';

type UseDragProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  imageSize: Size;
  handlePointerHoverMove?: (point: Point) => void; // this is called when pointer is moved, BUT THERE IS NO DRAGGING (returning adjusted coords)

  handlePointerDown?: (point: Point) => void; // is called on mouse down, before any change (returning adjusted coords)
  handleDrag?: (point: Point) => void; // is called when dragging, after each mouse reposition (RAF throttling is done)
  handleDragEnd?: (point: Point) => void; // is called after final change, when mouse is up
};

export function useDrag({
  containerRef,
  imageSize,
  handlePointerHoverMove,
  handlePointerDown,
  handleDrag,
  handleDragEnd,
}: UseDragProps) {
  const pendingPoint = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRequested.current!);
    };
  }, []);

  const { pointerIdRef, isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown } =
    usePointerPosition({
      ref: containerRef,
      imageSize,
    });

  const _handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownValid(event)) return;

    const point = getLocalCoords(event);
    handlePointerDown?.(point);
  };

  const _handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isMouseDown.current && handlePointerHoverMove) {
      pendingPoint.current = getLocalCoords(event);
      if (frameRequested.current !== null) return;

      frameRequested.current = requestAnimationFrame(() => {
        frameRequested.current = null;
        handlePointerHoverMove(pendingPoint.current!);
      });

      return;
    }

    if (!handleDrag) return;
    if (!isPointerMoveValid(event)) return;

    pendingPoint.current = getLocalCoords(event);
    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(() => {
      frameRequested.current = null;
      handleDrag(pendingPoint.current!);
    });
  };

  const _handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
      frameRequested.current = null;
    }

    handleDragEnd?.(getLocalCoords(event));
  };

  return {
    pointerIdRef,
    onPointerDown: _handlePointerDown,
    onPointerMove: _handlePointerMove,
    onPointerUp: _handlePointerUp,
  };
}
