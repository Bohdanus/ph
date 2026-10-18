import { describe, expect, it } from 'vitest';
import { EXPORT_LINE_END, EXPORT_LINE_START } from '../../export/helpers';
import {
  canvasOffsetToDocument,
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_SIZE,
  DEFAULT_DOCUMENT_WIDTH,
  containFit,
  documentStrokeBoundaryMargin,
  documentToCanvasOffset,
  DRAW_TOOL_STROKE_WIDTH,
  MIN_STROKE_BOUNDARY_MARGIN_DOC_PX,
  type DocumentFrameOrigin,
  type DocumentSize,
} from '../canvas-helpers';

/**
 * The document-space mapping the export baselines are pinned to.
 *
 * The export visual-regression baselines were, for their whole life, a function of the
 * window rather than of the document: the test line was specified in canvas-relative
 * offsets, and the canvas is `w-full h-full` of a grid area whose size the shell decides.
 * Fixing a real desktop overflow moved that canvas from 974x890 to 974x583 and moved the
 * export by 459 pixels, with no change anywhere in the export path. These are the pins for
 * the decoupling: the mapping is the app's, the round trip is exact, and the mapping holds
 * at every canvas aspect ratio.
 */

describe('documentToCanvasOffset', () => {
  it('reproduces the committed export baseline geometry exactly', () => {
    // The layout the baselines were recorded against: the overflowing 1fr row, in which the
    // document fitted horizontally at scale 1.2175 with a 54.75px vertical letterbox. The
    // height is 840 because that is the geometry that puts the stroke on the committed
    // baseline's row 78; see the derivation in `e2e/export/helpers.ts`, which shows what the
    // wrong 890 costs — 3824 differing pixels on every one of the seven formats.
    const box = { x: 56, y: 100, width: 974, height: 840 };

    const start = documentToCanvasOffset(box, 123.203285, 78.234086);
    const end = documentToCanvasOffset(box, 287.474333, 78.234086);

    // The canvas-relative offsets the spec used before the line was specified in document
    // space. If this drifts, the export no longer matches its committed baseline and the
    // failure looks like a rendering change rather than a moved test line.
    expect(start.x).toBeCloseTo(150, 4);
    expect(start.y).toBeCloseTo(150, 4);
    expect(end.x).toBeCloseTo(350, 4);
    expect(end.y).toBeCloseTo(150, 4);
  });

  it('inverts to the same document point from either mapping', () => {
    // A wide box and a tall box, so both contain-fit branches are covered.
    for (const box of [
      { x: 0, y: 0, width: 974, height: 840 },
      { x: 56, y: 100, width: 974, height: 583 },
      { x: 0, y: 0, width: 1200, height: 400 },
      { x: 0, y: 0, width: 500, height: 500 },
    ]) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 123.203285, y: 78.234086 },
        { x: DEFAULT_DOCUMENT_WIDTH, y: DEFAULT_DOCUMENT_HEIGHT },
        { x: 400, y: 300 },
      ]) {
        const offset = documentToCanvasOffset(box, point.x, point.y);
        const back = canvasOffsetToDocument(box, offset.x, offset.y);
        expect({ box, point, back: { x: Number(back.x.toFixed(4)), y: Number(back.y.toFixed(4)) } }).toEqual({
          box,
          point,
          back: {
            x: Number(point.x.toFixed(4)),
            y: Number(point.y.toFixed(4)),
          },
        });
      }
    }
  });

  it('resolves a document point to the same position in the document at any canvas size', () => {
    // The property the decoupling exists for: the same document point must not move in the
    // DOCUMENT when the canvas resizes, only in the canvas.
    const tall = { x: 0, y: 0, width: 974, height: 890 };
    const short = { x: 0, y: 0, width: 974, height: 583 };

    const inTall = documentToCanvasOffset(tall, 123.203285, 78.234086);
    const inShort = documentToCanvasOffset(short, 123.203285, 78.234086);

    expect(inTall).not.toEqual(inShort);
    expect(canvasOffsetToDocument(tall, inTall.x, inTall.y).x).toBeCloseTo(123.203285, 4);
    expect(canvasOffsetToDocument(short, inShort.x, inShort.y).x).toBeCloseTo(123.203285, 4);
  });

  it('centres the document in whichever axis has slack', () => {
    // 1200x400 is aspect 3.0 against the document's 1.333, so the document is fitted to the
    // height and the slack is HORIZONTAL: `scale = min(1200/800, 400/600) = 0.667` leaves
    // the full 400px of height used and 1200 - 533.3 to split as a horizontal letterbox.
    const wide = { x: 0, y: 0, width: 1200, height: 400 };
    const topLeft = documentToCanvasOffset(wide, 0, 0);
    const topRight = documentToCanvasOffset(wide, DEFAULT_DOCUMENT_WIDTH, 0);
    const bottomRight = documentToCanvasOffset(wide, DEFAULT_DOCUMENT_WIDTH, DEFAULT_DOCUMENT_HEIGHT);

    const wideScale = Math.min(wide.width / DEFAULT_DOCUMENT_WIDTH, wide.height / DEFAULT_DOCUMENT_HEIGHT);
    expect(topLeft.x, 'the slack axis is centred, not flush').toBeCloseTo(
      (wide.width - DEFAULT_DOCUMENT_WIDTH * wideScale) / 2,
      6
    );
    expect(topLeft.y, 'the fitted axis is flush').toBe(0);
    expect(topRight.x).toBeCloseTo(wide.width - topLeft.x, 6);
    expect(bottomRight.y, 'the fitted axis spans the box').toBeCloseTo(wide.height, 6);

    // And the mirror case: 400x1200 is taller than the document's aspect, so the slack is
    // vertical and the width is the fitted axis.
    const tall = { x: 0, y: 0, width: 400, height: 1200 };
    expect(documentToCanvasOffset(tall, 0, 0).x, 'the fitted axis is flush').toBe(0);
    const tallScale = Math.min(tall.width / DEFAULT_DOCUMENT_WIDTH, tall.height / DEFAULT_DOCUMENT_HEIGHT);
    expect(documentToCanvasOffset(tall, 0, 0).y, 'the slack axis is centred').toBeCloseTo(
      (tall.height - DEFAULT_DOCUMENT_HEIGHT * tallScale) / 2,
      6
    );
  });

  it('degenerate boxes do not produce NaN or Infinity', () => {
    // A zero-sized canvas is what a closed or not-yet-laid-out tab produces. The mapping
    // must stay total, because a NaN here would reach `page.mouse.move` and fail far from
    // the cause.
    const offset = documentToCanvasOffset({ width: 0, height: 0 }, 10, 10);
    expect(Number.isFinite(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
  });
});

/**
 * Why the export test line's coordinates are six-decimal numbers, as an enforced invariant.
 *
 * `EXPORT_LINE_START` and `EXPORT_LINE_END` were derived by inverting `documentToCanvasOffset`
 * at the geometry the committed baselines were recorded at, and the only property recorded
 * about them is that they map back to the old canvas-relative offsets. Nothing stated that
 * they must be clear of the pixel grid, and nothing measured what happens when they are not.
 *
 * It matters because a stroke's boundaries — the two endpoints and `lineWidth/2` beyond each
 * of them — are rasterised with anti-aliasing, and a boundary sitting exactly on an integer
 * document pixel is a rounding tie whose outcome the SIGN of a sub-pixel error decides. The
 * app's `getLocalCoords` is bare float64, so the only error in the whole chain is the
 * transport's: a `pointermove` carries `Math.fround(sent)`, worth up to half a float32 ulp,
 * measured here at 4.1e-5 document px of achieved-coordinate error over viewport widths
 * 768-1920 — and that error varies with `offsetX` and `scale`, i.e. with the frame.
 *
 * So these two tests are the difference between the choice being an accident and being a
 * rule: the first pins the measurement the rule rests on, the second is the rule.
 */
describe('the export line clears the document pixel grid', () => {
  it('the only error in a document-space gesture is float32, and it is four orders of magnitude under the shipped margin', () => {
    // The premise of the rule, as an executable assertion rather than a comment. If Chrome ever
    // stops quantising to float32 — or starts quantising harder — this is where that shows up,
    // and the threshold in the next test is the thing to re-derive against.
    const sent = 461.562628;
    const delivered = Math.fround(sent);
    const transportErrorPagePx = Math.abs(delivered - sent);

    // A float32 has a 24-bit significand, so the half-ulp bound at a magnitude of 2^e is
    // 2^(e-24). The exponent matters: at 461 the ulp is 3.1e-5, a thousand times the bound at
    // 0.46, and a viewport gets wider and the coordinate gets larger.
    const halfUlp = Math.pow(2, Math.floor(Math.log2(sent)) - 24);
    expect(transportErrorPagePx).toBeLessThanOrEqual(halfUlp);
    // The page coordinate 461 is a real one — the canvas-relative offset the 1280-wide layout
    // puts the export line's start at — and the error it actually takes is 5.9e-6.
    expect(transportErrorPagePx).toBeCloseTo(5.9e-6, 7);

    // In document space the error is divided by the contain-fit scale, so the smallest scale
    // in the responsive envelope gives the largest document-space error. `clientX` is bounded
    // by the viewport width, so 1920 is the largest magnitude the sweep can reach, which is
    // exponent 10 and a half-ulp of 2^(10-24) = 6.1e-5 page px. Divided by the smallest scale
    // measured across widths 768-1920 and heights 560/720 (0.705) that bounds the
    // document-space error at 8.7e-5, above the 4.1e-5 actually observed.
    const worstAnalyticDocError = Math.pow(2, 10 - 24) / 0.705;
    expect(worstAnalyticDocError).toBeCloseTo(8.66e-5, 7);
    expect(worstAnalyticDocError).toBeGreaterThan(4.1e-5);

    const margin = documentStrokeBoundaryMargin(EXPORT_LINE_START, EXPORT_LINE_END, DRAW_TOOL_STROKE_WIDTH);
    expect(margin / 4.1e-5, 'the margin must be orders of magnitude above the transport error').toBeGreaterThan(1_000);
  });

  it('EXPORT_LINE_START/END are far enough off the grid that the sign of the transport error cannot flip a coverage value', () => {
    const margin = documentStrokeBoundaryMargin(EXPORT_LINE_START, EXPORT_LINE_END, DRAW_TOOL_STROKE_WIDTH);

    // What breaks if someone "tidies" 123.203285 to 123: every boundary lands exactly on the
    // grid, the margin goes to 0, and this test goes RED. Without it the suite stays green at
    // 1280 wide and is wrong at 1024, because the split is periodic in viewport WIDTH and a
    // height-only test cannot observe it. Measured on this host with the endpoints rounded to
    // integers: 2 distinct exported byte-strings across 88 width x sidebar-state
    // configurations, against 1 for the shipped constants over the same 88.
    expect(margin).toBeGreaterThanOrEqual(MIN_STROKE_BOUNDARY_MARGIN_DOC_PX);

    // Pinned, so a change to the coordinates is a deliberate act with a diff, not an accident
    // that happens to still pass. The three contributing boundaries:
    //   start.x +/- 5 = 118.203285 / 128.203285  -> 0.203285 from the grid
    //   end.x   +/- 5 = 282.474333 / 292.474333  -> 0.474333
    //   y       +/- 5 =  52.700205 /  62.700205  -> 0.299795
    // The minimum is the start cap, so the start endpoint is the binding constraint.
    expect(margin).toBeCloseTo(0.203285, 6);
  });

  it('the draw preset line width is the one the app strokes with', () => {
    // `DRAW_TOOL_STROKE_WIDTH` is a copy of `savedDrawPerPen.pen.lineWidth` rather than an
    // import, because `vitest.e2e.config.ts` records a deliberate boundary — "nothing under
    // `e2e/` imports app source" — and reaching into `src/` for one number would break it and
    // pull the app's module graph into every e2e helper unit test. So the copy is pinned here
    // instead: the Draw tool's pen preset is `{ alpha: 0.9, lineWidth: 10 }`
    // (`src/tools/settings.ts:25`, spread into `defaultSettings.draw` on line 56), and the
    // round margin below is computed from this constant rather than from a literal, so a
    // change to either one has to be deliberate on both sides.
    expect(DRAW_TOOL_STROKE_WIDTH).toBe(10);
    expect(documentStrokeBoundaryMargin(EXPORT_LINE_START, EXPORT_LINE_END, DRAW_TOOL_STROKE_WIDTH)).toBeCloseTo(
      0.203285,
      6
    );
  });

  it('a boundary on the grid reports a margin of exactly 0', () => {
    // The mutation this rule exists to catch, as a self-contained assertion. Rounding the
    // start endpoint to an integer puts both its cap extremes — 118 and 128 — on the grid, so
    // the margin that `EXPORT_LINE_START` is required to keep is exactly 0, and the
    // requirement above rejects it.
    const rounded = { x: 123, y: 58 };
    const margin = documentStrokeBoundaryMargin(rounded, { x: 287, y: 58 }, DRAW_TOOL_STROKE_WIDTH);
    expect(margin).toBe(0);
    expect(margin).toBeLessThan(MIN_STROKE_BOUNDARY_MARGIN_DOC_PX);
  });
});

/**
 * THE CROP FRAME, and the two-leg map the app actually performs.
 *
 * `usePointerPosition.ts:261-262` maps client -> CANVAS space, and then every tool area adds the
 * document frame with `canvasToDocumentPoint` (`src/contexts/document-frame.ts:32-34`). So the
 * app's DOCUMENT -> CANVAS direction is `(d - frame) * scale + offset`, not `d * scale + offset`
 * — the two differ by exactly `frame * scale`, which is zero for an uncropped document and
 * proportional to the crop after one. Before the `documentFrame` parameter existed, this
 * function's own JSDoc claimed a DOCUMENT space it did not deliver, and nothing in the suite
 * noticed because no e2e spec crops.
 *
 * Every case here is therefore about a state the suite cannot reach today, on purpose: the
 * parameter is the only thing standing between the helper and the app's arithmetic, and the
 * first spec that crops is the first thing that would compare the two.
 */
describe('documentFrame', () => {
  const BOX = { x: 56, y: 100, width: 974, height: 583 };
  /** A crop that trims 120 off the left and 40 off the top, leaving a 680x560 frame. */
  const CROP: DocumentFrameOrigin = { x: 120, y: 40 };

  it('defaults to the origin, leaving every existing caller byte-identical', () => {
    // The load-bearing backward-compatibility claim: with no fifth argument the two functions
    // are what they were before it existed, which is why no spec needed editing.
    expect(documentToCanvasOffset(BOX, 400, 300)).toEqual(
      documentToCanvasOffset(BOX, 400, 300, DEFAULT_DOCUMENT_SIZE, { x: 0, y: 0 })
    );
    expect(canvasOffsetToDocument(BOX, 200, 150)).toEqual(
      canvasOffsetToDocument(BOX, 200, 150, DEFAULT_DOCUMENT_SIZE, { x: 0, y: 0 })
    );
  });

  it('puts a point at the frame origin on the letterbox origin, not scaled by it', () => {
    // The single clearest statement of what the parameter does. The frame's own (0,0) is the
    // top-left of the FRAME, which is the top-left of the letterboxed document — so a document
    // point equal to the frame origin must land on the document rect's corner exactly, with the
    // frame subtracted BEFORE the scale rather than after.
    const { offsetX, offsetY } = containFit(BOX);

    expect(documentToCanvasOffset(BOX, CROP.x, CROP.y, DEFAULT_DOCUMENT_SIZE, CROP)).toEqual({
      x: offsetX,
      y: offsetY,
    });
  });

  it('shifts the forward mapping by the frame times the scale, which is the app arithmetic', () => {
    const { scale } = containFit(BOX);
    const point = { x: 300, y: 200 };

    const withoutFrame = documentToCanvasOffset(BOX, point.x, point.y);
    const withFrame = documentToCanvasOffset(BOX, point.x, point.y, DEFAULT_DOCUMENT_SIZE, CROP);

    expect(withFrame.x).toBeCloseTo(withoutFrame.x - CROP.x * scale, 9);
    expect(withFrame.y).toBeCloseTo(withoutFrame.y - CROP.y * scale, 9);
    // Spelled out because it is the shape of the defect: without the frame the two agree, and
    // the crop is the only thing that separates them.
    expect(scale).toBeGreaterThan(0);
    expect(CROP.x * scale).toBeGreaterThan(100);
  });

  it('shifts the inverse mapping by the frame unscaled, in the other direction', () => {
    const canvasPoint = { x: 200, y: 150 };

    const withoutFrame = canvasOffsetToDocument(BOX, canvasPoint.x, canvasPoint.y);
    const withFrame = canvasOffsetToDocument(BOX, canvasPoint.x, canvasPoint.y, DEFAULT_DOCUMENT_SIZE, CROP);

    expect(withFrame.x).toBeCloseTo(withoutFrame.x + CROP.x, 9);
    expect(withFrame.y).toBeCloseTo(withoutFrame.y + CROP.y, 9);
  });

  it('keeps the two legs exact inverses with a non-zero frame', () => {
    // The same property the block above proves at the default, at a frame the suite cannot
    // produce — and proved on BOTH contain-fit branches, so it is not one scale's luck.
    for (const box of [
      { x: 0, y: 0, width: 974, height: 583 },
      { x: 0, y: 0, width: 974, height: 963 },
      { x: 0, y: 0, width: 1_600, height: 500 },
      { x: 0, y: 0, width: 500, height: 1_600 },
    ]) {
      for (const frame of [CROP, { x: 0, y: 37 }, { x: 211, y: 0 }, { x: -25, y: -9 }]) {
        for (const point of [
          { x: 0, y: 0 },
          { x: 123.203285, y: 78.234086 },
          { x: 400, y: 300 },
          { x: 800, y: 600 },
        ]) {
          const offset = documentToCanvasOffset(box, point.x, point.y, DEFAULT_DOCUMENT_SIZE, frame);
          const back = canvasOffsetToDocument(box, offset.x, offset.y, DEFAULT_DOCUMENT_SIZE, frame);

          expect(back.x).toBeCloseTo(point.x, 6);
          expect(back.y).toBeCloseTo(point.y, 6);
        }
      }
    }
  });

  it('uses the frame with a non-default document size too, since both are independent inputs', () => {
    const cropped: DocumentSize = { width: 680, height: 560 };
    const { offsetX, offsetY } = containFit(BOX, cropped);

    expect(documentToCanvasOffset(BOX, CROP.x, CROP.y, cropped, CROP)).toEqual({ x: offsetX, y: offsetY });
  });

  it('does not mutate the frame it is handed', () => {
    const frame: DocumentFrameOrigin = { x: 120, y: 40 };
    const snapshot = { ...frame };

    documentToCanvasOffset(BOX, 10, 10, DEFAULT_DOCUMENT_SIZE, frame);
    canvasOffsetToDocument(BOX, 10, 10, DEFAULT_DOCUMENT_SIZE, frame);

    expect(frame).toEqual(snapshot);
  });
});

/**
 * WHY THESE BLOCKS EXIST, and how they are not redundant with the suite above.
 *
 * The block above pins the round-trip property `f⁻¹(f(x)) = x` for the contain-fit
 * mapping at normal coordinates — the happy path the app actually walks. These
 * blocks below pin the UNHAPPY path: NaN, Infinity, zero-sized documents, and
 * coordinates that overflow float64. They do not assert that the helper produces a
 * "correct" answer for a non-existent input — there is no correct canvas offset for a
 * document point of NaN — but they pin WHAT THE ARITHMETIC DOES, so that a refactor
 * which silently changes the propagation (say, NaN becoming 0, or Infinity becoming a
 * clamp) is a diff, not a drift. A regression that converts a NaN into a finite
 * number is as much a change as one that converts a finite number into NaN.
 *
 * The tripwires at the end use `it.fails`: each asserts the behaviour we WANT but the
 * mapping does NOT yet deliver. It stays green while the gap is open; the moment a
 * guard lands and the assertion starts passing, `it.fails` flips and reports an
 * unexpected pass — the signal to promote it to a plain `it`.
 */

describe('edge cases: non-finite coordinates', () => {
  const BOX = { x: 0, y: 0, width: 974, height: 583 };

  it('propagates NaN through the forward mapping without swallowing it', () => {
    // NaN is an address, not a magnitude — a coordinate of NaN means "no point was
    // named", and the mapping is a pure float64 pipeline: `offsetX + (NaN - 0) * scale`
    // is NaN. The function does not guard against it, because a guard here would mask
    // a caller that failed to resolve its input rather than fix the cause.
    const offset = documentToCanvasOffset(BOX, Number.NaN, Number.NaN);
    expect(Number.isNaN(offset.x)).toBe(true);
    expect(Number.isNaN(offset.y)).toBe(true);
  });

  it('propagates NaN only on the axis that carries it', () => {
    // A mixed finite/NaN pair proves the propagation is per-axis, not a blanket
    // short-circuit: the finite axis still resolves to a real canvas offset.
    const { scale, offsetY } = containFit(BOX);
    const offset = documentToCanvasOffset(BOX, Number.NaN, DEFAULT_DOCUMENT_HEIGHT);
    expect(Number.isNaN(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
    expect(offset.y).toBeCloseTo(offsetY + DEFAULT_DOCUMENT_HEIGHT * scale, 9);
  });

  it('propagates Infinity through the forward mapping', () => {
    // `offsetX + (Infinity - 0) * scale` is `offsetX + Infinity`, which is Infinity
    // for any positive scale. The function carries the sign through unchanged.
    const offset = documentToCanvasOffset(BOX, Infinity, Infinity);
    expect(offset.x).toBe(Infinity);
    expect(offset.y).toBe(Infinity);
  });

  it('propagates -Infinity through the forward mapping', () => {
    const offset = documentToCanvasOffset(BOX, -Infinity, -Infinity);
    expect(offset.x).toBe(-Infinity);
    expect(offset.y).toBe(-Infinity);
  });

  it('propagates NaN only on the axis that carries it in the inverse mapping', () => {
    const { scale, offsetY } = containFit(BOX);
    const doc = canvasOffsetToDocument(BOX, Number.NaN, 200);
    expect(Number.isNaN(doc.x)).toBe(true);
    expect(Number.isFinite(doc.y)).toBe(true);
    expect(doc.y).toBeCloseTo((200 - offsetY) / scale, 9);
  });

  it('propagates Infinity through the inverse mapping', () => {
    // `(Infinity - offsetX) / scale` is `Infinity / scale`, which is Infinity for
    // any positive scale — the same propagation the forward direction exhibits.
    const doc = canvasOffsetToDocument(BOX, Infinity, Infinity);
    expect(doc.x).toBe(Infinity);
    expect(doc.y).toBe(Infinity);
  });

  it('returns NaN, not Infinity, from a non-finite stroke boundary', () => {
    // `Infinity - Math.round(Infinity)` is `Infinity - Infinity` = NaN in IEEE 754,
    // and `Math.min(..., NaN, ...)` is NaN. So a stroke endpoint at Infinity does
    // NOT produce an infinite margin — it produces NaN, which then poisons the
    // minimum. This is the quiet failure a caller might misread as "exactly on
    // the grid" (margin 0) rather than as "input was non-finite".
    const margin = documentStrokeBoundaryMargin({ x: Infinity, y: Infinity }, { x: 0, y: 0 }, DRAW_TOOL_STROKE_WIDTH);
    expect(Number.isNaN(margin)).toBe(true);
  });

  it('returns NaN from a NaN stroke endpoint', () => {
    const margin = documentStrokeBoundaryMargin({ x: Number.NaN, y: 0 }, { x: 10, y: 20 }, DRAW_TOOL_STROKE_WIDTH);
    expect(Number.isNaN(margin)).toBe(true);
  });

  it('returns NaN from a non-finite stroke width', () => {
    // `half = NaN / 2` is NaN, and every `offGrid` argument it touches becomes NaN,
    // so `Math.min` returns NaN regardless of the endpoints.
    const margin = documentStrokeBoundaryMargin(
      { x: 123.203285, y: 58.234086 },
      { x: 287.474333, y: 58.234086 },
      Number.NaN
    );
    expect(Number.isNaN(margin)).toBe(true);
  });
});

describe('edge cases: zero-sized documents', () => {
  const BOX = { x: 0, y: 0, width: 974, height: 583 };

  it('containFit reports an infinite scale and NaN offsets for a zero-sized document', () => {
    // `box.width / 0` is Infinity in IEEE 754, and `0 * Infinity` is NaN, so the
    // offset half of the contain fit is NaN even as the scale blows up. The app
    // never seeds a zero document — the default is 800×600 — so this pins the
    // arithmetic boundary rather than a state the suite reaches.
    const fit = containFit(BOX, { width: 0, height: 0 });
    expect(fit.scale).toBe(Infinity);
    expect(Number.isNaN(fit.offsetX)).toBe(true);
    expect(Number.isNaN(fit.offsetY)).toBe(true);
  });

  it('forward mapping of a zero-sized document produces NaN on both axes', () => {
    // Because `containFit` returns NaN offsets and an Infinity scale, the point
    // collapses: `NaN + finite × Infinity` is NaN. There is no document to map
    // against, so NaN is the only honest propagation.
    const offset = documentToCanvasOffset(BOX, 400, 300, { width: 0, height: 0 });
    expect(Number.isNaN(offset.x)).toBe(true);
    expect(Number.isNaN(offset.y)).toBe(true);
  });

  it('inverse mapping of a zero-sized document produces NaN on both axes', () => {
    const doc = canvasOffsetToDocument(BOX, 400, 300, { width: 0, height: 0 });
    expect(Number.isNaN(doc.x)).toBe(true);
    expect(Number.isNaN(doc.y)).toBe(true);
  });

  it('does not form a valid round trip with a zero-sized document', () => {
    // The round-trip property pinned elsewhere cannot hold when the document size
    // is zero: both directions collapse to NaN, so the inverse of the forward map
    // is NaN, not the original point. This is expected — the mapping is
    // non-invertible for a non-invertible document.
    const forward = documentToCanvasOffset(BOX, 100, 100, { width: 0, height: 0 });
    const back = canvasOffsetToDocument(BOX, forward.x, forward.y, { width: 0, height: 0 });
    expect(Number.isNaN(back.x)).toBe(true);
    expect(Number.isNaN(back.y)).toBe(true);
  });

  it('fits to the surviving axis when only one document dimension is zero', () => {
    // A document that is zero-wide but non-zero-tall is degenerate but not
    // undefined: `Math.min(box.width / 0, box.height / 600) = Math.min(Infinity, finite)`
    // picks the finite arm, so the scale is finite and non-zero. The zero axis
    // still collapses to offsetX, but the math does not blow up.
    const zeroWidth = containFit(BOX, { width: 0, height: DEFAULT_DOCUMENT_HEIGHT });
    expect(Number.isFinite(zeroWidth.scale)).toBe(true);
    expect(zeroWidth.scale).toBeGreaterThan(0);
    expect(Number.isFinite(zeroWidth.offsetX)).toBe(true);
    expect(zeroWidth.offsetX).toBeCloseTo(BOX.width / 2, 9);

    const zeroHeight = containFit(BOX, { width: DEFAULT_DOCUMENT_WIDTH, height: 0 });
    expect(Number.isFinite(zeroHeight.scale)).toBe(true);
    expect(zeroHeight.scale).toBeGreaterThan(0);
    expect(Number.isFinite(zeroHeight.offsetY)).toBe(true);
  });

  it('forward mapping of a zero-sized box is finite (collapses to origin)', () => {
    // Reinforces the "degenerate boxes do not produce NaN" assertion from the block
    // above, here alongside the zero-DOCUMENT case to make the asymmetry explicit:
    // a zero box has scale 0 and finite offsets, so every document point maps to
    // (offsetX, offsetY) — finite, but a single point.
    const { offsetX, offsetY } = containFit({ width: 0, height: 0 });
    const offset = documentToCanvasOffset({ width: 0, height: 0 }, 400, 300);
    expect(Number.isFinite(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
    expect(offset.x).toBe(offsetX);
    expect(offset.y).toBe(offsetY);
  });

  it('inverse mapping of a zero-sized box overflows to Infinity (the asymmetry)', () => {
    // The forward map of a zero-sized box is finite because scale = 0 and
    // `0 + coord × 0 = 0`. But the inverse divides by scale = 0: `10 / 0` is
    // Infinity in IEEE 754. The app never inverts a zero box — the forward-only
    // test above does not cover this direction — so this is a known limitation,
    // not a regression.
    const doc = canvasOffsetToDocument({ width: 0, height: 0 }, 10, 10);
    expect(doc.x).toBe(Infinity);
    expect(doc.y).toBe(Infinity);
  });
});

describe('edge cases: extreme offsets', () => {
  const BOX = { x: 0, y: 0, width: 974, height: 583 };

  it('preserves large but sub-overflowing coordinates as finite', () => {
    // 1e15 is well within float64's ~1.8e308 range, and the box scale (~0.97)
    // keeps the product finite: 1e15 × 0.97 = 9.7e14, still representable.
    const coord = 1e15;
    const offset = documentToCanvasOffset(BOX, coord, coord);
    expect(Number.isFinite(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
  });

  it('preserves coordinates at float64 max as finite for a normal box', () => {
    // Number.MAX_VALUE (~1.8e308) times the box scale (~0.97) is ~1.75e308,
    // still below the overflow threshold — so the forward map does not blow up
    // for a normal box even at the float64 limit.
    const coord = Number.MAX_VALUE;
    const offset = documentToCanvasOffset(BOX, coord, coord);
    expect(Number.isFinite(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
  });

  it('overflows to Infinity when the scale-coordinate product exceeds float64 max', () => {
    // A box large enough that its scale exceeds 1, combined with a coordinate
    // near 1e308, overflows: at a 100k×100k box the scale is 125
    // (min(125, 166.7)), so 1e308 × 125 overflows float64 to Infinity. This is
    // the boundary the mapping has no guard for — a caller that feeds a
    // pathological box plus a near-max coordinate gets Infinity, which would
    // reach `page.mouse.move` as a non-finite client coordinate.
    const bigBox = { x: 0, y: 0, width: 100_000, height: 100_000 };
    const { scale } = containFit(bigBox);
    expect(scale).toBeGreaterThan(1);
    const offset = documentToCanvasOffset(bigBox, 1e308, 1e308);
    expect(offset.x).toBe(Infinity);
    expect(offset.y).toBe(Infinity);
  });

  it('round-trips large coordinates within float64 precision', () => {
    // At 1e15 the float64 unit-in-the-last-place is ~0.125, so a round trip
    // through containFit's scale and its inverse stays within one ulp — checked
    // as a relative error many orders of magnitude tighter than the transport
    // error the export line margin was designed around (§4.1e-5).
    const coord = 1e15;
    const offset = documentToCanvasOffset(BOX, coord, coord);
    const back = canvasOffsetToDocument(BOX, offset.x, offset.y);
    expect(Math.abs(back.x / coord - 1)).toBeLessThan(1e-12);
    expect(Math.abs(back.y / coord - 1)).toBeLessThan(1e-12);
  });

  it('round-trips at the float64 limit with machine-epsilon relative error', () => {
    // At 1e308 the ulp is ~3.8e292, so the ABSOLUTE round-trip error is enormous
    // — but the RELATIVE error is machine epsilon (2.2e-16), because float64
    // multiply and divide preserve relative precision. `toBeCloseTo` checks
    // absolute error and would fail; the right invariant is relative.
    const coord = 1e308;
    const offset = documentToCanvasOffset(BOX, coord, coord);
    const back = canvasOffsetToDocument(BOX, offset.x, offset.y);
    expect(Math.abs(back.x / coord - 1)).toBeLessThan(1e-15);
    expect(Math.abs(back.y / coord - 1)).toBeLessThan(1e-15);
    // And `toBeCloseTo` (absolute) is the wrong oracle at this scale:
    expect(back.x).not.toBeCloseTo(coord, 3);
    expect(back.y).not.toBeCloseTo(coord, 3);
  });

  it('round-trips Number.MAX_VALUE exactly', () => {
    // At the float64 max the scale (~0.97) is small enough that
    // `MAX_VALUE × scale` does not overflow, and the inverse `÷ scale` recovers
    // the original exactly — the ratio is 1.0 with no precision loss.
    const coord = Number.MAX_VALUE;
    const offset = documentToCanvasOffset(BOX, coord, coord);
    const back = canvasOffsetToDocument(BOX, offset.x, offset.y);
    expect(back.x).toBeCloseTo(coord, 100);
    expect(back.y).toBeCloseTo(coord, 100);
  });
});

describe('known gaps (it.fails tripwires)', () => {
  // Each tripwire asserts the behaviour we WANT but the mapping does NOT yet
  // deliver. Wrapped in `it.fails`, it stays green while the gap is open; the
  // moment a guard lands and the assertion starts passing, `it.fails` flips and
  // reports an unexpected pass, which is the signal to promote it to a plain `it`.
  //
  // These are deliberately scoped to the mapping module's own behaviours — they do
  // NOT repeat the input-validation tripwires already pinned in
  // `canvas-helpers.unit.test.ts` for `containFit`, `documentToCanvasOffset`, and
  // `canvasOffsetToDocument` (which assert that the functions throw on non-finite
  // inputs). What is unique here: zero-sized DOCUMENTS, the zero-box inverse
  // asymmetry, overflow clamping, and `documentStrokeBoundaryMargin` validation.

  const BOX = { x: 0, y: 0, width: 974, height: 583 };

  it.fails('containFit rejects a zero-sized document with a thrown guard', () => {
    // containFit carries no validation — it is the shared arithmetic, and guards
    // live at callers per the JSDoc. If a guard is ever added here, it should
    // reject the zero-sized document that currently returns scale=Infinity with
    // NaN offsets, turning the silent NaN into a loud error at the boundary.
    expect(() => containFit(BOX, { width: 0, height: 0 })).toThrow();
  });

  it.fails('canvasOffsetToDocument of a zero-sized box returns a finite coordinate', () => {
    // The forward map of a zero-sized box is finite (scale 0, collapses to the
    // origin), but the inverse divides by scale 0 and returns Infinity. If a guard
    // is added that special-cases zero scale — returning the box origin instead —
    // this flips. See the "asymmetry" test above for the current behaviour.
    const doc = canvasOffsetToDocument({ width: 0, height: 0 }, 10, 10);
    expect(Number.isFinite(doc.x)).toBe(true);
    expect(Number.isFinite(doc.y)).toBe(true);
  });

  it.fails('documentStrokeBoundaryMargin rejects a non-finite stroke coordinate', () => {
    // A NaN or Infinity endpoint currently produces NaN from `offGrid`, which then
    // poisons `Math.min` into returning NaN — a silent "no boundary" that a caller
    // might misread as "on the grid" (margin 0). If a guard is added that throws on
    // non-finite inputs, this tripwire fires.
    expect(() =>
      documentStrokeBoundaryMargin({ x: Number.NaN, y: 0 }, { x: 10, y: 10 }, DRAW_TOOL_STROKE_WIDTH)
    ).toThrow();
  });

  it.fails('documentToCanvasOffset clamps an overflowing coordinate into the box', () => {
    // With a box scale > 1 and a coordinate near 1e308, the product overflows to
    // Infinity. If a clamp is added that keeps the result inside the box bounds,
    // this flips. See the "overflows to Infinity" test above for the current
    // behaviour.
    const bigBox = { x: 0, y: 0, width: 100_000, height: 100_000 };
    const offset = documentToCanvasOffset(bigBox, 1e308, 1e308);
    expect(Number.isFinite(offset.x)).toBe(true);
    expect(Number.isFinite(offset.y)).toBe(true);
  });
});
