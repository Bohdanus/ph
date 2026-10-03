import { describe, it, expect } from 'vitest';
import {
  STROKE_ANALYSIS,
  loadImageData,
  dominantRed,
  getColorAtPoint,
  getDarkPixelBounds,
  getSelectionBounds,
  getStrokeAnalysis,
  hasDarkPixels,
  hasRedPixels,
  type CaptureRegion,
  type ImageDataResult,
} from '../canvas-helpers';
import {
  CYAN,
  DARK_GRAY,
  RED,
  SPRAY_GRAY,
  WHITE,
  captureAtScale,
  captureRegionOf,
  createImageData,
  createTestImage,
  createTestImageData,
  fillAll,
  fillRect,
  setPixel,
  type Color,
} from './canvas-helpers.fixtures';

const { NEAR_WHITE_THRESHOLD } = STROKE_ANALYSIS;

const gray = (level: number): Color => ({ red: level, green: level, blue: level });
const black: Color = { red: 0, green: 0, blue: 0 };

const CONSTANT_CONTRACT: [keyof typeof STROKE_ANALYSIS, number][] = [
  ['DARK_THRESHOLD', 50],
  ['NEAR_WHITE_THRESHOLD', 250],
  ['DARK_PIXEL_THRESHOLD', 60],
  ['RED_DOMINANCE_FACTOR', 2],
  ['RED_PIXEL_RED_MIN', 180],
  ['RED_PIXEL_GREEN_MAX', 100],
  ['RED_PIXEL_BLUE_MAX', 100],
  ['SELECTION_RED_MAX', 80],
  ['SELECTION_GREEN_MIN', 80],
  ['SELECTION_BLUE_MIN', 180],
  ['SPRAY_LUMINANCE_THRESHOLD', 200],
  ['SPRAY_SATURATION_THRESHOLD', 30],
  ['SPRAY_VERTICAL_SPREAD_THRESHOLD', 30],
  ['SPRAY_GAP_THRESHOLD', 3],
  ['PEN_GAP_THRESHOLD', 5],
  ['COLOR_SAMPLE_RADIUS', 5],
];

describe('STROKE_ANALYSIS constants', () => {
  it.each(CONSTANT_CONTRACT)('documents %s as %i', (name, expected) => {
    expect(STROKE_ANALYSIS[name]).toBe(expected);
  });
});

describe('getStrokeAnalysis', () => {
  it('returns null for a fully transparent image', async () => {
    const image = createImageData(10, 10);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toBeNull();
  });

  it('returns null for a zero-sized image', async () => {
    expect(
      await getStrokeAnalysis({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, { width: 10, height: 10 })
    ).toBeNull();
  });

  const NEAR_WHITE_CASES: { name: string; level: number; expectedPixels: number }[] = [
    { name: 'pure white', level: 255, expectedPixels: 0 },
    { name: 'one above the near-white threshold', level: NEAR_WHITE_THRESHOLD + 1, expectedPixels: 0 },
    { name: 'exactly the near-white threshold', level: NEAR_WHITE_THRESHOLD, expectedPixels: 16 },
  ];

  it.each(NEAR_WHITE_CASES)(
    'classifies grey with $name as $expectedPixels stroke pixels',
    async ({ level, expectedPixels }) => {
      const image = await createTestImageData(gray(level), 4, 4);
      const result = await getStrokeAnalysis(image, captureRegionOf(image));

      if (expectedPixels === 0) {
        expect(result).toBeNull();
        return;
      }
      expect(result).toEqual({ type: 'solid', segments: 1, verticalSpread: 4, pixelCount: expectedPixels });
    }
  );

  it('classifies a dark band as a solid stroke', async () => {
    const image = await createTestImageData(black, 50, 5);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 5,
      pixelCount: 250,
    });
  });

  it('classifies a single-row stroke as solid with a vertical spread of one', async () => {
    const image = createImageData(10, 1);
    fillAll(image, black);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 1,
      pixelCount: 10,
    });
  });

  it('classifies a one-pixel-wide diagonal as solid', async () => {
    const image = createImageData(10, 10);
    for (let step = 0; step < 10; step++) setPixel(image, step, step, black);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 10,
      pixelCount: 10,
    });
  });

  it('classifies a one-pixel image as a solid stroke', async () => {
    const image = await createTestImageData(black, 1, 1);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 1,
      pixelCount: 1,
    });
  });

  it('splits a dashed stroke into segments', async () => {
    const image = createImageData(100, 10);
    fillAll(image, black);
    for (const gap of [
      [5, 9],
      [15, 19],
      [25, 29],
    ] as const) {
      fillRect(image, { left: gap[0], top: 0, right: gap[1], bottom: 9 }, WHITE);
    }

    const result = await getStrokeAnalysis(image, captureRegionOf(image));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('dashed');
    expect(result!.segments).toBeGreaterThan(1);
    expect(result!.pixelCount).toBe(850);
  });

  it('bridges anti-aliasing-sized gaps into a single solid segment', async () => {
    const image = createImageData(100, 10);
    fillAll(image, black);
    for (const gap of [
      [20, 21],
      [40, 41],
      [60, 61],
    ] as const) {
      fillRect(image, { left: gap[0], top: 0, right: gap[1], bottom: 9 }, WHITE);
    }

    const result = await getStrokeAnalysis(image, captureRegionOf(image));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('solid');
    expect(result!.segments).toBe(1);
  });

  it('classifies a full-clip grey wash as spray', async () => {
    const image = await createTestImageData(SPRAY_GRAY, 200, 200);

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'spray',
      segments: 1,
      verticalSpread: 200,
      pixelCount: 40000,
    });
  });

  it('counts only the dark pixels of a mixed row', async () => {
    const image = createImageData(50, 1);
    for (let x = 0; x < 25; x++) setPixel(image, x, 0, black);
    for (let x = 25; x < 50; x++) setPixel(image, x, 0, gray(200));

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 1,
      pixelCount: 25,
    });
  });

  it('counts dark and spray pixels together around a gap', async () => {
    const image = createImageData(50, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 50; x++) {
        const color = x < 25 ? black : x < 30 ? WHITE : SPRAY_GRAY;
        setPixel(image, x, y, color);
      }
    }

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'dashed',
      segments: 2,
      verticalSpread: 5,
      pixelCount: 225,
    });
  });

  it('keeps a low-spread grey and dark pair in one segment', async () => {
    const image = createImageData(50, 5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 50; x++) {
        const color = x < 40 ? SPRAY_GRAY : x < 43 ? WHITE : black;
        setPixel(image, x, y, color);
      }
    }

    expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 5,
      pixelCount: 235,
    });
  });

  it('refuses a region with no CSS size, rather than classifying against a scale of zero', async () => {
    // A zero or missing width makes `imageWidth / region.width` 0, Infinity or NaN, and
    // every threshold multiplied by one of those silently classifies the capture as
    // something. A misconfigured call site is a loud failure, not a wrong verdict.
    const image = createImageData(10, 1);
    fillAll(image, black);

    await expect(getStrokeAnalysis(image, { width: 0, height: 10 })).rejects.toThrow(/positive CSS size/);
    await expect(getStrokeAnalysis(image, { width: 10, height: 0 })).rejects.toThrow(/positive CSS size/);
    await expect(getStrokeAnalysis(image, { width: Number.NaN, height: 10 })).rejects.toThrow(/positive CSS size/);
    await expect(getStrokeAnalysis(image, { width: Number.POSITIVE_INFINITY, height: 10 })).rejects.toThrow(
      /positive CSS size/
    );
  });

  it('returns null for a zero-width image carrying ink, rather than measuring it', async () => {
    // The real defence against a scale of zero is `bottom < 0`, not the length of `data`:
    // with `width === 0` the coordinate arithmetic at canvas-helpers.ts yields NaN for
    // every pixel, and a NaN never compares less than the initial `top`, so `bottom` stays
    // at -1 and the function reports "nothing here" before any threshold is consulted. The
    // existing zero-sized test passes an EMPTY buffer, so it exercises the transparent-pixel
    // path instead and cannot tell the two defences apart; this one carries real ink, so a
    // change that removed the `bottom < 0` arm would fail here rather than pass.
    const image: ImageDataResult = { width: 0, height: 0, data: new Uint8ClampedArray([0, 0, 0, 255]) };

    expect(await getStrokeAnalysis(image, { width: 10, height: 10 })).toBeNull();
  });
});

/**
 * THE APP'S OWN WORKSPACE BACKDROP IS NOT INK.
 *
 * The classifier was asked to find a stroke and answer "is there one", with no notion of the
 * page it was photographing. The workspace is a checkerboard (`Main.tsx:279` picks
 * `.chessboard-light` or `.chessboard-dark`), the document is letterboxed inside it, and a clip
 * that straddles the letterbox photographs the page's own background. `#f3f3f3` then reads as
 * `spray`: it is not near-white (`> 250` is false at 243), it is above `SPRAY_LUMINANCE_THRESHOLD`
 * at zero saturation, and it fills the clip from edge to edge, so a single column of backdrop
 * produced `{ type: 'spray', segments: 1, verticalSpread: <the whole clip> }` with nothing
 * drawn. `e2e/pen-types.spec.ts:37-40` polls for exactly that non-null shape, so its wait could
 * be satisfied by the background and the spray assertions after it would be reading the
 * checkerboard rather than the pen.
 *
 * THE FIX IS EXACT, and that is a decision rather than a shortcut. `LETTERBOX_LIGHT_CELL` and
 * `LETTERBOX_DARK_CELL` match the two cell colours as RGB TRIPLES rather than as luminance
 * bands, because every band wide enough to be worth having runs into a grey this suite already
 * calls ink: `>= 243` swallows `grey(250)`, which the near-white table above pins as a stroke
 * one level below the threshold, and admitting 18 downward swallows `DARK_GRAY` at 10, which is
 * the ink of the dispatch table below and of two gap-threshold fixtures. So these cases pin the
 * cell colours, and the JSDoc on the constants records the residual: the anti-aliased blend at a
 * cell's diagonal edge, and the dark theme's `#000` gaps, are still read as ink.
 */
describe('getStrokeAnalysis on the workspace backdrop', () => {
  const { LETTERBOX_LIGHT_CELL, LETTERBOX_DARK_CELL } = STROKE_ANALYSIS;
  /** The clip `pen-types.spec.ts` takes: 320x120 CSS px, captured at CSS scale so scale is 1. */
  const REGION: CaptureRegion = { width: 320, height: 120 };
  const CLIP: { width: number; height: number } = { width: 320, height: 120 };

  /** The measured peak of one spray dab at the app's default spray preset. */
  const APP_SPRAY_PEAK: Color = { red: 204, green: 204, blue: 204 };

  /** A full-clip wash of `cell`, i.e. a capture with nothing drawn on it. */
  function backdropOnly(cell: Color): ImageDataResult {
    const image = createImageData(CLIP.width, CLIP.height);
    fillAll(image, cell);
    return image;
  }

  it('derives its palette from the app stylesheet rather than from a fixture', () => {
    // `.chessboard-light` and `.chessboard-dark`, `src/index.scss:140-164`. If either cell
    // colour moves, the exclusion stops matching and the cases below fail — which is the
    // point of naming the source rather than the number.
    expect(LETTERBOX_LIGHT_CELL).toEqual({ red: 0xf3, green: 0xf3, blue: 0xf3 });
    expect(LETTERBOX_DARK_CELL).toEqual({ red: 0x12, green: 0x12, blue: 0x12 });
  });

  it('places the light cell inside the band that made it a false positive', () => {
    // The arithmetic of the defect, restated so a reader does not have to re-derive it: 243 is
    // below the near-white cut, above the spray luminance cut, and perfectly unsaturated.
    expect(LETTERBOX_LIGHT_CELL.red).toBeLessThan(STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD);
    expect(LETTERBOX_LIGHT_CELL.red).toBeGreaterThan(STROKE_ANALYSIS.SPRAY_LUMINANCE_THRESHOLD);
    const level = LETTERBOX_LIGHT_CELL.red;
    expect(
      Math.max(LETTERBOX_LIGHT_CELL.red, LETTERBOX_LIGHT_CELL.green, LETTERBOX_LIGHT_CELL.blue) -
        Math.min(LETTERBOX_LIGHT_CELL.red, LETTERBOX_LIGHT_CELL.green, LETTERBOX_LIGHT_CELL.blue)
    ).toBeLessThan(STROKE_ANALYSIS.SPRAY_SATURATION_THRESHOLD);

    // And the reason a "no stroke" answer was the wrong one before: a full-clip wash has the
    // largest vertical spread the classifier can see, so it was a spray on every axis it looks
    // at, not merely on the colour.
    expect(CLIP.height).toBeGreaterThan(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD);
    expect(level).not.toBe(STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD);
  });

  it('returns null for a capture that is nothing but the light letterbox cell', async () => {
    expect(await getStrokeAnalysis(backdropOnly(LETTERBOX_LIGHT_CELL), REGION)).toBeNull();
  });

  it('returns null for a capture that is nothing but the dark letterbox cell', async () => {
    // The other arm: 18 is below `DARK_THRESHOLD`, so before the exclusion this was reported
    // as dark ink rather than as spray — two different wrong answers from one background.
    expect(LETTERBOX_DARK_CELL.red).toBeLessThan(STROKE_ANALYSIS.DARK_THRESHOLD);
    expect(await getStrokeAnalysis(backdropOnly(LETTERBOX_DARK_CELL), REGION)).toBeNull();
  });

  it('returns null for the light checkerboard itself, cells and #fff gaps alike', async () => {
    // The 20px cells of `background-size: 20px 20px`, which is what a real capture of the
    // letterbox is: half cell, half `#fff`. Both are excluded — the gap by `NEAR_WHITE_THRESHOLD`
    // and the cell by the new exclusion — so the pair is what a straddling clip really holds.
    const image = createImageData(CLIP.width, CLIP.height);
    for (let y = 0; y < CLIP.height; y++) {
      for (let x = 0; x < CLIP.width; x++) {
        setPixel(image, x, y, (x + y) % 20 < 10 ? LETTERBOX_LIGHT_CELL : WHITE);
      }
    }

    expect(await getStrokeAnalysis(image, REGION)).toBeNull();
  });

  it('still reads the app spray peak as spray, which is the margin the exclusion must leave', async () => {
    // The load-bearing non-regression. `drawSpray` puts the tool's Opacity in its gradient's
    // colour stop, and the default preset is Opacity 0.5 at `SPRAY_PEAK_ALPHA` 0.4 — so the
    // measured core of one dab is rgb(204,204,204) (`src/util/draw.ts:156-171`). The exclusion
    // is 243, so the brightest part of a real spray sits 39 levels BELOW it and clears
    // `SPRAY_LUMINANCE_THRESHOLD` by 4. Both numbers are pinned so that widening the exclusion
    // into a band, or moving the luminance cut, cannot pass unnoticed.
    expect(APP_SPRAY_PEAK.red).toBe(204);
    expect(LETTERBOX_LIGHT_CELL.red - APP_SPRAY_PEAK.red).toBe(39);
    expect(APP_SPRAY_PEAK.red - STROKE_ANALYSIS.SPRAY_LUMINANCE_THRESHOLD).toBeGreaterThan(0);

    const image = createImageData(CLIP.width, CLIP.height);
    fillAll(image, WHITE);
    fillRect(image, { left: 0, top: 50, right: CLIP.width - 1, bottom: 90 }, APP_SPRAY_PEAK);

    const analysis = await getStrokeAnalysis(image, REGION);

    expect(analysis).toEqual({
      type: 'spray',
      segments: 1,
      verticalSpread: 41,
      pixelCount: 41 * CLIP.width,
    });
  });

  it('classifies a spray stroke drawn across the light checkerboard, not over the paper', async () => {
    // The case the defect would have produced a WRONG answer for: real ink over real backdrop.
    // The stroke has to survive the exclusion, because the clip's own background is the cell
    // colour and the ink is only 39 levels below it.
    const image = createImageData(CLIP.width, CLIP.height);
    for (let y = 0; y < CLIP.height; y++) {
      for (let x = 0; x < CLIP.width; x++) {
        setPixel(image, x, y, (x + y) % 20 < 10 ? LETTERBOX_LIGHT_CELL : WHITE);
      }
    }
    fillRect(image, { left: 40, top: 50, right: 279, bottom: 90 }, SPRAY_GRAY);

    const analysis = await getStrokeAnalysis(image, REGION);

    expect(analysis).toEqual({
      type: 'spray',
      segments: 1,
      verticalSpread: 41,
      pixelCount: 41 * 240,
    });
  });

  it('classifies a black pen stroke as solid over the dark cell, which is why that cell is a match and not a band', async () => {
    // `#000000` at the pen preset's Opacity 0.9 over paper is rgb(26,26,26), and black is the
    // app's default pen colour (`src/contexts/StoreContext.tsx:324`). A band admitting the dark
    // cell downwards would swallow this stroke, and swallowing the `#000` gaps between the
    // cells is what would swallow it; so the exclusion is a MATCH on 18, and the stroke's own
    // bounds are what the classifier reports.
    const image = createImageData(CLIP.width, CLIP.height);
    fillAll(image, LETTERBOX_DARK_CELL);
    fillRect(image, { left: 0, top: 50, right: CLIP.width - 1, bottom: 59 }, { red: 0, green: 0, blue: 0 });

    const analysis = await getStrokeAnalysis(image, REGION);

    expect(analysis).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 10,
      pixelCount: 10 * CLIP.width,
    });
  });

  it("reads a pure #000 capture as ink, so the dark theme's gaps are the residual it leaves", async () => {
    // The residual is not pinned here and there is deliberately no case that says a dark-theme
    // checkerboard IS a stroke: that is not a fact anyone wants kept, and asserting it would
    // forbid a later fix. What is pinned is the reason the residual exists — the `#000` gaps
    // between dark cells are indistinguishable from the app's own black pen, so they cannot be
    // excluded without excluding ink, and `#000000` is the default pen colour
    // (`src/contexts/StoreContext.tsx:324`). Closing that gap is a decision about the app's
    // palette, not a threshold; `e2e/OPEN_PROBLEMS.md` is where it belongs.
    //
    // `type: 'spray'` and not 'solid' is a second, independent rule and is pinned here too:
    // admission and naming are decided separately, and a full-height wash is named by its SPREAD
    // whatever its colour. Read as a colour test this looks wrong; read as the two rules it
    // actually is, it is the shape `getDarkPixelBounds`/`hasDarkPixels` never needed to see.
    expect(await getStrokeAnalysis(backdropOnly({ red: 0, green: 0, blue: 0 }), REGION)).toEqual({
      type: 'spray',
      segments: 1,
      verticalSpread: CLIP.height,
      pixelCount: CLIP.width * CLIP.height,
    });
  });
});

/**
 * One physical stroke, 20 CSS px tall, with a 3 CSS px antialiased bridge in the middle of
 * it. Both numbers are chosen because each crosses a threshold at one scale and not the
 * other, which is what makes the 2x capture below a real test rather than a restatement:
 * 20 x 2 = 40 capture px clears SPRAY_VERTICAL_SPREAD_THRESHOLD (30), and a 3 CSS px gap
 * becomes 6 capture columns, clearing PEN_GAP_THRESHOLD (5). At 1x neither crosses, so
 * both are "solid, one segment"; unscaled at 2x the classifier reaches the other answer
 * twice over, and reports `{ type: 'spray', segments: 2 }`.
 */
function bridgedStroke(): ImageDataResult {
  const image = createImageData(50, 20);
  fillRect(image, { left: 0, top: 0, right: 24, bottom: 19 }, black);
  // 3 empty columns: 25, 26, 27.
  fillRect(image, { left: 25, top: 0, right: 27, bottom: 19 }, WHITE);
  fillRect(image, { left: 28, top: 0, right: 49, bottom: 19 }, black);
  return image;
}

describe('getStrokeAnalysis across capture scales', () => {
  it('classifies the same physical stroke the same way at 1x and at 2x', async () => {
    const stroke = bridgedStroke();
    const region = captureRegionOf(stroke);

    const atOneX = await getStrokeAnalysis(stroke, region);
    const atTwoX = await getStrokeAnalysis(captureAtScale(stroke, 2), region);

    expect(atOneX).not.toBeNull();
    expect(atTwoX).not.toBeNull();
    expect(atTwoX!.type).toBe(atOneX!.type);
    expect(atTwoX!.segments).toBe(atOneX!.segments);
    expect({ type: atTwoX!.type, segments: atTwoX!.segments }).toEqual({ type: 'solid', segments: 1 });
  });

  it('does not read a 20-CSS-px spread as spray at 2x, where it measures 40 capture pixels', async () => {
    const stroke = bridgedStroke();
    const region = captureRegionOf(stroke);
    const deviceCapture = captureAtScale(stroke, 2);

    const atTwoX = await getStrokeAnalysis(deviceCapture, region);

    // The measurement really did cross the raw constant; the test is about what the
    // classifier does with it, not about a fixture that would have passed anyway.
    expect(atTwoX!.verticalSpread).toBe(40);
    expect(atTwoX!.verticalSpread).toBeGreaterThan(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD);
    expect(atTwoX!.type).not.toBe('spray');
  });

  it('does not split a 3-CSS-px anti-aliasing bridge at 2x, where it measures 6 capture columns', async () => {
    const stroke = bridgedStroke();
    const region = captureRegionOf(stroke);
    const deviceCapture = captureAtScale(stroke, 2);

    const atTwoX = await getStrokeAnalysis(deviceCapture, region);
    const atOneX = await getStrokeAnalysis(stroke, region);

    // Same bridge, 6 capture columns apart instead of 3, and one segment either way.
    const bridgeInCaptureColumns = 3 * (deviceCapture.width / stroke.width);
    expect(bridgeInCaptureColumns).toBe(6);
    expect(bridgeInCaptureColumns).toBeGreaterThan(STROKE_ANALYSIS.PEN_GAP_THRESHOLD);
    expect(atTwoX!.segments).toBe(1);
    expect(atTwoX!.segments).toBe(atOneX!.segments);
  });

  it('still splits a genuine dash at 2x, so the scale correction is not a blanket merge', async () => {
    // A 10-CSS-px dash gap is a real gap, not an antialiasing bridge: it clears the pen
    // threshold at 1x and still clears the scaled one at 2x.
    const stroke = createImageData(50, 10);
    fillAll(stroke, black);
    fillRect(stroke, { left: 20, top: 0, right: 29, bottom: 9 }, WHITE);
    const region = captureRegionOf(stroke);

    const atOneX = await getStrokeAnalysis(stroke, region);
    const atTwoX = await getStrokeAnalysis(captureAtScale(stroke, 2), region);

    expect(atOneX!.type).toBe('dashed');
    expect(atTwoX!.type).toBe('dashed');
    expect(atTwoX!.segments).toBe(atOneX!.segments);
  });
});

/**
 * EACH MEASUREMENT IS SCALED BY ITS OWN AXIS.
 *
 * On a faithful capture the two axes of the scale are equal — `expectFaithfulCaptureOf` in
 * cdp-helpers.spec.ts pins that for the CDP path, and every fixture above is a whole-number
 * 1x or 2x capture — so those tests cannot tell a per-axis scale from a single scalar. This
 * block is what tells them apart, and it is deliberately EXAGGERATED.
 *
 * "Exaggerated" is not decoration. A real fractional clip DOES diverge, and by more than a
 * rounding: `documentClip` builds a clip from a `containFit` float, and `page.screenshot`
 * rounds each axis independently, so the short axis is the one that loses. For the
 * `shape-tools.spec.ts` clip shape (320s x 20s CSS px) at a 974x583 canvas box, the capture
 * comes back 311x19 device px — `scale.x` 1.0002 against `scale.y` 0.9777, a divergence of
 * about 2.2%. That is a real number, and it is small: the row measurement there is a stroke
 * one or two rows tall against a threshold near 30, so a couple of per cent cannot move it
 * across. It is recorded because the general case is not bounded by today's call sites, not
 * because a call site is known to be wrong.
 *
 * So the region here names a capture whose axes differ by a THIRD, which no real capture
 * takes. That is what makes the rule observable at all: a real 2% divergence would need a
 * measurement sitting within 2% of its threshold to show up, and no fixture here is built
 * that way. The two cases below each land between the two thresholds, so the row case reads
 * spray only under the row scale and the column case reads solid only under the column one;
 * a single scalar spends both the same way and gets exactly one of them wrong.
 */
describe('getStrokeAnalysis per-axis capture scale', () => {
  const REGION: CaptureRegion = { width: 100, height: 50 };

  it('scales the row measurement by the row scale, not the column scale', async () => {
    // 50 occupied rows against a 30-CSS-px threshold: 30 * 1.5 = 45, so spray under the row
    // scale, and 30 * 2 = 60, so NOT spray under the column one.
    const image = createImageData(200, 75);
    fillRect(image, { left: 0, top: 25, right: 199, bottom: 74 }, black);

    const result = await getStrokeAnalysis(image, REGION);

    // The measurement really did clear the raw constant; the test is about which axis the
    // classifier scales it by, not about a fixture that would have passed anyway.
    expect(result!.verticalSpread).toBe(50);
    expect(50).toBeGreaterThan(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD * (75 / 50));
    expect(50).not.toBeGreaterThan(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD * (200 / 100));
    expect(result!.type).toBe('spray');
  });

  it('scales the column gap by the column scale, not the row scale', async () => {
    // 10 occupied rows is short of either threshold, so the type is settled before the gap
    // is read. `fillRect` is inclusive at both ends, so the white run below erases EIGHT
    // columns (100..107) and the gap the loop measures is the distance between the two
    // surviving neighbours, 108 - 99 = NINE. Both numbers are stated because the one the
    // code compares is not the one the fixture draws: 9 against a 5-CSS-px pen threshold is
    // 5 * 2 = 10, so one segment under the column scale, and 5 * 1.5 = 7.5, so two under the
    // row one.
    const image = createImageData(200, 75);
    fillRect(image, { left: 0, top: 0, right: 199, bottom: 9 }, black);
    fillRect(image, { left: 100, top: 0, right: 107, bottom: 9 }, WHITE);

    const result = await getStrokeAnalysis(image, REGION);

    // Derived from the fixture rather than typed, so it cannot drift from what the loop
    // measures. A hand-written literal here is a statement about a number the
    // implementation never produces, and would hold even if getStrokeAnalysis were deleted.
    const erased = 8;
    const measuredGap = erased + 1;
    expect(measuredGap).toBeGreaterThan(STROKE_ANALYSIS.PEN_GAP_THRESHOLD * (75 / 50));
    expect(measuredGap).not.toBeGreaterThan(STROKE_ANALYSIS.PEN_GAP_THRESHOLD * (200 / 100));

    expect(result!.type).not.toBe('spray');
    expect(result!.segments).toBe(1);
  });
});

/**
 * The number of segments has to be right on its own terms, at whatever gap threshold the
 * constant table currently holds. Seeding the count at 0 and the previous column at -10
 * made the first occupied column a segment only while `gapThreshold` stayed below
 * `firstColumn + 10` - a bound nothing stated and nothing could see. The table pins the
 * gap thresholds by value, so today the bound holds by coincidence; these cases move the
 * threshold to both ends of the range and assert the invariant that has no bound at all.
 *
 * The threshold is moved by writing the exported table, because that table is the only
 * place the gap threshold lives - there is no second knob to inject it through. It is
 * restored in a `finally`, so the contract test that pins these values by number still
 * sees them.
 */
describe('getStrokeAnalysis segment seeding', () => {
  async function withPenGapThreshold(gapThreshold: number, run: () => Promise<void>): Promise<void> {
    const table = STROKE_ANALYSIS as { PEN_GAP_THRESHOLD: number };
    const original = table.PEN_GAP_THRESHOLD;
    table.PEN_GAP_THRESHOLD = gapThreshold;
    try {
      await run();
    } finally {
      table.PEN_GAP_THRESHOLD = original;
    }
  }

  // One column, so the fixture is solid at any threshold: adjacent occupied columns are 1
  // apart, which is a split at a threshold of 0 and is not one at 10, so a stroke several
  // columns wide cannot pin "a solid stroke is one segment" at both ends of the range.
  // The column is the FIRST one in the image, which is what a clip framed on a stroke
  // normally catches.
  const singleColumnStroke = (): ImageDataResult => {
    const image = createImageData(10, 10);
    fillRect(image, { left: 0, top: 0, right: 0, bottom: 9 }, black);
    return image;
  };

  it.each([0, 10])('reports one segment for a solid stroke at a gap threshold of %i', async (gapThreshold) => {
    await withPenGapThreshold(gapThreshold, async () => {
      const image = singleColumnStroke();

      expect(await getStrokeAnalysis(image, captureRegionOf(image))).toEqual({
        type: 'solid',
        segments: 1,
        verticalSpread: 10,
        pixelCount: 10,
      });
    });
  });

  it('reports one segment for a stroke starting at the first column, at a gap threshold of 10', async () => {
    // The exact shape of the old defect, isolated from the scaling. Seeding at `prev = -10`
    // made the first occupied column count as a segment only while
    // `firstColumn - (-10) > gapThreshold`, so a stroke that starts at column 0 - the case a
    // clip framed on a stroke normally catches - reported ZERO segments at a gap threshold
    // of 10, where `10 > 10` is false. `type` tests `segments > 1`, so the classifier
    // returned the self-inconsistent `{ type: 'solid', segments: 0 }`.
    await withPenGapThreshold(10, async () => {
      const image = singleColumnStroke();

      const result = await getStrokeAnalysis(image, captureRegionOf(image));

      expect(result!.segments).toBe(1);
      expect(result!.type).toBe('solid');
    });
  });
});

interface DispatchCase {
  name: string;
  run: (input: Buffer | ImageDataResult) => Promise<unknown>;
  color: Color;
  width: number;
  height: number;
  expected: unknown;
}

const DISPATCH_CASES: DispatchCase[] = [
  {
    name: 'dominantRed',
    run: dominantRed,
    color: RED,
    width: 50,
    height: 50,
    expected: { red: 255, green: 0, blue: 0, count: 2500 },
  },
  { name: 'hasDarkPixels', run: hasDarkPixels, color: DARK_GRAY, width: 50, height: 50, expected: true },
  { name: 'hasRedPixels', run: hasRedPixels, color: RED, width: 50, height: 50, expected: true },
  {
    name: 'getDarkPixelBounds',
    run: getDarkPixelBounds,
    color: DARK_GRAY,
    width: 101,
    height: 101,
    expected: { left: 0, top: 0, right: 100, bottom: 100, width: 101, height: 101, imageWidth: 101, imageHeight: 101 },
  },
  {
    name: 'getSelectionBounds',
    run: getSelectionBounds,
    color: CYAN,
    width: 101,
    height: 101,
    expected: { left: 0, top: 0, right: 100, bottom: 100, imageWidth: 101, imageHeight: 101, centerX: 50, centerY: 50 },
  },
  {
    name: 'getColorAtPoint',
    run: (input) => getColorAtPoint(input, 50, 50),
    color: RED,
    width: 100,
    height: 100,
    expected: { red: 255, green: 0, blue: 0 },
  },
  {
    name: 'getStrokeAnalysis',
    // The region is the CSS size of the clip the image was taken over, which here is the
    // image's own size: the fixture is captured at CSS scale, so the scale is 1 and both
    // sides of the dispatch comparison decode the same 50x5 capture.
    run: (input) => getStrokeAnalysis(input, { width: 50, height: 5 }),
    color: DARK_GRAY,
    width: 50,
    height: 5,
    expected: { type: 'solid', segments: 1, verticalSpread: 5, pixelCount: 250 },
  },
];

describe('Buffer input dispatch', () => {
  it.each(DISPATCH_CASES)(
    '$name decodes a Buffer exactly like decoded image data',
    async ({ run, color, width, height, expected }) => {
      const buffer = await createTestImage(color, width, height);
      const decoded = await loadImageData(buffer);

      const fromBuffer = await run(buffer);
      const fromDecoded = await run(decoded);

      expect(fromBuffer).toEqual(expected);
      expect(fromDecoded).toEqual(expected);
      expect(fromBuffer).toEqual(fromDecoded);
    }
  );
});
