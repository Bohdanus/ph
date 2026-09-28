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
    expect(await getStrokeAnalysis(createImageData(10, 10))).toBeNull();
  });

  it('returns null for a zero-sized image', async () => {
    expect(await getStrokeAnalysis({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });

  const NEAR_WHITE_CASES: { name: string; level: number; expectedPixels: number }[] = [
    { name: 'pure white', level: 255, expectedPixels: 0 },
    { name: 'one above the near-white threshold', level: NEAR_WHITE_THRESHOLD + 1, expectedPixels: 0 },
    { name: 'exactly the near-white threshold', level: NEAR_WHITE_THRESHOLD, expectedPixels: 16 },
  ];

  it.each(NEAR_WHITE_CASES)(
    'classifies grey with $name as $expectedPixels stroke pixels',
    async ({ level, expectedPixels }) => {
      const result = await getStrokeAnalysis(await createTestImageData(gray(level), 4, 4));

      if (expectedPixels === 0) {
        expect(result).toBeNull();
        return;
      }
      expect(result).toEqual({ type: 'solid', segments: 1, verticalSpread: 4, pixelCount: expectedPixels });
    }
  );

  it('classifies a dark band as a solid stroke', async () => {
    expect(await getStrokeAnalysis(await createTestImageData(black, 50, 5))).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 5,
      pixelCount: 250,
    });
  });

  it('classifies a single-row stroke as solid with a vertical spread of one', async () => {
    const image = createImageData(10, 1);
    fillAll(image, black);

    expect(await getStrokeAnalysis(image)).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 1,
      pixelCount: 10,
    });
  });

  it('classifies a one-pixel-wide diagonal as solid', async () => {
    const image = createImageData(10, 10);
    for (let step = 0; step < 10; step++) setPixel(image, step, step, black);

    expect(await getStrokeAnalysis(image)).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 10,
      pixelCount: 10,
    });
  });

  it('classifies a one-pixel image as a solid stroke', async () => {
    expect(await getStrokeAnalysis(await createTestImageData(black, 1, 1))).toEqual({
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

    const result = await getStrokeAnalysis(image);
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

    const result = await getStrokeAnalysis(image);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('solid');
    expect(result!.segments).toBe(1);
  });

  it('classifies a full-clip grey wash as spray', async () => {
    expect(await getStrokeAnalysis(await createTestImageData(SPRAY_GRAY, 200, 200))).toEqual({
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

    expect(await getStrokeAnalysis(image)).toEqual({
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

    expect(await getStrokeAnalysis(image)).toEqual({
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

    expect(await getStrokeAnalysis(image)).toEqual({
      type: 'solid',
      segments: 1,
      verticalSpread: 5,
      pixelCount: 235,
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
    run: getStrokeAnalysis,
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
