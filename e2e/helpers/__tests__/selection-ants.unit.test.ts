import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_REDRAW_POLL_INTERVAL_MS, CANVAS_REDRAW_TIMEOUT_MS } from '../canvas-helpers';
import { committedAntsOutline, hasNoCommittedAnts, waitForCommittedAnts } from '../selection-ants';
import type { Page } from '@playwright/test';

/**
 * `selection-ants.ts` without a browser.
 *
 * The module's surface is three functions that all take a Playwright `Page`, and the
 * part worth testing is the part that runs INSIDE the page: the pixel scan, the two ant
 * colours, the alpha guard and the `object-contain` scale-plus-centring arithmetic. All
 * of that is ordinary code over a canvas element's `getImageData`, so it is reachable
 * from Node by standing in two things:
 *
 * - `page.getByTestId(...).evaluate(fn)` — a `Page` whose single locator runs `fn`
 *   against whatever the test hands it. `evaluate` is documented to serialise `fn` into
 *   the page; here `fn` runs in this process instead, which is the whole point.
 * - `window.HTMLCanvasElement` — the callback's only browser global, used for its
 *   `instanceof` guard. The environment is Node, so `window` is absent and is installed
 *   for the duration of the case.
 *
 * What is deliberately NOT faked is the arithmetic under test. A real `Uint8ClampedArray`
 * of real RGBA bytes goes through the real loop, and the expected bounds are written out
 * from the documented scale-plus-offset rule rather than captured from a run.
 */

/** RGBA bytes, as `getImageData` returns them. */
type Rgba = readonly [number, number, number, number];

/** One half of the marching-ants dash. */
const BLACK: Rgba = [0, 0, 0, 255];
/** The other half. Both are opaque, and both have to be recognised. */
const WHITE: Rgba = [255, 255, 255, 255];
/** Opaque, and neither ant colour: alpha alone would accept it, and must not. */
const MID_GREY: Rgba = [128, 128, 128, 255];
/** Opaque and saturated: the colour a selection overlay is drawn in. */
const RED: Rgba = [255, 0, 0, 255];
/** A white pixel with no alpha: skipped on alpha before the colour test ever runs. */
const CLEAR_WHITE: Rgba = [255, 255, 255, 0];

interface Paint {
  readonly x: number;
  readonly y: number;
  readonly rgba: Rgba;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A canvas whose backing store is a real RGBA buffer, transparent everywhere except
 * the painted pixels. `object-contain` maps the store onto `box`, and that mapping is
 * what the module has to reproduce, so `box` is a parameter rather than a constant.
 */
class FakeAntsCanvas {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8ClampedArray;
  private readonly box: Box;

  constructor(width: number, height: number, paints: readonly Paint[], box?: Box) {
    this.width = width;
    this.height = height;
    this.box = box ?? { left: 0, top: 0, width, height };
    this.pixels = new Uint8ClampedArray(width * height * 4);
    for (const { x, y, rgba } of paints) {
      const at = (y * width + x) * 4;
      this.pixels[at] = rgba[0];
      this.pixels[at + 1] = rgba[1];
      this.pixels[at + 2] = rgba[2];
      this.pixels[at + 3] = rgba[3];
    }
  }

  /** `'2d'` only, so the "no 2d context" branch is reachable from a test. */
  getContext(
    kind: string
  ): { getImageData: (x: number, y: number, width: number, height: number) => { data: Uint8ClampedArray } } | null {
    if (kind !== '2d') return null;
    return {
      getImageData: (_x, _y, width, height) => ({ data: this.pixels.subarray(0, width * height * 4) }),
    };
  }

  getBoundingClientRect(): Box {
    return this.box;
  }
}

/** The same element, with no 2d context, which the module treats as a hard error. */
class ContextlessAntsCanvas extends FakeAntsCanvas {
  override getContext(): null {
    return null;
  }
}

/** The `window` the page callback resolves `window.HTMLCanvasElement` against. */
const BROWSER_GLOBALS = globalThis as unknown as { window?: unknown };

/** Virtual milliseconds. `waitForCommittedAnts` compares `Date.now()` against a deadline. */
let now = 0;
/** How many times the module slept between reads. */
let waits = 0;

/**
 * A `Page` with the one method the module calls on it. `read` is re-invoked per call,
 * which is how a test makes the ants arrive on the fourth poll instead of the first.
 */
function antsPage(read: () => unknown): Page {
  const page = {
    getByTestId: (testId: string) => {
      // The test id is part of the contract with the app's canvas, and a rename on
      // either side has to fail here rather than as an empty read in a spec.
      if (testId !== 'selection-ants-canvas') throw new Error(`unexpected test id: ${testId}`);
      return { evaluate: (callback: (element: unknown) => unknown) => Promise.resolve(callback(read())) };
    },
    waitForTimeout: async (ms: number) => {
      waits += 1;
      now += ms;
    },
  };
  return page as unknown as Page;
}

/** Reads the same element forever, which is what a settled selection looks like. */
function antsReading(canvas: FakeAntsCanvas | null): Page {
  return antsPage(() => canvas);
}

beforeEach(() => {
  now = 0;
  waits = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  BROWSER_GLOBALS.window = { HTMLCanvasElement: FakeAntsCanvas };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete BROWSER_GLOBALS.window;
});

describe('committedAntsOutline', () => {
  it('reports null for a canvas with no ants on it', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, []));
    await expect(committedAntsOutline(page)).resolves.toBeNull();
  });

  it('reports the bounds of a single ant pixel at one to one', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, [{ x: 2, y: 3, rgba: BLACK }]));
    await expect(committedAntsOutline(page)).resolves.toEqual({ left: 2, top: 3, right: 2, bottom: 3 });
  });

  it('accepts the white half of the dash as an ant', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, [{ x: 5, y: 1, rgba: WHITE }]));
    await expect(committedAntsOutline(page)).resolves.toEqual({ left: 5, top: 1, right: 5, bottom: 1 });
  });

  it.each([
    { name: 'a mid grey pixel', rgba: MID_GREY },
    { name: 'a saturated red pixel', rgba: RED },
  ])('rejects $name, because alpha alone would accept it', async ({ rgba }) => {
    const page = antsReading(new FakeAntsCanvas(8, 8, [{ x: 4, y: 4, rgba }]));
    await expect(committedAntsOutline(page)).resolves.toBeNull();
  });

  it('skips a transparent pixel whatever colour its bytes carry', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, [{ x: 4, y: 4, rgba: CLEAR_WHITE }]));
    await expect(committedAntsOutline(page)).resolves.toBeNull();
  });

  it('spans every ant pixel, so the bounds are the outermost one on each axis', async () => {
    const page = antsReading(
      new FakeAntsCanvas(8, 8, [
        { x: 1, y: 6, rgba: BLACK },
        { x: 5, y: 2, rgba: WHITE },
        { x: 3, y: 4, rgba: BLACK },
      ])
    );
    await expect(committedAntsOutline(page)).resolves.toEqual({ left: 1, top: 2, right: 5, bottom: 6 });
  });

  it('maps a 2x backing store through the element scale, not onto its own pixels', async () => {
    // object-contain, square to square: scale 1/2, no centring offset.
    const canvas = new FakeAntsCanvas(200, 200, [{ x: 10, y: 10, rgba: BLACK }], {
      left: 10,
      top: 20,
      width: 100,
      height: 100,
    });
    await expect(committedAntsOutline(antsReading(canvas))).resolves.toEqual({
      left: 15,
      top: 25,
      right: 15,
      bottom: 25,
    });
  });

  it('centres a letterboxed backing store inside the element box', () => {
    // 200x100 store in a 100x100 box: scale is min(100/200, 100/100) = 1/2, so the
    // store is 50 CSS pixels tall inside 100, which puts 25 CSS pixels of letterbox
    // above it and below it. A scale alone would report the top row at 0.
    expect({ scale: Math.min(100 / 200, 100 / 100), offsetY: (100 - 100 * (100 / 200)) / 2 }).toEqual({
      scale: 0.5,
      offsetY: 25,
    });
  });

  it('adds the letterbox offset to both edges of a letterboxed store', async () => {
    const canvas = new FakeAntsCanvas(200, 100, [{ x: 0, y: 99, rgba: BLACK }], {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    // Row 99 is the store's last row: 25 + 99 * 1/2 = 74.5 in CSS page space.
    await expect(committedAntsOutline(antsReading(canvas))).resolves.toEqual({
      left: 0,
      top: 74.5,
      right: 0,
      bottom: 74.5,
    });
  });

  it('names the test id when the page has no ants canvas', async () => {
    const page = antsPage(() => ({ tagName: 'DIV' }));
    await expect(committedAntsOutline(page)).rejects.toThrow(
      /committedAntsOutline: no \[data-testid="selection-ants-canvas"\] on the page/
    );
  });

  it('fails when the canvas has no 2d context rather than reporting no ants', async () => {
    // The distinction is the module's: "no ants" is an answer, "no context" is a
    // broken oracle, and reading it as the first would pass every assertion after it.
    const page = antsReading(new ContextlessAntsCanvas(8, 8, []));
    await expect(committedAntsOutline(page)).rejects.toThrow(/no 2d context/);
  });
});

describe('hasNoCommittedAnts', () => {
  it('is true for a canvas with no ants on it', async () => {
    await expect(hasNoCommittedAnts(antsReading(new FakeAntsCanvas(8, 8, [])))).resolves.toBe(true);
  });

  it('is false the moment one ant pixel is on it', async () => {
    const canvas = new FakeAntsCanvas(8, 8, [{ x: 0, y: 0, rgba: BLACK }]);
    await expect(hasNoCommittedAnts(antsReading(canvas))).resolves.toBe(false);
  });

  it('reads absence rather than looking for the ants somewhere else', async () => {
    // The same bytes as the case above, one ant on the far side of the store: the
    // answer is "there are ants", never "there are no ants over there".
    const canvas = new FakeAntsCanvas(8, 8, [{ x: 7, y: 7, rgba: WHITE }]);
    await expect(hasNoCommittedAnts(antsReading(canvas))).resolves.toBe(false);
  });
});

describe('waitForCommittedAnts', () => {
  it('returns on the first read that finds ants, and does not sleep after it', async () => {
    const canvas = new FakeAntsCanvas(8, 8, [{ x: 1, y: 1, rgba: BLACK }]);
    await expect(waitForCommittedAnts(antsReading(canvas), 'a committed lasso')).resolves.toBeUndefined();
    expect(waits).toBe(0);
  });

  it('keeps polling a settled canvas until the ants arrive', async () => {
    let reads = 0;
    const canvas = new FakeAntsCanvas(8, 8, [{ x: 3, y: 3, rgba: WHITE }]);
    const page = antsPage(() => {
      reads += 1;
      return reads < 4 ? new FakeAntsCanvas(8, 8, []) : canvas;
    });

    await expect(waitForCommittedAnts(page, 'a committed polygon')).resolves.toBeUndefined();
    // Three empty reads, so three sleeps, and the fourth read is the one that answers.
    expect(reads).toBe(4);
    expect(waits).toBe(3);
    expect(now).toBe(3 * CANVAS_REDRAW_POLL_INTERVAL_MS);
  });

  it('gives up at the redraw timeout, not one poll later or one poll sooner', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, []));
    await expect(waitForCommittedAnts(page, 'a committed selection')).rejects.toThrow(/Timed out/);
    expect(waits).toBe(CANVAS_REDRAW_TIMEOUT_MS / CANVAS_REDRAW_POLL_INTERVAL_MS);
    expect(now).toBe(CANVAS_REDRAW_TIMEOUT_MS);
  });

  it('names what it was waiting for and the last reading it got', async () => {
    const page = antsReading(new FakeAntsCanvas(8, 8, []));
    await expect(waitForCommittedAnts(page, 'the freehand lasso border')).rejects.toThrow(
      /Timed out waiting for the freehand lasso border \(last read: null, last error: null\)/
    );
  });

  it('tells a read that threw every tick apart from one that returned null forever', async () => {
    // Two different failures with the same symptom: a canvas that never appeared, and a
    // canvas whose read is broken. Reporting them the same way sends whoever reads the
    // failure to the wrong place.
    const page = antsPage(() => {
      throw new Error('no [data-testid="selection-ants-canvas"] on the page');
    });

    await expect(waitForCommittedAnts(page, 'the ants border')).rejects.toThrow(
      /last read: null, last error: no \[data-testid="selection-ants-canvas"\] on the page/
    );
  });
});
