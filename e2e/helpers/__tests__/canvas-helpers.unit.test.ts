import { describe, it, expect } from 'vitest';
import {
  isBuffer,
  buildClip,
  scanPixelsForBounds,
  screenshotBoundsToCss,
  getSelectionBounds,
  getStrokeAnalysis,
  STROKE_ANALYSIS,
  type BoundingBox,
  type ClipOptions,
  type ImageDataResult,
} from '../canvas-helpers';
import { imageBoundsToCss, type CssBox, type ImageSize } from '../screenshot-scale';
import {
  BLACK,
  OPAQUE,
  RED,
  SPRAY_GRAY,
  TRANSPARENT,
  WHITE,
  createImageData,
  fillAll,
  fillRect,
  setPixel,
  type Color,
} from './canvas-helpers.fixtures';

const DEFAULT_CLIP = { x: 10, y: 20, width: 100, height: 200 };

/** The app's selection colour as documented by getSelectionBounds: RGB ~ (0, 120, 255). */
const SELECTION_CYAN: Color = { red: 0, green: 120, blue: 255 };
/** Cyan-adjacent teal that is deliberately too dark in blue to be a selection handle. */
const LOW_BLUE_TEAL: Color = { red: 0, green: 120, blue: 100 };
const MID_GRAY: Color = { red: 128, green: 128, blue: 128 };

function flatImage(color: Color, width = 8, height = 8, alpha = OPAQUE): ImageDataResult {
  const image = createImageData(width, height);
  fillAll(image, color, alpha);
  return image;
}

function redPixelImage(
  width: number,
  height: number,
  points: ReadonlyArray<readonly [number, number]>
): ImageDataResult {
  const image = createImageData(width, height);
  for (const [x, y] of points) setPixel(image, x, y, { red: 255, green: 0, blue: 0 });
  return image;
}

const PARTIAL_CLIPS: { name: string; clip: ClipOptions; expected: Required<ClipOptions> }[] = [
  { name: 'x only', clip: { x: 50 }, expected: { ...DEFAULT_CLIP, x: 50 } },
  { name: 'y only', clip: { y: 60 }, expected: { ...DEFAULT_CLIP, y: 60 } },
  { name: 'width only', clip: { width: 150 }, expected: { ...DEFAULT_CLIP, width: 150 } },
  { name: 'height only', clip: { height: 250 }, expected: { ...DEFAULT_CLIP, height: 250 } },
  { name: 'y set with x explicitly undefined', clip: { y: 60, x: undefined }, expected: { ...DEFAULT_CLIP, y: 60 } },
  {
    name: 'every field explicitly undefined',
    clip: { x: undefined, y: undefined, width: undefined, height: undefined },
    expected: DEFAULT_CLIP,
  },
];

describe('buildClip', () => {
  it('returns the default when no clip is supplied', () => {
    expect(buildClip(undefined, DEFAULT_CLIP)).toEqual(DEFAULT_CLIP);
  });

  it('returns the default when clip is empty', () => {
    expect(buildClip({}, DEFAULT_CLIP)).toEqual(DEFAULT_CLIP);
  });

  it.each(PARTIAL_CLIPS)('keeps every other field for a partial clip: $name', ({ clip, expected }) => {
    expect(buildClip(clip, DEFAULT_CLIP)).toEqual(expected);
  });

  it('overrides all fields when all are provided', () => {
    expect(buildClip({ x: 1, y: 2, width: 3, height: 4 }, DEFAULT_CLIP)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('keeps explicit zeros instead of falling back to the default', () => {
    expect(buildClip({ x: 0, y: 0, width: 0, height: 0 }, DEFAULT_CLIP)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('scanPixelsForBounds', () => {
  const isRed = (r: number): boolean => r > 200;

  it('reports the documented not-found bounds when nothing matches', async () => {
    const result = await scanPixelsForBounds(createImageData(10, 10), () => false);
    expect(result).toEqual({ left: 10, top: 10, right: -1, bottom: -1, found: false });
  });

  it('finds bounds for a single matching pixel', async () => {
    const result = await scanPixelsForBounds(redPixelImage(10, 10, [[5, 5]]), isRed);
    expect(result).toEqual({ left: 5, top: 5, right: 5, bottom: 5, found: true });
  });

  it('spans every matching pixel', async () => {
    const result = await scanPixelsForBounds(
      redPixelImage(10, 10, [
        [2, 2],
        [5, 5],
        [8, 8],
      ]),
      isRed
    );
    expect(result).toEqual({ left: 2, top: 2, right: 8, bottom: 8, found: true });
  });

  it('skips pixels the predicate rejects on alpha', async () => {
    const image = createImageData(10, 10);
    setPixel(image, 5, 5, { red: 255, green: 0, blue: 0 }, 0);
    const result = await scanPixelsForBounds(image, (r, _g, _b, a) => r > 200 && a > 0);
    expect(result).toEqual({ left: 10, top: 10, right: -1, bottom: -1, found: false });
  });

  it('covers the whole image when every pixel matches', async () => {
    const image = createImageData(10, 10);
    for (let index = 0; index < image.data.length; index += 4) image.data[index] = 255;
    const result = await scanPixelsForBounds(image, isRed);
    expect(result).toEqual({ left: 0, top: 0, right: 9, bottom: 9, found: true });
  });

  it('separates columns from rows on a non-square image', async () => {
    const result = await scanPixelsForBounds(
      redPixelImage(6, 4, [
        [5, 0],
        [0, 3],
      ]),
      isRed
    );
    expect(result).toEqual({ left: 0, top: 0, right: 5, bottom: 3, found: true });
  });

  it('maps a single-column image taller than one pixel', async () => {
    const result = await scanPixelsForBounds(redPixelImage(1, 5, [[0, 2]]), isRed);
    expect(result).toEqual({ left: 0, top: 2, right: 0, bottom: 2, found: true });
  });

  it('maps a single-row image wider than one pixel', async () => {
    const result = await scanPixelsForBounds(redPixelImage(5, 1, [[3, 0]]), isRed);
    expect(result).toEqual({ left: 3, top: 0, right: 3, bottom: 0, found: true });
  });

  it('visits every pixel once with channels in red, green, blue, alpha order', async () => {
    const image = createImageData(2, 2);
    setPixel(image, 0, 0, { red: 11, green: 22, blue: 33 }, 44);
    setPixel(image, 1, 1, { red: 55, green: 66, blue: 77 }, 88);

    const visited: number[][] = [];
    await scanPixelsForBounds(image, (...channels) => {
      visited.push(channels);
      return false;
    });

    expect(visited).toHaveLength(4);
    expect(visited).toEqual(
      expect.arrayContaining([
        [11, 22, 33, 44],
        [55, 66, 77, 88],
      ])
    );
    expect(visited.filter(([red]) => red === 0)).toHaveLength(2);
  });

  it('propagates a predicate error instead of returning partial bounds', async () => {
    const image = redPixelImage(4, 4, [
      [0, 0],
      [3, 3],
    ]);
    await expect(
      scanPixelsForBounds(image, () => {
        throw new Error('predicate exploded');
      })
    ).rejects.toThrow('predicate exploded');
  });
});

describe('isBuffer', () => {
  it('is true for a Buffer', () => {
    expect(isBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  it('is false for decoded image data', () => {
    expect(isBuffer(createImageData(10, 10))).toBe(false);
  });
});

describe('screenshotBoundsToCss', () => {
  const box: BoundingBox = { x: 100, y: 50, width: 400, height: 300 };

  const SCALING_CASES: {
    name: string;
    bounds: Parameters<typeof screenshotBoundsToCss>[0];
    expected: { left: number; top: number; right: number; bottom: number };
  }[] = [
    {
      name: '1:1 image-to-box scaling',
      bounds: { left: 10, top: 20, right: 30, bottom: 40, imageWidth: 400, imageHeight: 300 },
      expected: { left: 110, top: 70, right: 130, bottom: 90 },
    },
    {
      name: 'half-size image (DPR 2)',
      bounds: { left: 20, top: 40, right: 60, bottom: 80, imageWidth: 800, imageHeight: 600 },
      expected: { left: 110, top: 70, right: 130, bottom: 90 },
    },
    {
      name: 'image exactly covering the box',
      bounds: { left: 0, top: 0, right: 10, bottom: 10, imageWidth: 400, imageHeight: 300 },
      expected: { left: 100, top: 50, right: 110, bottom: 60 },
    },
  ];

  it.each(SCALING_CASES)('maps pixels onto the box for $name', ({ bounds, expected }) => {
    expect(screenshotBoundsToCss(bounds, box)).toEqual(expected);
  });

  it.each(SCALING_CASES)('agrees with the shared scaling rule for $name', ({ bounds }) => {
    const image: ImageSize = { width: bounds.imageWidth, height: bounds.imageHeight };
    const target: CssBox = { x: box.x, y: box.y, width: box.width, height: box.height };
    const shared = imageBoundsToCss(image, target, {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    });

    expect(screenshotBoundsToCss(bounds, box)).toEqual(shared);
  });

  it('scales the x and y axes independently', () => {
    const stretched = screenshotBoundsToCss(
      { left: 10, top: 10, right: 20, bottom: 20, imageWidth: 100, imageHeight: 25 },
      box
    );
    expect(stretched).toEqual({ left: 140, top: 170, right: 180, bottom: 290 });
  });

  // The full-extent cases below are the self-consistency property the two
  // downstream callers rely on: whatever size the screenshot came back at, the
  // last sampled pixel — an inclusive edge, not one past it — must land on the
  // last CSS pixel of the rect that was captured.
  it('maps the last inclusive image pixel onto the last CSS pixel when the image size equals the box', () => {
    const result = screenshotBoundsToCss(
      { left: 0, top: 0, right: 399, bottom: 299, imageWidth: 400, imageHeight: 300 },
      box
    );
    expect(result).toEqual({ left: 100, top: 50, right: 499, bottom: 349 });
  });

  it('maps the last inclusive image pixel onto the last CSS pixel for a 2x image, halving every offset', () => {
    const result = screenshotBoundsToCss(
      { left: 0, top: 0, right: 799, bottom: 599, imageWidth: 800, imageHeight: 600 },
      box
    );
    // 0 -> 100, 799 -> 100 + 799/2 = 499.5: exactly half the device-pixel offsets.
    expect(result).toEqual({ left: 100, top: 50, right: 499.5, bottom: 349.5 });
  });

  it('scales only the mismatched axis for an aspect-mismatched image', () => {
    const result = screenshotBoundsToCss(
      { left: 0, top: 0, right: 799, bottom: 299, imageWidth: 800, imageHeight: 300 },
      box
    );
    // Doubled horizontally only: x offsets halve, y offsets pass through untouched.
    expect(result).toEqual({ left: 100, top: 50, right: 499.5, bottom: 349 });
  });

  it('collapses every edge onto the box origin when the box has no area', () => {
    const collapsed: BoundingBox = { x: 37, y: 11, width: 0, height: 0 };
    const result = screenshotBoundsToCss(
      { left: 5, top: 7, right: 90, bottom: 40, imageWidth: 100, imageHeight: 50 },
      collapsed
    );
    expect(result).toEqual({ left: 37, top: 11, right: 37, bottom: 11 });
  });

  it('yields NaN edges for a zero-sized image instead of throwing', () => {
    const result = screenshotBoundsToCss({ left: 0, top: 0, right: 0, bottom: 0, imageWidth: 0, imageHeight: 0 }, box);
    expect(result.left).toBeNaN();
    expect(result.top).toBeNaN();
    expect(result.right).toBeNaN();
    expect(result.bottom).toBeNaN();
  });
});

describe('getStrokeAnalysis gap threshold', () => {
  /**
   * The segment gap threshold must be selected from the same signal that decides
   * `type` (vertical spread). Deriving it from anything else — pixel population,
   * luminance, whichever is convenient — lets the threshold disagree with the
   * classification and silently change `segments` on inputs where the two signals
   * point different ways. These fixtures are built so the signals disagree in both
   * directions, and the gap sits between SPRAY_GAP_THRESHOLD and PEN_GAP_THRESHOLD
   * so the two thresholds must produce different `segments`. Both gap thresholds are
   * pinned by value in canvas-stroke-analysis.unit.test.ts; if they ever crossed, these
   * two fixtures would stop discriminating and both expectations below would fail.
   */
  it('uses the pen gap threshold when spray pixels outnumber dark pixels but the spread is pen-like', async () => {
    // Columns 0-5 spray (24 px), 6-9 near-white, 10-13 dark (16 px): sprayCount
    // (24) > darkCount (16) while verticalSpread (4) stays far below
    // SPRAY_VERTICAL_SPREAD_THRESHOLD. The 5-column jump from 5 to 10 clears
    // SPRAY_GAP_THRESHOLD but not PEN_GAP_THRESHOLD.
    const image = createImageData(14, 4);
    fillRect(image, { left: 0, top: 0, right: 5, bottom: 3 }, SPRAY_GRAY);
    fillRect(image, { left: 6, top: 0, right: 9, bottom: 3 }, WHITE);
    fillRect(image, { left: 10, top: 0, right: 13, bottom: 3 }, BLACK);

    const result = await getStrokeAnalysis(image);

    expect(result).toEqual({ type: 'solid', segments: 1, verticalSpread: 4, pixelCount: 40 });
    expect(result!.verticalSpread).toBeLessThanOrEqual(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD);
  });

  it('uses the spray gap threshold when dark pixels dominate but the spread is spray-like', async () => {
    // No spray pixels at all, yet the 40-row spread exceeds
    // SPRAY_VERTICAL_SPREAD_THRESHOLD, so the 4-column jump from 9 to 13 is
    // bridged only by SPRAY_GAP_THRESHOLD.
    const image = createImageData(20, 40);
    fillRect(image, { left: 0, top: 0, right: 9, bottom: 39 }, BLACK);
    fillRect(image, { left: 10, top: 0, right: 12, bottom: 39 }, WHITE);
    fillRect(image, { left: 13, top: 0, right: 19, bottom: 39 }, BLACK);

    const result = await getStrokeAnalysis(image);

    expect(result!.verticalSpread).toBeGreaterThan(STROKE_ANALYSIS.SPRAY_VERTICAL_SPREAD_THRESHOLD);
    expect(result).toEqual({ type: 'spray', segments: 2, verticalSpread: 40, pixelCount: 680 });
  });
});

describe('getSelectionBounds default thresholds', () => {
  // The defaults (redMax 80, greenMin 80, blueMin 180) are the only thing standing
  // between a real selection-cyan hit and a false positive. Specs that rely on
  // them would otherwise pass for the wrong reason the moment a default drifts, so
  // the accept case and a spread of realistic near-misses are both pinned here.
  it('matches the app selection cyan', async () => {
    const image = createImageData(3, 3);
    setPixel(image, 1, 2, SELECTION_CYAN);

    const result = await getSelectionBounds(image);

    expect(result).toEqual({
      left: 1,
      top: 2,
      right: 1,
      bottom: 2,
      imageWidth: 3,
      imageHeight: 3,
      centerX: 1,
      centerY: 2,
    });
  });

  const NON_SELECTION_COLORS: { name: string; color: Color }[] = [
    { name: 'black', color: BLACK },
    { name: 'white', color: WHITE },
    { name: 'mid grey', color: MID_GRAY },
    { name: 'red', color: RED },
    { name: 'low-blue cyan-ish teal', color: LOW_BLUE_TEAL },
  ];

  it.each(NON_SELECTION_COLORS)('rejects $name with the default thresholds', async ({ color }) => {
    expect(await getSelectionBounds(flatImage(color))).toBeNull();
  });

  const BOUNDARY_CASES: { name: string; color: Color; matched: boolean }[] = [
    { name: 'exactly on all three limits', color: { red: 80, green: 80, blue: 180 }, matched: true },
    { name: 'one red above redMax', color: { red: 81, green: 80, blue: 180 }, matched: false },
    { name: 'one green below greenMin', color: { red: 80, green: 79, blue: 180 }, matched: false },
    { name: 'one blue below blueMin', color: { red: 80, green: 80, blue: 179 }, matched: false },
  ];

  it.each(BOUNDARY_CASES)('treats the limit as inclusive: $name', async ({ color, matched }) => {
    const result = await getSelectionBounds(flatImage(color, 4, 4));
    expect(result !== null).toBe(matched);
  });

  it('rejects a fully transparent selection cyan', async () => {
    expect(await getSelectionBounds(flatImage(SELECTION_CYAN, 4, 4, TRANSPARENT))).toBeNull();
  });

  it('still matches a selection cyan at partial alpha', async () => {
    const result = await getSelectionBounds(flatImage(SELECTION_CYAN, 4, 4, 128));
    expect(result).not.toBeNull();
    expect(result!.left).toBe(0);
    expect(result!.bottom).toBe(3);
  });
});
