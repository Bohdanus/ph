import { describe, expect, it } from 'vitest';
import {
  MARQUEE_THICKNESS_PX,
  SINGLE_COLUMN_MARQUEE_SOURCE_TOOL,
  SINGLE_ROW_MARQUEE_SOURCE_TOOL,
  isSingleRowOrColumnMarqueeRect,
  singleColumnMarqueeRect,
  singleRowMarqueeRect,
  type SingleColumnMarqueeToolArgs,
  type SingleRowMarqueeToolArgs,
  type SingleRowOrColumnMarqueeToolArgs,
  type SingleRowOrColumnMarqueeToolName,
} from '../singleRowColumnMarquee.ts';
import type { RectXYSorted, Size } from '../../contexts/general-types.ts';

/**
 * A non-square document, deliberately. A square document makes "full width" and "full
 * height" the same number, so a builder that crossed the two axes over would still satisfy
 * every assertion written against it; 200x120 tells the row's span from the column's.
 */
const DOC: Size = { width: 200, height: 120 };

/** The row/column transpose of a rect: x becomes y. */
function transpose(rect: RectXYSorted): RectXYSorted {
  return { x1: rect.y1, y1: rect.x1, x2: rect.y2, y2: rect.x2 };
}

/**
 * The transpose of a document, and the half of the symmetry that is easy to miss: the two tools
 * are mirrors of each other only when the DOCUMENT is mirrored as well. Transposing a row's rect
 * while leaving a 200x120 document alone compares a band's height against the document's WIDTH,
 * so the identity below only closes once the size is swapped too.
 */
function transposeSize(size: Size): Size {
  return { width: size.height, height: size.width };
}

describe('MARQUEE_THICKNESS_PX', () => {
  it("is one document pixel, which is the whole of Adobe's specification for these tools", () => {
    // Not a literal in the assertions below: the constant is the single place the thickness is
    // written down, so every geometry case that compares `y2 - y1` against it is a comparison
    // against the shipped value rather than against a second copy of it.
    expect(MARQUEE_THICKNESS_PX).toBe(1);
  });
});

describe('singleRowMarqueeRect', () => {
  it('selects the first row for a press at y = 0', () => {
    expect(singleRowMarqueeRect(0, DOC)).toEqual({ x1: 0, y1: 0, x2: DOC.width, y2: 1 });
  });

  it('selects a middle row for a press in the middle of the document', () => {
    expect(singleRowMarqueeRect(60, DOC)).toEqual({ x1: 0, y1: 60, x2: DOC.width, y2: 61 });
  });

  it('selects the last row for a press on the last row, and never a row below it', () => {
    expect(singleRowMarqueeRect(119, DOC)).toEqual({ x1: 0, y1: 119, x2: DOC.width, y2: 120 });
    // One row PAST the last, which is what a press on the seam below the document produces.
    // Clamping rather than rejecting is this app's documented choice — see the note on
    // `clampPixelIndex` — so the answer is the last row, not the empty rect.
    expect(singleRowMarqueeRect(120, DOC)).toEqual({ x1: 0, y1: 119, x2: DOC.width, y2: 120 });
    expect(singleRowMarqueeRect(4000, DOC)).toEqual({ x1: 0, y1: 119, x2: DOC.width, y2: 120 });
  });

  it('spans the FULL document width whatever row was pressed', () => {
    const widths = [0, 1, 60, 119, -20, 900].map(
      (y) => singleRowMarqueeRect(y, DOC).x2 - singleRowMarqueeRect(y, DOC).x1
    );

    expect(widths).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it('is exactly MARQUEE_THICKNESS_PX tall for every row it can produce', () => {
    const heights = [-5, -1, -0.2, 0, 0.5, 12.9, 59, 60, 119, 119.999, 120, 500].map(
      (y) => singleRowMarqueeRect(y, DOC).y2 - singleRowMarqueeRect(y, DOC).y1
    );

    expect(heights).toEqual(heights.map(() => MARQUEE_THICKNESS_PX));
  });

  it('clamps a press above the document to the first row', () => {
    expect(singleRowMarqueeRect(-1, DOC)).toEqual({ x1: 0, y1: 0, x2: DOC.width, y2: 1 });
    expect(singleRowMarqueeRect(-0.0001, DOC)).toEqual({ x1: 0, y1: 0, x2: DOC.width, y2: 1 });
    expect(singleRowMarqueeRect(-4000, DOC)).toEqual({ x1: 0, y1: 0, x2: DOC.width, y2: 1 });
  });

  it('anchors to the row the pointer is INSIDE, by flooring, not the nearer row', () => {
    // THE `Math.floor` rule. A pixel is an interval `[n, n + 1)`, so a press at 12.9 is inside
    // row 12; `Math.round` would hand row 13 a press that landed above it. The 0.5 case is the
    // one that separates the two rules on its own — `Math.round(0.5) === 1` and
    // `Math.floor(0.5) === 0`.
    expect(singleRowMarqueeRect(12.9, DOC).y1).toBe(12);
    expect(singleRowMarqueeRect(0.5, DOC).y1).toBe(0);
    expect(singleRowMarqueeRect(119.5, DOC).y1).toBe(119);
    // A press exactly on a boundary belongs to the row it starts, not the one it ends.
    expect(singleRowMarqueeRect(13, DOC).y1).toBe(13);
    expect(singleRowMarqueeRect(0, DOC).y1).toBe(0);
    // And the floating point that a fractional zoom scale produces: 0.1 + 0.2 territory, where
    // an integer-typed value arrives as 11.999999999999998 and must not slip a row.
    expect(singleRowMarqueeRect(11.999999999999998, DOC).y1).toBe(11);
  });

  it('floors first and clamps after, so the last row survives a press at its own lower edge', () => {
    // `clampPixelIndex` is `Math.min(Math.max(Math.floor(value), 0), extent - 1)`. Flooring
    // before clamping is what keeps 119.9 at row 119 rather than rounding it to 120 and then
    // having to clamp it back down — the two orders agree here, and the case pins that they do.
    expect(singleRowMarqueeRect(119.9, DOC).y1).toBe(119);
  });

  it('yields row 0 of a zero-height document rather than refusing', () => {
    // The only non-empty answer available: there is no row to pick, and the height of the
    // result is still one, which is the honest answer to "which row" on an empty canvas.
    expect(singleRowMarqueeRect(0, { width: 200, height: 0 })).toEqual({ x1: 0, y1: 0, x2: 200, y2: 1 });
    expect(singleRowMarqueeRect(42, { width: 200, height: 0 })).toEqual({ x1: 0, y1: 0, x2: 200, y2: 1 });
  });

  it('yields a zero-width band on a zero-width document, because `Math.max(0, width)`, not one', () => {
    // A press on an empty canvas produces a rect of zero area, and the commit path's
    // `createCommittedRectangleSelection` is what turns that into "nothing committed". This is a
    // pin on the geometry, not an endorsement: the width here is `Math.max(0, 0) === 0`, and the
    // row itself is still the one the press named, because the clamp reads the height.
    expect(singleRowMarqueeRect(0, { width: 0, height: 120 })).toEqual({ x1: 0, y1: 0, x2: 0, y2: 1 });
    expect(singleRowMarqueeRect(5, { width: 0, height: 120 })).toEqual({ x1: 0, y1: 5, x2: 0, y2: 6 });
  });

  it('selects the nearest row for an infinite press, and the first for NaN', () => {
    // Only `NaN` short-circuits, because it has no direction to clamp. The infinities fall through
    // to the same clamp every other out-of-range press gets: `-Infinity` overshoots above the
    // document and lands on the first row, `+Infinity` overshoots below it and lands on the last.
    // Collapsing all three onto row 0 made `+Infinity` the one input that selected the row
    // furthest from the pointer.
    expect(singleRowMarqueeRect(NaN, DOC).y1).toBe(0);
    expect(singleRowMarqueeRect(Infinity, DOC).y1).toBe(DOC.height - 1);
    expect(singleRowMarqueeRect(-Infinity, DOC).y1).toBe(0);
  });

  it('follows the document height rather than a constant, on a second document size', () => {
    expect(singleRowMarqueeRect(1023, { width: 40, height: 1024 })).toEqual({
      x1: 0,
      y1: 1023,
      x2: 40,
      y2: 1024,
    });
  });
});

describe('singleColumnMarqueeRect', () => {
  it('selects the first column for a press at x = 0', () => {
    expect(singleColumnMarqueeRect(0, DOC)).toEqual({ x1: 0, y1: 0, x2: 1, y2: DOC.height });
  });

  it('selects a middle column for a press in the middle of the document', () => {
    expect(singleColumnMarqueeRect(100, DOC)).toEqual({ x1: 100, y1: 0, x2: 101, y2: DOC.height });
  });

  it('selects the last column for a press on it, and clamps one past it', () => {
    expect(singleColumnMarqueeRect(199, DOC)).toEqual({ x1: 199, y1: 0, x2: 200, y2: DOC.height });
    expect(singleColumnMarqueeRect(200, DOC)).toEqual({ x1: 199, y1: 0, x2: 200, y2: DOC.height });
    expect(singleColumnMarqueeRect(9999, DOC)).toEqual({ x1: 199, y1: 0, x2: 200, y2: DOC.height });
  });

  it('spans the FULL document height whatever column was pressed', () => {
    const heights = [0, 1, 100, 199, -20, 900].map(
      (x) => singleColumnMarqueeRect(x, DOC).y2 - singleColumnMarqueeRect(x, DOC).y1
    );

    expect(heights).toEqual([120, 120, 120, 120, 120, 120]);
  });

  it('is exactly MARQUEE_THICKNESS_PX wide for every column it can produce', () => {
    const widths = [-5, -0.2, 0, 0.5, 12.9, 100, 199, 199.5, 200, 500].map(
      (x) => singleColumnMarqueeRect(x, DOC).x2 - singleColumnMarqueeRect(x, DOC).x1
    );

    expect(widths).toEqual(widths.map(() => MARQUEE_THICKNESS_PX));
  });

  it('clamps a press left of the document to the first column', () => {
    expect(singleColumnMarqueeRect(-1, DOC)).toEqual({ x1: 0, y1: 0, x2: 1, y2: DOC.height });
    expect(singleColumnMarqueeRect(-9999, DOC)).toEqual({ x1: 0, y1: 0, x2: 1, y2: DOC.height });
  });

  it('anchors to the column the pointer is INSIDE, by flooring', () => {
    // The same `Math.floor` rule as the row, on the other axis — one `clampPixelIndex`, so the
    // two tools cannot drift into two different answers about half a pixel.
    expect(singleColumnMarqueeRect(12.9, DOC).x1).toBe(12);
    expect(singleColumnMarqueeRect(0.5, DOC).x1).toBe(0);
    expect(singleColumnMarqueeRect(199.5, DOC).x1).toBe(199);
  });

  it('yields column 0 of a zero-width document, and a zero-height band on a zero-height one', () => {
    expect(singleColumnMarqueeRect(0, { width: 0, height: 120 })).toEqual({ x1: 0, y1: 0, x2: 1, y2: 120 });
    expect(singleColumnMarqueeRect(7, { width: 0, height: 120 })).toEqual({ x1: 0, y1: 0, x2: 1, y2: 120 });
    // A zero-height document does NOT clamp the column, because the clamp reads the extent of the
    // axis the press is on. The band's other axis is `Math.max(0, height) === 0`, so the rect
    // comes back with zero area — which is what sends the commit path down its
    // `createCommittedRectangleSelection` → `null` → cancel branch.
    expect(singleColumnMarqueeRect(7, { width: 200, height: 0 })).toEqual({ x1: 7, y1: 0, x2: 8, y2: 0 });
  });

  it('selects the nearest column for an infinite press, and the first for NaN', () => {
    expect(singleColumnMarqueeRect(NaN, DOC).x1).toBe(0);
    expect(singleColumnMarqueeRect(Infinity, DOC).x1).toBe(DOC.width - 1);
    expect(singleColumnMarqueeRect(-Infinity, DOC).x1).toBe(0);
  });
});

describe('row/column transpose symmetry', () => {
  const AXIS_INPUTS = [-3, -0.5, 0, 0.5, 1, 12.9, 60, 119, 119.9, 120, 1e6, NaN];

  it('is a plain transpose on a square document, where swapping the axes needs no size swap', () => {
    // On a square document the document's own two extents are the same number, so the plain
    // transpose of the rect IS the other tool's answer — which is the identity
    // `singleColumnMarqueeRect` is documented as ("the transpose of `singleRowMarqueeRect`")
    // and the one a reader checks first.
    const SQUARE: Size = { width: 200, height: 200 };

    AXIS_INPUTS.forEach((axis) => {
      expect(transpose(singleRowMarqueeRect(axis, SQUARE))).toEqual(singleColumnMarqueeRect(axis, SQUARE));
    });
    [0, 42.7, 199].forEach((x) => {
      expect(transpose(singleColumnMarqueeRect(x, SQUARE))).toEqual(singleRowMarqueeRect(x, SQUARE));
    });
  });

  it('transposes the DOCUMENT along with the rect, on a non-square one', () => {
    // The real claim, and the reason the row and the column are one implementation rather than
    // two: swap the axes on both the pointer position and the canvas, and the two tools are the
    // same function. A builder that read `imageSize.height` where its sibling reads
    // `imageSize.width` cannot satisfy this for a document that is not a square.
    AXIS_INPUTS.forEach((axis) => {
      expect(transpose(singleRowMarqueeRect(axis, DOC))).toEqual(singleColumnMarqueeRect(axis, transposeSize(DOC)));
    });
  });

  it('agrees across the document sizes a real document has', () => {
    const SIZES: Size[] = [
      { width: 1, height: 1 },
      { width: 1, height: 900 },
      { width: 900, height: 1 },
      { width: 800, height: 600 },
      { width: 0, height: 0 },
    ];

    SIZES.forEach((size) => {
      [0, 1, 7.5, 200, 900].forEach((axis) => {
        expect(transpose(singleRowMarqueeRect(axis, size))).toEqual(singleColumnMarqueeRect(axis, transposeSize(size)));
      });
    });
  });
});

describe('isSingleRowOrColumnMarqueeRect', () => {
  it('accepts a row band these tools made, at every row', () => {
    [0, 1, 60, 119].forEach((y) => {
      expect(isSingleRowOrColumnMarqueeRect(singleRowMarqueeRect(y, DOC), DOC)).toBe(true);
    });
  });

  it('accepts a column band these tools made, at every column', () => {
    [0, 1, 100, 199].forEach((x) => {
      expect(isSingleRowOrColumnMarqueeRect(singleColumnMarqueeRect(x, DOC), DOC)).toBe(true);
    });
  });

  it('accepts a band from a DIFFERENT document size, because the check is against the size given', () => {
    const OTHER: Size = { width: 40, height: 1024 };

    expect(isSingleRowOrColumnMarqueeRect(singleRowMarqueeRect(1023, OTHER), OTHER)).toBe(true);
    // And the same rect judged against the wrong document is not a band for that document —
    // which is the point of taking `imageSize` at all.
    expect(isSingleRowOrColumnMarqueeRect(singleRowMarqueeRect(1023, OTHER), DOC)).toBe(false);
  });

  it('accepts a band anchored anywhere along its own thin axis, because the band is placed by the press', () => {
    // The band does not have to start at the document origin on the axis it is THIN in — a press
    // at row 60 produces `y1: 60` — and the predicate reads that as a band. What it does
    // require is the span, and the zero origin, on the axis it is FULL along.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 60, x2: 200, y2: 61 }, DOC)).toBe(true);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 100, y1: 0, x2: 101, y2: 120 }, DOC)).toBe(true);
  });

  it('rejects an ordinary rectangular-marquee selection smaller than the document', () => {
    // The case that matters most in the tool area: a selection the Rectangular Marquee drew must
    // NOT be grabbable by a 1-pixel tool's press, because moving it would relocate a rectangle the
    // user drew with a different tool.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 10, y1: 20, x2: 40, y2: 60 }, DOC)).toBe(false);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 100, y2: 60 }, DOC)).toBe(false);
  });

  it('rejects a full-document box that is not one pixel thin', () => {
    // The other way a rectangle can span the document: EVERY dimension of the document, which is
    // what a Select-All-shaped marquee is. Both clauses need a thickness of exactly 1.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 200, y2: 120 }, DOC)).toBe(false);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 200, y2: 2 }, DOC)).toBe(false);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 2, y2: 120 }, DOC)).toBe(false);
  });

  it('rejects a one-pixel band that does not span the document on its long axis', () => {
    // Thin, but not a band these tools make: a 100x1 box is a stripe the user drew.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 100, y2: 1 }, DOC)).toBe(false);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 50, y1: 0, x2: 51, y2: 60 }, DOC)).toBe(false);
  });

  it('rejects a full-length band that does not start at the origin on its long axis', () => {
    // The one asymmetry in the predicate, pinned on purpose: a full-height band is accepted for a
    // column anywhere (`x1` free) and a full-width band for a row anywhere (`y1` free), but
    // `y1 === 0` is required of the COLUMN-shaped one and `x1 === 0` of the ROW-shaped one, so a
    // vertical strip that starts below the top edge is not a band.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 5, x2: 1, y2: 125 }, DOC)).toBe(false);
    // A full-width band at row 5 IS one, which is what makes the rejection above about the axis
    // rather than about `y1` being non-zero.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 5, x2: 200, y2: 6 }, DOC)).toBe(true);
  });

  it('rejects a zero-area rect, which no band can be', () => {
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 0, y2: 0 }, DOC)).toBe(false);
  });

  it('accepts a band that overruns the document, because the span test is `>=`', () => {
    // `height >= imageSize.height` rather than `===`: a band normalised by a caller that rounded
    // outward still reads as a band. Pinned so the comparison is known, not assumed.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 1, y2: 200 }, DOC)).toBe(true);
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 300, y2: 1 }, DOC)).toBe(true);
  });

  it('rejects a rect that is one pixel thin and full-length but on a document whose own extent is smaller', () => {
    // The same 1x200 strip, judged against a 120-tall document, is longer than the document and
    // still passes the `>=` clause — which is the case above. Judged against a document TALLER
    // than it, it is short and does not. The predicate is relative to `imageSize` throughout.
    expect(isSingleRowOrColumnMarqueeRect({ x1: 0, y1: 0, x2: 1, y2: 200 }, { width: 200, height: 400 })).toBe(false);
  });
});

describe('tool args and source tools', () => {
  it('carries nothing but its own tool name, on both tools', () => {
    // Adobe scopes Style, Width/Height and Anti-alias to the Rectangular and Elliptical Marquees
    // BY NAME, so there is nothing to put in either args object: an options bar reading one of
    // these two would have a control with no spec behind it.
    const row: SingleRowMarqueeToolArgs = { toolName: 'single-row-marquee' };
    const column: SingleColumnMarqueeToolArgs = { toolName: 'single-column-marquee' };

    expect(Object.keys(row)).toEqual(['toolName']);
    expect(Object.keys(column)).toEqual(['toolName']);
    expect(row).toEqual({ toolName: 'single-row-marquee' });
    expect(column).toEqual({ toolName: 'single-column-marquee' });
  });

  it('types the union as exactly these two names', () => {
    // A compile-time pin: a third member added to `SingleRowOrColumnMarqueeToolName` without
    // widening `SingleRowOrColumnMarqueeToolArgs` fails `tsc`, which is the only gate that reads
    // this file's types at all.
    const both: SingleRowOrColumnMarqueeToolArgs[] = [
      { toolName: 'single-row-marquee' },
      { toolName: 'single-column-marquee' },
    ];
    const names: SingleRowOrColumnMarqueeToolName[] = both.map((args) => args.toolName);

    expect(names).toEqual(['single-row-marquee', 'single-column-marquee']);
  });

  it('commits under `rectangular-selection`, because a 1-pixel band IS a rectangle', () => {
    // `SelectionSourceTool` has no member for either tool, and the truthful value is the one the
    // geometry is: a band is a rectangle, and borrowing `'magic-wand'` the way the elliptical
    // tool does would put it in the class of selections that SKIP their anchor dots for a reason
    // (a tessellated ellipse has no draggable handles) that does not apply to a band.
    expect(SINGLE_ROW_MARQUEE_SOURCE_TOOL).toBe('rectangular-selection');
    expect(SINGLE_COLUMN_MARQUEE_SOURCE_TOOL).toBe('rectangular-selection');
  });
});
