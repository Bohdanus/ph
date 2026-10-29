import { describe, expect, it } from 'vitest';
import { EXPORT_LINE_END, EXPORT_LINE_START } from '../../export/helpers';
import {
  canvasOffsetToDocument,
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_SIZE,
  DEFAULT_DOCUMENT_WIDTH,
  containFit,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
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

  it('extrapolates linearly past the document rect rather than clamping to it', () => {
    // The mapping is bare arithmetic with no hidden clamp, which is exactly what makes the
    // inverse exact: a clamp would make the forward leg non-injective and break the
    // round-trip for any point outside the fitted rect. A negative document point and one
    // past the far edge both land on the straight `offset + d*scale` line, and the past-the-edge
    // one clears the box entirely instead of stopping at the box's edge.
    const box = { x: 56, y: 100, width: 974, height: 583 };
    const { scale, offsetX, offsetY } = containFit(box, DEFAULT_DOCUMENT_SIZE);

    const before = documentToCanvasOffset(box, -50, -50);
    const beyond = documentToCanvasOffset(box, 1000, 1000);

    expect(before.x).toBeCloseTo(offsetX - 50 * scale, 9);
    expect(before.y).toBeCloseTo(offsetY - 50 * scale, 9);
    expect(beyond.x).toBeCloseTo(offsetX + 1000 * scale, 9);
    expect(beyond.y).toBeCloseTo(offsetY + 1000 * scale, 9);

    // The extrapolation is real, not clamped: the over-box point escapes the box on both axes.
    expect(beyond.x).toBeGreaterThan(box.width);
    expect(beyond.y).toBeGreaterThan(box.height);
    // And the before-zero point is genuinely off the letterboxed document on both axes.
    expect(before.y).toBeLessThan(0);
  });

  it('maps the document corners onto the symmetric edges of the letterboxed rect', () => {
    // (0,0) lands on the letterbox origin (offsetX, offsetY) and the far corner on the
    // opposite edges: offsetX + docW*scale == boxW - offsetX, because offsetX is exactly the
    // slack halved. That symmetry is the property a caller reaches for when it wants to poll
    // the whole document rect, and pinning it here guards the off-by-half-letterbox class of bug.
    const box = { x: 56, y: 100, width: 974, height: 583 };
    const { offsetX, offsetY } = containFit(box, DEFAULT_DOCUMENT_SIZE);

    const topLeft = documentToCanvasOffset(box, 0, 0);
    const bottomRight = documentToCanvasOffset(box, DEFAULT_DOCUMENT_WIDTH, DEFAULT_DOCUMENT_HEIGHT);

    expect(topLeft.x).toBeCloseTo(offsetX, 9);
    expect(topLeft.y).toBeCloseTo(offsetY, 9);
    expect(bottomRight.x).toBeCloseTo(box.width - offsetX, 9);
    expect(bottomRight.y).toBeCloseTo(box.height - offsetY, 9);
  });
});

/**
 * `containFit` is the single derivation the two mapping directions share, so the
 * round-trip tests above cannot fail unless BOTH legs agree — and they agree by
 * construction because they both read `scale`/`offsetX`/`offsetY` from here. Pinning the
 * fit directly, on its own, is the test that catches a change to the rule itself, which the
 * round trip would happily call "correct" on both sides of.
 */
describe('containFit', () => {
  it('sets the scale to the narrower of the two axis ratios', () => {
    // The document is 4:3; a 3:1-wide box is limited by its height (scale = boxH/docH)
    // and a 1:3-tall box by its width (scale = boxW/docW). The wider a box the more the
    // fitted axis changes, so the assertions name the governing ratio explicitly rather
    // than a magic number.
    const wideBox = { width: 1600, height: 400 };
    const tallBox = { width: 400, height: 1600 };

    expect(containFit(wideBox).scale).toBeCloseTo(400 / DEFAULT_DOCUMENT_HEIGHT, 9);
    expect(containFit(tallBox).scale).toBeCloseTo(400 / DEFAULT_DOCUMENT_WIDTH, 9);

    // The fitted axis consumes the box exactly; the slack axis still has room.
    expect(containFit(wideBox).scale).toBeLessThan(1600 / DEFAULT_DOCUMENT_WIDTH);
    expect(containFit(tallBox).scale).toBeLessThan(1600 / DEFAULT_DOCUMENT_HEIGHT);
  });

  it('is flush on the fitted axis and centred on the slack axis', () => {
    // At the exact aspect match there is no slack and both offsets are zero, so the
    // document fills the box with no letterbox at all — the baseline case the rest of the
    // suite is pinned to.
    const match = containFit({ width: DEFAULT_DOCUMENT_WIDTH, height: DEFAULT_DOCUMENT_HEIGHT });
    expect(match.scale).toBe(1);
    expect(match.offsetX).toBe(0);
    expect(match.offsetY).toBe(0);

    // A wide box is height-limited, so the fitted axis (height) is flush and only offsetX
    // carries the horizontal slack, split evenly.
    const wide = containFit({ width: 1600, height: 400 });
    expect(wide.offsetY).toBe(0);
    expect(wide.offsetX).toBeCloseTo((1600 - DEFAULT_DOCUMENT_WIDTH * wide.scale) / 2, 9);

    // The mirror image: a tall box is width-limited, so offsetX is zero and offsetY holds the
    // vertical slack.
    const tall = containFit({ width: 400, height: 1600 });
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBeCloseTo((1600 - DEFAULT_DOCUMENT_HEIGHT * tall.scale) / 2, 9);
  });

  it('derives its scale from the document size it is handed, not from the seed constant', () => {
    // Halving the document doubles the scale out of the same box — so a caller carrying the
    // real backing-store size (the export fixture, the crop flow) gets the fit for THAT
    // document, not for the 800x600 seed every default carries.
    const halfDoc = { width: 400, height: 300 };
    const { scale: halfScale } = containFit({ width: 974, height: 583 }, halfDoc);

    expect(halfScale).toBeCloseTo(containFit({ width: 974, height: 583 }, DEFAULT_DOCUMENT_SIZE).scale * 2, 9);
    // 400x300 is still 4:3, and 974x583 is taller than 4:3 (974/583 = 1.673 vs 800/600 = 1.333),
    // so width governs: offsetY is the slack halved and offsetX is flush.
    expect(halfScale).toBeCloseTo(583 / 300, 9);
  });

  it('is referentially transparent: same inputs return equal results with no shared state', () => {
    const first = containFit({ width: 974, height: 583 });
    const second = containFit({ width: 974, height: 583 });

    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    // Mutating one result must not bleed into a fresh call — the fit is pure arithmetic
    // over its inputs, so a stale reference cannot poison a later lookup.
    first.scale = 999;
    first.offsetX = 999;
    expect(containFit({ width: 974, height: 583 }).scale).not.toBe(999);
    expect(containFit({ width: 974, height: 583 }).offsetX).not.toBe(999);
  });

  it('returns a finite, zero scale for a zero-sized box instead of NaN or Infinity', () => {
    // A closed or not-yet-laid-out tab produces a zero-size canvas, and `containFit` is shared
    // by every path that then divides by `scale` — so the zero must be a real zero and not
    // poison the downstream offsets with NaN. The downstream mapping test covers the
    // consumer, but the contract lives here.
    const degenerate = containFit({ width: 0, height: 0 });
    expect(degenerate.scale).toBe(0);
    expect(degenerate.offsetX).toBe(0);
    expect(degenerate.offsetY).toBe(0);
    expect(Number.isFinite(degenerate.scale)).toBe(true);
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

  it('round-trips off-origin points with both a crop frame and non-default document size', () => {
    const cropped: DocumentSize = { width: 680, height: 560 };
    const points = [
      { x: CROP.x, y: CROP.y },
      { x: CROP.x + 123.25, y: CROP.y + 78.5 },
      { x: CROP.x + cropped.width, y: CROP.y + cropped.height },
    ];

    for (const box of [BOX, { x: 0, y: 0, width: 1200, height: 400 }]) {
      for (const point of points) {
        const offset = documentToCanvasOffset(box, point.x, point.y, cropped, CROP);
        const back = canvasOffsetToDocument(box, offset.x, offset.y, cropped, CROP);

        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
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
 * The `LINE_*` pair are the box-relative coordinates `drawLine` is asked to stroke, and the
 * `EXPORT_LINE_*` pair are the DOCUMENT coordinates that were derived to land on them at the
 * committed baseline geometry. The two sets exist in different spaces, so a drift in either
 * one is invisible to the test that only checks one of them — the invariant that pins both is
 * that `documentToCanvasOffset` carries the export endpoints onto the line constants at the
 * geometry the baselines were recorded at.
 */
describe('the LINE_* standard test line constants', () => {
  // The layout the committed export baselines were recorded against: the 974x840 canvas the
  // overflowing 1fr row produced before the desktop overflow fix moved it to 974x583.
  const BASELINE_BOX = { x: 56, y: 100, width: 974, height: 840 };

  it('EXPORT_LINE_START/END map onto the exact LINE_* box constants at the baseline geometry', () => {
    // If the importable LINE_* numbers ever stop matching what the export endpoints resolve
    // to, the spec line a scenario draws and the line the export fixture waits on diverge —
    // and the failure looks like a rendering change rather than a moved test line, which is
    // precisely the defect this pairing was invented to make impossible.
    const start = documentToCanvasOffset(BASELINE_BOX, EXPORT_LINE_START.x, EXPORT_LINE_START.y);
    const end = documentToCanvasOffset(BASELINE_BOX, EXPORT_LINE_END.x, EXPORT_LINE_END.y);

    expect(start.x).toBeCloseTo(LINE_START_X, 5);
    expect(start.y).toBeCloseTo(LINE_START_Y, 5);
    expect(end.x).toBeCloseTo(LINE_END_X, 5);
    expect(end.y).toBeCloseTo(LINE_END_Y, 5);
  });

  it('describe a horizontal line spanning 200 box pixels at y = 150', () => {
    // The shape of the standard test line, stated as arithmetic so a "tidy" that shortens
    // one endpoint does not silently narrow the stroke a spec polls for: the two endpoints
    // share a y (the line is level) and are 200px apart, the span `waitForCanvasRedraw`'s
    // default clip (`CANVAS_REDRAW_CLIP`) was chosen to contain.
    expect(LINE_START_X).toBe(150);
    expect(LINE_START_Y).toBe(150);
    expect(LINE_END_X).toBe(350);
    expect(LINE_END_Y).toBe(150);

    expect(LINE_START_Y).toBe(LINE_END_Y);
    expect(LINE_END_X - LINE_START_X).toBe(200);
    expect(LINE_END_X).toBeGreaterThan(LINE_START_X);
  });

  it('places the line inside the standard redraw clip, which is what makes it visible to every wait', () => {
    // `CANVAS_REDRAW_CLIP` is { x: 100, y: 100, width: 300, height: 100 }. The line at 150..350
    // x and 150 y is fully inside it on the left/top and shares the bottom edge — so a wait on
    // the redraw clip is guaranteed to see the stroke. This pins the relationship so a move to
    // either constant is caught here rather than as a flaky "stroke not found" in a browser.
    expect(LINE_START_X).toBeGreaterThanOrEqual(100);
    expect(LINE_START_X).toBeLessThan(100 + 300);
    expect(LINE_END_X).toBeLessThanOrEqual(100 + 300);
    expect(LINE_START_Y).toBeGreaterThanOrEqual(100);
    expect(LINE_START_Y).toBeLessThanOrEqual(100 + 100);
  });
});
