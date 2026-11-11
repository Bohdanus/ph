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
  hasMagnetSnapPixels,
  hasManualSnapPixels,
  type CaptureRegion,
  type ImageDataResult,
  WHOLE_CAPTURE,
  viewportClip,
} from '../canvas-helpers';
import {
  CYAN,
  DARK_GRAY,
  RED,
  SPRAY_GRAY,
  TRANSPARENT,
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
  ['MAGNET_SNAP_RED_MAX', 60],
  ['MAGNET_SNAP_GREEN_MIN', 120],
  ['MAGNET_SNAP_BLUE_MAX', 160],
  ['MANUAL_SNAP_RED_MIN', 180],
  ['MANUAL_SNAP_GREEN_MIN', 90],
  ['MANUAL_SNAP_BLUE_MAX', 90],
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
      await getStrokeAnalysis(
        { width: 0, height: 0, data: new Uint8ClampedArray(0) },
        {
          width: 10,
          height: 10,
          mask: WHOLE_CAPTURE,
        }
      )
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

  it('includes mid-tone ink when the captured tool is Spray', async () => {
    const image = await createTestImageData(gray(128), 100, 40);
    const region = captureRegionOf(image);

    expect(await getStrokeAnalysis(image, region)).toBeNull();
    expect(await getStrokeAnalysis(image, region, { tool: 'spray' })).toEqual({
      type: 'spray',
      segments: 1,
      verticalSpread: 40,
      pixelCount: 4000,
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

    await expect(getStrokeAnalysis(image, { width: 0, height: 10, mask: WHOLE_CAPTURE })).rejects.toThrow(
      /positive CSS size/
    );
    await expect(getStrokeAnalysis(image, { width: 10, height: 0, mask: WHOLE_CAPTURE })).rejects.toThrow(
      /positive CSS size/
    );
    await expect(getStrokeAnalysis(image, { width: Number.NaN, height: 10, mask: WHOLE_CAPTURE })).rejects.toThrow(
      /positive CSS size/
    );
    await expect(
      getStrokeAnalysis(image, { width: Number.POSITIVE_INFINITY, height: 10, mask: WHOLE_CAPTURE })
    ).rejects.toThrow(/positive CSS size/);
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

    expect(await getStrokeAnalysis(image, { width: 10, height: 10, mask: WHOLE_CAPTURE })).toBeNull();
  });
});

/**
 * Spatial masks remove both themes' workspace backdrops without confusing document ink with
 * checkerboard gaps or antialiased cell edges.
 */
describe('getStrokeAnalysis uses document geometry for workspace backdrops', () => {
  const capture = viewportClip({ x: 0, y: 0, width: 100, height: 80 });
  const document = viewportClip({ x: 20, y: 20, width: 60, height: 40 });
  const mask = { capture, document };
  const region: CaptureRegion = { width: capture.width, height: capture.height, mask };
  const { LETTERBOX_DARK_CELL, LETTERBOX_LIGHT_CELL } = STROKE_ANALYSIS;

  function backdrop(theme: 'dark' | 'light'): ImageDataResult {
    const image = createImageData(100, 80);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const checker = Math.floor(x / 10) % 2 === Math.floor(y / 10) % 2;
        const edgeBlend = x % 10 === 0 || y % 10 === 0;
        const edge = theme === 'dark' ? { red: 1, green: 1, blue: 1 } : { red: 249, green: 249, blue: 249 };
        const cell = theme === 'dark' ? LETTERBOX_DARK_CELL : LETTERBOX_LIGHT_CELL;
        const gap = theme === 'dark' ? black : WHITE;
        setPixel(image, x, y, edgeBlend ? edge : checker ? cell : gap);
      }
    }
    fillRect(image, { left: 20, top: 20, right: 79, bottom: 59 }, WHITE);
    return image;
  }

  it('ignores dark cells, black gaps and antialiased edges outside the document', async () => {
    const image = backdrop('dark');
    expect(await getStrokeAnalysis(image, region)).toBeNull();
  });

  it('ignores light cells, white gaps and antialiased edges outside the document', async () => {
    const image = backdrop('light');
    expect(await getStrokeAnalysis(image, region)).toBeNull();
    expect(await getStrokeAnalysis(image, region, { tool: 'spray' })).toBeNull();
  });

  it('keeps a true #000 document stroke while excluding the surrounding dark checkerboard', async () => {
    const image = backdrop('dark');
    fillRect(image, { left: 40, top: 38, right: 59, bottom: 41 }, black);
    expect(await getStrokeAnalysis(image, region)).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 4,
      pixelCount: 80,
    });
  });

  it('keeps bright spray pixels in the document while excluding the light checkerboard', async () => {
    const image = backdrop('light');
    fillRect(image, { left: 35, top: 25, right: 64, bottom: 55 }, { red: 204, green: 204, blue: 204 });
    expect((await getStrokeAnalysis(image, region))?.type).toBe('spray');
  });

  it('maps the same spatial mask at 2x device scale without moving captured bounds', async () => {
    const image = backdrop('dark');
    fillRect(image, { left: 40, top: 38, right: 59, bottom: 41 }, black);
    const doubled = captureAtScale(image, 2);

    expect(await hasDarkPixels(doubled, mask)).toBe(true);
    expect(await getDarkPixelBounds(doubled, mask)).toMatchObject({ left: 80, right: 119, top: 76, bottom: 83 });
    expect(await getStrokeAnalysis(doubled, region)).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 8,
      pixelCount: 320,
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
 * cdp-helpers.spec.ts pins that for the Playwright-backed helper path, and every fixture above is a whole-number
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
  const REGION: CaptureRegion = { width: 100, height: 50, mask: WHOLE_CAPTURE };

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
  {
    name: 'hasDarkPixels',
    run: (input) => hasDarkPixels(input, WHOLE_CAPTURE),
    color: DARK_GRAY,
    width: 50,
    height: 50,
    expected: true,
  },
  { name: 'hasRedPixels', run: hasRedPixels, color: RED, width: 50, height: 50, expected: true },
  {
    name: 'getDarkPixelBounds',
    run: (input) => getDarkPixelBounds(input, WHOLE_CAPTURE),
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
    run: (input) => getStrokeAnalysis(input, { width: 50, height: 5, mask: WHOLE_CAPTURE }),
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

/**
 * The magnetic lasso paints its snapped preview path one of two colours and the COLOUR is the
 * assertion — it is how a spec reads whether the edge detector engaged. `e2e/README.md`'s
 * "house rule" applies with extra force here: a bound loose enough to accept the other branch,
 * or the tool's own blue guide, would make the Alt contract pass against a build that never
 * switched, so the discrimination is pinned here rather than discovered in a browser.
 *
 * Every colour below is the tool's nominal rgba composited at 0.95 over the suite's pinned
 * LIGHT backdrop, which is what a capture actually contains:
 *
 *   green  rgba(0,170,90,0.95)   -> (13, 174, 98)   over #fff
 *   orange rgba(230,130,0,0.95)  -> (231, 136, 13)  over #fff
 *   guide  rgba(0,123,255,0.95)  -> (13, 129, 255)  over #fff
 *
 * The guide is the case that matters most: it shares this path's GEOMETRY, so a green bound
 * without a red ceiling would match the blue line the tool draws along the same segment.
 */
const MAGNET_COMPOSITE_GREEN: Color = { red: 13, green: 174, blue: 98 };
const MAGNET_COMPOSITE_ORANGE: Color = { red: 231, green: 136, blue: 13 };
const MAGNET_COMPOSITE_GUIDE_BLUE: Color = { red: 13, green: 129, blue: 255 };

const MAGNET_DISCRIMINATION_CASES: { name: string; color: Color; green: boolean; orange: boolean }[] = [
  { name: 'the magnet-snapped preview path', color: MAGNET_COMPOSITE_GREEN, green: true, orange: false },
  { name: 'the Alt-suppressed preview path', color: MAGNET_COMPOSITE_ORANGE, green: false, orange: true },
  // The tool's own guide line, drawn along the same segment as the preview.
  { name: "the tool's blue magnetic guide", color: MAGNET_COMPOSITE_GUIDE_BLUE, green: false, orange: false },
  { name: 'the committed selection path', color: { red: 13, green: 129, blue: 255 }, green: false, orange: false },
  { name: 'a black document stroke', color: black, green: false, orange: false },
  // A red stroke is the case an orange bound loose enough to say "warm ink" would swallow:
  // `e2e/layers.spec.ts` really does paint #ff0000, so if this read as orange a spec drawing
  // red could satisfy a wait for the Alt-suppressed preview without Alt doing anything.
  { name: 'a red document stroke', color: RED, green: false, orange: false },
  { name: 'the white backdrop', color: WHITE, green: false, orange: false },
  // Grey is the trap a bound loose enough to match "some ink" would fall into, and the range
  // between the two composite greens is where an anti-aliased stroke fringe lands.
  { name: 'a mid grey', color: gray(150), green: false, orange: false },
  { name: 'a dark grey', color: gray(100), green: false, orange: false },
  { name: 'the nominal green, uncomposited', color: { red: 0, green: 170, blue: 90 }, green: true, orange: false },
  { name: 'the nominal orange, uncomposited', color: { red: 230, green: 130, blue: 0 }, green: false, orange: true },
];

describe('magnetic lasso preview path discrimination', () => {
  it.each(MAGNET_DISCRIMINATION_CASES)(
    'reads $name as magnet=$green manual=$orange',
    async ({ color, green, orange }) => {
      const image = await createTestImageData(color, 12, 12);
      expect(await hasMagnetSnapPixels(image)).toBe(green);
      expect(await hasManualSnapPixels(image)).toBe(orange);
    }
  );

  it('never reports either colour on an empty capture', async () => {
    const blank = await createTestImageData(WHITE, 20, 20);
    expect(await hasMagnetSnapPixels(blank)).toBe(false);
    expect(await hasManualSnapPixels(blank)).toBe(false);
  });

  it('skips a transparent pixel rather than reading it as black', async () => {
    // A capture with nothing but alpha 0 is the checkerboard's own absence of ink. Read as
    // 0,0,0 it would satisfy a green bound with no upper blue ceiling, so both predicates
    // must skip it — which is also what every other predicate in this file does.
    const transparent = await createTestImageData(WHITE, 8, 8);
    fillAll(transparent, WHITE, TRANSPARENT);
    expect(await hasMagnetSnapPixels(transparent)).toBe(false);
    expect(await hasManualSnapPixels(transparent)).toBe(false);
  });

  it('finds the colour among surrounding document ink', async () => {
    // The predicates scan a whole clip that also contains the artwork, so a green pixel has
    // to survive being surrounded by black and red rather than sitting alone on white.
    const mixed = await createTestImageData(WHITE, 30, 30);
    fillRect(mixed, { left: 0, top: 0, right: 29, bottom: 29 }, black);
    fillRect(mixed, { left: 0, top: 0, right: 14, bottom: 14 }, RED);
    setPixel(mixed, 20, 20, MAGNET_COMPOSITE_GREEN);
    expect(await hasMagnetSnapPixels(mixed)).toBe(true);
    expect(await hasManualSnapPixels(mixed)).toBe(false);

    setPixel(mixed, 20, 20, MAGNET_COMPOSITE_ORANGE);
    expect(await hasMagnetSnapPixels(mixed)).toBe(false);
    expect(await hasManualSnapPixels(mixed)).toBe(true);
  });
});

/**
 * Dark-pixel helpers use the fitted-document mask, retaining black ink while excluding
 * checkerboard cells, gaps and edge blends that can have identical RGB values.
 */
describe('dark pixel helpers apply spatial document masks', () => {
  const capture = viewportClip({ x: 0, y: 0, width: 100, height: 80 });
  const document = viewportClip({ x: 20, y: 20, width: 60, height: 40 });
  const mask = { capture, document };
  const { LETTERBOX_DARK_CELL } = STROKE_ANALYSIS;

  function darkBackdrop(): ImageDataResult {
    const image = createImageData(100, 80);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const checker = Math.floor(x / 10) % 2 === Math.floor(y / 10) % 2;
        const edgeBlend = x % 10 === 0 || y % 10 === 0;
        setPixel(image, x, y, edgeBlend ? { red: 1, green: 1, blue: 1 } : checker ? LETTERBOX_DARK_CELL : black);
      }
    }
    fillRect(image, { left: 20, top: 20, right: 79, bottom: 59 }, WHITE);
    return image;
  }

  it('reports no ink when only the dark checkerboard surrounds a clean document', async () => {
    const image = darkBackdrop();
    expect(await hasDarkPixels(image, mask)).toBe(false);
    expect(await getDarkPixelBounds(image, mask)).toBeNull();
  });

  it('detects #000 document ink and reports bounds relative to the original capture', async () => {
    const image = darkBackdrop();
    fillRect(image, { left: 40, top: 38, right: 59, bottom: 41 }, black);
    expect(await hasDarkPixels(image, mask)).toBe(true);
    expect(await getDarkPixelBounds(image, mask)).toMatchObject({ left: 40, right: 59, top: 38, bottom: 41 });
  });
});

/**
 * P3 — transparent pixels weighted as fully opaque (low confidence). `dominantRed` and
 * `getColorAtPoint` skip only `alpha === 0`, so a pixel at `alpha === 1` but with RGB
 * values that would be invisible when composited is counted at full weight. The
 * `hasDarkPixels` / `hasRedPixels` pair answer yes/no, so a single nearly-transparent
 * pixel can satisfy them just as an opaque one would — but `getDarkPixelBounds` and
 * `getSelectionBounds` use `a !== 0`, the other half of the byte, so they disagree on
 * the exact boundary. These tests pin all four edges of the divergence.
 */
describe('transparent pixel weighting divergence', () => {
  it('hasDarkPixels answers true for an alpha-1 dark pixel even if it would be invisible over white', async () => {
    // A (0,0,0,1) pixel is black at full alpha — but at 1/255 coverage it composites to
    // ~(254,254,254) over `#fff`, which is paper. The predicate still reports it as dark
    // because it never composites. This is the wrong-pass in miniature: a single antialias
    // fringe row at alpha 1 can satisfy a dark-pixel wait even though the eye sees none.
    const image = createImageData(10, 10);
    fillAll(image, WHITE);
    setPixel(image, 5, 5, black, 1);
    expect(await hasDarkPixels(image, WHOLE_CAPTURE)).toBe(true);
  });

  it('getColorAtPoint averages an alpha-1 pixel at full weight, not composited', async () => {
    // The function reads `(r,g,b,a)` directly and skips only `a === 0`. A pixel with `a: 1`
    // but RGB `(0,0,0)` is averaged as pure black, never composited against a background.
    // This is pinned because `getColorAtPoint` is the only helper that RETURNS a colour
    // to its caller — the other predicates answer yes/no.
    //
    // Radius 0 selects only the target pixel, so the average IS the pixel. If the function
    // composited a-alpha-1 black against white instead, the result would be ~(255,255,255),
    // not (0,0,0).
    const image = createImageData(10, 10);
    fillAll(image, WHITE);
    setPixel(image, 5, 5, black, 1);

    const color = await getColorAtPoint(image, 5, 5, 0, undefined);
    expect(color).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it('getDarkPixelBounds and hasDarkPixels agree on a-equals-0 but diverge at a-equals-1', async () => {
    // `hasDarkPixels` skips `alpha === 0`; `getDarkPixelBounds` skips `a !== 0`. Both
    // skip the same pixels (alpha 0), but the boundary is stated differently: one tests
    // `=== 0`, the other tests `!== 0`. For any alpha EXCEPT 0, both proceed. The
    // divergence is purely in the negation style — but a refactor to `< 0.5` or `> 0`
    // would silently break one without the other.
    const zeroAlpha = createImageData(5, 5);
    fillAll(zeroAlpha, WHITE, TRANSPARENT);

    // Both skip alpha-0 pixels: a fully-transparent dark pixel is invisible to neither.
    expect(await hasDarkPixels(zeroAlpha, WHOLE_CAPTURE)).toBe(false);
    expect(await getDarkPixelBounds(zeroAlpha, WHOLE_CAPTURE)).toBeNull();

    // Both see alpha-1 dark pixels: a (0,0,0,1) pixel is dark to both.
    setPixel(zeroAlpha, 2, 2, black, 1);
    expect(await hasDarkPixels(zeroAlpha, WHOLE_CAPTURE)).toBe(true);
    const bounds = await getDarkPixelBounds(zeroAlpha, WHOLE_CAPTURE);
    expect(bounds).not.toBeNull();
    expect(bounds!.left).toBe(2);
    expect(bounds!.right).toBe(2);
  });

  it('dominantRed weights an alpha-1 pixel as fully opaque, never compositing it', async () => {
    // Like `getColorAtPoint`, `dominantRed` skips only `alpha === 0`. A (255,0,0,1) pixel
    // is dominant red at full alpha even though it composites to ~(255,254,254) over white
    // — which is no longer red-dominant at all. The function never composites, so the
    // weighting divergence is by design, and this test pins it as an intentional limitation.
    const image = await createTestImageData(WHITE, 20, 20);
    setPixel(image, 10, 10, RED, 1);

    const result = await dominantRed(image);
    expect(result).not.toBeNull();
    // If the pixel had been composited against white, red=255 would not dominate.
    expect(result!.red).toBe(255);
    expect(result!.green).toBe(0);
    expect(result!.blue).toBe(0);
  });
});

describe('pixel-analysis edge cases', () => {
  /**
   * OPEN_PROBLEMS.md P3 — transparent pixels weighted as fully opaque.
   * `dominantRed` skips only `alpha === 0`; an alpha-1 pixel with RGB (0,0,0)
   * is averaged as pure black at full weight, never composited against a background.
   */
  it('dominantRed ignores fully-transparent pixels and returns null on an all-transparent image', async () => {
    const image = await createTestImageData(WHITE, 10, 10);
    fillAll(image, black, 0);
    expect(await dominantRed(image)).toBeNull();
  });

  it('dominantRed skips alpha-0 pixels but counts alpha-1 pixels in the same colour group', async () => {
    // RGB (255,0,0) at alpha 1 should be dominant; alpha-0 pixels of the same RGB are skipped.
    const image = await createTestImageData(WHITE, 10, 10);
    setPixel(image, 5, 5, RED, 1);
    const result = await dominantRed(image);
    expect(result).not.toBeNull();
    expect(result!.red).toBe(255);
    expect(result!.green).toBe(0);
    expect(result!.blue).toBe(0);
    expect(result!.count).toBe(1);
  });
});
