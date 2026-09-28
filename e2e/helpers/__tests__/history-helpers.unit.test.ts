import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  bandCentreY,
  bandClip,
  bandInkFlags,
  bandIsInked,
  bandRows,
  bandUnionClip,
  canvasBands,
  getRedoButton,
  getUndoButton,
  waitForBandInked,
  waitForBands,
  visibleCanvasBox,
  wholeCanvasBand,
  type CanvasBand,
} from '../history-helpers';
import { type BoundingBox, type ClipOptions, type ImageDataResult } from '../canvas-helpers';
import {
  BLACK,
  DARK_GRAY,
  OPAQUE,
  TRANSPARENT,
  WHITE,
  createFakePage,
  createImageData,
  createPageMock,
  createScreenshotSpy,
  createTestImage,
  fillAll,
  resolveFakeMatches,
  setPixel,
} from './canvas-helpers.fixtures';

/**
 * Non-zero origin on purpose, and a height that divides by three, so a clip that
 * ignored the box origin or rounded a band edge would show up rather than cancel out.
 */
const BOX: BoundingBox = { x: 40, y: 15, width: 320, height: 300 };
const BAND_COUNT = 3;

function bands(): CanvasBand[] {
  return canvasBands(BOX, BAND_COUNT);
}

function unionClip(): Required<ClipOptions> {
  return bandUnionClip(bands());
}

/** A 1:1 band-stack capture: opaque white with black ink on the named rows. */
function stackWithInkOnRows(inkedRows: readonly number[]): ImageDataResult {
  const image = createImageData(BOX.width, BOX.height);
  fillAll(image, WHITE, OPAQUE);
  for (const row of inkedRows) setPixel(image, 4, row, BLACK, OPAQUE);
  return image;
}

type WaitForTimeoutSpy = Mock<(ms: number) => Promise<void>>;

/**
 * Page double whose `waitForTimeout` advances the fake clock instead of sleeping, so the
 * poll loop runs at full speed and every deadline decision is deterministic. Copied from
 * `canvas-redraw.unit.test.ts`: only `Date` is faked, so the real `setTimeout` stays
 * installed and the sharp decode behind the band read still settles.
 */
function createPollingPage(result: Buffer) {
  let elapsed = 0;
  const screenshot = createScreenshotSpy(result);
  const waitForTimeout: WaitForTimeoutSpy = vi.fn(async (ms: number) => {
    elapsed += ms;
    vi.advanceTimersByTime(ms);
  });
  return {
    page: createPageMock({ screenshot, waitForTimeout }),
    screenshot,
    waitForTimeout,
    elapsed: () => elapsed,
    clips: () => screenshot.mock.calls.map(([options]) => options.clip),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bandClip', () => {
  it('cuts a band from the box, in page coordinates', () => {
    expect(bandClip(BOX, 0, BAND_COUNT)).toEqual({ x: 40, y: 15, width: 320, height: 100 });
    expect(bandClip(BOX, 1, BAND_COUNT)).toEqual({ x: 40, y: 115, width: 320, height: 100 });
    expect(bandClip(BOX, 2, BAND_COUNT)).toEqual({ x: 40, y: 215, width: 320, height: 100 });
  });

  it('returns the whole box for a single band', () => {
    expect(bandClip(BOX, 0, 1)).toEqual({ x: BOX.x, y: BOX.y, width: BOX.width, height: BOX.height });
  });

  it('tiles the box with no seam and no overlap', () => {
    // Exact equality, not a tolerance: both edges of a seam come from the same
    // expression, so a rounding change that opened a sub-pixel gap is a defect.
    const clips = bands().map((band) => band.clip);
    expect(clips.reduce((total, clip) => total + clip.height, 0)).toBe(BOX.height);
    for (let index = 1; index < clips.length; index++) {
      expect(clips[index].y).toBe(clips[index - 1].y + clips[index - 1].height);
    }
  });

  it('keeps the full box width in every band', () => {
    // A band that cropped X could read as clean because the stroke was outside the
    // crop, which is a false pass rather than a failure.
    for (const band of bands()) {
      expect(band.clip.x).toBe(BOX.x);
      expect(band.clip.width).toBe(BOX.width);
    }
  });

  it('tiles a box whose height does not divide by the band count', () => {
    const odd: BoundingBox = { x: 12, y: 30, width: 200, height: 100 };
    const stack = canvasBands(odd, 3);
    for (const band of stack) {
      expect(band.clip.y).toBeGreaterThanOrEqual(odd.y);
      expect(band.clip.y + band.clip.height).toBeLessThanOrEqual(odd.y + odd.height);
    }
    expect(stack.reduce((total, band) => total + band.clip.height, 0)).toBe(odd.height);
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
  ])('rejects a %s band count rather than dividing by it', (_label, bandCount) => {
    expect(() => bandClip(BOX, 0, bandCount)).toThrow(/bandCount must be a positive integer/);
  });

  it.each([
    ['below the stack', -1],
    ['at the stack size', BAND_COUNT],
    ['fractional', 1.5],
  ])('rejects a band index %s rather than sampling a band that does not exist', (_label, band) => {
    expect(() => bandClip(BOX, band, BAND_COUNT)).toThrow(/band must be an integer in/);
  });
});

describe('canvasBands and wholeCanvasBand', () => {
  it('numbers the stack from the top and hands back the single-band clips', () => {
    const stack = bands();
    expect(stack.map((band) => band.index)).toEqual([0, 1, 2]);
    expect(stack.map((band) => band.clip)).toEqual([
      bandClip(BOX, 0, BAND_COUNT),
      bandClip(BOX, 1, BAND_COUNT),
      bandClip(BOX, 2, BAND_COUNT),
    ]);
  });

  it('reads the whole canvas as one band covering the whole box', () => {
    const whole = wholeCanvasBand(BOX);
    expect(whole.index).toBe(0);
    expect(whole.clip).toEqual({ x: BOX.x, y: BOX.y, width: BOX.width, height: BOX.height });
    expect(bandUnionClip([whole])).toEqual(whole.clip);
  });

  it('validates the count before building anything', () => {
    expect(() => canvasBands(BOX, 0)).toThrow(/bandCount must be a positive integer/);
  });
});

describe('bandCentreY', () => {
  it('is the box-relative midpoint of its own band', () => {
    // Box-relative on one side and page-relative on the other: convert before comparing.
    for (const band of bands()) {
      expect(bandCentreY(BOX, band.index, BAND_COUNT)).toBe(band.clip.y + band.clip.height / 2 - BOX.y);
    }
  });

  it('places each centre strictly inside its own band and no other', () => {
    const stack = bands();
    stack.forEach((_ownBand, index) => {
      const pageCentre = BOX.y + bandCentreY(BOX, index, BAND_COUNT);
      stack.forEach((other, otherIndex) => {
        const inside = pageCentre > other.clip.y && pageCentre < other.clip.y + other.clip.height;
        expect(inside, `band ${index} centre inside band ${otherIndex}`).toBe(index === otherIndex);
      });
    });
  });

  it('halves the box height for a single band', () => {
    expect(bandCentreY(BOX, 0, 1)).toBe(BOX.height / 2);
  });

  it('validates the band index the same way bandClip does', () => {
    expect(() => bandCentreY(BOX, BAND_COUNT, BAND_COUNT)).toThrow(/band must be an integer in/);
    expect(() => bandCentreY(BOX, 0, 0)).toThrow(/bandCount must be a positive integer/);
  });
});

describe('visibleCanvasBox', () => {
  const VIEWPORT = { width: 1280, height: 1000 };

  it('returns the box unchanged when all of it is on screen', () => {
    expect(visibleCanvasBox({ x: 56, y: 100, width: 974, height: 863 }, VIEWPORT)).toEqual({
      x: 56,
      y: 100,
      width: 974,
      height: 863,
    });
  });

  it('cuts the part of the canvas that hangs below the fold', () => {
    // This application lays the workspace canvas out taller than a 720px window
    // (measured: an 840px element in a 720px viewport), and a clipped screenshot
    // of the overflow comes back as the rows that fit, with no error.
    expect(visibleCanvasBox({ x: 56, y: 100, width: 974, height: 840 }, { width: 1280, height: 720 })).toEqual({
      x: 56,
      y: 100,
      width: 974,
      height: 620,
    });
  });

  it('cuts a canvas that hangs off the left or top of the page', () => {
    expect(visibleCanvasBox({ x: -40, y: -10, width: 200, height: 100 }, VIEWPORT)).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 90,
    });
  });

  it('keeps only the part of a canvas that runs off the right of the page', () => {
    expect(visibleCanvasBox({ x: 1100, y: 10, width: 400, height: 100 }, VIEWPORT)).toEqual({
      x: 1100,
      y: 10,
      width: 180,
      height: 100,
    });
  });

  it('refuses a canvas that is entirely off screen rather than returning a zero-area box', () => {
    // A zero-area box would divide by zero in bandRows, and the bands it produced
    // would read as clean - the same silent pass this function exists to prevent.
    expect(() => visibleCanvasBox({ x: 56, y: 800, width: 974, height: 200 }, { width: 1280, height: 720 })).toThrow(
      /does not overlap/
    );
    expect(() => visibleCanvasBox({ x: 2000, y: 10, width: 100, height: 100 }, VIEWPORT)).toThrow(/does not overlap/);
  });
});

describe('bandUnionClip', () => {
  it('is the enclosing rect of bands that are apart', () => {
    const first = bands()[0];
    const last = bands()[2];
    expect(bandUnionClip([first, last])).toEqual({ x: BOX.x, y: BOX.y, width: BOX.width, height: BOX.height });
  });

  it('is the band itself when there is only one', () => {
    const only = bands()[1];
    expect(bandUnionClip([only])).toEqual(only.clip);
  });

  it('takes the outer edges rather than the geometry of either band', () => {
    // Neither band's own x/width nor its own y/height is the envelope, so a
    // union built from either band's first edge is a different rect.
    const apart: CanvasBand[] = [
      { index: 0, clip: { x: 100, y: 30, width: 50, height: 10 } },
      { index: 1, clip: { x: 20, y: 100, width: 200, height: 10 } },
    ];
    expect(bandUnionClip(apart)).toEqual({ x: 20, y: 30, width: 200, height: 80 });
  });

  it('refuses an empty stack instead of reporting a zero-area clip', () => {
    expect(() => bandUnionClip([])).toThrow(/at least one band/);
  });
});

describe('bandRows', () => {
  it('slices a 1:1 capture into the band heights', () => {
    expect(bandRows(bands(), BOX.height)).toEqual([
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
      { top: 200, bottom: 300 },
    ]);
  });

  it('doubles every band for a capture at twice the CSS resolution', () => {
    // The capture is in device pixels and the clips are in CSS pixels, so a
    // device-pixel-ratio-2 image must not be read as the top half of the bands twice.
    expect(bandRows(bands(), BOX.height * 2)).toEqual([
      { top: 0, bottom: 200 },
      { top: 200, bottom: 400 },
      { top: 400, bottom: 600 },
    ]);
  });

  it('reads a band that does not start at the top of the capture as the whole image', () => {
    expect(bandRows([bands()[1]], 100)).toEqual([{ top: 0, bottom: 100 }]);
  });

  it('gives a band that rounds away a single row rather than none', () => {
    // Zero rows would report "clean" for a strip of the capture that was never read.
    const hairline: CanvasBand[] = [{ index: 0, clip: { x: 0, y: 0, width: 10, height: 0.4 } }];
    const [row] = bandRows(hairline, 3);
    expect(row.bottom).toBeGreaterThan(row.top);
  });

  it('never hands back a row past the end of the image', () => {
    const overhanging: CanvasBand[] = [{ index: 0, clip: { x: 0, y: 0, width: 10, height: 10_000 } }];
    expect(bandRows(overhanging, 50)).toEqual([{ top: 0, bottom: 50 }]);
  });

  it('refuses an empty capture rather than dividing by its height', () => {
    expect(() => bandRows(bands(), 0)).toThrow(/imageHeight must be a positive integer/);
  });
});

describe('bandIsInked', () => {
  it.each([
    ['black', BLACK],
    ['dark grey, which is inside the shared threshold', DARK_GRAY],
  ])('reports %s as ink', async (_label, color) => {
    const image = createImageData(4, 4);
    fillAll(image, color, OPAQUE);
    await expect(bandIsInked(image)).resolves.toBe(true);
  });

  it('reports a white band as clean', async () => {
    const image = createImageData(4, 4);
    fillAll(image, WHITE, OPAQUE);
    await expect(bandIsInked(image)).resolves.toBe(false);
  });

  it('ignores a fully transparent band, so an empty document is not ink', async () => {
    const image = createImageData(4, 4);
    fillAll(image, BLACK, TRANSPARENT);
    await expect(bandIsInked(image)).resolves.toBe(false);
  });

  it('still counts a single dark pixel, so a half-restored stroke fails the band', async () => {
    const image = createImageData(20, 20);
    fillAll(image, WHITE, OPAQUE);
    setPixel(image, 10, 10, BLACK, OPAQUE);
    await expect(bandIsInked(image)).resolves.toBe(true);
  });
});

describe('bandInkFlags', () => {
  it('reports one flag per band, in band order', async () => {
    // Rows 150 and 250 of a 300-row capture land in bands 1 and 2.
    await expect(bandInkFlags(stackWithInkOnRows([150, 250]), bands())).resolves.toEqual([false, true, true]);
  });

  it('reports a clean stack when no band carries ink', async () => {
    await expect(bandInkFlags(stackWithInkOnRows([]), bands())).resolves.toEqual([false, false, false]);
  });

  it('reads only the rows its own bands cover, not every row of the capture', async () => {
    // The capture is the union, so it carries a row neither band owns. Ink there
    // has to read as clean in both bands: a slice bounded by the whole image would
    // report it as inked and let a stroke in an unsampled strip pass for a failure.
    const gapped: CanvasBand[] = [
      { index: 0, clip: { x: 0, y: 0, width: 20, height: 10 } },
      { index: 1, clip: { x: 0, y: 20, width: 20, height: 10 } },
    ];
    const gapInk = createImageData(20, 30);
    fillAll(gapInk, WHITE, OPAQUE);
    setPixel(gapInk, 1, 15, BLACK, OPAQUE);
    setPixel(gapInk, 1, 5, BLACK, OPAQUE);

    await expect(bandInkFlags(gapInk, gapped)).resolves.toEqual([true, false]);
  });

  it('reads a capture at twice the CSS resolution without shifting the bands', async () => {
    // The x2 image carries the ink where the doubled band 1 rows are.
    const image = createImageData(BOX.width * 2, BOX.height * 2);
    fillAll(image, WHITE, OPAQUE);
    setPixel(image, 8, 300, BLACK, OPAQUE);
    await expect(bandInkFlags(image, bands())).resolves.toEqual([false, true, false]);
  });

  it('decodes a PNG buffer, so a real capture takes the same path', async () => {
    const inked = await createTestImage(BLACK, BOX.width, BOX.height);
    const clean = await createTestImage(WHITE, BOX.width, BOX.height);
    await expect(bandInkFlags(inked, bands())).resolves.toEqual([true, true, true]);
    await expect(bandInkFlags(clean, bands())).resolves.toEqual([false, false, false]);
  });
});

describe('getUndoButton and getRedoButton', () => {
  const undo = { selector: 'button', testId: 'undo-button' };
  const redo = { selector: 'button', testId: 'redo-button' };
  const unlabelled = { selector: 'button' };

  it('locates each control by its own test id, with no positional fallback', () => {
    // A second candidate would turn one element into a union and every call into a
    // strict-mode violation, so a test id that stopped matching has to match nothing.
    const page = createFakePage([undo, redo, unlabelled]);
    expect(resolveFakeMatches(getUndoButton(page))).toEqual([undo]);
    expect(resolveFakeMatches(getRedoButton(page))).toEqual([redo]);
  });

  it('does not answer for a control that is not on the page', () => {
    const page = createFakePage([unlabelled]);
    expect(resolveFakeMatches(getUndoButton(page))).toEqual([]);
    expect(resolveFakeMatches(getRedoButton(page))).toEqual([]);
  });
});

describe('waitForBands', () => {
  it('reads the union clip once and returns when every band already matches', async () => {
    const harness = createPollingPage(await createTestImage(BLACK, BOX.width, BOX.height));

    await expect(waitForBands(harness.page, bands(), [true, true, true])).resolves.toBeUndefined();

    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(harness.clips()).toEqual([unionClip()]);
    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });

  it('keeps polling while any one band disagrees', async () => {
    // A solid black capture has ink in every band, so [true, false, false] can never
    // be satisfied. Returning on the first band that matched would declare the wait
    // done on band 0 and read the canvas mid-replay; four reads is the proof it does not.
    const harness = createPollingPage(await createTestImage(BLACK, BOX.width, BOX.height));

    await expect(
      waitForBands(harness.page, bands(), [true, false, false], { timeoutMs: 250, pollIntervalMs: 100 })
    ).rejects.toThrow(/Canvas did not render/);

    expect(harness.screenshot).toHaveBeenCalledTimes(4);
    expect(harness.elapsed()).toBe(300);
    expect(new Set(harness.clips().map((clip) => JSON.stringify(clip)))).toEqual(
      new Set([JSON.stringify(unionClip())])
    );
  });

  it('names the expected state of every band when it never arrives', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, BOX.width, BOX.height));

    await expect(
      waitForBands(harness.page, bands(), [true, false, false], { timeoutMs: 1_000, pollIntervalMs: 250 })
    ).rejects.toThrow('Canvas did not render band 0 inked, band 1 clean, band 2 clean within 1000ms');

    expect(harness.elapsed()).toBe(1_000);
  });

  it('returns on the first read when every band is expected clean', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, BOX.width, BOX.height));
    await expect(waitForBands(harness.page, bands(), [false, false, false])).resolves.toBeUndefined();
    expect(harness.screenshot).toHaveBeenCalledTimes(1);
  });

  it('refuses a state list that does not match the band list, before it reads anything', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, BOX.width, BOX.height));
    expect(() => waitForBands(harness.page, bands(), [true, true])).toThrow(/expected 3 band states, got 2/);
    expect(harness.screenshot).not.toHaveBeenCalled();
  });
});

describe('waitForBandInked', () => {
  it('waits on the band clip itself, not on the union of a stack', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, BOX.width, BOX.height));

    await expect(waitForBandInked(harness.page, bands()[1], { timeoutMs: 300, pollIntervalMs: 100 })).rejects.toThrow(
      'Canvas did not render band 1 inked within 300ms'
    );

    // Four reads: the poll at t=0, then one per 100ms interval up to the 300ms
    // deadline. Every one of them is the band's own clip, not the box.
    expect(harness.screenshot).toHaveBeenCalledTimes(4);
    expect(new Set(harness.clips().map((clip) => JSON.stringify(clip)))).toEqual(
      new Set([JSON.stringify(bandClip(BOX, 1, BAND_COUNT))])
    );
    expect(harness.elapsed()).toBe(300);
  });

  it('returns on the read that finds the ink', async () => {
    const harness = createPollingPage(await createTestImage(BLACK, BOX.width, BOX.height));
    await expect(waitForBandInked(harness.page, bands()[0])).resolves.toBeUndefined();
    expect(harness.screenshot).toHaveBeenCalledTimes(1);
  });
});
