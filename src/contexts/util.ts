import type { Rect, RectXY, Size } from './ImageContext.tsx';
import type { RefObject } from 'react';

export function getCanvasSize(canvasRef: RefObject<HTMLCanvasElement | null>): Size {
  if (!canvasRef.current) return { width: 0, height: 0 };
  return {
    width: canvasRef.current.width,
    height: canvasRef.current.height,
  };
}

export function sortRect(rect: RectXY): RectXY {
  const { x1, y1, x2, y2 } = rect;

  const newX1 = Math.min(x1, x2);
  const newY1 = Math.min(y1, y2);
  const newX2 = Math.max(x1, x2);
  const newY2 = Math.max(y1, y2);

  return { x1: newX1, y1: newY1, x2: newX2, y2: newY2 };
}

type TrimmedRect = Rect & { isTrimmed: boolean };

export function trimRect(rectSorted: RectXY, imageSize: Size): TrimmedRect {
  let { x1, y1, x2, y2 } = rectSorted;
  const { width: imageWidth, height: imageHeight } = imageSize;
  const isTrimmed = x1 < 0 || y1 < 0 || x2 > imageWidth || y2 > imageHeight; // && x1 !== x2 && y1 !== y2;

  if (isTrimmed) {
    x1 = Math.max(0, x1);
    y1 = Math.max(0, y1);
    x2 = Math.min(imageWidth, x2);
    y2 = Math.min(imageHeight, y2);
  }

  const x = Math.round(x1);
  const y = Math.round(y1);
  const width = Math.round(x2 - x1);
  const height = Math.round(y2 - y1);

  return { x, y, width, height, isTrimmed };
}

export function hexToRgb(hex: string): string {
  // Remove the #
  hex = hex.replace('#', '');

  // Parse the hex values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `${r}, ${g}, ${b}`;
}
