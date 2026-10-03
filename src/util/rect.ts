import type { RefObject } from 'react';
import {
  getTextWidth,
  layoutText,
  requiredHeightForLines,
  resolveTextKind,
  resolveTextStyle,
  textWrapWidth,
  type TextToolArgs,
} from '../tools/text.ts';
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

/**
 * A text box's ORIGIN clamped into the document, with its EXTENT left alone.
 *
 * **A type layer is not the document, and the origin is the only part of the box that has to be
 * inside it.** Photoshop lets a type layer grow past the canvas edge rather than cropping the type
 * to it, and this app's committed layer canvas IS the box — `useLayer`'s `createLayerFromTool`
 * takes `pos` from this rect and `layer-utils`'s `createLayerSource` sizes the creator's canvas at
 * `size: pos` — so clamping the extent destroyed ink the draft had already shown the user. A
 * left-aligned click at `imageSize.width - 10` grew `x2` to `width + 300`, `trimRect2` clamped it
 * back to `width`, and the commit wrote a ten-pixel bitmap holding the first few pixels of one
 * glyph; the same held for the last line near the bottom edge.
 *
 * Clamping the origin is what replaces that clamp, and it is what makes a positive extent
 * STRUCTURAL rather than accidental: every extent below is content-derived and every text box
 * carries `TEXT_PADDING` on both sides, so `x2 > x1` and `y2 > y1` hold for any non-empty text —
 * which is what `layer-utils`' `Layer width and height must be greater than 0` throw needs.
 *
 * The far edge is additionally floored at the clamped origin, which is the same map
 * {@link clampEdge} is: it never crops anything a sorted rect had, and it means a rect that
 * arrived wholly outside the document — a click in the letterbox, say — still comes out sorted
 * rather than inverted. `RectXYSorted` is an alias of `RectXY` and guarantees nothing at the type
 * level, so this is load-bearing rather than decoration.
 */
function clampTextOrigin(rect: RectXYSorted, imageSize: Size): RectXYSorted {
  const x1 = clampEdge(rect.x1, imageSize.width);
  const y1 = clampEdge(rect.y1, imageSize.height);

  return { x1, y1, x2: Math.max(rect.x2, x1), y2: Math.max(rect.y2, y1) };
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

  // Resolved before the `!text` branch, which needs the kind for the one-pixel question below and
  // not for anything else.
  const isParagraph = resolveTextKind(newArgs) === 'paragraph';

  // The empty draft is a box with NO ink in it, so nothing can be lost by clamping all four of its
  // edges into the document — and clamping is what stops the frame jumping on the first keystroke.
  // `useRect`'s `drawMask` paints `trimRect(...)` while handing `onRepaint` the UNCLAMPED rect, so
  // the click at `x = 0` published `[-1, 1]` and painted it at `[0, 1]`: the box the first
  // keystroke grew from started a pixel left of the frame the user was looking at.
  //
  // The one-pixel widening is kept for POINT type, whose rect is the click point itself — it is
  // what makes the overlay mask of a zero-area press visible before anything is typed, and
  // `TEXT_TOOL_REQUIREMENTS.md` §2 records it as load-bearing. It is DROPPED for PARAGRAPH type,
  // where the box's width is the width the user dragged: the ±1 made `textWrapWidth` 2px wider on
  // the first character than on every character after it, so the first line of type wrapped at a
  // width no later keystroke would reproduce.
  //
  // The height is derived from the CLAMPED origin, so a press in the letterbox keeps a whole line
  // box at the document edge instead of half of one hanging off it.
  if (!text) {
    const inset = isParagraph ? 0 : 1;
    const draft = trimRect2({ ...rect, x1: rect.x1 - inset, x2: rect.x2 + inset }, imageSize);
    return { ...draft, y2: draft.y1 + fontSize * lineHeight + 2 * TEXT_PADDING };
  }

  // A paragraph box's width is the width the user dragged, so it is clamped BEFORE anything is
  // measured rather than after. `useRect.drawMask` paints `trimRect(...)` while handing
  // `onRepaint` the unclamped rect, so without this the preview wraps at the dragged width while
  // the committed box is the clamped one and the two wrap differently — a divergence that moves
  // ink today and changes where the lines break under wrapping.
  //
  // `trimRect2` returns a `RectXY` and never null, so the `?? rect` this line once carried was a
  // provable no-op.
  const placed = isParagraph ? trimRect2(rect, imageSize) : rect;

  let newRect = clampTextOrigin(placed, imageSize);

  const ctx2d = canvasRef.current?.getContext('2d');
  if (ctx2d) {
    if (isParagraph) {
      // Only the height is content-derived for a paragraph box. The width is not grown and not
      // re-placed: "the lines of type wrap to fit the dimensions of the bounding box"
      // (https://helpx.adobe.com/photoshop/using/creating-type.html), so the box's dimensions are
      // what the text takes, not the other way round.
      //
      // The height comes from the ONE layout this function performs, below, rather than from a
      // `lineCount * fontSize * lineHeight + TEXT_PADDING * 2` computed here: that arithmetic was a
      // second opinion about where the lines fall, in the one file whose reason to exist is that
      // there is only one, and it was wrong in a second way as well, because the line step is
      // shorter than the ink whenever the leading is under the font's own ascent — so the box
      // cropped its own first line and the committed layer went out without it.
      const style = resolveTextStyle(newArgs);
      const layout = layoutText(ctx2d as Ctx2D, style, text, wrapWidth(newRect, isParagraph));
      const requiredHeight = requiredHeightForLines(ctx2d as Ctx2D, style, layout.lines.length);
      if (requiredHeight > newRect.y2 - newRect.y1) {
        newRect = { ...newRect, y2: newRect.y1 + requiredHeight };
      }
    } else {
      /**
       * The point arm, and the ONE place `align` moves a box rather than moving ink.
       *
       * `align` is honoured twice, by two different mechanisms, and which one runs depends on
       * whether the box has room:
       *
       * - **The box has slack** (`requiredWidth <= currentWidth`) — a box the user widened with a
       *   handle. The box is left EXACTLY where it is, and `renderText`'s anchor
       *   (`boxLeft + (boxRight - boxLeft - width) / 2` for centre, `boxRight - width` for right)
       *   moves the ink inside it. Nothing to do here, and moving the box would be wrong: it would
       *   displace the ink a second time, by the same slack, on top of the anchor.
       * - **The text outgrows the box** (`requiredWidth > currentWidth`). There is no slack to
       *   distribute, so the growth itself has to be placed, and that is this arm: rightward for
       *   left, symmetrically about the current centre for centre, leftward with the right edge
       *   pinned for right.
       *
       * A point box whose width is exactly its ink has neither, so all three settings render
       * identically there. That is not a defect to fix in this file: it is what "each line of type
       * is independent — the line expands or shrinks as you edit it" (Adobe, `creating-type.html`)
       * means for a box that hugs its own text. `HANDOFF.md` carries the open question about
       * whether the bar should say so.
       *
       * The `align` comparison below is a chain rather than a `switch` because the third arm IS
       * the fallthrough: an absent or unrecognised value — a hand-edited or forward-version
       * settings record, or an args object built before `align` was a field — grows rightward,
       * which is where the tool starts. A `switch` with three named cases and no default left that
       * input doing NOTHING at all, while `renderText`'s own anchor documents the opposite rule for
       * the same value on the same box. The two halves of one alignment must not disagree about
       * where an unrecognised value lands.
       */
      const currentWidth = newRect.x2 - newRect.x1;
      const requiredWidth = getTextWidth(ctx2d, newArgs) + TEXT_PADDING * 2;
      if (requiredWidth > currentWidth) {
        // Each re-placed left edge is clamped again, because `align` can move it off the origin
        // this rect started from: a centred or right-flushed box growing leftwards off a click at
        // the document's left edge would otherwise START outside the document, which is the one
        // thing this rect's origin may not do. The EXTENT is then rebuilt from the clamped edge
        // rather than kept, because clamping an edge inward and leaving the other one alone would
        // crop exactly the ink this rule exists to preserve.
        const grownLeft =
          align === 'center'
            ? newRect.x1 - (requiredWidth - currentWidth) / 2
            : align === 'right'
              ? newRect.x2 - requiredWidth
              : newRect.x1;
        const x1 = clampEdge(grownLeft, imageSize.width);
        newRect = { ...newRect, x1, x2: x1 + requiredWidth };
      }
    }
  }

  // The hard-break count, for the point box only. A PARAGRAPH box's height was already settled from
  // its own layout call above, and it must not be settled twice from two different sources — which
  // is exactly what happened before, and is why `HANDOFF.md` still carries an entry about a
  // paragraph box whose wrapped and hard-break heights disagreed.
  const currentHeight = newRect.y2 - newRect.y1;
  const pointRequiredHeight = hardBreakHeight(ctx2d, newArgs, text);
  if (!isParagraph && pointRequiredHeight > currentHeight) {
    newRect = { ...newRect, y2: newRect.y1 + pointRequiredHeight };
  }

  // A PARAGRAPH box keeps every edge clamped to the document, which is the same
  // `trimRect2(rect, imageSize)` its width was clamped with, and it is what makes the overflow icon
  // reachable at all: `layoutText` reports an overflow by comparing the lines it needs against the
  // box's height, and a box that could grow past the document's bottom edge could never outgrow
  // its own height. `e2e/text-tool.spec.ts` — the overflow-icon test — pins that clamp.
  //
  // A POINT box is not clamped: its extent is what the content required, and the ink past the
  // document edge belongs to the layer even though the canvas cannot show it.
  return isParagraph ? trimRect2(newRect, imageSize) : newRect;
};

/** The wrap width a box of this kind offers its text: the box's own for paragraph, unbounded for point. */
function wrapWidth(rect: RectXYSorted, isParagraph: boolean): number {
  return isParagraph ? textWrapWidth(rect) : Infinity;
}

/**
 * The height a POINT box needs: its hard-broken lines, sized by the same layout authority.
 *
 * Point type lays out against an infinite width, so its line count IS its hard-break count and
 * there is nothing to wrap — but the ink still has to fit, which is the same
 * `Math.max(lines * lineStep, inkHeight)` rule the paragraph arm uses. Going through
 * {@link layoutText} rather than a local `split('\n').length` multiplication is what keeps the two
 * arms from drifting: they answer the same question and now answer it in one place.
 */
function hardBreakHeight(ctx: Ctx2D | undefined | null, args: TextToolArgs, text: string): number {
  return requiredHeightForLines(ctx, resolveTextStyle(args), text.split('\n').length);
}
