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
  // Sorted FIRST. `RectXYSorted` is an alias of `RectXY`, so nothing at the type level guarantees
  // `x1 <= x2`, and this function's whole contract is that the box it returns has a positive extent.
  // Without the sort the far-edge floor below DELETES the span instead of normalising it: an input of
  // `{x1: 500, x2: 100}` came back `{x1: 500, x2: 500}` — width zero, 400px of box gone — where
  // `sortRect` would have given `{100, 500}`. The production caller happens to sort already, which is
  // exactly why the JSDoc could claim a guarantee the code did not keep.
  const sorted = sortRect(rect);
  const x1 = clampEdge(sorted.x1, imageSize.width);
  const y1 = clampEdge(sorted.y1, imageSize.height);

  // The far edges are floored at the clamped origin rather than clamped too. Clamping them is the
  // obvious reading and it is wrong: a box dragged out past the right edge would have its ORIGIN
  // pulled back to the edge and keep its far edge beyond the document, which still has a positive
  // extent, whereas clamping both collapses such a box to nothing at the boundary. The ink this
  // function exists to preserve lives beyond the document by design.
  return { x1, y1, x2: Math.max(sorted.x2, x1), y2: Math.max(sorted.y2, y1) };
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

/**
 * The narrowest a PARAGRAPH box may be, as the width a drag has to leave.
 *
 * **A RECONSTRUCTION, with no Adobe figure behind it.** Adobe documents that paragraph type wraps
 * to the dimensions of its bounding box and says nothing about how narrow that box is allowed to
 * get, so this is the app's own floor and it exists here for two structural reasons rather than for
 * looks:
 *
 * - A press with no horizontal travel produces `x1 === x2`, because `useRect` sorts the mask rect and
 *   a vertical drag has no width. `TextToolArea` classifies on the larger of the two axes, so a
 *   purely VERTICAL drag is a paragraph box — and a zero-width box has no positive extent, which
 *   `layer-utils`' `createLayerSource` refuses outright. Without a floor, dragging straight down
 *   leaves Apply throwing on a box the user can see and cannot fix, and the throw reaches
 *   `window.onerror` rather than a boundary.
 * - Below the box's own padding, `textWrapWidth` goes NEGATIVE, and then `fits('')` is false for
 *   every candidate and the breaker reports a width overflow for a body with no ink in it.
 *
 * The value is therefore the padding, and not a round number chosen to look like a UI minimum: it is
 * the width at which the wrap width reaches zero, which is the point below which the box has no
 * usable interior left.
 */
const MIN_PARAGRAPH_WIDTH = TEXT_PADDING * 2;

/**
 * Hold a paragraph box at {@link MIN_PARAGRAPH_WIDTH}, leaving a wider drag exactly as dragged.
 *
 * Applied at BOTH of this function's paragraph exits — the empty-draft early return and the final
 * one — because a user can reach a zero-width paragraph box by dragging vertically OR by dragging a
 * handle onto its opposite edge, and the non-empty path never re-derives the width. Flooring only
 * the empty draft would leave the resize route throwing.
 */
function atLeastMinParagraphWidth(rect: RectXYSorted, isParagraph: boolean): RectXYSorted {
  if (!isParagraph) return rect;
  if (rect.x2 - rect.x1 >= MIN_PARAGRAPH_WIDTH) return rect;
  return { ...rect, x2: rect.x1 + MIN_PARAGRAPH_WIDTH };
}

export const calculateNewRect = (
  newArgs: TextToolArgs,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  imageSize: Size
): RectXYSorted | null => {
  const { text, rect } = newArgs;
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
    // Raw `fontSize`/`lineHeight` would put a `NaN` from a corrupt settings record straight into
    // `y2`, and `createLayerSource` rejects only `=== 0`, so a negative extent reaches
    // `new OffscreenCanvas`. `resolveTextStyle` is the one seam that folds both, and every other
    // measurement in this file already goes through it.
    const { fontSize: size, lineHeight: leading } = resolveTextStyle(newArgs);
    const draft = atLeastMinParagraphWidth(
      trimRect2({ ...rect, x1: rect.x1 - inset, x2: rect.x2 + inset }, imageSize),
      isParagraph
    );
    return { ...draft, y2: draft.y1 + size * leading + 2 * TEXT_PADDING };
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
      // Both halves style their own context now, which is the fix `e2e/text-tool.spec.ts` has been
      // holding red for. The workspace canvas carries `10px sans-serif` for the whole session, so an
      // unstyled measure wrapped this paragraph at a fraction of its real width: measured on this
      // host a 1042px string at `64px Arial` reads as 163px unstyled, the line count came back as
      // one, and the box grew to hold one line while the renderer drew three — into a canvas that IS
      // the box, so two bands were cropped out of the committed layer rather than merely mislaid.
      const lineCount = layoutText(ctx2d as Ctx2D, style, text, wrapWidth(newRect, isParagraph)).lines.length;
      const requiredHeight = requiredHeightForLines(ctx2d as Ctx2D, style, lineCount);
      if (requiredHeight > newRect.y2 - newRect.y1) {
        newRect = { ...newRect, y2: newRect.y1 + requiredHeight };
      }
    } else {
      /**
       * The point arm, and the ONE place a point box's geometry is decided at all.
       *
       * **The box hugs its ink, in both directions, and stays centred on the click.** The width is
       * recomputed on every edit so replacing the placeholder does not leave unused space, and the
       * click remains the stable horizontal anchor while the text changes.
       *
       * - The width is recomputed every call rather than compared against what is there. "When you
       *   enter point type, each line of type is independent — the line expands or shrinks as you edit
       *   it, but it doesn't wrap to the next line" (`creating-type.html`). This arm used to grow only,
       *   on the reasoning that slack meant "a box the user widened with a handle" — which stopped being
       *   true the moment a box is born holding the `'Lorem ipsum'` placeholder, because then it
       *   carries slack the user never chose, and three characters typed over the placeholder left the
       *   line as wide as the placeholder. A grow-only rule cannot tell the two apart.
       * - Point type is not a paragraph alignment box, so the width follows the content rather than
       *   distributing slack for `align`. The app's point-text interaction keeps the placement click
       *   centred instead, which makes typing in either direction predictable.
       *
       * A consequence, stated because it is real: widening a POINT box with a handle now survives only
       * until the next keystroke, which snaps it back to its ink. Adobe has no handle on a point line
       * at all, so this is the closer of the two behaviours, and the handle belongs to `HANDOFF.md`'s
       * transform question rather than to point type.
       *
       * `clampEdge` still applies to the calculated left edge. A click close to the document edge may
       * therefore lose perfect centring in order to keep the type origin inside the document.
       */
      const requiredWidth = getTextWidth(ctx2d, newArgs) + TEXT_PADDING * 2;
      const centerX = newRect.x1;
      const x1 = clampEdge(centerX - requiredWidth / 2, imageSize.width);
      newRect = { ...newRect, x1, x2: x1 + requiredWidth };
    }
  }

  // The hard-break count, for the point box only. A PARAGRAPH box's height was already settled from
  // its own layout call above, and it must not be settled twice from two different sources — which
  // is exactly what happened before, and is why `HANDOFF.md` still carries an entry about a
  // paragraph box whose wrapped and hard-break heights disagreed.
  // The guard is HOISTED, not applied to the result. It used to read
  // `!isParagraph && hardBreakHeight(...) > currentHeight`, so a paragraph draft still paid for the
  // call: a `resolveTextStyle` allocation, a bracketed `applyTextStyle` writing five properties, and
  // a `measureText('')` — a real font metric read, which can force a synchronous font load on a face
  // not yet resident — on every keystroke, purely to have the number discarded one line later.
  if (!isParagraph) {
    const pointRequiredHeight = hardBreakHeight(ctx2d, newArgs, text);
    if (pointRequiredHeight > newRect.y2 - newRect.y1) {
      newRect = { ...newRect, y2: newRect.y1 + pointRequiredHeight };
    }
  }

  // A PARAGRAPH box keeps every edge clamped to the document, which is the same
  // `trimRect2(rect, imageSize)` its width was clamped with, and it is what makes the overflow icon
  // reachable at all: `layoutText` reports an overflow by comparing the lines it needs against the
  // box's height, and a box that could grow past the document's bottom edge could never outgrow
  // its own height. `e2e/text-tool.spec.ts` — the overflow-icon test — pins that clamp.
  //
  // A POINT box is not clamped: its extent is what the content required, and the ink past the
  // document edge belongs to the layer even though the canvas cannot show it.
  return isParagraph ? trimRect2(atLeastMinParagraphWidth(newRect, true), imageSize) : newRect;
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
  // No context at all is not a reason to report zero lines of height: `requiredHeightForLines`
  // degrades to the line step on its own, and the line step is the honest answer when there is no
  // measurer — `Text.tsx` hands `calculateNewRect` the tool overlay, which is null on the first
  // render and in every test that mounts no canvas.
  return requiredHeightForLines(ctx, resolveTextStyle(args), text.split('\n').length);
}
