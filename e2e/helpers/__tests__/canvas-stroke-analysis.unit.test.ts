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
