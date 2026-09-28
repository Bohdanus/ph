import type { RefObject } from 'react';
import { getTextWidth, type TextToolArgs } from '../tools/text.ts';
import { normalizeHex } from './color.ts';
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

// Every edge goes through the same monotonic map. A one-sided clamp moves only
// the far edge of a rect lying outside the image, leaving an inverted pair that a
// later sort re-forms into a phantom rect of non-zero width outside the document;
// clamping both sides collapses that rect onto a point instead.
function clampEdge(value: number, imageLength: number): number {
  return Math.min(Math.max(0, value), imageLength);
}

export function trimRect(rectSorted: RectXY, imageSize: Size): TrimmedRect {
  const { x1: rawX1, y1: rawY1, x2: rawX2, y2: rawY2 } = rectSorted;
  // Normalise before clamping, never after: `src/tools/crop.ts:17` is the one
  // caller that passes its rect with no `sortRect` of its own.
  const { x1, y1, x2, y2 } = sortRect({ x1: rawX1, y1: rawY1, x2: rawX2, y2: rawY2 });
  const { width: imageWidth, height: imageHeight } = imageSize;

  // A declaration about the input, not the output: it stays true for a rect that
  // lay entirely outside, whose clamped extent below is empty.
  const isTrimmed = x1 < 0 || y1 < 0 || x2 > imageWidth || y2 > imageHeight;

  const left = clampEdge(x1, imageWidth);
  const top = clampEdge(y1, imageHeight);
  const right = clampEdge(x2, imageWidth);
  const bottom = clampEdge(y2, imageHeight);

  // Round each edge once and derive the extent from the rounded edges, so
  // x + width === Math.round(x2) holds by construction for every consumer.
  const x = Math.round(left);
  const y = Math.round(top);
  const width = Math.round(right) - x;
  const height = Math.round(bottom) - y;

  return { x, y, width, height, isTrimmed };
}

export function trimRect2(rectSorted: RectXY, imageSize: Size): RectXY {
  const { x1: rawX1, y1: rawY1, x2: rawX2, y2: rawY2 } = rectSorted;
  const { x1, y1, x2, y2 } = sortRect({ x1: rawX1, y1: rawY1, x2: rawX2, y2: rawY2 });
  const { width: imageWidth, height: imageHeight } = imageSize;

  return {
    x1: clampEdge(x1, imageWidth),
    y1: clampEdge(y1, imageHeight),
    x2: clampEdge(x2, imageWidth),
    y2: clampEdge(y2, imageHeight),
  };
}

export function sortedRectToPos(rectSorted: RectXYSorted): Pos {
  const { x1, y1, x2, y2 } = rectSorted;

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
  const { x, y, width, height } = rect;

  const x1 = x;
  const y1 = y;
  const x2 = x1 + width;
  const y2 = y1 + height;

  return { x1, y1, x2, y2 };
}

export function hexToRgb(hex: string): string {
  // Parse the hex values
  hex = normalizeHex(hex);
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
  const { align, text, fontSize, lineHeight, rect } = newArgs;
  // No rect means the text has not been placed on the canvas yet, and there is nothing to
  // grow. The old `newArgs.rect ?? { x1: 0, y1: 0, x2: 0, y2: 0 }` manufactured one at the
  // document origin, which no caller wanted: the only path that can reach here with a null
  // rect is a toolbar keystroke (`Text.tsx`), and that made `Apply` reachable for text drawn
  // at 0,0 -- `disabled={!text || !rect}` was a dead half that the substitution kept dead.
  // `TextToolArea.tsx:32` passes the rect `useRect`'s `onChangeEnd` hands it, non-null by
  // type, so it can never hit this.
  if (!rect) return null;

  if (!text)
    return {
      ...rect,
      x1: rect.x1 - 1,
      x2: rect.x2 + 1,
      y2: rect.y1 + fontSize * lineHeight + 2 * TEXT_PADDING,
    };

  let newRect = rect;

  const ctx2d = canvasRef.current?.getContext('2d');
  if (ctx2d) {
    const currentWidth = rect.x2 - rect.x1;
    const requiredWidth = getTextWidth(ctx2d, newArgs) + TEXT_PADDING * 2;
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
