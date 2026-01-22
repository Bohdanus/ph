import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { type InteractionMode, type Point, type RectXY, type Size } from '../../contexts/ImageContext';
import type { CropToolType } from '../../tools/crop.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { sortRect, trimRect } from '../../contexts/util.ts';

const HANDLE_SIZE = 10;

const CURSOR_MAP = {
  top: 'ns-resize',
  'top-right': 'nesw-resize',
  right: 'ew-resize',
  'bottom-right': 'nwse-resize',
  bottom: 'ns-resize',
  'bottom-left': 'nesw-resize',
  left: 'ew-resize',
  'top-left': 'nwse-resize',
  inside: 'move',
};

interface CropHandlerConfig {
  containerRef: RefObject<HTMLElement | null>;
  crop: CropToolType | null; /* sorted */
  interactionMode: InteractionMode;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  setCrop: (crop: CropToolType | null) => void;
  size: Size;
}

export const useCropHandler = ({
  containerRef,
  crop,
  interactionMode,
  overlayCtxRef,
  overlayRef,
  setCrop,
  size,
}: CropHandlerConfig) => {
  const cropStart = useRef<Point | null>(null);
  const cropEdgeStart = useRef<string | null>(null);
  const frameRequested = useRef<number | null>(null);
  const lastCropRectUnsorted = useRef<RectXY | null>(null);

  // cleanup when leaving the tool
  useEffect(() => {
    cropStart.current = null;
    cropEdgeStart.current = null;
    setCrop(null);
  }, [interactionMode]);

  // when rotating crop changes
  useEffect(() => {
    if (interactionMode === 'crop') {
      lastCropRectUnsorted.current = crop;
      drawCropMask();
    }
  }, [crop, interactionMode]);

  function onContainerResize() {
    if (interactionMode === 'crop') {
      drawCropMask();
    }
  }

  const { dimensionsRef, onPointerDown, onPointerUp, getLocalCoords, isMouseDown } = usePointerPosition(
    containerRef,
    size,
    onContainerResize
  );

  function getCropEdge(point: Point) {
    if (crop) {
      const { x1, y1, x2, y2 } = crop;
      const { scale } = dimensionsRef.current;
      const h2 = HANDLE_SIZE / scale / 2;

      // check if the mouse is inside a resize handle
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

      // check for resize line
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

      // inside
      if (point.x > x1 && point.x < x2 && point.y > y1 && point.y < y2) {
        return 'inside';
      }
    }
  }

  function setMouseCursor(edge?: string) {
    const cursor = CURSOR_MAP[edge as keyof typeof CURSOR_MAP];

    overlayRef.current!.style.cursor = cursor ?? '';
  }

  function drawCropMask() {
    const ctx = overlayCtxRef.current!;
    const width_overlay = size.width;
    const height_overlay = size.height;
    const { scale } = dimensionsRef.current;

    ctx.clearRect(0, 0, width_overlay, height_overlay);

    const rect = lastCropRectUnsorted.current;
    if (!rect) return;

    const { x, y, width, height } = trimRect(rect, size);
    // if (width === 0 || height === 0) return; // just clear if useless selection

    // Draw semi-transparent overlay
    // eslint-disable-next-line react-compiler/react-compiler
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, width_overlay, height_overlay);

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

    // todo update status bar
  }

  function calculateCropRect(point: Point) {
    let x1, x2, y1, y2;
    const startEdge = cropEdgeStart.current;
    if (crop && startEdge) {
      ({ x1, y1, x2, y2 } = crop);
      switch (startEdge) {
        case 'inside':
          const dx = point.x - cropStart.current!.x;
          const dy = point.y - cropStart.current!.y;
          x1 += dx;
          y1 += dy;
          x2 += dx;
          y2 += dy;
          break;
        case 'left':
          x1 = point.x;
          break;
        case 'right':
          x2 = point.x;
          break;
        case 'top':
          y1 = point.y;
          break;
        case 'bottom':
          y2 = point.y;
          break;
      }
    } else {
      const start = cropStart.current!;
      x1 = start.x;
      y1 = start.y;
      x2 = point.x;
      y2 = point.y;
    }

    const rect = {
      x1,
      y1,
      x2,
      y2,
    };
    lastCropRectUnsorted.current = rect; // save for resize to work

    return rect;
  }

  const handleMouseDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerDown(event)) return;

    const point = getLocalCoords(event);

    if (crop) {
      const edge = getCropEdge(point);
      setMouseCursor(edge);

      cropStart.current = null;
      cropEdgeStart.current = null;

      switch (edge) {
        case 'inside':
          cropStart.current = point;
          cropEdgeStart.current = edge;
          return;
        case 'top-left':
          cropStart.current = {
            x: crop.x2,
            y: crop.y2,
          };
          return;
        case 'top-right':
          cropStart.current = {
            x: crop.x2,
            y: crop.y1,
          };
          return;
        case 'bottom-left':
          cropStart.current = {
            x: crop.x1,
            y: crop.y2,
          };
          return;
        case 'bottom-right':
          cropStart.current = {
            x: crop.x1,
            y: crop.y1,
          };
          return;
        case 'top':
        case 'left':
        case 'bottom':
        case 'right':
          cropEdgeStart.current = edge;
          return;
      }
    }

    cropStart.current = point;
  };

  const handleMouseMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = getLocalCoords(event);

    if (!isMouseDown.current) {
      const edge = getCropEdge(point);
      setMouseCursor(edge);
      return;
    }

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }
    frameRequested.current = requestAnimationFrame(() => {
      frameRequested.current = null;

      calculateCropRect(point);
      drawCropMask();
    });
  };

  const handleMouseUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!onPointerUp(event)) return;

    overlayRef.current!.style.cursor = '';

    const point = getLocalCoords(event);
    const newCrop = sortRect(calculateCropRect(point));
    const newCropTrimmed = trimRect(newCrop, size);

    if (newCropTrimmed.width === 0 || newCropTrimmed.height === 0) {
      setCrop(null);
    } else {
      setCrop(newCrop);
    }

    cropStart.current = null;
    cropEdgeStart.current = null;

    if (frameRequested.current !== null) {
      cancelAnimationFrame(frameRequested.current);
    }

    // commented out because useEffect is doing the shit
    // drawCropMask();
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};
