import { describe, it, expect } from 'vitest';
import {
  INK_LUMA_FLOOR,
  STROKE_ANALYSIS,
  dominantRed,
  hasDarkPixels,
  hasRedPixels,
  getDarkPixelBounds,
  getSelectionBounds,
  getColorAtPoint,
  inkHeight,
  inkWidth,
  loadImageData,
  measureInk,
  type ImageDataResult,
} from '../canvas-helpers';
import {
  BLACK,
  CYAN,
  DARK_GRAY,
  GREEN,
  OPAQUE,
  RED,
  TRANSPARENT,
  WHITE,
  createImageData,
  createTestImage,
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

  it('ranks two reds by population, because the sort is what picks the winner', async () => {
    // Every other case here has ONE red in the map, so none of them reaches the comparator at
    // all: `[...colors.values()][0]` on a one-entry array is the same answer as a sort of one
    // entry. Two distinct reds are needed, and the one with FEWER pixels must lose — which is
    // the property that makes the map a tally rather than a set. Insertion order is the wrong
    // one deliberately: the more common red is written second.
    const image = createImageData(10, 10);
    fillRect(image, { left: 0, top: 0, right: 2, bottom: 9 }, RED);
    fillRect(image, { left: 3, top: 0, right: 9, bottom: 9 }, { red: 200, green: 20, blue: 20 });

    expect(await dominantRed(image)).toEqual({ red: 200, green: 20, blue: 20, count: 70 });
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

  it('returns null for a coordinate that is not a pixel address, rather than a fabricated colour', async () => {
    // A fractional coordinate passes the bounds guard, and then the sample window is
    // translated off the pixel grid. The three cases below are the three ways that goes,
    // measured against this solid-red 100x100 fixture, where `index = (y * width + x) * 4`:
    //
    //   (50, 50.5)     the `.5` cancels against the `* 4`, so the index stays integral and
    //                  the loop reads a real pixel - the one 50 columns to the right of the
    //                  one asked for, and returns its colour. `{red: 255, ...}`.
    //   (50.25, 50.25) `18281 % 4` is 1, so every read is a GREEN or BLUE channel rather
    //                  than a red or an alpha, the transparent-pixel skip cannot fire, and
    //                  the sum is a colour no pixel holds. `{red: 0, green: 0, blue: 255}`.
    //   (0.1, 99.9)    the fractional part does not cancel, so `data[37960.4]` is
    //                  `undefined`; `undefined === 0` is false, so nothing is skipped and
    //                  the sums come back NaN.
    //
    // All three are non-null answers in a function whose contract is that null means
    // "nothing at this point", and every one of them is a colour at a pixel the caller
    // never named.
    const image = solidRed(100, 100);

    for (const [pointX, pointY] of [
      [50, 50.5],
      [50.25, 50.25],
      [0.1, 99.9],
    ] as const) {
      expect(await getColorAtPoint(image, pointX, pointY, 5)).toBeNull();
    }
  });

  it('returns null for a non-finite coordinate', async () => {
    // A non-finite coordinate has no pixel address either, and it reaches the sampler
    // through the same hole: `NaN < 0` and `NaN >= width` are both false, so the bounds
    // guard admits it. It happens to answer null today - Infinity through the guard, NaN
    // through a loop whose bounds never compare true - and this pins that, because a NaN
    // coordinate is what `cssPointToImage` hands a caller whose box has no area.
    const image = solidRed(100, 100);

    expect(await getColorAtPoint(image, Number.NaN, 50, 5)).toBeNull();
    expect(await getColorAtPoint(image, 50, Number.NaN, 5)).toBeNull();
    expect(await getColorAtPoint(image, Number.POSITIVE_INFINITY, 50, 5)).toBeNull();
  });

  it('is unaffected by the guard for an integer coordinate', async () => {
    // The guard rejects non-integers, not integers: the centre of the image, the pixel
    // before it, the last one in range and the first all still sample.
    const image = solidRed(100, 100);

    expect(await getColorAtPoint(image, 50, 50, 5)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(await getColorAtPoint(image, 49, 50, 0)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(await getColorAtPoint(image, 99, 99, 0)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(await getColorAtPoint(image, 0, 0, 0)).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('returns null when every sampled pixel is transparent', async () => {
    expect(await getColorAtPoint(createImageData(100, 100), 50, 50, 5)).toBeNull();
  });

  it('clamps a negative radius to the centre pixel instead of reporting no colour', async () => {
    // A negative radius made `pointY - radius > pointY + radius`, so the loop body never
    // ran and the helper returned null — which means "nothing at this point" to every
    // caller. A misconfigured constant must not read as a legitimate miss. White field
    // with a single red centre, so any radius wider than 0 would average in white.
    const image = createImageData(100, 100);
    fillAll(image, WHITE);
    setPixel(image, 50, 50, RED);

    expect(await getColorAtPoint(image, 50, 50, -5)).toEqual({ red: 255, green: 0, blue: 0 });
    expect(await getColorAtPoint(image, 50, 50, -5)).toEqual(await getColorAtPoint(image, 50, 50, 0));
    expect(await getColorAtPoint(image, 50, 50, -1)).toEqual(await getColorAtPoint(image, 50, 50, 0));
  });

  it('still reports no colour for a negative radius when the centre pixel is transparent', async () => {
    // The clamp fixes the radius, not the sample: null here means the centre really is
    // empty, which is the only case where null is the honest answer.
    const image = createImageData(100, 100);
    fillAll(image, WHITE, TRANSPARENT);
    setPixel(image, 50, 50, RED, TRANSPARENT);

    expect(await getColorAtPoint(image, 50, 50, -5)).toBeNull();
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

/**
 * THE EXPORT ORACLE'S INSTRUMENT, and the reason it exists.
 *
 * `compareScreenshots` counts differing pixels against a budget, and for a long horizontal
 * stroke that budget is wildly asymmetric: shifting a 174x11 band one pixel sideways relights
 * only the two round caps, so on the committed baseline a 1.0-document-pixel horizontal shift
 * produces 88 diff pixels and PASSES the 100-pixel budget while the same shift vertically
 * produces 741 and fails. `measureInk` has no such blind spot — which is only true if it really
 * tracks a sub-pixel shift, so the shift is asserted rather than asserted ABOUT in a docstring.
 * `e2e/adjustments.spec.ts:91` and `e2e/export/helpers.ts:224-237` are the two callers, and
 * `assertExportGeometry` is what stands or falls on the centroid case below.
 */
describe('measureInk', () => {
  const PAPER = 255;
  /** What `measureInk` treats as 255-paper, from `INK_LUMA_FLOOR`. Derived, not typed twice. */
  const PAPER_LUMA = PAPER - INK_LUMA_FLOOR;

  /** A horizontal band of black on white, `left`..`left + width - 1`, `rows` tall. */
  const band = (left: number, top: number, width: number, rows: number): ImageDataResult => {
    const image = createImageData(200, 20);
    fillRect(image, { left, top, right: left + width - 1, bottom: top + rows - 1 }, BLACK);
    return image;
  };

  it('weights a pixel by its alpha, so a translucent mark weighs half of an opaque one', async () => {
    // The claim at the weight line: `((paper - luma) * alpha) / 255`. Pure black at alpha 255
    // carries the full `paper - 0 = 247`; at alpha 128 it carries 247 * 128/255 of that. Asserted
    // as the exact ratio rather than as "about half", because "about half" would also pass for
    // a linear-ramp weighting that is not the one in the code.
    const opaque = createImageData(1, 1);
    setPixel(opaque, 0, 0, BLACK, OPAQUE);
    const translucent = createImageData(1, 1);
    setPixel(translucent, 0, 0, BLACK, 128);

    const opaqueProfile = await measureInk(opaque);
    const translucentProfile = await measureInk(translucent);

    expect(opaqueProfile!.ink).toBeCloseTo(PAPER_LUMA, 6);
    expect(translucentProfile!.ink).toBeCloseTo((PAPER_LUMA * 128) / PAPER, 6);
    expect(translucentProfile!.ink / opaqueProfile!.ink).toBeCloseTo(128 / PAPER, 9);
  });

  it('drops a pixel whose weight is zero or less, which is the paper boundary', async () => {
    // `paper` is `255 - INK_LUMA_FLOOR` (247), and the weight is `paper - luma`. So luma 247
    // weighs EXACTLY zero and is dropped by the `<= 0` test; luma 246 weighs 1 and is kept. A
    // `< 0` test instead of `<= 0` would admit the zero-weight pixel and count it in
    // `pixelCount`, which is one of the numbers `assertExportGeometry` compares.
    const atThePaper = createImageData(1, 1);
    setPixel(atThePaper, 0, 0, gray(PAPER_LUMA));
    const oneDarker = createImageData(1, 1);
    setPixel(oneDarker, 0, 0, gray(PAPER_LUMA - 1));

    expect(await measureInk(atThePaper)).toBeNull();
    const profile = await measureInk(oneDarker);
    expect(profile!.ink).toBeCloseTo(1, 9);
    expect(profile!.pixelCount).toBe(1);
  });

  it('returns null for a blank page and for an empty image, which are different answers', async () => {
    // The docstring's contract: null means "no ink at all", a legitimate blank export. The two
    // fixtures reach it through different arms — every pixel transparent (`alpha === 0`) and
    // every pixel at or above the paper (`weight <= 0`) — so both are pinned.
    const paper = createImageData(8, 8);
    fillAll(paper, WHITE);

    expect(await measureInk(createImageData(8, 8))).toBeNull();
    expect(await measureInk(paper)).toBeNull();
    expect(await measureInk({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toBeNull();
  });

  it('tracks a horizontal shift of exactly one document pixel', async () => {
    // THE LOAD-BEARING CASE. `assertExportGeometry` compares measured centroids against the
    // committed baselines, and the whole reason `measureInk` was written is that the pixel-diff
    // oracle it replaced was ~110x looser on this axis. One image pixel at one CSS pixel per
    // image pixel is a one-document-pixel shift, because the capture is at CSS scale.
    const base = band(20, 8, 160, 3);
    const shifted = band(21, 8, 160, 3);

    const before = await measureInk(base);
    const after = await measureInk(shifted);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.centroidX - before!.centroidX).toBeCloseTo(1, 9);
    // And the axis the old oracle COULD see is equally blind here, which is the property that
    // makes the centroid a replacement rather than an addition.
    expect(after!.centroidY).toBe(before!.centroidY);
    expect(after!.spreadX).toBeCloseTo(before!.spreadX, 9);
    expect(after!.spreadY).toBe(before!.spreadY);
  });

  it('resolves the centroid on the pixel-centre convention, so a one-pixel mark is at 0.5', async () => {
    // The `x + 0.5` at the accumulation line, which is what makes a sub-pixel centroid possible
    // at all: without it every centroid would be a whole number and the measurement would
    // quantise exactly where the diff oracle did not.
    const image = createImageData(4, 4);
    setPixel(image, 1, 2, BLACK);

    const profile = await measureInk(image);

    expect(profile!.centroidX).toBe(1.5);
    expect(profile!.centroidY).toBe(2.5);
  });

  it('reports zero spread for a single pixel, and NaN is the failure this was checked against', async () => {
    // `Math.max(0, E[x²] - E[x]²)` guards against catastrophic cancellation, and a single pixel
    // is the minimum case: the quantity it guards is exactly zero. A NaN spread reaches
    // `assertExportGeometry` as a comparison against a tolerance, which is always false, so the
    // failure would be a hard red rather than a wrong pass — but a red that says nothing about
    // the geometry.
    //
    // WHAT IS NOT CLAIMED HERE. The guard cannot be shown to be load-bearing by any fixture of
    // a capturable size. The unguarded expression goes negative only when the ink-weighted mean
    // is near-zero variance AT A LARGE COORDINATE, and measuring that needs roughly 1e5 ink
    // pixels at column 8000 or beyond — an image over 8e8 pixels, which no `page.screenshot`
    // produces and which would not fit the heap. Small images with mixed weights were searched
    // to 2e6 pixels and across both axes without finding one. So the guard is defensive, this
    // case pins the contract it protects (a zero-variance profile reports 0, never NaN), and
    // the fact that the guard itself is unreachable at capture sizes is recorded here rather
    // than left as an assumption.
    const image = createImageData(4, 4);
    setPixel(image, 2, 1, BLACK);

    const profile = await measureInk(image);

    expect(profile!.spreadX).toBe(0);
    expect(profile!.spreadY).toBe(0);
    expect(Number.isNaN(profile!.spreadX)).toBe(false);
    expect(Number.isNaN(profile!.spreadY)).toBe(false);
  });

  it('carries the image size alongside the measurements, since a 2x capture is twice as wide', async () => {
    const profile = await measureInk(band(20, 8, 160, 3));

    expect(profile!.imageWidth).toBe(200);
    expect(profile!.imageHeight).toBe(20);
    expect(profile!.pixelCount).toBe(160 * 3);
    expect(profile!.left).toBe(20);
    expect(profile!.right).toBe(179);
    expect(profile!.top).toBe(8);
    expect(profile!.bottom).toBe(10);
  });

  it('measures a Buffer exactly like decoded image data', async () => {
    const buffer = await createTestImage(BLACK, 12, 4);
    const decoded = await loadImageData(buffer);

    expect(await measureInk(buffer)).toEqual(await measureInk(decoded));
  });

  it('exposes the span accessors as right-minus-left, not as a CSS size', async () => {
    // Both are `[IMAGE]` pixels, so a caller converting to CSS has to divide by the capture
    // scale itself. `inkWidth`/`inkHeight` are what `e2e/export/helpers.ts:236-237` compares
    // against the committed baseline, so the "+1" inclusive convention is pinned on a fixture
    // whose inclusive edges are not symmetric: a mark on columns 20..24 is FIVE columns wide.
    const image = createImageData(40, 40);
    fillRect(image, { left: 20, top: 5, right: 24, bottom: 9 }, BLACK);

    const profile = await measureInk(image);

    expect(inkWidth(profile!)).toBe(5);
    expect(inkHeight(profile!)).toBe(5);
    expect(inkWidth(profile!)).toBe(profile!.right - profile!.left + 1);
    expect(inkHeight(profile!)).toBe(profile!.bottom - profile!.top + 1);
  });

  it('has one floor, and it is the constant every export measurement was taken with', async () => {
    // `options.floor` used to let a caller change this and is gone: no caller in `e2e/` ever
    // passed it, so it was a second place for the same number to disagree with itself. The
    // measurement it was supposed to justify — that a floor of 8 trims JPEG's ringing from
    // `112..295` to the `118..292` every format agrees on — is about the EXPORT formats, which
    // `e2e/export/helpers.ts` decodes and hands over unchanged. Pinning the constant is what
    // stops a future edit from quietly moving every baseline at once.
    expect(INK_LUMA_FLOOR).toBe(8);
    // And the value is derived from it rather than from a second literal in the loop.
    const profile = await measureInk(band(20, 8, 160, 3));
    expect(profile!.ink).toBeCloseTo(160 * 3 * PAPER_LUMA, 6);
  });
});
