import { describe, it, expect } from 'vitest';
import {
  STROKE_ANALYSIS,
  dominantRed,
  hasDarkPixels,
  hasRedPixels,
  getDarkPixelBounds,
  getSelectionBounds,
  getColorAtPoint,
  type ImageDataResult,
} from '../canvas-helpers';
import {
  CYAN,
  DARK_GRAY,
  GREEN,
  OPAQUE,
  RED,
  TRANSPARENT,
  WHITE,
  createImageData,
  createTestImageData,
  fillAll,
  fillRect,
  setPixel,
  type Color,
} from './canvas-helpers.fixtures';

const { DARK_THRESHOLD, DARK_PIXEL_THRESHOLD, NEAR_WHITE_THRESHOLD, RED_PIXEL_RED_MIN, RED_PIXEL_GREEN_MAX } =
  STROKE_ANALYSIS;

const gray = (level: number): Color => ({ red: level, green: level, blue: level });

describe('dominantRed', () => {
  const NON_RED: { name: string; color: Color; alpha?: number }[] = [
    { name: 'white', color: WHITE },
    { name: 'non-dominant green', color: { red: 100, green: 200, blue: 50 } },
    { name: 'fully transparent red', color: RED, alpha: 0 },
  ];

  it('reports the dominant red with its pixel count', async () => {
    expect(await dominantRed(await createTestImageData(RED))).toEqual({ red: 255, green: 0, blue: 0, count: 2500 });
  });

  it('reports a single red pixel for a 1x1 image', async () => {
    expect(await dominantRed(await createTestImageData(RED, 1, 1))).toEqual({ red: 255, green: 0, blue: 0, count: 1 });
  });

  it.each(NON_RED)('returns null for $name', async ({ color, alpha }) => {
    expect(await dominantRed(await createTestImageData(color, 50, 50, alpha))).toBeNull();
  });

  it('counts only the red pixels of a mixed image', async () => {
    const image = createImageData(4, 2);
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [3, 0],
    ] as const)
      setPixel(image, x, y, RED);
    for (const [x, y] of [
      [2, 0],
      [0, 1],
      [1, 0],
      [2, 1],
      [3, 1],
    ] as const)
      setPixel(image, x, y, GREEN);

    expect(await dominantRed(image)).toEqual({ red: 255, green: 0, blue: 0, count: 3 });
  });

  // PIN: current behavior counts alpha 128 at full weight (source only skips alpha === 0).
  it('counts partially transparent red pixels', async () => {
    const image = createImageData(3, 1);
    setPixel(image, 0, 0, RED, 128);
    setPixel(image, 1, 0, RED);
    setPixel(image, 2, 0, GREEN);

    expect(await dominantRed(image)).toEqual({ red: 255, green: 0, blue: 0, count: 2 });
  });
});

describe('hasDarkPixels', () => {
  const DARK_CASES: { name: string; color: Color; expected: boolean }[] = [
    { name: 'near black', color: DARK_GRAY, expected: true },
    { name: 'white', color: WHITE, expected: false },
    { name: 'light gray', color: gray(200), expected: false },
    { name: 'exactly the dark threshold', color: gray(DARK_PIXEL_THRESHOLD), expected: false },
    { name: 'one below the dark threshold', color: gray(DARK_PIXEL_THRESHOLD - 1), expected: true },
  ];

  it.each(DARK_CASES)('is $expected for $name', async ({ color, expected }) => {
    expect(await hasDarkPixels(await createTestImageData(color))).toBe(expected);
  });

  it('ignores dark pixels that are fully transparent', async () => {
    expect(await hasDarkPixels(await createTestImageData({ red: 0, green: 0, blue: 0 }, 10, 10, 0))).toBe(false);
  });

  it('finds a single dark pixel among light ones', async () => {
    const image = createImageData(10, 10);
    fillAll(image, WHITE);
    setPixel(image, 7, 3, { red: 0, green: 0, blue: 0 });

    expect(await hasDarkPixels(image)).toBe(true);
  });
});

describe('hasRedPixels', () => {
  const RED_CASES: { name: string; color: Color; expected: boolean }[] = [
    { name: 'pure red', color: RED, expected: true },
    { name: 'white', color: WHITE, expected: false },
    { name: 'red below the minimum', color: { red: RED_PIXEL_RED_MIN - 80, green: 50, blue: 50 }, expected: false },
    { name: 'red at the minimum', color: { red: RED_PIXEL_RED_MIN, green: 50, blue: 50 }, expected: false },
    { name: 'red just above the minimum', color: { red: RED_PIXEL_RED_MIN + 1, green: 50, blue: 50 }, expected: true },
    { name: 'green at the maximum', color: { red: 200, green: RED_PIXEL_GREEN_MAX, blue: 50 }, expected: false },
    {
      name: 'green just below the maximum',
      color: { red: 200, green: RED_PIXEL_GREEN_MAX - 1, blue: 50 },
      expected: true,
    },
    {
      name: 'pink with green above the maximum',
      color: { red: 255, green: RED_PIXEL_GREEN_MAX + 50, blue: 100 },
      expected: false,
    },
  ];

  it.each(RED_CASES)('is $expected for $name', async ({ color, expected }) => {
    expect(await hasRedPixels(await createTestImageData(color))).toBe(expected);
  });

  it('ignores red pixels that are fully transparent', async () => {
    expect(await hasRedPixels(await createTestImageData(RED, 10, 10, 0))).toBe(false);
  });
});

describe('getDarkPixelBounds', () => {
  it('measures a dark block', async () => {
    const image = createImageData(100, 100);
    fillRect(image, { left: 20, top: 20, right: 79, bottom: 79 }, DARK_GRAY);

    expect(await getDarkPixelBounds(image)).toEqual({
      left: 20,
      top: 20,
      right: 79,
      bottom: 79,
      width: 60,
      height: 60,
      imageWidth: 100,
      imageHeight: 100,
    });
  });

  it('returns null for a white image', async () => {
    expect(await getDarkPixelBounds(await createTestImageData(WHITE, 50, 50))).toBeNull();
  });

  it('returns null for a fully transparent image', async () => {
    expect(await getDarkPixelBounds(createImageData(50, 50))).toBeNull();
  });

  const DARK_BOUNDARY_CASES: { name: string; level: number; expected: boolean }[] = [
    { name: 'one above the threshold', level: DARK_THRESHOLD + 1, expected: false },
    { name: 'exactly at the threshold', level: DARK_THRESHOLD, expected: false },
    { name: 'one below the threshold', level: DARK_THRESHOLD - 1, expected: true },
  ];

  it.each(DARK_BOUNDARY_CASES)('treats a pixel $name as dark=$expected', async ({ level, expected }) => {
    const image = createImageData(50, 50);
    setPixel(image, 25, 25, gray(level));
    const result = await getDarkPixelBounds(image);

    if (!expected) {
      expect(result).toBeNull();
      return;
    }
    expect(result).toEqual({
      left: 25,
      top: 25,
      right: 25,
      bottom: 25,
      width: 1,
      height: 1,
      imageWidth: 50,
      imageHeight: 50,
    });
  });

  it('returns a one-pixel box for a single dark pixel in the top-left corner', async () => {
    const image = createImageData(5, 5);
    setPixel(image, 0, 0, { red: 0, green: 0, blue: 0 });

    expect(await getDarkPixelBounds(image)).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 1,
      height: 1,
      imageWidth: 5,
      imageHeight: 5,
    });
  });

  it('returns a one-pixel box for a single dark pixel in the bottom-right corner', async () => {
    const image = createImageData(5, 5);
    setPixel(image, 4, 4, { red: 0, green: 0, blue: 0 });

    expect(await getDarkPixelBounds(image)).toEqual({
      left: 4,
      top: 4,
      right: 4,
      bottom: 4,
      width: 1,
      height: 1,
      imageWidth: 5,
      imageHeight: 5,
    });
  });

  it('spans disconnected dark regions', async () => {
    const image = createImageData(10, 10);
    setPixel(image, 1, 1, { red: 0, green: 0, blue: 0 });
    setPixel(image, 8, 7, { red: 0, green: 0, blue: 0 });

    expect(await getDarkPixelBounds(image)).toEqual({
      left: 1,
      top: 1,
      right: 8,
      bottom: 7,
      width: 8,
      height: 7,
      imageWidth: 10,
      imageHeight: 10,
    });
  });

  it('ignores dark pixels that are fully transparent', async () => {
    const image = createImageData(8, 8);
    setPixel(image, 2, 2, { red: 0, green: 0, blue: 0 }, TRANSPARENT);
    expect(await getDarkPixelBounds(image)).toBeNull();
  });
});

describe('getSelectionBounds', () => {
  const THRESHOLDS = { redMax: 100, greenMin: 100, blueMin: 200 };

  it('detects the selection colour with the default thresholds', async () => {
    const image = createImageData(100, 100);
    fillRect(image, { left: 10, top: 10, right: 89, bottom: 89 }, CYAN);

    expect(await getSelectionBounds(image)).toEqual({
      left: 10,
      top: 10,
      right: 89,
      bottom: 89,
      imageWidth: 100,
      imageHeight: 100,
      centerX: 50,
      centerY: 50,
    });
  });

  it('returns null when no pixel matches', async () => {
    expect(await getSelectionBounds(await createTestImageData(RED, 50, 50))).toBeNull();
  });

  it('uses custom thresholds for a lighter blue', async () => {
    const image = createImageData(50, 50);
    fillAll(image, { red: 100, green: 150, blue: 200 });

    expect(await getSelectionBounds(image, THRESHOLDS)).toEqual({
      left: 0,
      top: 0,
      right: 49,
      bottom: 49,
      imageWidth: 50,
      imageHeight: 50,
      centerX: 25,
      centerY: 25,
    });
  });

  const THRESHOLD_CASES: { name: string; color: Color; expected: boolean }[] = [
    { name: 'exactly on every threshold', color: { red: 100, green: 100, blue: 200 }, expected: true },
    { name: 'red above the maximum', color: { red: 101, green: 100, blue: 200 }, expected: false },
    { name: 'green below the minimum', color: { red: 100, green: 99, blue: 200 }, expected: false },
    { name: 'blue below the minimum', color: { red: 100, green: 100, blue: 199 }, expected: false },
  ];

  it.each(THRESHOLD_CASES)('matches=$expected for a pixel $name', async ({ color, expected }) => {
    const image = createImageData(3, 1);
    setPixel(image, 1, 0, color);
    const result = await getSelectionBounds(image, THRESHOLDS);
    expect(result !== null).toBe(expected);
  });

  it('excludes a matching colour that is fully transparent', async () => {
    const image = createImageData(3, 1);
    setPixel(image, 1, 0, CYAN, TRANSPARENT);
    expect(await getSelectionBounds(image)).toBeNull();
  });
});

describe('getColorAtPoint', () => {
  const solidRed = (width: number, height: number): ImageDataResult => {
    const image = createImageData(width, height);
    fillAll(image, RED);
    return image;
  };

  it('returns the colour at the point', async () => {
    expect(await getColorAtPoint(solidRed(100, 100), 50, 50, 5)).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('samples only the centre pixel when the radius is zero', async () => {
    const image = createImageData(100, 100);
    fillAll(image, WHITE);
    setPixel(image, 50, 50, RED);

    expect(await getColorAtPoint(image, 50, 50, 0)).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('averages the neighbourhood using the default radius when none is given', async () => {
    const image = solidRed(100, 100);
    fillRect(image, { left: 49, top: 49, right: 51, bottom: 51 }, GREEN);

    expect(await getColorAtPoint(image, 50, 50, 0)).toEqual({ red: 0, green: 255, blue: 0 });

    const averaged = await getColorAtPoint(image, 50, 50);
    expect(averaged).toEqual(await getColorAtPoint(image, 50, 50, STROKE_ANALYSIS.COLOR_SAMPLE_RADIUS));
    expect(averaged!.red).toBeGreaterThan(0);
    expect(averaged!.green).toBeGreaterThan(0);
  });

  it('returns null outside the image', async () => {
    const image = solidRed(100, 100);
    expect(await getColorAtPoint(image, -1, 50, 5)).toBeNull();
    expect(await getColorAtPoint(image, 100, 100, 5)).toBeNull();
    expect(await getColorAtPoint(image, 50, -1, 5)).toBeNull();
    expect(await getColorAtPoint(image, 50, 100, 5)).toBeNull();
  });

  it('returns null when every sampled pixel is transparent', async () => {
    expect(await getColorAtPoint(createImageData(100, 100), 50, 50, 5)).toBeNull();
  });

  it('returns null for a negative radius instead of sampling the centre', async () => {
    expect(await getColorAtPoint(solidRed(100, 100), 50, 50, -5)).toBeNull();
  });

  it('clamps a radius that reaches past every image edge', async () => {
    const topLeft = createImageData(10, 10);
    setPixel(topLeft, 0, 0, RED);
    const bottomRight = createImageData(10, 10);
    setPixel(bottomRight, 9, 9, { red: 10, green: 200, blue: 30 });

    expect(await getColorAtPoint(topLeft, 0, 0, 100)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(await getColorAtPoint(bottomRight, 9, 9, 100)).toEqual({ red: 10, green: 200, blue: 30 });
  });

  it('averages only the opaque pixels inside the radius, skipping fully transparent ones', async () => {
    // The 11x11 window around (50, 50) is 6 opaque red columns (66 px), 5 opaque green
    // columns (30 px) and a 25 px fully transparent hole that still carries white RGB —
    // the shape decoded screenshots actually have over erased regions. Counting the hole
    // would give 192/116/53 instead of 175/80/0, so the exact averages below can only hold
    // while `alpha === 0` is skipped.
    const image = createImageData(100, 100);
    fillRect(image, { left: 45, top: 45, right: 50, bottom: 55 }, RED);
    fillRect(image, { left: 51, top: 50, right: 55, bottom: 55 }, GREEN);
    fillRect(image, { left: 51, top: 45, right: 55, bottom: 49 }, WHITE, TRANSPARENT);

    expect(await getColorAtPoint(image, 50, 50, 5)).toEqual({ red: 175, green: 80, blue: 0 });
    expect(await getColorAtPoint(image, 53, 47, 0)).toBeNull();
  });

  it('ignores near-white pixels when asked', async () => {
    const image = createImageData(100, 100);
    fillAll(image, WHITE);

    expect(
      await getColorAtPoint(image, 50, 50, 5, { ignoreNearWhite: true, nearWhiteThreshold: NEAR_WHITE_THRESHOLD })
    ).toBeNull();
    expect(await getColorAtPoint(image, 50, 50, 5, { ignoreNearWhite: true })).toBeNull();
  });

  it('respects a custom near-white threshold', async () => {
    const image = await createTestImageData(gray(220), 100, 100);

    expect(await getColorAtPoint(image, 50, 50, 5, { ignoreNearWhite: true })).toEqual({
      red: 220,
      green: 220,
      blue: 220,
    });
    expect(await getColorAtPoint(image, 50, 50, 5, { ignoreNearWhite: true, nearWhiteThreshold: 200 })).toBeNull();
  });

  it('weights a blended sample by the pixels it actually covers', async () => {
    const image = createImageData(100, 100);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 50; x++) {
        const index = (y * 100 + x) * 4;
        const isRed = x < 25;
        image.data[index] = isRed ? 255 : 0;
        image.data[index + 1] = isRed ? 0 : 255;
        image.data[index + 2] = 0;
        image.data[index + 3] = OPAQUE;
      }
    }

    const redColumns = 5;
    const greenColumns = 6;
    const result = await getColorAtPoint(image, 25, 50, 5);

    expect(result).not.toBeNull();
    expect(result!.blue).toBe(0);
    expect(result!.red).toBeGreaterThan(0);
    expect(result!.red).toBeLessThan(255);
    expect(result!.green).toBeGreaterThan(result!.red);
    expect(result!.green / result!.red).toBeCloseTo(greenColumns / redColumns, 1);
  });
});
