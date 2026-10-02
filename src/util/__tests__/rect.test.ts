import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
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
});

describe('reduceRect', () => {
  it('subtracts the pos offset from every coordinate', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    const pos: Pos = { x: 5, y: 10, width: 5, height: 5 };
    expect(reduceRect(rect, pos)).toEqual({ x1: 5, y1: 10, x2: 25, y2: 50 });
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

  function makeCanvasRef(measureWidth: number) {
    const ctx = {
      measureText: vi.fn(() => ({ width: measureWidth })),
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
    expect(result).toEqual({ x1: -1, y1: 0, x2: 1, y2: 16 * 1.2 + 2 * 5 });
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

  it('centers wider text for center align', () => {
    const canvasRef = makeCanvasRef(120);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 50, y1: 0, x2: 100, y2: 0 },
        align: 'center',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    const requiredWidth = 120 + 2 * 5;
    const currentWidth = 100 - 50;
    expect(result!.x1).toBeCloseTo(50 + (currentWidth - requiredWidth) / 2);
    expect(result!.x2).toBeCloseTo(50 + (currentWidth + requiredWidth) / 2);
  });

  it('does not change width when text fits within the current width', () => {
    const canvasRef = makeCanvasRef(10);
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
    expect(result!.x2).toBe(100);
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
});
