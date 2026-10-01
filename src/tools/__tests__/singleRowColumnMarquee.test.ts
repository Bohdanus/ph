import { describe, expect, it } from 'vitest';
import {
  MARQUEE_THICKNESS_PX,
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  isSingleRowOrColumnMarqueeRect,
  singleColumnMarqueeRect,
  singleRowMarqueeRect,
} from '../singleRowColumnMarquee.ts';
import { createCommittedRectangleSelection } from '../../util/selection.ts';
import type { RectXYSorted, Size } from '../../contexts/general-types.ts';

const DOC: Size = { width: 200, height: 120 };
/** The extent of the document in `SingleRowColumnMarqueeToolArea`'s shifted-frame fixture. */
const SHIFTED: Size = { width: 700, height: 550 };

const area = (rect: RectXYSorted): number => (rect.x2 - rect.x1) * (rect.y2 - rect.y1);

/** Swap the two axes: the operation that carries a row band to a column band. */
const transpose = (rect: RectXYSorted): RectXYSorted => ({
  x1: rect.y1,
  y1: rect.x1,
  x2: rect.y2,
  y2: rect.x2,
});

describe('MARQUEE_THICKNESS_PX', () => {
  it('is one document pixel, which is the whole thickness rule for both tools', () => {
    expect(MARQUEE_THICKNESS_PX).toBe(1);
  });
});

describe('singleRowMarqueeRect', () => {
  it('makes a band exactly one pixel tall', () => {
    const rect = singleRowMarqueeRect(40, DOC);

    expect(rect.y2 - rect.y1).toBe(MARQUEE_THICKNESS_PX);
    expect(rect.y2 - rect.y1).toBe(1);
  });

  it('spans the whole document width, from the left edge to the right edge', () => {
    expect(singleRowMarqueeRect(40, DOC)).toEqual({ x1: 0, y1: 40, x2: 200, y2: 41 });
  });

  it('reads a press as the row it landed in, and does not round it to a neighbour', () => {
    // `Math.floor` and `Math.trunc` are indistinguishable THROUGH the clamp — every
    // negative input collapses to row 0 either way — so what is pinnable here is the
    // half of the rule that is observable: a press inside a row belongs to that row,
    // and 13.0 is row 13 rather than row 12.
    expect(singleRowMarqueeRect(12.9, DOC).y1).toBe(12);
    expect(singleRowMarqueeRect(0.5, DOC).y1).toBe(0);
    expect(singleRowMarqueeRect(13, DOC).y1).toBe(13);
  });

  it('clamps a press above the document to the first row', () => {
    expect(singleRowMarqueeRect(-5, DOC)).toEqual({ x1: 0, y1: 0, x2: 200, y2: 1 });
  });

  it('clamps a press on and past the bottom edge to the last row', () => {
    expect(singleRowMarqueeRect(DOC.height - 1, DOC)).toEqual({ x1: 0, y1: 119, x2: 200, y2: 120 });
    expect(singleRowMarqueeRect(DOC.height, DOC)).toEqual({ x1: 0, y1: 119, x2: 200, y2: 120 });
  });

  it('lands on the only row of a 1x1 document, from anywhere in range or out of it', () => {
    const unit: Size = { width: 1, height: 1 };

    expect(singleRowMarqueeRect(0, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(singleRowMarqueeRect(0.9, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(singleRowMarqueeRect(100, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });

  it('answers the only non-empty band for a zero-height document, and does not throw', () => {
    const flat: Size = { width: 200, height: 0 };

    expect(() => singleRowMarqueeRect(5, flat)).not.toThrow();
    expect(singleRowMarqueeRect(5, flat)).toEqual({ x1: 0, y1: 0, x2: 200, y2: 1 });
  });

  it('keeps a zero-width band at zero rather than off the left edge', () => {
    const narrow: Size = { width: 0, height: 10 };

    expect(singleRowMarqueeRect(3, narrow)).toEqual({ x1: 0, y1: 3, x2: 0, y2: 4 });
  });

  it('reads a non-finite press as the first row', () => {
    for (const y of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(singleRowMarqueeRect(y, DOC)).toEqual({ x1: 0, y1: 0, x2: 200, y2: 1 });
    }
  });
});

describe('singleColumnMarqueeRect', () => {
  it('makes a band exactly one pixel wide', () => {
    const rect = singleColumnMarqueeRect(40, DOC);

    expect(rect.x2 - rect.x1).toBe(MARQUEE_THICKNESS_PX);
    expect(rect.x2 - rect.x1).toBe(1);
  });

  it('spans the whole document height, from the top edge to the bottom edge', () => {
    expect(singleColumnMarqueeRect(40, DOC)).toEqual({ x1: 40, y1: 0, x2: 41, y2: 120 });
  });

  it('reads a press as the column it landed in, and does not round it to a neighbour', () => {
    expect(singleColumnMarqueeRect(12.9, DOC).x1).toBe(12);
    expect(singleColumnMarqueeRect(0.5, DOC).x1).toBe(0);
    expect(singleColumnMarqueeRect(13, DOC).x1).toBe(13);
  });

  it('clamps a press left of the document to the first column', () => {
    expect(singleColumnMarqueeRect(-5, DOC)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 120 });
  });

  it('clamps a press on and past the right edge to the last column', () => {
    expect(singleColumnMarqueeRect(DOC.width - 1, DOC)).toEqual({ x1: 199, y1: 0, x2: 200, y2: 120 });
    expect(singleColumnMarqueeRect(DOC.width, DOC)).toEqual({ x1: 199, y1: 0, x2: 200, y2: 120 });
  });

  it('lands on the only column of a 1x1 document, from anywhere in range or out of it', () => {
    const unit: Size = { width: 1, height: 1 };

    expect(singleColumnMarqueeRect(0, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(singleColumnMarqueeRect(0.9, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(singleColumnMarqueeRect(100, unit)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 });
  });

  it('answers the only non-empty band for a zero-width document, and does not throw', () => {
    const flat: Size = { width: 0, height: 120 };

    expect(() => singleColumnMarqueeRect(5, flat)).not.toThrow();
    expect(singleColumnMarqueeRect(5, flat)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 120 });
  });

  it('keeps a zero-height band at zero rather than off the top edge', () => {
    const narrow: Size = { width: 50, height: 0 };

    expect(singleColumnMarqueeRect(3, narrow)).toEqual({ x1: 3, y1: 0, x2: 4, y2: 0 });
  });

  it('reads a non-finite press as the first column', () => {
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(singleColumnMarqueeRect(x, DOC)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 120 });
    }
  });
});

describe('a row band and a column band are the same band on the other axis', () => {
  it('carries the same band with the document axes swapped, for every index both axes share', () => {
    // A row band runs the full WIDTH, so carrying it onto the other axis means carrying the
    // document's axes with it: the band in a `w`-tall document that is the transpose of the
    // row band of a `w`-wide one is the COLUMN band of a document whose width is that height.
    const sizes: Size[] = [
      { width: 200, height: 120 },
      { width: 64, height: 64 },
      { width: 1, height: 1 },
      { width: 37, height: 9 },
    ];

    for (const size of sizes) {
      const swapped: Size = { width: size.height, height: size.width };

      for (let index = 0; index < Math.min(size.width, size.height); index++) {
        const label = `size ${size.width}x${size.height} index ${index}`;

        expect(transpose(singleRowMarqueeRect(index, size)), label).toEqual(singleColumnMarqueeRect(index, swapped));
        expect(area(singleRowMarqueeRect(index, size)), label).toBe(area(singleColumnMarqueeRect(index, swapped)));
      }
    }
  });

  it('are transposes of each other inside one square document, and only there', () => {
    for (const side of [1, 9, 64]) {
      const square: Size = { width: side, height: side };

      for (let index = 0; index < side; index++) {
        expect(transpose(singleRowMarqueeRect(index, square)), `side ${side} index ${index}`).toEqual(
          singleColumnMarqueeRect(index, square)
        );
      }
    }

    // The bound on the claim above, and it is a bound rather than an accident of the sizes
    // chosen: in a non-square document the row band's long axis is the document's WIDTH and
    // the column band's is its HEIGHT, so the two are different bands, not two views of one.
    expect(transpose(singleRowMarqueeRect(0, DOC))).not.toEqual(singleColumnMarqueeRect(0, DOC));
    expect(area(singleRowMarqueeRect(0, DOC))).toBe(200);
    expect(area(singleColumnMarqueeRect(0, DOC))).toBe(120);
  });

  it('is exactly the transpose up to the point where the two clamps stop agreeing', () => {
    // The transpose claim above is bounded, and the bound is observable: index 150 is in
    // range for a 200-wide document and out of range for a 120-tall one, so the row clamps
    // to 119 while the column stays at 150. If either clamp were dropped the two would
    // agree again, which is what makes this the control for the clamp being load-bearing.
    const size: Size = { width: 200, height: 120 };

    expect(singleRowMarqueeRect(150, size).y1).toBe(119);
    expect(singleColumnMarqueeRect(150, size).x1).toBe(150);
    expect(transpose(singleRowMarqueeRect(150, size))).not.toEqual(singleColumnMarqueeRect(150, size));
  });
});

describe('isSingleRowOrColumnMarqueeRect', () => {
  it('recognises every row band the row tool produces', () => {
    for (let y = 0; y < DOC.height; y++) {
      expect(isSingleRowOrColumnMarqueeRect(singleRowMarqueeRect(y, DOC), DOC), `row ${y}`).toBe(true);
    }
  });

  it('recognises every column band the column tool produces', () => {
    for (let x = 0; x < DOC.width; x++) {
      expect(isSingleRowOrColumnMarqueeRect(singleColumnMarqueeRect(x, DOC), DOC), `column ${x}`).toBe(true);
    }
  });

  it('rejects an ordinary rectangle drawn by the rectangular marquee', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 10, y1: 20, x2: 100, y2: 80 }, DOC)).toBe(false);
  });

  it('rejects a two-pixel-tall full-width rect, because the thickness is one', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 10, x2: 200, y2: 12 }, DOC)).toBe(false);
  });

  it('rejects a one-pixel-wide full-height rect, because the thickness is one', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 10, y1: 0, x2: 12, y2: 120 }, DOC)).toBe(false);
  });

  it('rejects a band that does not start at the left edge', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 5, y1: 10, x2: 205, y2: 11 }, DOC)).toBe(false);
  });

  it('rejects a row band that stops short of the right edge', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 10, x2: 199, y2: 11 }, DOC)).toBe(false);
  });

  it('rejects a column band that stops short of the bottom edge', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 10, y1: 0, x2: 11, y2: 119 }, DOC)).toBe(false);
  });

  it('accepts a band that overhangs the far edge, because the band is the whole axis', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 10, x2: 240, y2: 11 }, DOC)).toBe(true);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 10, y1: 0, x2: 11, y2: 200 }, DOC)).toBe(true);
  });

  it('rejects a one-pixel square on a larger document, which is neither axis', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 1, y2: 1 }, DOC)).toBe(false);
  });
});

describe('marquee source tools', () => {
  it('are the rectangular marquee for both tools, because a 1-pixel band is a rectangle', () => {
    expect(SINGLE_ROW_MARQUEE_SOURCE_TOOL).toBe('rectangular-selection');
    expect(SINGLE_COLUMN_MARQUEE_SOURCE_TOOL).toBe('rectangular-selection');
  });
});

/**
 * The frame origin is applied by the CALLER and only by the caller: the tool area converts a
 * canvas point with `canvasToDocumentPoint` before it gets here, and `createCommittedRectangleSelection`
 * performs no conversion of its own — its `pos` is `trimRect(rect)` verbatim. These cases pin the
 * two facts that makes load-bearing — the band is anchored at the DOCUMENT edge, and it clamps
 * against the DOCUMENT extent — so a frame that was added a second time on the way out, or a clamp
 * taken against a canvas, fails here first rather than as a band one frame away from the press.
 */
describe('a band on a document whose frame origin is non-zero', () => {
  it('is anchored at document x=0 for a row and document y=0 for a column, on every axis', () => {
    for (let y = 0; y < SHIFTED.height; y += 37) {
      const band = singleRowMarqueeRect(y, SHIFTED);

      expect(band).toEqual({ x1: 0, y1: y, x2: 700, y2: y + 1 });
      expect(isSingleRowOrColumnMarqueeRect(band, SHIFTED)).toBe(true);
    }

    for (let x = 0; x < SHIFTED.width; x += 53) {
      const band = singleColumnMarqueeRect(x, SHIFTED);

      expect(band).toEqual({ x1: x, y1: 0, x2: x + 1, y2: 550 });
      expect(isSingleRowOrColumnMarqueeRect(band, SHIFTED)).toBe(true);
    }
  });

  it('clamps to the last row and column of the DOCUMENT, which is the number a press past the frame commits', () => {
    // 350 and 350 are inside. 595 and 790 are past the document once the frame origin of
    // (100, 50) is added to the canvas point, and -10 and -50 are before it. The clamp answers
    // 700 - 1 = 699 and 550 - 1 = 549, measured against the document extent rather than any canvas.
    expect(singleRowMarqueeRect(350, SHIFTED).y1).toBe(350);
    expect(singleRowMarqueeRect(595, SHIFTED).y1).toBe(549);
    expect(singleRowMarqueeRect(-10, SHIFTED).y1).toBe(0);
    expect(singleColumnMarqueeRect(350, SHIFTED).x1).toBe(350);
    expect(singleColumnMarqueeRect(790, SHIFTED).x1).toBe(699);
    expect(singleColumnMarqueeRect(-50, SHIFTED).x1).toBe(0);
  });

  it('stops recognising a band that has been translated sideways, and keeps recognising the one rebuilt on the new axis', () => {
    // The cross axis going back to the document edge is the whole of what a band IS, and it is
    // the part a translation loses: 200 columns of sideways displacement leaves a full-width
    // rect at x=200..400, which no later press on it can move again.
    const band = singleRowMarqueeRect(40, DOC);
    const translated: RectXYSorted = { x1: band.x1 + 200, y1: band.y1, x2: band.x2 + 200, y2: band.y2 };

    expect(isSingleRowOrColumnMarqueeRect(band, DOC)).toBe(true);
    expect(isSingleRowOrColumnMarqueeRect(translated, DOC)).toBe(false);
    expect(isSingleRowOrColumnMarqueeRect(singleRowMarqueeRect(100, DOC), DOC)).toBe(true);
  });

  it('produces a rect the commit builder REJECTS on a zero-extent document, not a band', () => {
    // Both builders answer a non-empty rect even when the document has no extent on the band axis
    // — the only answer available without a second clamp rule — and it is `trimRect` inside
    // `createCommittedRectangleSelection` that collapses it, because a document 0 rows tall
    // clamps the band's bottom edge back onto its own top edge. So there is nothing to commit,
    // and the tool area cancels the draft rather than writing a band of no area.
    const flatRow: Size = { width: 700, height: 0 };
    const rowRect = singleRowMarqueeRect(300, flatRow);

    expect(rowRect).toEqual({ x1: 0, y1: 0, x2: 700, y2: 1 });
    expect(area(rowRect)).toBe(700);
    expect(createCommittedRectangleSelection({ id: 'band', rect: rowRect, imageSize: flatRow })).toBeNull();

    const flatColumn: Size = { width: 0, height: 550 };
    // `clampPixelIndex(300, 0)` answers 0 rather than 300: with no columns there is no column 300.
    const columnRect = singleColumnMarqueeRect(300, flatColumn);

    expect(columnRect).toEqual({ x1: 0, y1: 0, x2: 1, y2: 550 });
    expect(area(columnRect)).toBe(550);
    expect(createCommittedRectangleSelection({ id: 'band', rect: columnRect, imageSize: flatColumn })).toBeNull();
  });
});
