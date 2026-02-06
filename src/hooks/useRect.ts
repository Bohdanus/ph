import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import type { Point, RectXY, RectXYSorted, Size } from '../contexts/ImageContext.tsx';
import { usePointerPosition } from './usePointerPosition.ts';
import { getCanvasSize, sortRect, trimRect } from '../util/rect.ts';
import { CURSOR_MAP, HANDLE_SIZE } from '../util/constants.ts';

type UseRectProps = {
  enabled?: boolean;
  imageSize: Size;
  initialRect?: RectXYSorted | null; // can be set using props
  containerRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  onChange?: (sortedRect: RectXYSorted) => void; // is called when dragging, after each mouse move (RAF throttling is done)
  onChangeEnd: (sortedRect: RectXYSorted) => void; // is called after final change, when mouse is up
  aspectRatio?: number | null;
};

export function useRect({
  imageSize,
  initialRect,
  containerRef,
  overlayRef,
  overlayCtxRef,
  onChange,
  onChangeEnd,
  aspectRatio = null,
}: UseRectProps) {
  const rectUnsortedRef = useRef<RectXY | null>(null); // might become unsorted while dragging
  const startPointRef = useRef<Point | null>(null);
  const movingEdgeRef = useRef<string | null>(null);
  const customAspectRatioRef = useRef<number | null>(null);

  const pendingPoint = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

  // when rotating or mirroring, crop area changes, so redraw the crop mask
  useEffect(() => {
    rectUnsortedRef.current = initialRect ?? null;
    drawMask();
  }, [initialRect]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRequested.current!);
      overlayCtxRef.current!.clearRect(0, 0, imageSize.width, imageSize.height);
    };
  }, []);

  const { dimensionsRef, onPointerDown, onPointerUp, getLocalCoords, isMouseDown } = usePointerPosition({
    ref: containerRef,
    imageSize,
    onResize: drawMask,
  });

  function getEdgeAtPoint(point: Point, event?: PointerEvent<HTMLDivElement>): string | undefined {
    if (initialRect) {
      const { x1, y1, x2, y2 } = initialRect;
      const { scale } = dimensionsRef.current;
      const h2 = HANDLE_SIZE / scale / 2;

      // Detect modifier keys to lock aspect ratio, if not set already
      if (!aspectRatio && event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
        customAspectRatioRef.current = (x2 - x1) / (y2 - y1);
      }

      // check for tops
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top-left';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top-right';
      }
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom-left';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom-right';
      }

      // check for line
      if (point.x >= x1 && point.x <= x2 && point.y >= y1 - h2 && point.y <= y1 + h2) {
        return 'top';
      }
      if (point.x >= x2 - h2 && point.x <= x2 + h2 && point.y >= y1 && point.y <= y2) {
        return 'right';
      }
      if (point.x >= x1 - h2 && point.x <= x1 + h2 && point.y >= y1 && point.y <= y2) {
        return 'left';
      }
      if (point.x >= x1 && point.x <= x2 && point.y >= y2 - h2 && point.y <= y2 + h2) {
        return 'bottom';
      }

      // inside the resize square
      if (point.x > x1 && point.x < x2 && point.y > y1 && point.y < y2) {
        return 'inside';
      }
    }
  }

  function setMouseCursor(edge: string | undefined, event: PointerEvent<HTMLDivElement>) {
    const eventTarget = event.target as HTMLDivElement;
    const cursor = CURSOR_MAP[edge as keyof typeof CURSOR_MAP];

    eventTarget.style.cursor = cursor ?? '';
  }

  function drawMask() {
    const ctx = overlayCtxRef.current!;
    const { scale } = dimensionsRef.current;

    ctx.clearRect(0, 0, imageSize.width, imageSize.height);

    const rect = rectUnsortedRef.current;
    if (!rect) return;

    const { x, y, width, height } = trimRect(sortRect(rect), getCanvasSize(overlayRef));

    // Draw semi-transparent overlay
    // eslint-disable-next-line react-compiler/react-compiler
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, imageSize.width, imageSize.height);

    // Clear the selection area
    ctx.clearRect(x, y, width, height);

    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([5 / scale, 5 / scale]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw handles
    const h1 = HANDLE_SIZE / scale;
    const h2 = h1 / 2;
    ctx.fillStyle = '#007bff';
    ctx.fillRect(x - h2, y - h2, h1, h1);
    ctx.fillRect(x + width - h2, y - h2, h1, h1);
    ctx.fillRect(x - h2, y + height - h2, h1, h1);
    ctx.fillRect(x + width - h2, y + height - h2, h1, h1);

    // todo update status bar - add func on each update
    onChange?.(sortRect(rect));
  }

  function adjustHeightRatio({ x1, y1, x2, y2 }: RectXY, _aspectRatio: number | null) {
    if (_aspectRatio) {
      const width = Math.abs(x2 - x1);
      const currentHeight = Math.abs(y2 - y1);
      const wantedHeight = width / _aspectRatio;
      const diff = (wantedHeight - currentHeight) / 2;
      if (y1 < y2) {
        y1 -= diff;
        y2 += diff;
      } else {
        y1 += diff;
        y2 -= diff;
      }
    }
    return { y1, y2 };
  }

  function calculateCropRect(point: Point) {
    let x1, x2, y1, y2;
    const startPoint = startPointRef.current!;
    const startEdge = movingEdgeRef.current;

    const _aspectRatio = customAspectRatioRef.current ?? aspectRatio;

    if (initialRect && startEdge) {
      ({ x1, y1, x2, y2 } = initialRect);
      switch (startEdge) {
        case 'inside':
          const dx = point.x - startPoint.x;
          const dy = point.y - startPoint.y;
          x1 += dx;
          y1 += dy;
          x2 += dx;
          y2 += dy;
          break;
        case 'left':
          x1 = point.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'right':
          x2 = point.x;
          ({ y1, y2 } = adjustHeightRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'top':
          y1 = point.y;
          if (_aspectRatio) {
            const height = Math.abs(y2 - y1);
            const width = height * _aspectRatio;
            x2 = x1 + width * (x2 < x1 ? -1 : 1);
          }
          break;
        case 'bottom':
          y2 = point.y;
          if (_aspectRatio) {
            const height = Math.abs(y2 - y1);
            const width = height * _aspectRatio;
            x2 = x1 + width * (x2 < x1 ? -1 : 1);
          }
          break;
        case 'top-left':
          if (_aspectRatio) {
            const width = Math.abs(startPoint.x - point.x);
            const height = Math.abs(y2 - y1);
            if (width / height > _aspectRatio) {
              // width is too large
              x2 = x1 + height * _aspectRatio * (x2 < x1 ? -1 : 1);
            } else {
              // height is too large
              y2 = y1 + (width / _aspectRatio) * (y2 < y1 ? -1 : 1);
            }
          }
          break;

        case 'top-right':
        case 'bottom-left':
        case 'bottom-right':
          if (_aspectRatio) {
            x2 = point.x;
            y2 = point.y;
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            if (width / height > _aspectRatio) {
              // width is too large
              x2 = x1 + height * _aspectRatio * (x2 < x1 ? -1 : 1);
            } else {
              // height is too large
              y2 = y1 + (width / _aspectRatio) * (y2 < y1 ? -1 : 1);
            }
          }
          break;
      }
    } else {
      x1 = startPoint.x;
      y1 = startPoint.y;
      x2 = point.x;
      y2 = point.y;

      if (_aspectRatio) {
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        if (width / height > _aspectRatio) {
          x2 = x1 + height * _aspectRatio * (x2 < x1 ? -1 : 1);
        } else {
          y2 = y1 + (width / _aspectRatio) * (y2 < y1 ? -1 : 1);
        }
      }
    }

    const rect = {
      x1,
      y1,
      x2,
      y2,
    };
    rectUnsortedRef.current = rect; // save for resize to work

    return rect;
  }

  ////////////////////////////

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerDown(event)) return;

    startPointRef.current = null;
    movingEdgeRef.current = null;

    const point = getLocalCoords(event);

    if (initialRect) {
      const edge = getEdgeAtPoint(point, event);
      setMouseCursor(edge, event);

      switch (edge) {
        case 'inside':
          startPointRef.current = point;
          movingEdgeRef.current = edge;
          return;
        case 'top-left':
          startPointRef.current = {
            x: initialRect.x2,
            y: initialRect.y2,
          };
          movingEdgeRef.current = edge;
          return;
        case 'top-right':
          startPointRef.current = {
            x: initialRect.x1,
            y: initialRect.y2,
          };
          movingEdgeRef.current = edge;
          return;
        case 'bottom-left':
          startPointRef.current = {
            x: initialRect.x2,
            y: initialRect.y1,
          };
          movingEdgeRef.current = edge;
          return;
        case 'bottom-right':
          startPointRef.current = {
            x: initialRect.x1,
            y: initialRect.y1,
          };
          movingEdgeRef.current = edge;
          return;
        case 'top':
        case 'left':
        case 'bottom':
        case 'right':
          movingEdgeRef.current = edge;
          return;
      }
    }

    startPointRef.current = point;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = getLocalCoords(event);

    if (!isMouseDown.current) {
      const edge = getEdgeAtPoint(point);
      setMouseCursor(edge, event);
      return;
    }

    pendingPoint.current = point;
    if (frameRequested.current !== null) return;

    frameRequested.current = requestAnimationFrame(() => {
      frameRequested.current = null;

      calculateCropRect(pendingPoint.current!);
      drawMask();
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerUp(event)) return;

    (event.target as HTMLDivElement).style.cursor = '';

    const point = getLocalCoords(event);
    const sortedRect = sortRect(calculateCropRect(point));
    onChangeEnd(sortedRect);

    startPointRef.current = null;
    movingEdgeRef.current = null;

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }

    customAspectRatioRef.current = null;

    // commented out because useEffect after initialRect change is doing the shit anyway
    // drawMask();
  };

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
  };
}
