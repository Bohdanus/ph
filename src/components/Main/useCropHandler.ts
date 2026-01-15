import { type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { type InteractionMode, type Point, type Size } from '../../contexts/ImageContext';
import type { CropToolType } from '../../tools/crop.ts';

const HANDLE_SIZE = 10;

interface CropHandlerConfig {
  crop: CropToolType | null;
  getCanvasCoordinates: (event: PointerEvent<HTMLCanvasElement>) => Point;
  interactionMode: InteractionMode;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  setCrop: (crop: CropToolType | null) => void;
  size: Size;
}

export const useCropHandler = ({
  crop,
  overlayCtxRef,
  overlayRef,
  getCanvasCoordinates,
  setCrop,
  size,
}: CropHandlerConfig) => {
  const isMouseDown = useRef(false);
  const cropStart = useRef<Point | null>(null);
  const frameRequested = useRef(false);

  useEffect(() => {
    drawCropMask(crop);
  }, [size]);

  function drawCropMask(rect: CropToolType | null) {
    if (!rect) return;

    const { x, y, width, height } = rect;
    if (width === 0 || height === 0) return;

    const ctx = overlayCtxRef.current!;
    const width_overlay = overlayRef.current!.width;
    const height_overlay = overlayRef.current!.height;

    ctx.clearRect(0, 0, width_overlay, height_overlay);

    // Draw semi-transparent overlay
    // eslint-disable-next-line react-compiler/react-compiler
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, width_overlay, height_overlay);

    // Clear the selection area
    ctx.clearRect(x, y, width, height);

    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw handles
    ctx.fillStyle = '#007bff';
    ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x + width - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x + width - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  const handleCropResize = (coords: Point) => {
    const start = cropStart.current!;
    const x = Math.min(start.x, coords.x);
    const y = Math.min(start.y, coords.y);
    const width = Math.abs(start.x - coords.x);
    const height = Math.abs(start.y - coords.y);

    const newCrop = { x, y, width, height };
    drawCropMask(newCrop);
    setCrop(newCrop);

    frameRequested.current = false;
  };

  const handleMouseDown = (event: PointerEvent<HTMLCanvasElement>) => {
    isMouseDown.current = true;
    const coords = getCanvasCoordinates(event);

    if (crop) {
      const { x, y, width, height } = crop;
      const h2 = HANDLE_SIZE / 2;
      let cursor = 'crosshair';

      // check if the mouse is inside a resize handle
      if (coords.x >= x - h2 && coords.x <= x + h2 && coords.y >= y - h2 && coords.y <= y + h2) {
        // 'top-left';
        cropStart.current = {
          x: crop.x + crop.width,
          y: crop.y + crop.height,
        };
        cursor = 'nwse-resize';
      } else if (coords.x >= x + width - h2 && coords.x <= x + width + h2 && coords.y >= y - h2 && coords.y <= y + h2) {
        // 'top-right';
        cropStart.current = {
          x: crop.x + crop.width,
          y: crop.y,
        };
        cursor = 'nesw-resize';
      } else if (
        coords.x >= x - h2 &&
        coords.x <= x + h2 &&
        coords.y >= y + height - h2 &&
        coords.y <= y + height + h2
      ) {
        //'bottom-left';
        cropStart.current = {
          x: crop.x,
          y: crop.y + crop.height,
        };
        cursor = 'nesw-resize';
      } else if (
        coords.x >= x + width - h2 &&
        coords.x <= x + width + h2 &&
        coords.y >= y + height - h2 &&
        coords.y <= y + height + h2
      ) {
        //'bottom-right';
        cropStart.current = {
          x: crop.x,
          y: crop.y,
        };
        cursor = 'nsew-resize';
      }

      overlayRef.current!.style.cursor = cursor;
    }

    cropStart.current = coords;
  };

  const handleMouseMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(event);

    if (isMouseDown.current && !frameRequested.current) {
      frameRequested.current = true;
      requestAnimationFrame(() => handleCropResize(coords));
    }
  };

  const handleMouseUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isMouseDown.current) return;

    const coords = getCanvasCoordinates(event);
    const start = cropStart.current!;
    const overlay = overlayRef.current!;

    const x1 = Math.max(0, Math.min(overlay.width, start.x));
    const y1 = Math.max(0, Math.min(overlay.height, start.y));
    const x2 = Math.max(0, Math.min(overlay.width, coords.x));
    const y2 = Math.max(0, Math.min(overlay.height, coords.y));

    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x1 - x2);
    const height = Math.abs(y1 - y2);

    if (width > 0 && height > 0) {
      setCrop({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
    }

    overlayRef.current!.style.cursor = 'crosshair';

    requestAnimationFrame(() => {
      handleCropResize(coords);
      cropStart.current = null;
    });

    isMouseDown.current = false;
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
};
