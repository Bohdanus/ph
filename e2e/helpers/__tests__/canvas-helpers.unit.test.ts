import { afterEach, describe, it, expect } from 'vitest';
import {
  buildClip,
  canvasOffsetToDocument,
  containFit,
  documentToCanvasOffset,
  dominantRed,
  getColorAtPoint,
  getDarkPixelBounds,
  getSelectionBounds,
  getStrokeAnalysis,
  hasDarkPixels,
  hasRedPixels,
  isBuffer,
  scanPixelsForBounds,
  screenshotBoundsToCss,
  STROKE_ANALYSIS,
  takeLineScreenshot,
  waitForCanvasPixels,
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
  captureRegionOf,
  cleanupTempDirs,
  createImageData,
  createScrollablePage,
  createTestInfoMock,
  fillAll,
  fillRect,
  makeOutputDir,
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
   *
   * Both fixtures are CSS-scale captures of their own size, so the scale the classifier
   * derives is 1 and the thresholds apply unscaled - which is what lets these two compare a
   * 5-column jump against PEN_GAP_THRESHOLD directly. The scale-relative behaviour is
   * covered in canvas-stroke-analysis.unit.test.ts, where the same comparisons are made
   * against a 2x capture of the same stroke.
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

    const result = await getStrokeAnalysis(image, captureRegionOf(image));

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

    const result = await getStrokeAnalysis(image, captureRegionOf(image));

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

/**
 * `onScreenClip` is module-private, so these tests drive it through its two public gates,
 * `waitForCanvasPixels` and `takeLineScreenshot`, and assert on the throw. That is the
 * contract: a clip taller than the viewport is refused BEFORE anything is scrolled or
 * photographed, so a caller asking for a region the page cannot render gets an error
 * naming both numbers instead of a short image at exit 0. See `HANDOFF.md` §242.
 *
 * The default `createScrollablePage` geometry is a window that holds its whole page, so
 * every clip here is already on screen; the only thing under test is the height guard,
 * which runs before the visibility check. The fixture's viewport is 1280x1080 by default,
 * so the short-clip cases below are the ordinary path and exist to prove the guard does
 * not over-refuse.
 */
describe('onScreenClip refuses an over-tall clip', () => {
  const SHORT_VIEWPORT = 720;
  const overTall: Required<ClipOptions> = { x: 0, y: 0, width: 1280, height: 900 };

  it('throws naming the requested height and the viewport height', async () => {
    const harness = createScrollablePage({ viewportHeight: SHORT_VIEWPORT, documentHeight: SHORT_VIEWPORT });

    await expect(waitForCanvasPixels(harness.page, overTall, async () => true, { timeoutMs: 1_000 })).rejects.toThrow(
      `onScreenClip: a screenshot clip cannot be taller than the viewport: requested 900px in a ${SHORT_VIEWPORT}px window`
    );
    // Nothing was scrolled and nothing was photographed: the refusal is at the gate.
    expect(harness.screenshot).not.toHaveBeenCalled();
    expect(harness.scroll.scrollRequests()).toEqual([]);
  });

  it('refuses even when the region is already fully on screen', async () => {
    // The guard runs before the `alreadyVisible` check, so a clip that fits vertically
    // in the page but not in the window is refused regardless of scroll position.
    const harness = createScrollablePage({ viewportHeight: SHORT_VIEWPORT, documentHeight: SHORT_VIEWPORT });

    await expect(waitForCanvasPixels(harness.page, overTall, async () => true, { timeoutMs: 1_000 })).rejects.toThrow(
      /cannot be taller than the viewport/
    );
    expect(harness.screenshot).not.toHaveBeenCalled();
  });

  it('refuses through takeLineScreenshot, which routes every clip the same way', async () => {
    const outputDir = await makeOutputDir('over-tall-line');
    const harness = createScrollablePage({ viewportHeight: SHORT_VIEWPORT, documentHeight: SHORT_VIEWPORT });
    const { testInfo } = createTestInfoMock(outputDir);

    await expect(
      takeLineScreenshot(harness.page, { x: 0, y: 0, width: 1280, height: 1280 }, 'over-tall', testInfo, {
        x: 0,
        y: 0,
        width: 1280,
        height: 900,
      })
    ).rejects.toThrow(/cannot be taller than the viewport/);
    expect(harness.screenshot).not.toHaveBeenCalled();
  });

  it('admits a clip exactly the viewport height', async () => {
    const harness = createScrollablePage({ viewportHeight: SHORT_VIEWPORT, documentHeight: SHORT_VIEWPORT });
    const exact: Required<ClipOptions> = { x: 0, y: 0, width: 1280, height: SHORT_VIEWPORT };

    await expect(
      waitForCanvasPixels(harness.page, exact, async () => true, { timeoutMs: 1_000 })
    ).resolves.toBeUndefined();
    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(harness.clips()).toEqual([exact]);
  });

  it('admits a clip shorter than the viewport and photographs it as given', async () => {
    const harness = createScrollablePage({ viewportHeight: SHORT_VIEWPORT, documentHeight: SHORT_VIEWPORT });
    const short: Required<ClipOptions> = { x: 10, y: 20, width: 120, height: 100 };

    await waitForCanvasPixels(harness.page, short, async () => true, { timeoutMs: 1_000 });
    expect(harness.clips()).toEqual([short]);
  });

  it('admits a clip shorter than the viewport that needs scrolling into view', async () => {
    // Below the fold but NOT over-tall: the guard must not refuse a region the page can
    // render, only one it cannot.
    const harness = createScrollablePage({
      viewportHeight: SHORT_VIEWPORT,
      documentHeight: 1_177,
      initialScrollY: 0,
    });
    const belowTheFold: Required<ClipOptions> = { x: 176, y: 748, width: 320, height: 160 };

    await expect(
      waitForCanvasPixels(harness.page, belowTheFold, async () => true, { timeoutMs: 1_000 })
    ).resolves.toBeUndefined();
    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(harness.clips()[0].y + belowTheFold.height).toBeLessThanOrEqual(SHORT_VIEWPORT);
  });

  afterEach(async () => {
    await cleanupTempDirs();
  });
});

const COORD_BOX: BoundingBox = { x: 100, y: 50, width: 400, height: 300 };

describe('non-finite coordinates', () => {
  describe('containFit', () => {
    it('propagates NaN box dimensions as NaN scale and offsets', () => {
      const result = containFit({ width: Number.NaN, height: 300 });
      expect(result.scale).toBeNaN();
      expect(result.offsetX).toBeNaN();
      expect(result.offsetY).toBeNaN();
    });

    it('propagates Infinity on both axes as an Infinity scale with NaN offsets', () => {
      // Infinity - Infinity is NaN in IEEE 754, so the offset collapses even
      // though the scale is finite-infinite.
      const result = containFit({ width: Infinity, height: Infinity });
      expect(result.scale).toBe(Infinity);
      expect(result.offsetX).toBeNaN();
      expect(result.offsetY).toBeNaN();
    });

    it('collapses to a zero scale from a zero-width box', () => {
      const result = containFit({ width: 0, height: 300 });
      expect(result.scale).toBe(0);
      expect(result.offsetX).toBe(0);
      expect(result.offsetY).toBe(150);
    });
  });

  describe('documentToCanvasOffset', () => {
    it('propagates NaN document coordinates as NaN canvas offsets', () => {
      const result = documentToCanvasOffset(COORD_BOX, Number.NaN, 300);
      expect(result.x).toBeNaN();
      expect(result.y).not.toBeNaN();
    });

    it('propagates Infinity document coordinates', () => {
      const result = documentToCanvasOffset(COORD_BOX, Number.POSITIVE_INFINITY, 300);
      expect(result.x).toBe(Infinity);
      expect(result.y).not.toBe(Infinity);
    });

    it('propagates -Infinity document coordinates', () => {
      const result = documentToCanvasOffset(COORD_BOX, Number.NEGATIVE_INFINITY, 300);
      expect(result.x).toBe(-Infinity);
    });
  });

  describe('canvasOffsetToDocument', () => {
    it('propagates NaN canvas coordinates as NaN document coordinates', () => {
      const result = canvasOffsetToDocument(COORD_BOX, Number.NaN, 300);
      expect(result.x).toBeNaN();
      expect(result.y).not.toBeNaN();
    });

    it('propagates Infinity canvas coordinates', () => {
      const result = canvasOffsetToDocument(COORD_BOX, Number.POSITIVE_INFINITY, 300);
      expect(result.x).toBe(Infinity);
    });

    it('propagates -Infinity canvas coordinates', () => {
      const result = canvasOffsetToDocument(COORD_BOX, Number.NEGATIVE_INFINITY, 300);
      expect(result.x).toBe(-Infinity);
    });
  });

  describe('getColorAtPoint', () => {
    const image = createImageData(100, 100);
    fillAll(image, RED);

    it('returns null for a NaN pointX', async () => {
      expect(await getColorAtPoint(image, Number.NaN, 50, 5)).toBeNull();
    });

    it('returns null for a NaN pointY', async () => {
      expect(await getColorAtPoint(image, 50, Number.NaN, 5)).toBeNull();
    });

    it('returns null for an Infinity pointX', async () => {
      expect(await getColorAtPoint(image, Number.POSITIVE_INFINITY, 50, 5)).toBeNull();
      expect(await getColorAtPoint(image, Number.NEGATIVE_INFINITY, 50, 5)).toBeNull();
    });

    it('returns null for an Infinity pointY', async () => {
      expect(await getColorAtPoint(image, 50, Number.POSITIVE_INFINITY, 5)).toBeNull();
    });
  });
});

describe('zero-sized images', () => {
  const EMPTY_0x0 = createImageData(0, 0);
  const EMPTY_0xN = createImageData(0, 10);
  const EMPTY_Nx0 = createImageData(10, 0);

  it('dominantRed returns null for a 0x0 image', async () => {
    expect(await dominantRed(EMPTY_0x0)).toBeNull();
  });

  it('dominantRed returns null for a zero-width image', async () => {
    expect(await dominantRed(EMPTY_0xN)).toBeNull();
  });

  it('dominantRed returns null for a zero-height image', async () => {
    expect(await dominantRed(EMPTY_Nx0)).toBeNull();
  });

  it('getColorAtPoint returns null for a 0x0 image', async () => {
    expect(await getColorAtPoint(EMPTY_0x0, 0, 0, 5)).toBeNull();
  });

  it('getColorAtPoint returns null for a zero-width image', async () => {
    expect(await getColorAtPoint(EMPTY_0xN, 0, 0, 5)).toBeNull();
  });

  it('getColorAtPoint returns null for a zero-height image', async () => {
    expect(await getColorAtPoint(EMPTY_Nx0, 0, 0, 5)).toBeNull();
  });

  it('scanPixelsForBounds returns the not-found sentinel for a 0x0 image', async () => {
    // left = width = 0, top = height = 0
    expect(await scanPixelsForBounds(EMPTY_0x0, () => true)).toEqual({
      left: 0,
      top: 0,
      right: -1,
      bottom: -1,
      found: false,
    });
  });

  it('scanPixelsForBounds returns the not-found sentinel for a zero-width image', async () => {
    // left = width = 0, top = height = 10
    expect(await scanPixelsForBounds(EMPTY_0xN, () => true)).toEqual({
      left: 0,
      top: 10,
      right: -1,
      bottom: -1,
      found: false,
    });
  });

  it('scanPixelsForBounds returns the not-found sentinel for a zero-height image', async () => {
    // left = width = 10, top = height = 0
    expect(await scanPixelsForBounds(EMPTY_Nx0, () => true)).toEqual({
      left: 10,
      top: 0,
      right: -1,
      bottom: -1,
      found: false,
    });
  });

  it('getDarkPixelBounds returns null for a 0x0 image', async () => {
    expect(await getDarkPixelBounds(EMPTY_0x0)).toBeNull();
  });

  it('hasDarkPixels returns false for a 0x0 image', async () => {
    expect(await hasDarkPixels(EMPTY_0x0)).toBe(false);
  });

  it('hasRedPixels returns false for a 0x0 image', async () => {
    expect(await hasRedPixels(EMPTY_0x0)).toBe(false);
  });

  it('getSelectionBounds returns null for a 0x0 image', async () => {
    expect(await getSelectionBounds(EMPTY_0x0)).toBeNull();
  });
});

describe('dominantRed edge cases', () => {
  it('returns null when every red pixel is fully transparent', async () => {
    // The skip condition is alpha === 0; transparency alone excludes a red
    // pixel regardless of how dominant its channels are.
    const image = createImageData(3, 3);
    fillAll(image, RED, TRANSPARENT);
    expect(await dominantRed(image)).toBeNull();
  });

  it('excludes a pixel where red equals green * RED_DOMINANCE_FACTOR exactly', async () => {
    // RED_DOMINANCE_FACTOR = 2; the skip test is red <= green * 2.
    // 200 <= 200 is true, so this pixel is skipped and not dominant.
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, { red: 200, green: 100, blue: 100 });
    expect(await dominantRed(image)).toBeNull();
  });

  it('includes one pixel past the dominance boundary', async () => {
    // 201 <= 200 is false on both channels, so the pixel is kept.
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, { red: 201, green: 100, blue: 100 });
    expect(await dominantRed(image)).toEqual({ red: 201, green: 100, blue: 100, count: 1 });
  });

  it('excludes a pixel that dominates green but not blue', async () => {
    // 200 > 10*2 = 20 (dominates green), but 200 <= 100*2 = 200 (not dominant over blue).
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, { red: 200, green: 10, blue: 100 });
    expect(await dominantRed(image)).toBeNull();
  });

  it('breaks ties by first-encountered colour, not by channel values', async () => {
    // Two reds with equal pixel counts. The stable sort keeps the first-inserted
    // (first-encountered in the scan) colour as the winner.
    const image = createImageData(4, 1);
    setPixel(image, 0, 0, { red: 255, green: 0, blue: 0 });
    setPixel(image, 1, 0, { red: 255, green: 0, blue: 0 });
    setPixel(image, 2, 0, { red: 200, green: 50, blue: 50 });
    setPixel(image, 3, 0, { red: 200, green: 50, blue: 50 });
    expect(await dominantRed(image)).toEqual({ red: 255, green: 0, blue: 0, count: 2 });
  });

  it('reports a single red pixel with count 1', async () => {
    const image = createImageData(5, 5);
    setPixel(image, 2, 2, RED);
    expect(await dominantRed(image)).toEqual({ red: 255, green: 0, blue: 0, count: 1 });
  });
});

describe('getColorAtPoint edge cases', () => {
  it('returns the sole pixel colour on a 1x1 image', async () => {
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, RED);
    expect(await getColorAtPoint(image, 0, 0, 0)).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('samples the only pixel regardless of a large radius', async () => {
    // Every out-of-range pixel is skipped by the bounds guard inside the loop,
    // so the centre pixel is the sole contributor.
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, RED);
    expect(await getColorAtPoint(image, 0, 0, 50)).toEqual({ red: 255, green: 0, blue: 0 });
  });

  it('uses the default capture radius when none is supplied', async () => {
    const image = createImageData(100, 100);
    fillAll(image, RED);
    const defaulted = await getColorAtPoint(image, 50, 50);
    const explicit = await getColorAtPoint(image, 50, 50, STROKE_ANALYSIS.COLOR_SAMPLE_RADIUS);
    expect(defaulted).toEqual(explicit);
  });

  it('returns null on a 1x1 image when the sole pixel is transparent', async () => {
    const image = createImageData(1, 1);
    setPixel(image, 0, 0, RED, TRANSPARENT);
    expect(await getColorAtPoint(image, 0, 0, 5)).toBeNull();
  });

  it('rounds the averaged channels to the nearest integer', async () => {
    // Two pixels with red 0 and red 1: average = 0.5; Math.round(0.5) rounds up.
    const image = createImageData(2, 1);
    setPixel(image, 0, 0, { red: 0, green: 0, blue: 0 });
    setPixel(image, 1, 0, { red: 1, green: 0, blue: 0 });
    expect(await getColorAtPoint(image, 0, 0, 1)).toEqual({ red: 1, green: 0, blue: 0 });
  });
});

describe('known gaps (it.fails tripwires)', () => {
  // Each tripwire asserts the behaviour we WANT but the helper does NOT yet deliver.
  // Wrapped in `it.fails`, it stays green while the gap is open; the moment the
  // guard lands and the assertion starts passing, `it.fails` flips and reports an
  // unexpected pass, which is the signal to promote it to a plain `it`.

  const box: BoundingBox = { x: 100, y: 50, width: 400, height: 300 };

  describe('containFit input validation', () => {
    // containFit is deliberately the shared arithmetic; guards live at callers.
    // These tripwires catch any addition of a throw guard that would change
    // that contract — the same pattern used in contain-fit.test.ts.

    it.fails('throws on a non-finite box dimension', () => {
      expect(() => containFit({ width: Number.NaN, height: 300 })).toThrow();
    });

    it.fails('throws on a zero box dimension', () => {
      expect(() => containFit({ width: 0, height: 300 })).toThrow();
    });

    it.fails('throws on a negative box dimension', () => {
      expect(() => containFit({ width: -100, height: 300 })).toThrow();
    });
  });

  describe('document coordinate mapping input validation', () => {
    it.fails('throws on a non-finite document coordinate', () => {
      expect(() => documentToCanvasOffset(box, Number.NaN, 300)).toThrow();
    });

    it.fails('throws on a non-finite canvas coordinate', () => {
      expect(() => canvasOffsetToDocument(box, Number.NaN, 300)).toThrow();
    });
  });

  describe('getColorAtPoint input validation', () => {
    // NaN radius: Math.max(0, NaN) yields NaN, so the loop bounds NaN <= NaN are
    // false and the body never runs — the result is null, correct only by accident.
    //
    // NOTE: an Infinity radius is NOT tripwired here because it would enter an
    // infinite loop — pointY - Infinity is -Infinity and -Infinity + 1 stays
    // -Infinity in IEEE 754, so the sampling loop never advances. A guard that
    // rejects non-finite radii before the loop would fix both NaN and Infinity.
    it.fails('throws on a NaN radius', async () => {
      const image = createImageData(10, 10);
      fillAll(image, RED);
      await expect(getColorAtPoint(image, 5, 5, Number.NaN)).rejects.toThrow();
    });
  });
});
