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
  angleFromCenter,
  rectCenter,
  rotatePointAround,
} from '../rect.ts';
import type { RectXY, RectXYSorted, Pos, Size } from '../../contexts/general-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import { TEXT_PADDING } from '../constants.ts';

describe('rectangle rotation helpers', () => {
  it('rotates a point around the rectangle centre and reports its angle', () => {
    const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const center = rectCenter(rect);
    const rotated = rotatePointAround({ x: 100, y: 50 }, center, 90);

    expect(rotated.x).toBeCloseTo(50);
    expect(rotated.y).toBeCloseTo(100);
    expect(angleFromCenter(center, rotated)).toBeCloseTo(90);
  });

  it('reports an infinite centre for a rect whose edges sit at the extended-real extremes', () => {
    expect(rectCenter({ x1: 0, y1: 0, x2: Infinity, y2: Infinity })).toEqual({ x: Infinity, y: Infinity });
  });

  it('propagates a NaN edge into the centre rather than throwing', () => {
    const result = rectCenter({ x1: NaN, y1: 0, x2: 10, y2: 20 });
    expect(result.x).toBeNaN();
    expect(result.y).toBe(10);
  });

  it('does not throw when rotating a point carrying a NaN coordinate', () => {
    // NaN survives the affine math; the only requirement is that the rotation never throws.
    const result = rotatePointAround({ x: NaN, y: 50 }, { x: 50, y: 50 }, 45);
    expect(result.x).toBeNaN();
    expect(result.y).toBeNaN();
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

  it('propagates a NaN coordinate without throwing, because Math.min/max return NaN', () => {
    // A corrupt upstream record can inject NaN; sortRect must stay total and never throw,
    // so the NaN surfaces in the affected edge alone rather than crashing the drag.
    const result = sortRect({ x1: NaN, y1: 0, x2: 10, y2: 20 });
    expect(result.x1).toBeNaN();
    expect(result.x2).toBeNaN();
    expect(result.y1).toBe(0);
    expect(result.y2).toBe(20);
  });

  it('sorts Infinity and -Infinity as ordinary extended reals', () => {
    const result = sortRect({ x1: Infinity, y1: -Infinity, x2: 10, y2: 20 });
    expect(result).toEqual({ x1: 10, y1: -Infinity, x2: Infinity, y2: 20 });
  });

  it('treats a fully inverted pair as a normal drag once sorted', () => {
    const rect = { x1: -500, y1: -500, x2: -100, y2: -100 };
    expect(sortRect(rect)).toEqual({ x1: -500, y1: -500, x2: -100, y2: -100 });
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

  it('clamps a rect that extends far past the far edge to the image boundary', () => {
    const huge: RectXY = { x1: 0, y1: 0, x2: 1e9, y2: 1e9 };
    expect(trimRect(huge, imageSize)).toEqual({ x: 0, y: 0, width: 100, height: 100, isTrimmed: true });
  });

  it('clamps a deeply inverted rect whose far edge lies beyond the image', () => {
    // x1 > x2 and x2 is off the bottom-right: sortRect re-orders, then both clamp.
    const inverted: RectXY = { x1: 2000, y1: 2000, x2: 50, y2: 10 };
    expect(trimRect(inverted, imageSize)).toEqual({ x: 50, y: 10, width: 50, height: 90, isTrimmed: true });
  });

  it('collapses a zero-WIDTH but positive-HEIGHT degenerate rect into a zero-width span', () => {
    // x1 === x2 means no width; the height is content, so the point survives as a vertical span.
    const degenerate: RectXY = { x1: 50, y1: 50, x2: 50, y2: 60 };
    expect(trimRect(degenerate, imageSize)).toEqual({ x: 50, y: 50, width: 0, height: 10, isTrimmed: false });
  });

  it('collapses a zero-HEIGHT but positive-WIDTH degenerate rect into a zero-height span', () => {
    const degenerate: RectXY = { x1: 50, y1: 50, x2: 60, y2: 50 };
    expect(trimRect(degenerate, imageSize)).toEqual({ x: 50, y: 50, width: 10, height: 0, isTrimmed: false });
  });

  it('does not throw on a NaN coordinate and propagates it through the result', () => {
    // NaN is never < 0 and never > imageLength, so isTrimmed stays false; the NaN
    // then flows through clampEdge and roundedPos untouched.
    const result = trimRect({ x1: NaN, y1: NaN, x2: NaN, y2: NaN }, imageSize);
    expect(result.isTrimmed).toBe(false);
    expect(result.x).toBeNaN();
    expect(result.y).toBeNaN();
    expect(result.width).toBeNaN();
    expect(result.height).toBeNaN();
  });

  it('clamps Infinity down to the image boundary and -Infinity up to zero', () => {
    const result = trimRect({ x1: -Infinity, y1: -Infinity, x2: Infinity, y2: Infinity }, imageSize);
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100, isTrimmed: true });
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

  it('clamps a rect extending far past the far edge to the image boundary', () => {
    const huge: RectXY = { x1: 0, y1: 0, x2: 1e9, y2: 1e9 };
    expect(trimRect2(huge, imageSize)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
  });

  it('does not throw on a NaN coordinate and leaves the unaffected edges intact', () => {
    // One NaN edge collapses to NaN; the other axis, untouched by NaN, still clamps.
    const result = trimRect2({ x1: NaN, y1: -5, x2: 150, y2: 20 }, imageSize);
    expect(result.x1).toBeNaN();
    expect(result.x2).toBeNaN();
    expect(result.y1).toBe(0);
    expect(result.y2).toBe(20);
  });

  it('clamps Infinity to the boundary and -Infinity to zero, matching clampEdge', () => {
    expect(trimRect2({ x1: -Infinity, y1: 0, x2: Infinity, y2: 50 }, imageSize)).toEqual({
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 50,
    });
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

  it('does not clamp, so Infinity keeps an unbounded extent', () => {
    // sortRoundRect is crop's "grow the canvas" arm: it never clamps, so an
    // edge at Infinity survives as a rounded Infinity extent.
    const result = sortRoundRect({ x1: 0, y1: 0, x2: Infinity, y2: Infinity });
    expect(result).toEqual({ x: 0, y: 0, width: Infinity, height: Infinity });
  });

  it('does not throw on a NaN coordinate and propagates it into the extent', () => {
    const result = sortRoundRect({ x1: NaN, y1: 0, x2: 10, y2: 20 });
    expect(result.x).toBeNaN();
    expect(result.width).toBeNaN();
    expect(result.y).toBe(0);
    expect(result.height).toBe(20);
  });

  it('sorts an inverted rect whose edges are at the extended-realm extremes', () => {
    // x1 > x2 and y1 > y2, each at an extreme: sortRect re-orders before rounding.
    const result = sortRoundRect({ x1: Infinity, y1: 90, x2: -Infinity, y2: 10 });
    expect(result).toEqual({ x: -Infinity, y: 10, width: Infinity, height: 80 });
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

  it('produces a zero-width span for a rect whose x-edges meet but y-edges differ', () => {
    const rect: RectXYSorted = { x1: 50, y1: 20, x2: 50, y2: 80 };
    expect(sortedRectToPos(rect)).toEqual({ x: 50, y: 20, width: 0, height: 60 });
  });

  it('reports a negative width for an inverted input, since it trusts its sorted contract', () => {
    // RectXYSorted is an alias with no runtime enforcement, so a negative extent reaches here;
    // the function derives the span directly, so the negative surfaces rather than throwing.
    const inverted: RectXYSorted = { x1: 100, y1: 50, x2: 70, y2: 90 };
    expect(sortedRectToPos(inverted)).toEqual({ x: 100, y: 50, width: -30, height: 40 });
  });
});

describe('reduceRect', () => {
  it('subtracts the pos offset from every coordinate', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    const pos: Pos = { x: 5, y: 10, width: 5, height: 5 };
    expect(reduceRect(rect, pos)).toEqual({ x1: 5, y1: 10, x2: 25, y2: 50 });
  });

  it('does not throw on a NaN offset and propagates it to the matching axis', () => {
    const rect: RectXYSorted = { x1: 10, y1: 20, x2: 30, y2: 60 };
    const pos: Pos = { x: NaN, y: 10, width: 5, height: 5 };
    const result = reduceRect(rect, pos);
    expect(result.x1).toBeNaN();
    expect(result.x2).toBeNaN();
    expect(result.y1).toBe(10);
    expect(result.y2).toBe(50);
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

  it('produces an inverted rect when the pos carries a negative width or height', () => {
    // The caller is responsible for the sign; posToSortedRect only adds, so a negative
    // extent lands as x2 < x1 (and later as a negative width from sortedRectToPos).
    const pos: Pos = { x: 100, y: 50, width: -30, height: 40 };
    expect(posToSortedRect(pos)).toEqual({ x1: 100, y1: 50, x2: 70, y2: 90 });
  });

  it('does not throw on a NaN origin and propagates it to the matching edges', () => {
    const pos: Pos = { x: NaN, y: 50, width: 30, height: 40 };
    const result = posToSortedRect(pos);
    expect(result.x1).toBeNaN();
    expect(result.x2).toBeNaN();
    expect(result.y1).toBe(50);
    expect(result.y2).toBe(90);
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

/** Test-only copy of `clampTextOrigin` (`src/util/rect.ts:112`), which is private. */
function clampTextOrigin(rect: RectXYSorted, imageSize: Size): RectXYSorted {
  const sorted = sortRect(rect);
  const x1 = Math.min(Math.max(0, sorted.x1), imageSize.width);
  const y1 = Math.min(Math.max(0, sorted.y1), imageSize.height);
  return { x1, y1, x2: Math.max(x1, sorted.x2), y2: Math.max(y1, sorted.y2) };
}

describe('clampTextOrigin', () => {
  const size: Size = { width: 1000, height: 800 };

  it('leaves a rect fully inside the document untouched', () => {
    const rect: RectXYSorted = { x1: 100, y1: 50, x2: 400, y2: 300 };
    expect(clampTextOrigin(rect, size)).toEqual(rect);
  });

  it('clamps an origin that sits outside the document to the boundary', () => {
    const rect: RectXYSorted = { x1: -50, y1: -30, x2: 400, y2: 300 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 0, y1: 0, x2: 400, y2: 300 });
  });

  it('clamps an origin past the far edge to the document boundary', () => {
    const rect: RectXYSorted = { x1: 1200, y1: 900, x2: 1500, y2: 1200 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 1000, y1: 800, x2: 1500, y2: 1200 });
  });

  it('clamps an origin exactly at the document boundary and leaves the far edge alone', () => {
    const rect: RectXYSorted = { x1: 1000, y1: 800, x2: 1500, y2: 1200 };
    expect(clampTextOrigin(rect, size)).toEqual(rect);
  });

  it('floors the far edge at the clamped origin, so a rect wholly on the negative side does not report a negative extent', () => {
    const rect: RectXYSorted = { x1: -200, y1: -150, x2: -100, y2: -50 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('sorts an inverted input before clamping, so a right-to-left drag keeps a positive extent', () => {
    const rect: RectXYSorted = { x1: 400, y1: 300, x2: 100, y2: 50 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 100, y1: 50, x2: 400, y2: 300 });
  });

  it('preserves the far edge beyond the document, which is the point of the clamp', () => {
    const rect: RectXYSorted = { x1: 950, y1: 100, x2: 1400, y2: 300 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 950, y1: 100, x2: 1400, y2: 300 });
  });

  it('clamps an origin at -Infinity to zero and floors the far edge at that origin', () => {
    // -Infinity sorts to the min, then clampEdge maps it to 0; the far edge is floored at 0, so a
    // wholly-negative box collapses onto the origin rather than inverting.
    const rect: RectXYSorted = { x1: -Infinity, y1: -Infinity, x2: -100, y2: -50 };
    expect(clampTextOrigin(rect, size)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('does not throw on a NaN origin and propagates NaN to that axis', () => {
    const rect: RectXYSorted = { x1: NaN, y1: 100, x2: 400, y2: 300 };
    const result = clampTextOrigin(rect, size);
    expect(result.x1).toBeNaN();
    expect(result.x2).toBeNaN();
    expect(result.y1).toBe(100);
    expect(result.y2).toBe(300);
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
    const mockDOMMatrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      m11: 1,
      m12: 0,
      m13: 0,
      m14: 0,
      m21: 0,
      m22: 1,
      m23: 0,
      m24: 0,
      m31: 0,
      m32: 0,
      m33: 1,
      m34: 0,
      m41: 0,
      m42: 0,
      m43: 0,
      m44: 0,
      is2D: true,
      isIdentity: true,
      multiply: vi.fn(),
      preMultiply: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      rotateFromVector: vi.fn(),
      flipX: vi.fn(),
      flipY: vi.fn(),
      inverse: vi.fn(),
      rotateAxisAngle: vi.fn(),
      skewX: vi.fn(),
      skewY: vi.fn(),
      toFloat32Array: vi.fn(),
      toFloat64Array: vi.fn(),
      toJSON: vi.fn(),
      toString: vi.fn(),
    } as unknown as DOMMatrix;

    const ctx = {
      font: '10px sans-serif',
      measureText: vi.fn((text: string) => ({
        width: measureWidth ?? text.length * (parseFloat(ctx.font) || 10),
      })),
      save: vi.fn(),
      restore: vi.fn(),
      getTransform: vi.fn(() => mockDOMMatrix),
      setTransform: vi.fn(),
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
    expect(result!.x2 - result!.x1).toBe(100 + 2 * 5);
  });

  it('expands a point box equally around the click for every alignment setting', () => {
    const rect = { x1: 100, y1: 0, x2: 100, y2: 0 };
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
      expect(result!.x1, align).toBe(100 - (120 + 2 * TEXT_PADDING) / 2);
      expect(result!.x2, align).toBe(100 + (120 + 2 * TEXT_PADDING) / 2);
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
    expect(result!.x1 + result!.x2).toBe(100);
    expect(result!.x2 - result!.x1).toBe(2 * 16 + 2 * TEXT_PADDING);
  });

  it('grows and shrinks a point box around its fixed click', () => {
    const narrower = calculateNewRect(
      {
        ...baseArgs,
        text: 'hi',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 100, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    const wider = calculateNewRect(
      {
        ...baseArgs,
        text: 'abcd',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 100, y1: 0, x2: 100, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      makeCanvasRef(),
      imageSize
    );
    expect(narrower!.x1 + narrower!.x2).toBe(200);
    expect(wider!.x1 + wider!.x2).toBe(200);
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

    expect(result).toEqual({ x1: 25, y1: 8, x2: 75, y2: 42 });
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
    expect(at16!.x2 - at16!.x1).toBe(5 * 16 + 2 * 5);
    expect(at64!.x2 - at64!.x1).toBe(5 * 64 + 2 * 5);
    expect(at64!.x2 - at64!.x1).toBeGreaterThan(at16!.x2 - at16!.x1);
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
        // A click ten pixels from the right edge of a thousand-pixel document. The centred box grows
        // past the document on the right, because the committed layer's canvas IS this rect
        // (`createLayerFromTool` takes `pos` from it and `createLayerSource` sizes the creator's
        // canvas at `size: pos`), so clamping the extent wrote a ten-pixel bitmap holding the first
        // few pixels of one glyph while the overlay showed the whole string.
        rect: { x1: 990, y1: 0, x2: 990, y2: 0 },
        align: 'left',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.x1).toBe(990 - (300 + 2 * 5) / 2);
    expect(result!.x2).toBe(990 + (300 + 2 * 5) / 2);
    expect(result!.x2).toBeGreaterThan(imageSize.width);
  });

  it('clamps a point box origin when its centred left edge falls outside the document', () => {
    const canvasRef = makeCanvasRef(300);
    const result = calculateNewRect(
      {
        ...baseArgs,
        text: 'hello',
        fontSize: 16,
        lineHeight: 1.2,
        // The click is near the left edge and the measured line is wider than the available space.
        rect: { x1: 5, y1: 1005, x2: 5, y2: 1005 },
        align: 'right',
      } as TextToolArgs,
      canvasRef,
      imageSize
    );
    expect(result!.y1).toBeCloseTo(1005 - (16 * 1.2 + 2 * TEXT_PADDING) / 2);
    expect(result!.x1).toBe(0);
    expect(result!.x2).toBe(300 + 2 * TEXT_PADDING);
    // And the extent is still the content's, so nothing is cropped by the origin clamp.
    expect(result!.x2 - result!.x1).toBe(300 + 2 * 5);
  });

  it('keeps the original click centred across successive point-text edits', () => {
    const first = calculateNewRect(
      {
        ...baseArgs,
        text: 'a',
        fontSize: 16,
        lineHeight: 1.2,
        rect: { x1: 500, y1: 100, x2: 500, y2: 100 },
        kind: 'point',
      } as TextToolArgs,
      makeCanvasRef(16),
      imageSize
    )!;
    const second = calculateNewRect(
      {
        ...baseArgs,
        text: 'a\nb\nc',
        fontSize: 16,
        lineHeight: 1.2,
        rect: first,
        kind: 'point',
      } as TextToolArgs,
      makeCanvasRef(160),
      imageSize
    )!;

    expect(first.x1 + first.x2).toBe(1000);
    expect(second.x1 + second.x2).toBe(1000);
    expect(first.y1 + first.y2).toBe(200);
    expect(second.y1 + second.y2).toBe(200);
    expect(second.x1).toBeLessThan(first.x1);
    expect(second.x2).toBeGreaterThan(first.x2);
    expect(second.y1).toBeLessThan(first.y1);
    expect(second.y2).toBeGreaterThan(first.y2);
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
    // centred placement. The left edge clamps at the document boundary, while a
    // `resolveTextKind` default of 'paragraph' would have left both edges at 100 and 200.
    expect(result.x1).toBe(0);
    expect(result.x2).toBe(300 + 2 * TEXT_PADDING);
  });
});
