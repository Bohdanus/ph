import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  getCanvasSize,
  sortRect,
  sortRoundRect,
  trimRect,
  trimRect2,
  sortedRectToPos,
  reduceRect,
  posToSortedRect,
  hexToRgb,
  calculateNewRect,
} from '../rect.ts';
import type { RectXY, RectXYSorted, Pos, Size } from '../../contexts/general-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import { TEXT_PADDING } from '../constants.ts';

describe('getCanvasSize', () => {
  /**
   * The only untested export in this module before this change, and both of its arms are
   * reachable from a React ref: `null` on the first render and before the canvas is mounted,
   * a live element afterwards.
   *
   * A NON-SQUARE canvas is what pins the field order. `{ width, height }` read in the wrong
   * order satisfies every square assertion in the suite, so the test uses 320x180.
   */
  it('reads the backing-store dimensions off the live element', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;

    expect(getCanvasSize({ current: canvas })).toEqual({ width: 320, height: 180 });
  });

  it('reports a zero size for a ref that is not mounted', () => {
    expect(getCanvasSize({ current: null })).toEqual({ width: 0, height: 0 });
  });

  it('reports the current backing store, not the layout box, after the element is resized', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    const ref = { current: canvas };
    expect(getCanvasSize(ref)).toEqual({ width: 100, height: 100 });

    canvas.width = 640;
    canvas.height = 480;
    expect(getCanvasSize(ref)).toEqual({ width: 640, height: 480 });
  });
});

describe('sortRect', () => {
  it('returns the rect unchanged when already sorted', () => {
    const rect = { x1: 1, y1: 2, x2: 5, y2: 8 };
    expect(sortRect(rect)).toEqual(rect);
  });

  it('swaps coordinates when inverted', () => {
    const rect = { x1: 5, y1: 8, x2: 1, y2: 2 };
    expect(sortRect(rect)).toEqual({ x1: 1, y1: 2, x2: 5, y2: 8 });
  });

  it('handles equal coordinates', () => {
    const rect = { x1: 3, y1: 3, x2: 3, y2: 3 };
    expect(sortRect(rect)).toEqual({ x1: 3, y1: 3, x2: 3, y2: 3 });
  });
});

describe('trimRect', () => {
  const imageSize: Size = { width: 100, height: 100 };

  it('does not trim when the rect is fully inside the image', () => {
    const rect = { x1: 10, y1: 20, x2: 50, y2: 60 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 10, y: 20, width: 40, height: 40, isTrimmed: false });
  });

  it('trims coordinates that exceed image bounds', () => {
    const rect = { x1: 10, y1: 20, x2: 150, y2: 120 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 10, y: 20, width: 90, height: 80, isTrimmed: true });
  });

  it('trims negative coordinates', () => {
    const rect = { x1: -10, y1: -5, x2: 30, y2: 40 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 0, y: 0, width: 30, height: 40, isTrimmed: true });
  });

  it('collapses a rect fully outside the image to an empty rect and still marks isTrimmed', () => {
    const rect: RectXY = { x1: -5, y1: -5, x2: -1, y2: -1 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 0, y: 0, width: 0, height: 0, isTrimmed: true });
  });

  it('collapses a rect fully outside on the far side to an empty rect', () => {
    const rect: RectXY = { x1: 120, y1: 130, x2: 150, y2: 160 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 100, y: 100, width: 0, height: 0, isTrimmed: true });
  });

  it('keeps a partially overlapping rect as the non-empty intersection', () => {
    const wide: Size = { width: 800, height: 800 };
    const rect: RectXY = { x1: 700, y1: 700, x2: 850, y2: 850 };
    expect(trimRect(rect, wide)).toEqual({ x: 700, y: 700, width: 100, height: 100, isTrimmed: true });
  });

  it('normalises an unsorted rect before clamping', () => {
    const rect: RectXY = { x1: 50, y1: 60, x2: 10, y2: 20 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 10, y: 20, width: 40, height: 40, isTrimmed: false });
  });

  it('reports isTrimmed for an unsorted rect whose far edge leaves the image', () => {
    const rect: RectXY = { x1: 200, y1: 10, x2: 50, y2: 20 };
    expect(trimRect(rect, imageSize)).toEqual({ x: 50, y: 10, width: 50, height: 10, isTrimmed: true });
  });

  it('rounds the resulting coordinates', () => {
    const rect = { x1: 10.4, y1: 20.6, x2: 50.4, y2: 60.6 };
    const result = trimRect(rect, imageSize);
    expect(result.x).toBe(10);
    expect(result.y).toBe(21);
    expect(result.width).toBe(40);
    expect(result.height).toBe(40);
  });

  it('derives the extent from the rounded edges, not the unrounded span', () => {
    // 20.4 - 10.6 = 9.8 rounds to 10, which would put the right edge at 21.
    const rect = { x1: 10.6, y1: 20.6, x2: 20.4, y2: 60.4 };
    const result = trimRect(rect, imageSize);
    expect(result.x).toBe(11);
    expect(result.width).toBe(9);
    expect(result.x + result.width).toBe(20);
    expect(result.y + result.height).toBe(Math.round(60.4));
  });

  /**
   * `isTrimmed` is a declaration about the INPUT, and the comparison is strict on the far
   * edges and strict-negative on the near ones. A rect flush with all four edges of the
   * image was never trimmed, and this is the only case in the file where that is observable:
   * every other `isTrimmed: true` case is also one where the OUTPUT differs from the input,
   * so a rewrite that derived the flag from the clamped result, or that used `>=`, passes
   * all of them.
   */
  it('reports isTrimmed false for a rect flush with the image on every edge', () => {
    expect(trimRect({ x1: 0, y1: 0, x2: 100, y2: 100 }, imageSize)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      isTrimmed: false,
    });
  });

  it('reports isTrimmed true one pixel past any edge, and false exactly at it', () => {
    const at = (x1: number, y1: number, x2: number, y2: number) => trimRect({ x1, y1, x2, y2 }, imageSize).isTrimmed;

    expect(at(0, 0, 100, 100)).toBe(false);
    expect(at(0, 0, 101, 100)).toBe(true);
    expect(at(0, 0, 100, 101)).toBe(true);
    expect(at(-1, 0, 100, 100)).toBe(true);
    expect(at(0, -1, 100, 100)).toBe(true);
  });

  it('clamps a rect inside a zero-size image to a point without inverting it', () => {
    // Every edge clamps to 0 and the extent is derived from the rounded edges, so the
    // result is a point rather than the negative width a one-sided clamp would leave.
    expect(trimRect({ x1: 10, y1: 10, x2: 20, y2: 20 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isTrimmed: true,
    });
  });
});

describe('trimRect2', () => {
  const imageSize: Size = { width: 100, height: 100 };

  it('clamps coordinates to image bounds without rounding', () => {
    const rect = { x1: -10, y1: -5, x2: 150, y2: 120 };
    expect(trimRect2(rect, imageSize)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });

  it('does not modify coordinates that are already within bounds', () => {
    const rect = { x1: 10, y1: 20, x2: 50, y2: 60 };
    expect(trimRect2(rect, imageSize)).toEqual(rect);
  });

  it('collapses a rect fully outside the image instead of inverting it', () => {
    const rect: RectXY = { x1: -5, y1: -5, x2: -1, y2: -1 };
    expect(trimRect2(rect, imageSize)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('collapses a rect fully beyond the far edge', () => {
    const rect: RectXY = { x1: 120, y1: 130, x2: 150, y2: 160 };
    expect(trimRect2(rect, imageSize)).toEqual({ x1: 100, y1: 100, x2: 100, y2: 100 });
  });

  it('normalises an unsorted rect before clamping', () => {
    const rect: RectXY = { x1: 50, y1: 60, x2: 10, y2: 20 };
    expect(trimRect2(rect, imageSize)).toEqual({ x1: 10, y1: 20, x2: 50, y2: 60 });
  });

  it('keeps a partially overlapping rect as the non-empty intersection', () => {
    const wide: Size = { width: 800, height: 800 };
    const rect: RectXY = { x1: 700, y1: 700, x2: 850, y2: 850 };
    expect(trimRect2(rect, wide)).toEqual({ x1: 700, y1: 700, x2: 800, y2: 800 });
  });
});

describe('sortRoundRect', () => {
  it('sorts an inverted rect into a positive-extent pos', () => {
    const rect: RectXY = { x1: 50, y1: 60, x2: 10, y2: 20 };
    expect(sortRoundRect(rect)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it('allows an edge past the image size, because it is never given one', () => {
    // The crop rectangle may extend the canvas past the image, which is the whole point of
    // this function: `trimRect` clamps the same input to `{x: 0, y: 100, width: 100, height: 400}`.
    const rect: RectXY = { x1: -60, y1: 100, x2: 740, y2: 500 };
    expect(sortRoundRect(rect)).toEqual({ x: -60, y: 100, width: 800, height: 400 });
  });

  it('derives the extent from the rounded edges, not the unrounded span', () => {
    const rect: RectXY = { x1: -10.4, y1: 0.2, x2: 100.6, y2: 50.5 };
    const result = sortRoundRect(rect);
    expect(result.x).toBe(-10);
    expect(result.y).toBe(0);
    expect(result.width).toBe(111);
    expect(result.height).toBe(51);
    expect(result.x + result.width).toBe(Math.round(100.6));
    expect(result.y + result.height).toBe(Math.round(50.5));
  });

  it('returns a zero extent for a degenerate rect, so emptiness guards keep working', () => {
    const rect: RectXY = { x1: 30, y1: 30, x2: 30, y2: 30 };
    expect(sortRoundRect(rect)).toEqual({ x: 30, y: 30, width: 0, height: 0 });
  });

  it('does not mutate its argument', () => {
    const rect: RectXY = { x1: 50.4, y1: 60.6, x2: 10.4, y2: 20.6 };
    const frozen = Object.freeze({ ...rect });
    sortRoundRect(frozen);
    expect(frozen).toEqual(rect);
  });
});

describe('sortedRectToPos', () => {
  it('converts a sorted rect to a pos', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    expect(sortedRectToPos(rect)).toEqual({ x: 10, y: 20, width: 20, height: 40 });
  });

  it('works with zero-size rects', () => {
    const rect: RectXYSorted = { x1: 5, y1: 5, x2: 5, y2: 5 };
    expect(sortedRectToPos(rect)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });

  /**
   * The `RectXYSorted` name is a promise about the CALLER, not a normalisation this function
   * makes: it subtracts and does not sort, so an inverted rect reports a negative extent.
   * `sortRect` exists and is the thing that would have to be called here, and calling it
   * would pass every sorted case in this file while changing what an unsorted one reports.
   */
  it('reports a negative extent for an unsorted rect rather than normalising it', () => {
    expect(sortedRectToPos({ x1: 30, y1: 60, x2: 10, y2: 20 })).toEqual({ x: 30, y: 60, width: -20, height: -40 });
  });
});

describe('reduceRect', () => {
  it('subtracts the pos offset from every coordinate', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    const pos: Pos = { x: 5, y: 10, width: 5, height: 5 };
    expect(reduceRect(rect, pos)).toEqual({ x1: 5, y1: 10, x2: 25, y2: 50 });
  });

  /**
   * A layer moved off the top-left of the document has a NEGATIVE pos, which is the sign
   * this function has to get right: every existing case moves a rect up and left, so a
   * rewrite that added the offset would pass all of them and shift a stroke on a moved
   * layer twice as far the other way.
   */
  it('ADDS the offset back for a layer at a negative origin', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    const pos: Pos = { x: -12, y: -7, width: 5, height: 5 };

    expect(reduceRect(rect, pos)).toEqual({ x1: 22, y1: 27, x2: 42, y2: 67 });
    expect(reduceRect(rect, { x: 0, y: 0, width: 1, height: 1 })).toEqual(rect);
  });
});

describe('posToSortedRect', () => {
  it('converts a pos to a sorted rect', () => {
    const pos: Pos = { x: 10, y: 20, width: 30, height: 40 };
    expect(posToSortedRect(pos)).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
  });

  it('works with zero dimensions', () => {
    const pos: Pos = { x: 0, y: 0, width: 0, height: 0 };
    expect(posToSortedRect(pos)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});

describe('hexToRgb', () => {
  it('converts a hex color string to a comma-separated rgb string', () => {
    expect(hexToRgb('#ff0000')).toBe('255, 0, 0');
    expect(hexToRgb('#00ff00')).toBe('0, 255, 0');
    expect(hexToRgb('#0000ff')).toBe('0, 0, 255');
  });

  it('works without the leading hash', () => {
    expect(hexToRgb('ffffff')).toBe('255, 255, 255');
  });

  it('handles mixed-case hex digits', () => {
    expect(hexToRgb('#FfFfFf')).toBe('255, 255, 255');
  });

  it('expands 3-digit hex instead of parsing a short string as channels', () => {
    expect(hexToRgb('#fff')).toBe('255, 255, 255');
    expect(hexToRgb('#000')).toBe('0, 0, 0');
    expect(hexToRgb('#abc')).toBe('170, 187, 204');
  });

  it('parses 3-digit hex identically to its 6-digit equivalent', () => {
    expect(hexToRgb('#f00')).toBe(hexToRgb('#ff0000'));
    expect(hexToRgb('fff')).toBe('255, 255, 255');
  });
});

describe('calculateNewRect', () => {
  const imageSize: Size = { width: 1000, height: 1000 };
  const baseArgs = {
    color: '#000000',
    fontFamily: 'Arial',
    bold: false,
    italic: false,
  };

  /**
   * A canvas whose `measureText` can be made FONT-SENSITIVE.
   *
   * Passing a number pins the width for every string at every font, which is what the arithmetic
   * tests below want and what made this file blind: with a constant, a regression that deleted
   * `ctx.font = fontShorthand(style)` from `applyTextStyle` — or restored the
   * `${size}px ${weight}` shorthand its grammar rejects — passed every width assertion here, and
   * so did any change to `tracking`, because `baseArgs` carries none and the cluster fallback in
   * `inkWidth` therefore never ran.
   *
   * Omitting the number derives the width from the string and from `ctx.font` instead, so a test
   * can ask what the box does when the face changes. `font` is a REAL property here rather than a
   * bare `vi.fn()` sink, because the font-aware path has to be able to read back what
   * `applyTextStyle` wrote.
   */
  function makeCanvasRef(measureWidth?: number) {
    const ctx = {
      font: '10px sans-serif',
      measureText: vi.fn((text: string) => ({
        width: measureWidth ?? text.length * (parseFloat(ctx.font) || 10),
      })),
      // `getTextWidth` brackets its `applyTextStyle` in save/restore because it is handed the live
      // tool overlay by `calculateNewRect` and would otherwise leave that context wearing the Type
      // tool's typography. These are `vi.fn()`s and so are not real state, but they have to be
      // present for the bracket to be callable at all.
      save: vi.fn(),
      restore: vi.fn(),
    };
    return { current: { getContext: vi.fn(() => ctx) } } as unknown as RefObject<HTMLCanvasElement | null>;
  }

  it('returns an expanded rect when text is empty', () => {
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 0, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result).not.toBeNull();
    // `x1` is 0 and not -1. The one-pixel widening below is what makes a zero-area press visible
    // before anything is typed, and it used to be returned UNCLAMPED, so a click at the document's
    // left edge published a box starting a pixel outside the document — a box `useRect`'s
    // `drawMask` then painted clamped to `[0, 1]`, so the frame jumped on the first keystroke. The
    // expectation this replaced asserted `-1`; it was correct only about the defect.
    expect(result).toEqual({ x1: 0, y1: 0, x2: 1, y2: 16 * 1.2 + 2 * 5 });
  });

  it('keeps an empty draft box inside the document when the press is in the letterbox', () => {
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        // A press below the image, which the tool area reaches because it is `absolute inset-0`
        // over the whole centred container rather than over the letterboxed canvas.
        rect: { x1: 40, y1: 1010, x2: 40, y2: 1010 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.y1).toBe(1000);
    // A whole line box at the edge, not half of one hanging off it, and a positive extent — which
    // is what `layer-utils`' `Layer width and height must be greater than 0` needs.
    expect(result!.y2).toBeGreaterThan(1000);
  });

  it('gives a VERTICAL paragraph drag a usable width, because it is classified as a paragraph', () => {
    // THE REGRESSION THIS FILE HAD NO CASE FOR. `TextToolArea` classifies on the larger of the two
    // axes, so a drag straight DOWN — no horizontal travel at all — is a paragraph box, and `useRect`
    // hands back a sorted rect whose `x1` equals its `x2`. A zero-width box has no positive extent,
    // and `layer-utils`' `createLayerSource` refuses one outright, so Apply threw on a box the user
    // could see and could not fix. Nothing caught it: the e2e drags both ways, and no unit test
    // placed a paragraph box narrower than its own padding.
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        kind: 'paragraph',
        rect: { x1: 500, y1: 100, x2: 500, y2: 200 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.x2).toBeGreaterThan(result!.x1);
    // At the floor, which is the box's own padding, so `textWrapWidth` is zero rather than negative:
    // below that every fit test fails and the breaker reports a width overflow for a body with no ink.
    expect(result!.x2 - result!.x1).toBe(2 * 5);
  });

  it('floors a paragraph box a HANDLE RESIZE has narrowed to nothing, not just an empty draft', () => {
    // The second route to the same zero width: a user dragging the right handle onto the left edge.
    // The non-empty paragraph path never re-derives the width, so flooring only the empty draft
    // would have left this one throwing.
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        kind: 'paragraph',
        rect: { x1: 100, y1: 100, x2: 100, y2: 180 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.x2 - result!.x1).toBe(2 * 5);
  });

  it('leaves a point box at its own one-pixel widening, because the floor is paragraph-only', () => {
    // A point press is a zero-AREA point rather than a zero-width box, and its one pixel is what
    // makes its overlay mask visible before anything is typed. Giving it the paragraph floor would
    // replace that with a 20px box the user never dragged.
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 100, y1: 100, x2: 100, y2: 100 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    // One pixel each side of the click, so two where nothing clamps — and nowhere near the
    // paragraph floor, which is the point of the case.
    expect(result!.x2 - result!.x1).toBe(2);
    expect(result!.x2 - result!.x1).toBeLessThan(2 * 5);
  });

  it('leaves a wider paragraph drag exactly as dragged', () => {
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        kind: 'paragraph',
        rect: { x1: 100, y1: 100, x2: 480, y2: 180 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.x1).toBe(100);
    expect(result!.x2).toBe(480);
  });

  it('keeps an empty PARAGRAPH draft exactly the width the user dragged', () => {
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        kind: 'paragraph',
        rect: { x1: 100, y1: 100, x2: 300, y2: 180 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    // A paragraph box's width is the width the user dragged. The one-pixel widening that point
    // type needs made `textWrapWidth` 2px wider on the first character than on every character
    // after it, so the first line of type wrapped at a width no later keystroke reproduced.
    expect(result!.x1).toBe(100);
    expect(result!.x2).toBe(300);
  });

  it('expands the width for left-aligned text that exceeds the current width', () => {
    const canvasRef = makeCanvasRef(100);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 50, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.x2).toBe(100 + 2 * 5);
  });

  it('does NOT move a POINT box for center or right align, because Adobe scopes alignment to paragraph type', () => {
    // This replaces a pin that asserted the opposite — that a center-aligned point box grows
    // symmetrically about its current centre — on the reasoning that `align` should place the growth.
    // Adobe settles it: "You can align type to one edge of a paragraph (left, center, or right for
    // horizontal type). Alignment options are available only for paragraph type"
    // (`formatting-paragraphs.html`), and "You can align and justify only paragraph text. To manage
    // spacing for point text, convert it to paragraph text" (`setup-paragraph-formatting.html`).
    // Point type "appears in a straight line without boundaries or a bounding box"
    // (`add-text.html`), so there is nothing to align within. All three settings therefore produce
    // the SAME rect for a point box, which is the geometry the entry in `HANDOFF.md` describes as a
    // no-op control — a control defect, not a geometry one, and the entry carries the fix.
    const rect = { x1: 50, y1: 0, x2: 100, y2: 0 };
    for (const align of ['left', 'center', 'right'] as const) {
      const result = calculateNewRect(
        {
          ...baseArgs,
          text: 'hello',
          fontSize: 16,
          lineHeight: 1.2,
          rect,
          align,
        } as TextToolArgs,
        makeCanvasRef(120),
        imageSize
      );
      expect(result!.x1, align).toBe(50);
      expect(result!.x2, align).toBe(50 + 120 + 2 * TEXT_PADDING);
    }
  });

  it('SHRINKS a point box whose text is narrower than the box, because a point line is its own box', () => {
    // This is the other half of "each line of type is independent — the line expands or shrinks as
    // you edit it" (Adobe, `creating-type.html), and it is the half that used to be missing. The
    // rule grew only, on the reasoning that slack meant "a box the user widened with a handle" —
    // which stopped being true the moment a box is born holding the `'Lorem ipsum'` placeholder,
    // because then it carries slack the user never chose. A grow-only rule cannot tell the two
    // apart, so three characters typed over the placeholder left the line as wide as the placeholder.
    const canvasRef = makeCanvasRef();
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hi',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    // The fixture measurer reads `text.length * parseFloat(ctx.font)`, and `applyTextStyle` has set
    // `ctx.font` to the 16px face the args carry, so `'hi'` measures 2 * 16 = 32; plus `TEXT_PADDING`
    // at each end, that is 42. The box arrived 100 wide and must come back 42 wide — a grow-only rule
    // returns 100 and this test fails.
    expect(result!.x1).toBe(0);
    expect(result!.x2).toBe(2 * 16 + 2 * TEXT_PADDING);
  });

  it('grows and shrinks a point box in the same direction for left alignment, from a fixed left edge', () => {
    // The shrinking arm must not walk the LEFT edge leftward the way centre and right do: left
    // alignment pins x1 and moves x2, so a line that both grows and shrinks keeps its origin. A
    // sign error here moves the whole line every keystroke.
    const narrower = calculateNewRect(
      { ...baseArgs, text: 'hi', rect: { x1: 40, y1: 0, x2: 200, y2: 0 }, align: 'left' } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    const wider = calculateNewRect(
      { ...baseArgs, text: 'abcdefghij', rect: { x1: 40, y1: 0, x2: 200, y2: 0 }, align: 'left' } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    expect(narrower!.x1).toBe(40);
    expect(wider!.x1).toBe(40);
    expect(wider!.x2).toBeGreaterThan(narrower!.x2);
  });

  it.each(['left', 'center', 'right'] as const)('shrinks a point box to its ink regardless of align %s', (align) => {
    // Point type has no paragraph alignment box. Its width follows the current ink on every edit,
    // so a placeholder-sized draft contracts when the user replaces the placeholder.
    const dragged = { x1: 0, y1: 0, x2: 100, y2: 50 };
    // 40 of ink + 2 * 5 of padding = 50, against a box 100 wide. The result must remove that
    // placeholder-era slack rather than preserving it for an alignment setting that does not
    // apply to point type.
    const canvasRef = makeCanvasRef(40);

    const result = calculateNewRect(
      { ...baseArgs, text: 'hello', fontSize: 20, lineHeight: 1.2, rect: dragged, align } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result).toEqual({ x1: 0, y1: 0, x2: 50, y2: 50 });
  });

  it('measures with the font the args carry, so the box follows the face', () => {
    // Font-sensitive mock: no pinned width, so every measure reads `ctx.font`. A point box whose
    // text outgrows it is sized from `getTextWidth`, which is where the two `ctx.font` writes
    // matter — `applyTextStyle`'s shorthand and `fontVariantCaps` after it. This is the assertion
    // that makes the mock worth anything: with the old constant-width mock, deleting
    // `ctx.font = fontShorthand(style)` outright passed every width test in this file.
    const at16 = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 1, y2: 0 },
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    const at64 = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 64,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 1, y2: 0 },
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    // 'hello' is five characters, and the mock charges `fontSize` per character.
    expect(at16!.x2).toBe(5 * 16 + 2 * 5);
    expect(at64!.x2).toBe(5 * 64 + 2 * 5);
    expect(at64!.x2).toBeGreaterThan(at16!.x2);
  });

  it('widens for tracking, through the per-grapheme fallback', () => {
    // `baseArgs` carries no `tracking`, so the cluster fallback in `inkWidth` never ran anywhere in
    // this file: with `spacing === 0` it short-circuits to a single `measureText`, and with
    // `letterSpacing` absent from the mock `hasLetterSpacing` is false, so tracking had no coverage
    // at all. Tracking 100 is 0.1em, applied per grapheme past the first.
    const untracked = calculateNewRect(
      {
        ...baseArgs,
        text: 'abcd',
        fontSize: 20,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 1, y2: 0 },
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    const tracked = calculateNewRect(
      {
        ...baseArgs,
        text: 'abcd',
        fontSize: 20,
        lineHeight: 1.2,
        tracking: 100,
        rect: { x1: 0, y1: 0, x2: 1, y2: 0 },
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    // Four characters at 20px is 80px of ink; tracking adds one gap per pair, so three of them at
    // 0.1em of 20px.
    expect(tracked!.x2).toBe(untracked!.x2 + 3 * (0.1 * 20));
  });

  it('keeps the ink a point box needs even when it runs past the document edge', () => {
    const canvasRef = makeCanvasRef(300);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        // A click ten pixels from the right edge of a thousand-pixel document. The box has to grow
        // rightward past the document, because the committed layer's canvas IS this rect
        // (`createLayerFromTool` takes `pos` from it and `createLayerSource` sizes the creator's
        // canvas at `size: pos`), so clamping the extent wrote a ten-pixel bitmap holding the first
        // few pixels of one glyph while the overlay showed the whole string.
        rect: { x1: 990, y1: 0, x2: 990, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.x1).toBe(990);
    expect(result!.x2).toBe(990 + 300 + 2 * 5);
    expect(result!.x2).toBeGreaterThan(imageSize.width);
  });

  it('clamps the origin of a point box that would otherwise start outside the document', () => {
    const canvasRef = makeCanvasRef(300);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        // Right-aligned text growing leftward off a press below the document.
        rect: { x1: 5, y1: 1005, x2: 5, y2: 1005 },
        align: 'right',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.y1).toBe(1000);
    expect(result!.x1).toBeGreaterThanOrEqual(0);
    // And the extent is still the content's, so nothing is cropped by the origin clamp.
    expect(result!.x2 - result!.x1).toBe(300 + 2 * 5);
  });

  it('expands height for multi-line text', () => {
    const canvasRef = makeCanvasRef(10);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'line1\nline2\nline3',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.y2).toBe(3 * 16 * 1.2 + 2 * 5);
  });

  it('returns null when there is no rect, instead of growing one at the document origin', () => {
    const canvasRef = makeCanvasRef(50);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hi',
        fontSize: 16,
        lineHeight: 1.2,
        rect: null,
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result).toBeNull();
  });

  it('returns null for an empty draft with no rect too, so the guard precedes the !text branch', () => {
    // The `!text` branch turns a zero-area drag into a non-degenerate rect so the overlay
    // mask is visible pre-typing. That is load-bearing for `TextToolArea`, which always
    // has a rect. Without a rect there is no drag to keep visible, and the old
    // substitution produced a 2px box at (0,0) for a user who had placed nothing.
    const canvasRef = makeCanvasRef(0);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        rect: null,
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result).toBeNull();
  });

  // `makeCanvasRef`'s `measureText` answers the SAME width for every string, whatever it is asked
  // to measure, so a paragraph box's wrap count is a function of that constant and of the token
  // count rather than of the string's length: a line fits iff `measureWidth <= wrapWidth`, and
  // once it does not fit, `wrapLine` breaks at every space — N space-separated tokens lay out as
  // N lines. A token that cannot fit is never broken, so a single word is always one line however
  // wide it is. Every wrap count below is derived from that, not guessed.
  const FONT_SIZE = 16;
  const LINE_HEIGHT = 1.2;
  const LINE_STEP = FONT_SIZE * LINE_HEIGHT;

  it('leaves a paragraph box the width the user dragged, however much wider the text is', () => {
    const rect = { x1: 100, y1: 200, x2: 200, y2: 260 };
    // 1000 does not fit the 90px of wrap width a 100px box offers, so the text really does
    // outgrow the box and the three tokens lay out as three lines.
    const canvasRef = makeCanvasRef(1000);

    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'aaaa bbbb cccc',
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        rect,
        align: 'left',
        kind: 'paragraph',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.x1).toBe(100);
    expect(result!.x2).toBe(200);
    // The height moved, so the width above is a decision and not a paragraph branch that did
    // nothing at all.
    expect(result!.y2 - result!.y1).toBeCloseTo(3 * LINE_STEP + 2 * TEXT_PADDING);
  });

  it('sizes a paragraph box by the WRAPPED line count, not by the hard-break count', () => {
    const wrappedLines = 4;
    // One hard line and four tokens, at 500 against the 190px a 200px box offers to its text:
    // the whole line does not fit, so all three spaces break and the draft is four lines tall.
    const canvasRef = makeCanvasRef(500);

    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'alpha beta gamma delta',
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        rect: { x1: 0, y1: 100, x2: 200, y2: 100 },
        align: 'left',
        kind: 'paragraph',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.y2 - result!.y1).toBeCloseTo(wrappedLines * LINE_STEP + 2 * TEXT_PADDING);
    // `text.split('\n').length` is 1 here, and that is the count the point-type arm sizes from.
    expect(result!.y2 - result!.y1).not.toBeCloseTo(1 * LINE_STEP + 2 * TEXT_PADDING);
  });

  it('never re-places a paragraph box for align, where point type moves centre and right', () => {
    const rect = { x1: 100, y1: 0, x2: 200, y2: 300 };
    // 1000 is wider than the box on both the ink measure and the wrap measure, so point type's
    // width arm fires for every one of the three values.
    const canvasRef = makeCanvasRef(1000);

    const committed = (['left', 'center', 'right'] as const).map((align) => {
      const result = calculateNewRect(
        {
          ...baseArgs,
          text: 'aaaa bbbb cccc',
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
          rect,
          align,
          kind: 'paragraph',
        } as TextToolArgs,
        canvasRef,
        imageSize
      );
      return { align, x1: result!.x1, x2: result!.x2 };
    });

    expect(committed).toEqual([
      { align: 'left', x1: 100, x2: 200 },
      { align: 'center', x1: 100, x2: 200 },
      { align: 'right', x1: 100, x2: 200 },
    ]);
  });

  it('leaves a paragraph box that is already tall enough for its wrapped lines exactly as dragged', () => {
    const rect = { x1: 100, y1: 200, x2: 200, y2: 300 };
    // 100px of height for the 67.6px three wrapped lines need, so the requirement is met and the
    // guard that grows the height does not fire. The height is never trimmed down to the content
    // either, which is what a dragged box is.
    const canvasRef = makeCanvasRef(1000);

    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'aaaa bbbb cccc',
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        rect,
        align: 'left',
        kind: 'paragraph',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.y2 - result!.y1).toBe(100);
    expect(result).toEqual(rect);
  });

  it('wraps a paragraph box at the CLAMPED width, so a box dragged past the right edge lays out as one already at the edge', () => {
    const size: Size = { width: 400, height: 1000 };
    // 500 does not fit the 390px a 400px-wide box offers and does fit the 690px of the unclamped
    // 700px box, so measure-then-clamp and clamp-then-measure disagree about the line count and
    // this test separates them.
    const canvasRef = makeCanvasRef(500);
    const base = {
      ...baseArgs,
      text: 'alpha beta gamma',
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      align: 'left',
      kind: 'paragraph',
    } as TextToolArgs;

    const inside = calculateNewRect({ ...base, rect: { x1: 0, y1: 0, x2: 400, y2: 30 } }, canvasRef, size)!;
    const overhang = calculateNewRect({ ...base, rect: { x1: 0, y1: 0, x2: 700, y2: 30 } }, canvasRef, size)!;

    // The committed width is the clamped one, and the layout is the one the clamped width gives.
    expect(overhang.x2).toBe(400);
    expect(overhang.y2 - overhang.y1).toBeCloseTo(inside.y2 - inside.y1);
    expect(overhang.y2 - overhang.y1).toBeCloseTo(3 * LINE_STEP + 2 * TEXT_PADDING);
  });

  it('keeps growing a record that carries no kind key at all, which is what every pre-kind document holds', () => {
    const args = {
      ...baseArgs,
      text: 'hello',
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      rect: { x1: 100, y1: 0, x2: 200, y2: 300 },
      align: 'left',
    } as TextToolArgs;
    // The key is ABSENT, which is the case `saveLastSettings` and every document written before
    // the field existed are in. Setting it to 'point' explicitly would test a different record.
    expect('kind' in args).toBe(false);

    const result = calculateNewRect(args, makeCanvasRef(300), imageSize)!;

    // 300 of ink plus the padding on both sides grows a 100px box, which is the point-type arm's
    // move and the one a paragraph box of this width would refuse. A `resolveTextKind` default of
    // 'paragraph' would have left both edges at 100 and 200.
    expect(result.x1).toBe(100);
    expect(result.x2).toBe(100 + 300 + 2 * TEXT_PADDING);
  });

  it('keeps a PARAGRAPH box the dragged width when the text FITS, where point type shrinks to its ink', () => {
    // The fitting case, which is the one the grow-only rule above could not tell from the not-fitting
    // one. The same drag and the same 10px of ink go through both arms on purpose: 10 + 2 * 5 is 20
    // against a box 100 wide, so point type contracts to its ink and paragraph type keeps the width
    // the user dragged. A paragraph arm that re-derived its width would answer 20 here.
    const args = (kind: 'point' | 'paragraph') =>
      ({
        ...baseArgs,
        text: 'hi',
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        rect: { x1: 0, y1: 0, x2: 100, y2: 0 },
        align: 'left',
        kind,
      }) as TextToolArgs;
    const canvasRef = makeCanvasRef(10);

    const point = calculateNewRect(args('point'), canvasRef, imageSize)!;
    const paragraph = calculateNewRect(args('paragraph'), canvasRef, imageSize)!;

    expect(point.x1).toBe(0);
    expect(point.x2).toBe(10 + 2 * TEXT_PADDING);
    expect(paragraph.x1).toBe(0);
    expect(paragraph.x2).toBe(100);
  });

  it('anchors a right-aligned box to the rect NEAR edge, because alignment is paragraph-scoped', () => {
    // REWRITTEN against current behaviour. This case used to assert that a right-aligned box grows
    // leftward and keeps its FAR edge at 900, on the reasoning that `align` should place the growth
    // around the rect's centre. That arm is gone: Adobe scopes alignment to paragraph type
    // ("Alignment options are available only for paragraph type"), and a point line has no box to
    // align within. So every setting keeps the near edge and moves only `x2` — the assertion below
    // is the near edge holding, plus the far-edge mutant it rules out.
    const canvasRef = makeCanvasRef(200);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 800, y1: 0, x2: 900, y2: 0 },
        align: 'right',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    // 200 + 2 * 5 = 210 of ink measured off the NEAR edge at 800. The rect sits at 800..900 in a
    // 1000-wide document, so nothing is clamped and neither anchor is invisible.
    expect(result!.x1).toBe(800);
    expect(result!.x2).toBe(800 + (200 + 2 * TEXT_PADDING));
    // The far-edge anchor this case originally pinned is the mutant: 900 - 210 = 690.
    expect(result!.x1).not.toBe(900 - (200 + 2 * TEXT_PADDING));
    // And the far edge DID move, which is what separates "alignment is ignored" from
    // "the box is left alone": a 210px line does not fit in the 100px the user dragged.
    expect(result!.x2).not.toBe(900);
  });

  it('re-places a right-aligned box on its ink too, where the old rule preserved the dragged width', () => {
    // REWRITTEN against current behaviour. The salvaged case asserted that a right-aligned box
    // whose text fits is left exactly as dragged (`x1` 50, `x2` 100). The point arm is now
    // recomputed from the ink on every call — "each line of type is independent — the line expands
    // or shrinks as you edit it" — so alignment buys no exemption from it and the 100px box
    // contracts to the 20px of ink, from a fixed left edge.
    const canvasRef = makeCanvasRef(10);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hi',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 50, y1: 0, x2: 100, y2: 0 },
        align: 'right',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );

    expect(result!.x1).toBe(50);
    expect(result!.x2).toBe(50 + 10 + 2 * TEXT_PADDING);
    expect(result!.x2).not.toBe(100);
  });

  /**
   * `if (ctx2d)` is the guard that lets this run with no canvas mounted at all.
   *
   * A `canvasRef` whose `current` is null is the real first-render shape, and a null ref
   * reaching `getTextWidth` would throw on `ctx.font`. The assertion is on the RESULT rather
   * than on `not.toThrow`: with no context the function must still grow the HEIGHT, because
   * line counting is arithmetic and does not need a measurement. That is the observable
   * difference between "guard returns early" and "guard skips only the width".
   */
  it('grows the height without a canvas, because the guard skips only the width', () => {
    const unmounted = { current: null } as RefObject<HTMLCanvasElement | null>;
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'line1\nline2',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 10, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      unmounted,
      imageSize
    );

    // 2 * 16 * 1.2 + 2 * 5 = 48.4; the width is untouched because it was never measured.
    expect(result!.y2).toBe(2 * 16 * 1.2 + 2 * 5);
    expect(result!.x1).toBe(10);
    expect(result!.x2).toBe(100);
  });

  it('survives a canvas that refuses a 2d context', () => {
    const noContext = {
      current: { getContext: vi.fn(() => null) },
    } as unknown as RefObject<HTMLCanvasElement | null>;
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      noContext,
      imageSize
    );

    expect(result!.x2).toBe(100);
    expect(result!.y2).toBe(16 * 1.2 + 2 * 5);
  });

  it("trims a grown PARAGRAPH box back into the document, and leaves a POINT box's ink outside it", () => {
    // REWRITTEN against current behaviour, which split the salvaged case in two. It used to pin one
    // rule — a grown box is clamped back into the document, which the old implementation did by
    // returning `trimRect2(...)` unconditionally — with a measured width of 5000 as the witness for
    // both the far-edge and the near-edge clamp. The trim is now the PARAGRAPH exit alone, on the
    // documented grounds that a paragraph box must stay inside the document for its overflow icon
    // to be reachable, while a POINT box's committed layer canvas IS its box and has to carry the
    // ink past the edge. So both halves are pinned here rather than one rule that is now two.
    const args = (kind: 'point' | 'paragraph') =>
      ({
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        kind,
        align: 'left',
      }) as TextToolArgs;

    // The far edge, in the dimension that actually grows: a 29.2px line wanted at y1 = 990 in a
    // 1000-tall document is 1019.2 unclamped, and the trim is the only thing that makes it 1000.
    const tall = calculateNewRect(
      { ...args('paragraph'), rect: { x1: 0, y1: 990, x2: 100, y2: 995 } },
      makeCanvasRef(10),
      imageSize
    );
    expect(tall!.y2).toBe(imageSize.height);
    expect(tall!.y2).not.toBe(990 + (16 * 1.2 + 2 * 5));

    // The near edge: a drag that started off the document keeps its dragged WIDTH and loses only
    // the negative origin, which is the difference between clamping the edges and collapsing the
    // box onto the edge. 50 - 10 of wrap width leaves the interior, so 0..50 is not a floored width.
    const overhang = calculateNewRect(
      { ...args('paragraph'), rect: { x1: -50, y1: 100, x2: 50, y2: 100 } },
      makeCanvasRef(10),
      imageSize
    );
    expect(overhang?.x1).toBe(0);
    expect(overhang?.x2).toBe(50);

    // And the POINT box keeps its ink: 5000 + 10 grows x2 to 5010 and the document does not get a
    // say, because a layer's canvas is this rect and clamping it would commit a bitmap holding the
    // first few pixels of one glyph while the overlay showed the whole string.
    const point = calculateNewRect(
      { ...args('point'), rect: { x1: 0, y1: 0, x2: 100, y2: 0 } },
      makeCanvasRef(5000),
      imageSize
    );
    expect(point!.x1).toBe(0);
    expect(point!.x2).toBe(5000 + 2 * 5);
    expect(point!.x2).not.toBe(imageSize.width);
  });

  it('clamps a rect that already exceeded the document to its ORIGIN, and sizes the extent from the ink', () => {
    // REWRITTEN against current behaviour. The salvaged case asked for a 40-wide clamp of a rect
    // that ran 20px off the top-left, and the answer it recorded — a full-width box with the bottom
    // derived from the rect's own pre-clamp `y1` — was the old unconditional `trimRect2`. The
    // point arm now clamps the ORIGIN and floors the far edge at it rather than clamping the extent,
    // then recomputes the width from the ink, so the returned 20px is the content's and not the
    // document's: a box whose far edge had been clamped would be 40 wide with 20px of nothing in it.
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hi',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: -20, y1: -20, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      makeCanvasRef(10),
      { width: 40, height: 40 }
    );

    // The height is derived from the CLAMPED origin (0), not from the rect's own -20, and the width
    // is 10 of ink plus the padding on both sides rather than the document's 40.
    expect(result).toEqual({ x1: 0, y1: 0, x2: 10 + 2 * 5, y2: 16 * 1.2 + 2 * 5 });
  });

  it('returns the empty-text box CLAMPED into the document, which is the early return', () => {
    // REWRITTEN against current behaviour. The salvaged case pinned the opposite and said so: the
    // `!text` arm returned before `trimRect2`, so a press at the origin published `x1` of -1 and a
    // box one pixel wider than the document. That was a defect — `useRect`'s `drawMask` paints
    // `trimRect(...)` while handing `onRepaint` the UNCLAMPED rect, so the box the first keystroke
    // grew from started a pixel left of the frame the user was looking at — and it is fixed. What
    // survives of the case is the thing that made it observable: the early return is the ONLY path
    // that both widens by an inset and does not measure, so it is the only place the two clamps can
    // be told apart from the width arm.
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: '',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 0, y1: 0, x2: 100, y2: 100 },
        align: 'left',
      } as TextToolArgs,
      makeCanvasRef(0),
      { width: 100, height: 100 }
    );

    // The ±1 widening is still applied — it is what makes a zero-area press's mask visible — and it
    // is clamped away at BOTH edges of a document-sized box. So the published rect is the document's
    // own, and the frame cannot move on the first keystroke.
    expect(result).toEqual({ x1: 0, y1: 0, x2: 100, y2: 16 * 1.2 + 2 * 5 });
    expect(result!.x1).not.toBe(-1);
    expect(result!.x2).not.toBe(101);
  });
});
