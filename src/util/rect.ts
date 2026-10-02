import type { RefObject } from 'react';
import { getTextLineCount, getTextWidth, resolveTextKind, textWrapWidth, type TextToolArgs } from '../tools/text.ts';
import { normalizeHex } from './color.ts';
import { TEXT_PADDING } from './constants.ts';
import type { Ctx2D, Pos, RectXY, Size, RectXYSorted } from '../contexts/general-types.ts';

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

// Round each edge once and derive the extent from the rounded edges, so
// x + width === Math.round(x2) holds by construction for every consumer.
// `trimRect` feeds it clamped edges, `sortRoundRect` feeds it unclamped ones:
// the rounding is the same, the clamp is the caller's decision.
function roundedPos(left: number, top: number, right: number, bottom: number): Pos {
  const x = Math.round(left);
  const y = Math.round(top);
  const width = Math.round(right) - x;
  const height = Math.round(bottom) - y;

  return { x, y, width, height };
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

  return { ...roundedPos(left, top, right, bottom), isTrimmed };
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

// `trimRect` without the clamp: crop extends the canvas past the image edge, so the
// rect this normalises is expected to leave it. That is why there is no `imageSize`
// argument and no `isTrimmed` — a caller that needs the intersection clamps separately.
export function sortRoundRect(rect: RectXY): Pos {
  const { x1, y1, x2, y2 } = sortRect(rect);

  return roundedPos(x1, y1, x2, y2);
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

  const isParagraph = resolveTextKind(newArgs) === 'paragraph';

  // A paragraph box's width is the width the user dragged, so it is clamped BEFORE anything is
  // measured rather than after. `useRect.drawMask` paints `trimRect(...)` while handing
  // `onRepaint` the unclamped rect, so without this the preview wraps at the dragged width while
  // the committed box is the clamped one and the two wrap differently — a divergence that moves
  // ink today and changes where the lines break under wrapping.
  const placed = isParagraph ? (trimRect2(rect, imageSize) ?? rect) : rect;

  let newRect = placed;

  const ctx2d = canvasRef.current?.getContext('2d');
  if (ctx2d) {
    if (isParagraph) {
      // Only the height is content-derived for a paragraph box. The width is not grown and not
      // re-placed: "the lines of type wrap to fit the dimensions of the bounding box"
      // (https://helpx.adobe.com/photoshop/using/creating-type.html), so the box's dimensions are
      // what the text takes, not the other way round.
      const lineCount = getTextLineCount(ctx2d as Ctx2D, { ...newArgs, rect: placed }, textWrapWidth(placed));
      const requiredHeight = lineCount * fontSize * lineHeight + TEXT_PADDING * 2;
      if (requiredHeight > placed.y2 - placed.y1) {
        newRect = { ...placed, y2: placed.y1 + requiredHeight };
      }
    } else {
      const currentWidth = placed.x2 - placed.x1;
      const requiredWidth = getTextWidth(ctx2d, newArgs) + TEXT_PADDING * 2;
      if (requiredWidth > currentWidth) {
        switch (align) {
          case 'left':
            newRect = { ...placed, x2: placed.x1 + requiredWidth };
            break;
          case 'center':
            newRect = {
              ...placed,
              x1: placed.x1 + (currentWidth - requiredWidth) / 2,
              x2: placed.x1 + (currentWidth + requiredWidth) / 2,
            };
            break;
          case 'right':
            newRect = { ...placed, x1: placed.x2 - requiredWidth };
        }
      }
    }
  }

  const lineCount = text.split('\n').length;
  const requiredHeight = lineCount * fontSize * lineHeight + TEXT_PADDING * 2;

  const currentHeight = newRect.y2 - newRect.y1;
  if (!isParagraph && requiredHeight > currentHeight) {
    newRect = { ...newRect, y2: newRect.y1 + requiredHeight };
  }

  return trimRect2(newRect, imageSize);
};
