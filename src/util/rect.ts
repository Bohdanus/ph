import type { RefObject } from 'react';
import { getTextWidth, type TextToolArgs } from '../tools/text.ts';
import { TEXT_PADDING } from './constants.ts';
import type { Pos, RectXY, Size, RectXYSorted } from '../contexts/general-types.ts';

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

type TrimmedRect = Pos & { isTrimmed: boolean };

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

  // Ensure coordinates are in correct order (handle inverted coordinates)
  if (x1 > x2) [x1, x2] = [x2, x1];
  if (y1 > y2) [y1, y2] = [y2, y1];

  const x = Math.round(x1);
  const y = Math.round(y1);
  const width = Math.round(x2 - x1);
  const height = Math.round(y2 - y1);

  return { x, y, width, height, isTrimmed };
}

export function trimRect2(rectSorted: RectXY, imageSize: Size): RectXY {
  let { x1, y1, x2, y2 } = rectSorted;
  const { width: imageWidth, height: imageHeight } = imageSize;

  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  x2 = Math.min(imageWidth, x2);
  y2 = Math.min(imageHeight, y2);

  return { x1, y1, x2, y2 };
}

export function sortedRectToPos(rectSorted: RectXYSorted): Pos {
  let { x1, y1, x2, y2 } = rectSorted;

  const x = x1;
  const y = y1;
  const width = x2 - x1;
  const height = y2 - y1;

  return { x, y, width, height };
}

export function reduceRect(sortedRect: RectXYSorted, pos: Pos) {
  return {
    x1: sortedRect.x1 - pos.x,
    y1: sortedRect.y1 - pos.y,
    x2: sortedRect.x2 - pos.x,
    y2: sortedRect.y2 - pos.y,
  };
}

export function posToSortedRect(rect: Pos): RectXYSorted {
  let { x, y, width, height } = rect;

  const x1 = x;
  const y1 = y;
  const x2 = x1 + width;
  const y2 = y1 + height;

  return { x1, y1, x2, y2 };
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

export const calculateNewRect = (
  newArgs: TextToolArgs,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  imageSize: Size
): RectXYSorted | null => {
  const { align, text, fontSize, lineHeight } = newArgs;
  const rect = newArgs.rect ?? { x1: 0, y1: 0, x2: 0, y2: 0 };

  if (!text)
    return {
      ...rect,
      x1: rect.x1 - 1,
      x2: rect.x2 + 1,
      y2: rect.y1 + fontSize * lineHeight + 2 * TEXT_PADDING,
    };

  let newRect = rect;

  const currentWidth = rect.x2 - rect.x1;
  const requiredWidth = getTextWidth(canvasRef.current!.getContext('2d')!, newArgs) + TEXT_PADDING * 2;
  if (requiredWidth > currentWidth) {
    switch (align) {
      case 'left':
        newRect = { ...rect, x2: rect.x1 + requiredWidth };
        break;
      case 'center':
        newRect = {
          ...rect,
          x1: rect.x1 + (currentWidth - requiredWidth) / 2,
          x2: rect.x1 + (currentWidth + requiredWidth) / 2,
        };
        break;
      case 'right':
        newRect = { ...rect, x1: rect.x2 - requiredWidth };
    }
  }

  const lines = text.split('\n');
  const lineCount = lines.length;
  const requiredHeight = lineCount * fontSize * lineHeight + TEXT_PADDING * 2;

  const currentHeight = newRect.y2 - newRect.y1;
  if (requiredHeight > currentHeight) {
    newRect = { ...newRect, y2: newRect.y1 + requiredHeight };
  }

  return trimRect2(newRect, imageSize);
};
