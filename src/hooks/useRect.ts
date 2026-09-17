import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import type { Point, RectXY, RectXYSorted, Size } from '../contexts/general-types.ts';
import { usePointerPosition } from './usePointerPosition.ts';
import { getCanvasSize, posToSortedRect, sortRect, trimRect } from '../util/rect.ts';
import { CURSOR_MAP, HANDLE_SIZE } from '../util/constants.ts';
import { isEqual } from 'lodash-es';
import type { Layer } from '../contexts/layer-types.ts';

type UseRectProps = {
  aspectRatio?: number | null;
  imageSize: Size;
  initialRect?: RectXYSorted | null; // can be set using props

  hideBlend?: boolean;
  isMoveTool?: boolean;

  containerRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;

  onRepaint?: (sortedRect: RectXYSorted) => void; // is called on redraw (RAF throttled)
  onChange?: (sortedRect: RectXYSorted) => void; // is called on resize (RAF throttled)
  onChangeEnd: (sortedRect: RectXYSorted) => void; // is called after final change, when mouse is up
};

export function useRect({
  aspectRatio = null,
  imageSize,
  initialRect,

  hideBlend,
  isMoveTool,

  containerRef,
  overlayRef,

  onRepaint,
  onChange,
  onChangeEnd,
}: UseRectProps) {
  const startRectRef = useRef<RectXYSorted | null>(null);
  const rectUnsortedRef = useRef<RectXY | null>(null); // might become unsorted while dragging

  const startPointRef = useRef<Point | null>(null);
  const currentEdgeRef = useRef<string | null>(null);
  const customAspectRatioRef = useRef<number | null>(null);

  const pendingPoint = useRef<Point | null>(null);
  const frameRequested = useRef<number | null>(null);

  const ctx = overlayRef.current!.getContext('2d')!;

  useEffect(() => {
    if (aspectRatio && initialRect) {
      const patch = adjustWidthRatio(initialRect, aspectRatio);
      startRectRef.current = { ...initialRect, ...patch };
    } else {
      startRectRef.current = initialRect ? { ...initialRect } : null;
    }

    if (!isEqual(startRectRef.current, rectUnsortedRef.current)) {
      rectUnsortedRef.current = startRectRef.current ? { ...startRectRef.current } : null;
      drawMask();
    }
  }, [aspectRatio, initialRect]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameRequested.current!);
    };
  }, []);

  const pointerPositionData = usePointerPosition({
    ref: containerRef,
    imageSize,
    onResize: () => {
      drawMask();
    },
  });

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords, isMouseDown, dimensionsRef } =
    pointerPositionData;

  function getEdgeAtPoint(point: Point, event?: PointerEvent<HTMLDivElement>): string | null {
    const _initialRect = startRectRef.current;
    if (_initialRect) {
      const { x1, y1, x2, y2 } = _initialRect;
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

    return null;
  }

  function setMouseCursor(edge: string | null, event: PointerEvent<HTMLDivElement>) {
    const eventTarget = event.target as HTMLDivElement;
    const cursor = CURSOR_MAP[edge as keyof typeof CURSOR_MAP];

    eventTarget.style.cursor = cursor ?? '';
  }

  function drawMask(hasRectChanged?: boolean) {
    const { scale } = dimensionsRef.current;

    ctx.clearRect(0, 0, imageSize.width, imageSize.height);

    const rect = rectUnsortedRef.current;
    if (!rect) return;

    const { x, y, width, height } = trimRect(sortRect(rect), getCanvasSize(overlayRef));

    if (!hideBlend) {
      // Draw semi-transparent overlay

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, imageSize.width, imageSize.height);

      // Clear the selection area
      ctx.clearRect(x, y, width, height);
    }

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
    const sortedRect = sortRect(rect);
    onRepaint?.(sortedRect);

    if (hasRectChanged) {
      onChange?.(sortedRect);
    }
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

  function adjustWidthRatio({ x1, y1, x2, y2 }: RectXY, _aspectRatio: number | null) {
    if (_aspectRatio) {
      const height = Math.abs(y2 - y1);
      const currentWidth = Math.abs(x2 - x1);
      const wantedWidth = height / _aspectRatio;
      const diff = (wantedWidth - currentWidth) / 2;
      if (x1 < x2) {
        x1 -= diff;
        x2 += diff;
      } else {
        x1 += diff;
        x2 -= diff;
      }
    }
    return { x1, x2 };
  }

  function adjustFreePoint(point: Point, _aspectRatio: number | null) {
    const x1 = startPointRef.current!.x;
    const y1 = startPointRef.current!.y;
    let x2 = point.x;
    let y2 = point.y;

    if (_aspectRatio) {
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);
      if (width / height > _aspectRatio) {
        x2 = x1 + height * _aspectRatio * (x2 < x1 ? -1 : 1);
      } else {
        y2 = y1 + (width / _aspectRatio) * (y2 < y1 ? -1 : 1);
      }
    }
    return { x1, y1, x2, y2 };
  }

  function calculateMaskRect(point: Point) {
    let x1, x2, y1, y2;
    const _initialRect = startRectRef.current;
    const startPoint = startPointRef.current!;
    const edge = currentEdgeRef.current;

    const _aspectRatio = customAspectRatioRef.current ?? aspectRatio;

    if (_initialRect && edge) {
      ({ x1, y1, x2, y2 } = _initialRect);
      switch (edge) {
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
          ({ x1, x2 } = adjustWidthRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        case 'bottom':
          y2 = point.y;
          ({ x1, x2 } = adjustWidthRatio({ x1, y1, x2, y2 }, _aspectRatio));
          break;
        default:
          ({ x1, y1, x2, y2 } = adjustFreePoint(point, _aspectRatio));
      }
    } else {
      ({ x1, y1, x2, y2 } = adjustFreePoint(point, _aspectRatio));
    }

    const result = {
      x1,
      y1,
      x2,
      y2,
    };
    rectUnsortedRef.current = result; // save for resize to work

    return result;
  }

  ////////////////////////////

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, layerUnderPointer?: Layer): boolean => {
    if (!isPointerDownValid(event)) return false;

    let isHandleClicked = false;

    currentEdgeRef.current = null;

    const point = getLocalCoords(event);
    startPointRef.current = point;

    const selectionRect = startRectRef.current;

    if (selectionRect) {
      const edge = getEdgeAtPoint(point, event);
      currentEdgeRef.current = edge;

      isHandleClicked = !!edge;

      setMouseCursor(edge, event);

      switch (edge) {
        case 'top-left':
          startPointRef.current = {
            x: selectionRect.x2,
            y: selectionRect.y2,
          };
          break;
        case 'top-right':
          startPointRef.current = {
            x: selectionRect.x1,
            y: selectionRect.y2,
          };
          break;
        case 'bottom-left':
          startPointRef.current = {
            x: selectionRect.x2,
            y: selectionRect.y1,
          };
          break;
        case 'bottom-right':
          startPointRef.current = {
            x: selectionRect.x1,
            y: selectionRect.y1,
          };
          break;
      }
    }

    if (!isHandleClicked && layerUnderPointer && !layerUnderPointer.isBedrock) {
      rectUnsortedRef.current = posToSortedRect(layerUnderPointer.pos);
      startRectRef.current = { ...rectUnsortedRef.current };

      currentEdgeRef.current = 'inside';
      setMouseCursor('inside', event);
      drawMask();
    }

    return isHandleClicked;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): boolean => {
    const point = getLocalCoords(event);

    // detect mouse over drag handles
    if (!isMouseDown.current) {
      const edge = getEdgeAtPoint(point);
      setMouseCursor(edge, event);
      return !!edge;
    }

    if (!isPointerMoveValid(event)) return false;
    if (isMoveTool && !startRectRef.current) return false;

    pendingPoint.current = point;
    if (frameRequested.current !== null) return false;

    frameRequested.current = requestAnimationFrame(() => {
      frameRequested.current = null;

      calculateMaskRect(pendingPoint.current!);
      drawMask(true);
    });

    return false;
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    (event.target as HTMLDivElement).style.cursor = '';

    if (isMoveTool && !startRectRef.current) return;

    const point = getLocalCoords(event);
    const sortedRect = sortRect(calculateMaskRect(point));
    onChangeEnd(sortedRect);

    startRectRef.current = { ...sortedRect };
    startPointRef.current = null;
    currentEdgeRef.current = null;
    customAspectRatioRef.current = null;

    cancelAnimationFrame(frameRequested.current!);
    frameRequested.current = null;

    drawMask();
  };

  return {
    ...pointerPositionData,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    clearSelection: () => {
      startRectRef.current = null;
      rectUnsortedRef.current = null;
      currentEdgeRef.current = null;
      customAspectRatioRef.current = null;
      drawMask();
    },
  };
}
