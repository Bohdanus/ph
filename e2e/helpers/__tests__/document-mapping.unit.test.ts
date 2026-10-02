import { describe, expect, it } from 'vitest';
import { EXPORT_LINE_END, EXPORT_LINE_START } from '../../export/helpers';
import {
  canvasOffsetToDocument,
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
  documentStrokeBoundaryMargin,
  documentToCanvasOffset,
  DRAW_TOOL_STROKE_WIDTH,
  MIN_STROKE_BOUNDARY_MARGIN_DOC_PX,
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
