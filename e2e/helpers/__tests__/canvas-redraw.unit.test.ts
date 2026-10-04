import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Page } from '@playwright/test';
import { canvasRedrawClip, waitForCanvasPixels, type CanvasPixelPredicate } from '../canvas-redraw';
import {
  CANVAS_REDRAW_CLIP,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  containFit,
  hasDarkPixels,
  waitForCanvasRedraw,
  type BoundingBox,
  type ClipOptions,
} from '../canvas-helpers';
import {
  BLACK,
  DARK_GRAY,
  SPRAY_GRAY,
  WHITE,
  createScrollablePage,
  createTestImage,
  type ScreenshotSpy,
} from './canvas-helpers.fixtures';

/** Non-zero origin on purpose: a zero origin would let a clip that ignores the box pass. */
const BOX: BoundingBox = { x: 40, y: 15, width: 320, height: 200 };
const BOX_CLIP: Required<ClipOptions> = { x: 140, y: 115, width: 300, height: 100 };

const STANDALONE_CLIP: Required<ClipOptions> = { x: 7, y: 9, width: 120, height: 80 };

/** The poll loop only ever needs to know the buffer came back; contents are up to the predicate. */
const SCREENSHOT = Buffer.from('fake-png-data');

/** A read happens on every attempt including the one that trips the deadline. */
const READS_PER_DEFAULT_TIMEOUT = CANVAS_REDRAW_TIMEOUT_MS / CANVAS_REDRAW_POLL_INTERVAL_MS + 1;

type WaitForTimeoutSpy = Mock<(ms: number) => Promise<void>>;

interface PollingPage {
  page: Page;
  screenshot: ScreenshotSpy;
  waitForTimeout: WaitForTimeoutSpy;
  /** Fake-clock milliseconds the polls have consumed, i.e. the wait a real run would have spent. */
  elapsed: () => number;
  /** Clips handed to `page.screenshot`, in call order. */
  clips: () => Required<ClipOptions>[];
}

/**
 * Page double whose `waitForTimeout` advances the fake clock instead of sleeping, so the
 * poll loop runs at full speed and every deadline decision is deterministic. Only `Date` is
 * faked (see `beforeEach`): the real `setTimeout` stays installed so the sharp decode behind
 * `hasDarkPixels` still settles, and the elapsed time is tracked here rather than measured.
 */
function createPollingPage(result: Buffer = SCREENSHOT): PollingPage {
  let elapsed = 0;
  const waitForTimeout: WaitForTimeoutSpy = vi.fn(async (ms: number) => {
    elapsed += ms;
    vi.advanceTimersByTime(ms);
  });
  // The default geometry is a window that holds its whole page, so every clip here is
  // already on screen and the reads are the clips the tests pass in. What the scroll model
  // buys is `evaluate` at all: the wait reads the window to decide that.
  const scrollable = createScrollablePage({ result, waitForTimeout });
  return {
    page: scrollable.page,
    screenshot: scrollable.screenshot,
    waitForTimeout,
    elapsed: () => elapsed,
    clips: scrollable.clips,
  };
}

function always(result: boolean): Mock<CanvasPixelPredicate> {
  return vi.fn<CanvasPixelPredicate>().mockResolvedValue(result);
}

/** Answers `answers` in order, so the attempt a predicate stops on is exact. */
function sequence(...answers: boolean[]): Mock<CanvasPixelPredicate> {
  const predicate = vi.fn<CanvasPixelPredicate>();
  for (const answer of answers) predicate.mockResolvedValueOnce(answer);
  return predicate;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForCanvasPixels', () => {
  it('reads once and returns when the predicate accepts the first screenshot', async () => {
    const harness = createPollingPage();
    const predicate = always(true);

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate)).resolves.toBeUndefined();

    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(predicate).toHaveBeenCalledTimes(1);
    expect(harness.waitForTimeout).not.toHaveBeenCalled();
    expect(harness.elapsed()).toBe(0);
  });

  it('hands the predicate the screenshot buffer and retries while it answers false', async () => {
    const harness = createPollingPage();
    const predicate = sequence(false, false, true);

    await waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 5_000, pollIntervalMs: 100 });

    expect(harness.screenshot).toHaveBeenCalledTimes(3);
    expect(predicate.mock.calls).toEqual([[SCREENSHOT], [SCREENSHOT], [SCREENSHOT]]);
    expect(harness.waitForTimeout.mock.calls).toEqual([[100], [100]]);
    expect(harness.elapsed()).toBe(200);
  });

  it('stops at the first true instead of burning the 10s default timeout', async () => {
    const harness = createPollingPage();
    let calls = 0;
    const predicate: CanvasPixelPredicate = async () => ++calls >= 3;

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate)).resolves.toBeUndefined();

    expect(calls).toBe(3);
    expect(harness.waitForTimeout.mock.calls).toEqual([
      [CANVAS_REDRAW_POLL_INTERVAL_MS],
      [CANVAS_REDRAW_POLL_INTERVAL_MS],
    ]);
    expect(harness.elapsed()).toBe(2 * CANVAS_REDRAW_POLL_INTERVAL_MS);
    expect(harness.elapsed()).toBeLessThan(CANVAS_REDRAW_TIMEOUT_MS);
  });

  it('throws the documented message naming the timeout once the deadline passes', async () => {
    const harness = createPollingPage();
    const predicate = always(false);

    await expect(
      waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, {
        timeoutMs: 1_000,
        pollIntervalMs: 100,
        description: 'red pixels',
      })
    ).rejects.toThrow('Canvas did not render red pixels within 1000ms');

    expect(predicate).toHaveBeenCalledTimes(11);
    expect(harness.waitForTimeout).toHaveBeenCalledTimes(10);
  });

  it('names the generic description when the caller supplies none', async () => {
    const harness = createPollingPage();

    await expect(
      waitForCanvasPixels(harness.page, STANDALONE_CLIP, always(false), { timeoutMs: 300, pollIntervalMs: 100 })
    ).rejects.toThrow('Canvas did not render the expected pixels within 300ms');
  });

  it('defaults to the shared 10000ms timeout and 100ms poll interval', async () => {
    const harness = createPollingPage();
    const predicate = always(false);

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate)).rejects.toThrow(
      `Canvas did not render the expected pixels within ${CANVAS_REDRAW_TIMEOUT_MS}ms`
    );

    expect(CANVAS_REDRAW_TIMEOUT_MS).toBe(10_000);
    expect(CANVAS_REDRAW_POLL_INTERVAL_MS).toBe(100);
    expect(predicate).toHaveBeenCalledTimes(READS_PER_DEFAULT_TIMEOUT);
    expect(new Set(harness.waitForTimeout.mock.calls.flat())).toEqual(new Set([CANVAS_REDRAW_POLL_INTERVAL_MS]));
  });

  it('waits the injected interval between attempts, not the default one', async () => {
    const harness = createPollingPage();
    const predicate = sequence(false, false, false, false, true);

    await waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, {
      timeoutMs: 60_000,
      pollIntervalMs: 250,
    });

    expect(harness.waitForTimeout.mock.calls).toEqual([[250], [250], [250], [250]]);
    expect(harness.elapsed()).toBe(1_000);
  });

  it('forwards the caller clip to page.screenshot without touching it', async () => {
    const harness = createPollingPage();
    const clip = canvasRedrawClip(BOX);

    await waitForCanvasPixels(harness.page, clip, always(true));

    expect(harness.screenshot).toHaveBeenCalledWith({ clip });
    expect(harness.screenshot.mock.calls[0][0].clip).toBe(clip);
    expect(harness.clips()).toEqual([{ x: 140, y: 115, width: 300, height: 100 }]);
  });

  it('captures with a clip only, so the poll loop writes nothing to disk', async () => {
    const harness = createPollingPage();

    await waitForCanvasPixels(harness.page, canvasRedrawClip(BOX), always(true));

    expect(harness.screenshot.mock.calls[0][0]).toEqual({ clip: BOX_CLIP });
  });

  it('reuses the same clip object for every attempt of one call', async () => {
    const harness = createPollingPage();
    const clip = { ...STANDALONE_CLIP };

    await waitForCanvasPixels(harness.page, clip, sequence(false, true));

    expect(harness.screenshot.mock.calls[0][0].clip).toBe(harness.screenshot.mock.calls[1][0].clip);
    expect(harness.screenshot.mock.calls[0][0].clip).toBe(clip);
  });

  // The loop reads the pixels before it checks the deadline, so a stroke that lands on the
  // final attempt is accepted. Reordering the two statements fails this test.
  it('accepts a read that lands exactly on the deadline', async () => {
    const harness = createPollingPage();
    const predicate = sequence(false, true);

    await expect(
      waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 100, pollIntervalMs: 100 })
    ).resolves.toBeUndefined();

    expect(predicate).toHaveBeenCalledTimes(2);
    expect(harness.elapsed()).toBe(100);
  });

  // `pollIntervalMs` is read with `??`, so an explicit 0 is honoured as a tight loop
  // instead of being replaced by CANVAS_REDRAW_POLL_INTERVAL_MS.
  it('honours an explicit poll interval of zero', async () => {
    const harness = createPollingPage();
    const predicate = sequence(false, false, true);

    await waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 60_000, pollIntervalMs: 0 });

    expect(harness.waitForTimeout.mock.calls).toEqual([[0], [0]]);
    expect(harness.elapsed()).toBe(0);
  });

  it('propagates a rejected predicate without retrying or reporting a timeout', async () => {
    const harness = createPollingPage();
    const failure = new Error('decode failed');
    const predicate = vi.fn<CanvasPixelPredicate>().mockRejectedValue(failure);

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 1_000 })).rejects.toBe(
      failure
    );

    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });

  it('surfaces a predicate failure from a later attempt instead of the timeout error', async () => {
    const harness = createPollingPage();
    const failure = new Error('sharp exploded');
    const predicate = vi.fn<CanvasPixelPredicate>().mockResolvedValueOnce(false).mockRejectedValue(failure);

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 1_000 })).rejects.toBe(
      failure
    );

    expect(harness.screenshot).toHaveBeenCalledTimes(2);
    expect(harness.waitForTimeout.mock.calls).toEqual([[100]]);
  });

  it('propagates a predicate that throws synchronously', async () => {
    const harness = createPollingPage();
    const failure = new Error('bad clip');
    const predicate: CanvasPixelPredicate = () => {
      throw failure;
    };

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, predicate, { timeoutMs: 1_000 })).rejects.toBe(
      failure
    );

    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });

  it('propagates a capture failure instead of retrying the screenshot', async () => {
    const harness = createPollingPage();
    const failure = new Error('target closed');
    harness.screenshot.mockRejectedValue(failure);

    await expect(waitForCanvasPixels(harness.page, STANDALONE_CLIP, always(true))).rejects.toBe(failure);

    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });
});

/**
 * A clip can only be photographed where it is on screen: Playwright trims it against the
 * viewport, so a region entirely below the fold collapses to zero height and the capture
 * throws `Clipped area is either empty or outside the resulting image`. These pin what the
 * wait does about that — and, just as load-bearing, what it does when nothing is wrong.
 *
 * The geometry is the app's, measured: 1177px of page in a 720px window, and
 * `paint-options.spec.ts` reads its 60px stroke from 0.7 of the canvas box height, which
 * lands at page y=748 — 28px below the fold.
 */
describe('waitForCanvasPixels on a region that is not in view', () => {
  const VIEWPORT_HEIGHT = 720;
  const DOCUMENT_HEIGHT = 1177;
  const MAX_SCROLL_Y = DOCUMENT_HEIGHT - VIEWPORT_HEIGHT;

  /** The measured wide stroke: page y 748..908, inside a 720px window. */
  const BELOW_THE_FOLD: Required<ClipOptions> = { x: 176, y: 748, width: 320, height: 160 };

  function scrolledPage(overrides: Parameters<typeof createScrollablePage>[0] = {}) {
    // The clock is faked for this file, and the deadline is read from `Date.now()`. A
    // `waitForTimeout` that does not advance it turns every wait that is meant to run out
    // into an unbounded loop, so it advances the clock the way the polling harness does.
    const waitForTimeout: WaitForTimeoutSpy = vi.fn(async (ms: number) => {
      vi.advanceTimersByTime(ms);
    });
    return createScrollablePage({
      viewportHeight: VIEWPORT_HEIGHT,
      documentHeight: DOCUMENT_HEIGHT,
      waitForTimeout,
      ...overrides,
    });
  }

  it('reads a region below the fold instead of letting the capture throw', async () => {
    const harness = scrolledPage();

    await waitForCanvasPixels(harness.page, BELOW_THE_FOLD, always(true), { timeoutMs: 1_000 });

    expect(harness.clips()).toHaveLength(1);
    // Scrolled to the maximum the page allows (457), which puts the region at 291..451.
    expect(harness.clips()[0]).toEqual({ x: 176, y: 291, width: 320, height: 160 });
    expect(harness.clips()[0].y).toBeGreaterThanOrEqual(0);
    expect(harness.clips()[0].y + BELOW_THE_FOLD.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
  });

  it('scrolls a region above the fold back into view', async () => {
    // The measured `pen-types` shape, not a hypothetical one: the window is at 440 and the
    // clip sits at -240, i.e. the region is 200px above the top of the window. Note that
    // only a NEGATIVE viewport origin can be off screen this way — a clip at y=20 with the
    // window at 457 is at page 477, well inside the 457..1177 the viewport covers, and is
    // correctly left alone.
    const harness = scrolledPage({ initialScrollY: 440 });
    const aboveTheFold: Required<ClipOptions> = { x: 156, y: -240, width: 320, height: 120 };

    await waitForCanvasPixels(harness.page, aboveTheFold, always(true), { timeoutMs: 1_000 });

    // Read at page 200..320, and then put the window back where the caller had it rather
    // than stranding the rest of the test at the top of the page.
    expect(harness.clips()[0]).toEqual({ x: 156, y: 200, width: 320, height: 120 });
    expect(harness.scroll.scrollRequests()).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 440 },
    ]);
    expect(harness.scroll.scrollY()).toBe(440);
  });

  it('leaves a clip that is off neither edge alone, even with the window scrolled', async () => {
    const harness = scrolledPage({ initialScrollY: 440 });
    const inView: Required<ClipOptions> = { x: 176, y: 372, width: 320, height: 80 };

    await waitForCanvasPixels(harness.page, inView, always(true), { timeoutMs: 1_000 });

    expect(harness.scroll.scrollRequests()).toEqual([]);
    expect(harness.clips()).toEqual([inView]);
  });

  it('keeps reading the region it adjusted to on every later poll, not the original clip', async () => {
    const harness = scrolledPage();

    await waitForCanvasPixels(harness.page, BELOW_THE_FOLD, sequence(false, false, true), {
      timeoutMs: 10_000,
      pollIntervalMs: 100,
    });

    expect(harness.clips()).toHaveLength(3);
    for (const clip of harness.clips()) expect(clip).toEqual(harness.clips()[0]);
  });

  it('leaves the window where it found it once the read succeeds', async () => {
    const harness = scrolledPage({ initialScrollX: 12, initialScrollY: 0 });

    await waitForCanvasPixels(harness.page, BELOW_THE_FOLD, always(true), { timeoutMs: 1_000 });

    // The last request is the undo, and it restores BOTH axes to the pre-read position.
    expect(harness.scroll.scrollRequests().at(-1)).toEqual({ x: 12, y: 0 });
    expect(harness.scroll.scrollY()).toBe(0);
    expect(harness.scroll.scrollX()).toBe(12);
  });

  it('restores the window when the read gives up, so a later mouse drag is not moved', async () => {
    const harness = scrolledPage({ initialScrollY: 40 });

    await expect(
      waitForCanvasPixels(harness.page, BELOW_THE_FOLD, always(false), { timeoutMs: 300, pollIntervalMs: 100 })
    ).rejects.toThrow(/did not render/);

    expect(harness.scroll.scrollY()).toBe(40);
  });

  it('restores the window when the predicate itself throws', async () => {
    const harness = scrolledPage();
    const failure = new Error('bad clip');

    await expect(
      waitForCanvasPixels(harness.page, BELOW_THE_FOLD, () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(harness.scroll.scrollY()).toBe(0);
  });

  it('asks for no scroll at all when the region is already fully in view', async () => {
    const harness = scrolledPage();
    const inView: Required<ClipOptions> = { x: 176, y: 372, width: 320, height: 80 };

    await waitForCanvasPixels(harness.page, inView, always(true), { timeoutMs: 1_000 });

    expect(harness.scroll.scrollRequests()).toEqual([]);
    expect(harness.clips()).toEqual([inView]);
  });

  it('treats a region that only partly fits as out of view', async () => {
    // 700 + 80 = 780, past the 720px window. Trimming would silently return a 20px-tall
    // capture, which is a wrong answer rather than an error.
    const harness = scrolledPage();
    const straddling: Required<ClipOptions> = { x: 176, y: 700, width: 320, height: 80 };

    await waitForCanvasPixels(harness.page, straddling, always(true), { timeoutMs: 1_000 });

    expect(harness.scroll.scrollRequests()).not.toEqual([]);
    expect(harness.clips()[0].y + straddling.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
  });

  it('does not ask the page for a scroll it cannot perform', async () => {
    // A region taller than the window can never be fully in view; the request must still
    // land on the page's real scroll extent rather than somewhere unreachable.
    const harness = scrolledPage();
    const tallerThanTheWindow: Required<ClipOptions> = { x: 0, y: 0, width: 1280, height: 900 };

    await waitForCanvasPixels(harness.page, tallerThanTheWindow, always(true), { timeoutMs: 1_000 });

    for (const request of harness.scroll.scrollRequests()) {
      expect(request.y).toBeGreaterThanOrEqual(0);
      expect(request.y).toBeLessThanOrEqual(MAX_SCROLL_Y);
    }
  });
});

describe('canvasRedrawClip', () => {
  it('offsets the shared redraw region by the canvas origin', () => {
    expect(canvasRedrawClip(BOX)).toEqual({ x: 140, y: 115, width: 300, height: 100 });
  });

  it('follows CANVAS_REDRAW_CLIP for the size, and the box origin plus the clamp for the position', () => {
    // The SIZE is the constant's, unchanged by anything. The ORIGIN is the box plus the larger
    // of the constant and the letterbox the document sits inside — see the containment block
    // below for why the second half of that is there at all.
    const { offsetX, offsetY } = containFit(BOX);
    expect(canvasRedrawClip(BOX)).toEqual({
      x: BOX.x + Math.max(CANVAS_REDRAW_CLIP.x, offsetX),
      y: BOX.y + Math.max(CANVAS_REDRAW_CLIP.y, offsetY),
      width: CANVAS_REDRAW_CLIP.width,
      height: CANVAS_REDRAW_CLIP.height,
    });
  });

  it('keeps the region SIZE independent of the box size', () => {
    // Only the size, and deliberately not the position any more: the position IS a function of
    // the box, because a fixed box-relative origin photographs the letterbox on the tall boxes
    // and the containment block below is the case that used to fail silently. The old pin here
    // asserted the position too, and that assertion is what the clamp removed.
    for (const box of [
      { x: BOX.x, y: BOX.y, width: 4, height: 4 },
      { x: BOX.x, y: BOX.y, width: 5_000, height: 4_000 },
      { x: 0, y: 0, width: 974, height: 583 },
      { x: 0, y: 0, width: 974, height: 963 },
    ]) {
      const clip = canvasRedrawClip(box);
      expect(clip.width, `width for ${box.width}x${box.height}`).toBe(300);
      expect(clip.height, `height for ${box.width}x${box.height}`).toBe(100);
    }
  });

  it('returns the full region for a degenerate zero-size box instead of throwing', () => {
    const degenerate: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

    expect(() => canvasRedrawClip(degenerate)).not.toThrow();
    expect(canvasRedrawClip(degenerate)).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  it('keeps a negative origin arithmetic rather than clamping it', () => {
    // A negative box origin is arithmetic, not a letterbox: the clamp is on the offset WITHIN
    // the box, so the origin still adds rather than being discarded.
    expect(canvasRedrawClip({ x: -50, y: -20, width: 200, height: 200 })).toEqual({
      x: 50,
      y: 80,
      width: 300,
      height: 100,
    });
  });

  it('returns a fresh object so a caller cannot corrupt the shared constant', () => {
    const first = canvasRedrawClip(BOX);
    first.x = -1;
    first.width = 0;

    expect(canvasRedrawClip(BOX)).toEqual(BOX_CLIP);
    expect(CANVAS_REDRAW_CLIP).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });
});

/**
 * THE STANDARD CLIP LIES INSIDE THE LETTERBOXED DOCUMENT.
 *
 * The document is `object-fit: contain` inside the canvas element, so a fixed box-relative
 * region is photographing the letterbox as soon as the letterbox reaches it — and it does.
 * At the suite's 1280x720 the element is 974x583, the fit is height-limited at 0.9717, and the
 * horizontal letterbox is 98.33px, so `CANVAS_REDRAW_CLIP.x = 100` starts 1.67 CSS px inside
 * the document: a margin, not a containment. At the 1280x1100 `document-dialogs.spec.ts` uses,
 * the element is 974x963, the fit is WIDTH-limited at 1.2175 and the VERTICAL letterbox is
 * 116.25px, so the first 16.25 px of the clip are bare checkerboard TODAY.
 *
 * Harmless, and that is the shape worth naming: `#f3f3f3` is neither dark nor red, so
 * `hasDarkPixels` still finds the stroke and the assertion still passes. Nothing fails when the
 * region stops being the document — the region is simply still a region. `getStrokeAnalysis` is
 * the predicate that does NOT tolerate it, which is why F1 and this are the same defect seen
 * from two ends.
 *
 * So containment is asserted, for the boxes the suite actually measures. `canvasRedrawClip`
 * clamps its origin to `max(CANVAS_REDRAW_CLIP, letterboxOrigin)`; the size is untouched, and
 * that is safe for a reason worth stating: nothing can be painted outside the document rect, so
 * moving the region off the letterbox cannot move it off a stroke any spec drew.
 */
describe('canvasRedrawClip containment in the letterboxed document', () => {
  /**
   * The boxes the suite MEASURES, and the condition they share: the standard test line, at
   * box-relative (150,150)-(350,150), is itself inside the letterboxed document. That is what
   * makes containment and "contains the line" the same requirement here rather than two
   * competing ones — see the trade-off block below for the boxes where they are not.
   */
  const MEASURED_BOXES: { name: string; box: BoundingBox }[] = [
    // The suite default, from `devices['Desktop Chrome']` at 1280x720 with a 56px rail.
    { name: '1280x720 (the suite default)', box: { x: 56, y: 100, width: 974, height: 583 } },
    // `document-dialogs.spec.ts`'s `test.use({ viewport: 1280x1100 })`.
    { name: '1280x1100 (document-dialogs)', box: { x: 56, y: 100, width: 974, height: 963 } },
    // The overflowing layout the export baselines were recorded against.
    { name: 'the export baseline layout', box: { x: 56, y: 100, width: 974, height: 840 } },
    // The height that overflowed a desktop window before it was fixed.
    { name: 'the pre-fix overflow height', box: { x: 56, y: 100, width: 974, height: 890 } },
  ];

  /** The document rect inside `box`, in BOX-relative coordinates, as the app renders it. */
  const documentRectOf = (box: BoundingBox) => {
    const { scale, offsetX, offsetY } = containFit(box);
    return { x: offsetX, y: offsetY, width: DEFAULT_DOCUMENT_WIDTH * scale, height: DEFAULT_DOCUMENT_HEIGHT * scale };
  };

  const STANDARD_LINE = { x: LINE_START_X, y: LINE_START_Y, right: LINE_END_X, bottom: LINE_END_Y };

  it.each(MEASURED_BOXES)('keeps the clip inside the document at $name', ({ box }) => {
    const documentRect = documentRectOf(box);
    const clip = canvasRedrawClip(box);
    // Box-relative on both sides, so the box origin cancels and the numbers are the ones the
    // stylesheet's contain fit produces.
    const left = clip.x - box.x;
    const top = clip.y - box.y;

    expect(left).toBeGreaterThanOrEqual(documentRect.x);
    expect(top).toBeGreaterThanOrEqual(documentRect.y);
    expect(left + clip.width).toBeLessThanOrEqual(documentRect.x + documentRect.width);
    expect(top + clip.height).toBeLessThanOrEqual(documentRect.y + documentRect.height);
  });

  it.each(MEASURED_BOXES)('still contains the standard line the clip exists for, at $name', ({ box }) => {
    // Containment alone would be satisfied by a clip that had slid off the line and onto the
    // middle of the document, so the original purpose is asserted beside it — and the
    // precondition is checked first, because it is the thing that makes both hold at once.
    const clip = canvasRedrawClip(box);
    const left = clip.x - box.x;
    const top = clip.y - box.y;

    expect(STANDARD_LINE.x, 'the line is inside the document, so a contained clip can hold it').toBeGreaterThanOrEqual(
      documentRectOf(box).x
    );
    expect(STANDARD_LINE.y).toBeGreaterThanOrEqual(documentRectOf(box).y);
    expect(left).toBeLessThanOrEqual(STANDARD_LINE.x);
    expect(top).toBeLessThanOrEqual(STANDARD_LINE.y);
    expect(left + clip.width).toBeGreaterThanOrEqual(STANDARD_LINE.right);
    expect(top + clip.height).toBeGreaterThanOrEqual(STANDARD_LINE.bottom);
  });

  it('leaves the default viewport byte-identical to the unclamped constant', () => {
    // WHO IS SUBJECT TO THIS CLAMP, because naming the wrong specs here is what made this
    // comment false once already. The default-clip users are the specs that reach
    // `CANVAS_REDRAW_CLIP` without passing a clip of their own: the six that call
    // `canvasRedrawClip(box)` — `file-roundtrip`, `keyboard-shortcuts`, `document-dialogs`,
    // `history-panel`, `paint-tool-pixels`, `layers-panel` — plus every caller of
    // `waitForCanvasRedraw(page, box)`, which reaches the same default through the wrapper.
    //
    // The four that are NOT subject to it, and were wrongly named as its users, are
    // `adjustments`, `levels`, `filter-tools` and `color`: each deliberately waits on its own
    // contain-fit-derived `documentClipInBox(box)` instead. Derive the set with
    //   grep -rn "canvasRedrawClip(" e2e/ --include="*.ts"
    //   grep -rn "waitForCanvasRedraw(page, box" e2e/ --include="*.ts"
    // and read it rather than trusting a list in a comment, which is the whole reason this
    // paragraph now names the two greps instead of a roster.
    //
    // Of the default-clip users, only `document-dialogs` is measured at a box where the clamp
    // engages (974x963 — see the table below); the rest run at 1280x720, where it is a no-op.
    expect(canvasRedrawClip({ x: 56, y: 100, width: 974, height: 583 })).toEqual({
      x: 56 + 100,
      y: 100 + 100,
      width: 300,
      height: 100,
    });
    // And the margin it has to spare, recomputed rather than typed: the letterbox the clamp is
    // measured against. 1.67px is the whole reason this was latent and not live.
    const letterbox = containFit({ width: 974, height: 583 }).offsetX;
    expect(letterbox).toBeCloseTo(98.333, 2);
    expect(letterbox).toBeLessThan(CANVAS_REDRAW_CLIP.x);
  });

  it.each([
    // The slack each measured box leaves, and therefore whether the clamp engages. The numbers
    // are stated rather than recomputed because the margin between the two engaged states is
    // 1.67 CSS px at 1280x720 and 16.25 px at 1280x1100, and those two margins are the entire
    // reason the clip photographed the letterbox in one viewport and nearly did in the other.
    //
    // The condition, for anyone who wants it in one sentence: the clamp engages when the slack
    // on an axis exceeds twice `CANVAS_REDRAW_CLIP` — `boxWidth - documentWidth > 200`. It is
    // NOT a single formula in box terms, and that is worth knowing: the letterbox exists on an
    // axis only when that axis is the SLACK axis, so 974x583 is 98.33px of horizontal slack
    // and zero vertical, while 974x963 is exactly the reverse.
    {
      name: '1280x720',
      box: { width: 974, height: 583 },
      offsetX: 98.333,
      offsetY: 0,
      engaged: false,
    },
    {
      name: '1280x1100 (document-dialogs)',
      box: { width: 974, height: 963 },
      offsetX: 0,
      offsetY: 116.25,
      engaged: true,
    },
    {
      name: 'the export baseline layout',
      box: { width: 974, height: 840 },
      offsetX: 0,
      offsetY: 54.75,
      engaged: false,
    },
    {
      name: 'the pre-fix overflow height',
      box: { width: 974, height: 890 },
      offsetX: 0,
      offsetY: 79.75,
      engaged: false,
    },
    {
      name: 'a very wide, short box',
      box: { width: 1_600, height: 500 },
      offsetX: 466.667,
      offsetY: 0,
      engaged: true,
    },
    {
      name: 'a very tall, narrow box',
      box: { width: 500, height: 1_600 },
      offsetX: 0,
      offsetY: 612.5,
      engaged: true,
    },
  ])('measures $name slack as $offsetX x $offsetY, clamp engaged: $engaged', ({ box, offsetX, offsetY, engaged }) => {
    const fit = containFit(box);

    expect(fit.offsetX).toBeCloseTo(offsetX, 2);
    expect(fit.offsetY).toBeCloseTo(offsetY, 2);

    const clip = canvasRedrawClip({ x: 0, y: 0, ...box });
    const hasMoved = clip.x !== CANVAS_REDRAW_CLIP.x || clip.y !== CANVAS_REDRAW_CLIP.y;

    expect(hasMoved).toBe(engaged);
  });
});

/**
 * WHERE CONTAINMENT AND "CONTAINS THE LINE" ARE MUTUALLY UNSATISFIABLE.
 *
 * Past a point the letterbox swallows the standard test line itself, and no clip can then be
 * both inside the document and over the line — the line would be at a box-relative coordinate
 * where no stroke can be painted, because painting happens in the document. The clamp resolves
 * that by keeping containment, which is the only one of the two that can be satisfied.
 *
 * The two boxes are extreme on purpose and are NOT the suite's: a 1600x500 canvas box is one
 * no viewport produces, and a 500x1600 one is a portrait window. They are here to state the
 * trade-off rather than leave it to be discovered, because the alternative — a clip that tracks
 * the line wherever the line is — is precisely the unclamped behaviour that photographs the
 * letterbox.
 */
describe('canvasRedrawClip where the letterbox swallows the standard line', () => {
  it.each([
    { name: 'a very wide, short box', box: { x: 0, y: 0, width: 1_600, height: 500 } },
    { name: 'a very tall, narrow box', box: { x: 0, y: 0, width: 500, height: 1_600 } },
  ])('keeps containment and gives up the line on $name', ({ box }) => {
    const { scale, offsetX, offsetY } = containFit(box);
    const clip = canvasRedrawClip(box);

    // The precondition: the line really is outside the document here, on whichever axis the
    // slack falls — 1600x500 is wide, so it is the horizontal letterbox; 500x1600 is tall, so
    // it is the vertical one. Asserting both axes would fail on each box for the wrong reason.
    const lineIsOutside = LINE_START_X < offsetX || LINE_START_Y < offsetY;
    expect(lineIsOutside).toBe(true);
    expect(clip.x - box.x).toBeGreaterThanOrEqual(offsetX);
    // And containment still holds, which is the half that survived.
    expect(clip.x - box.x + clip.width).toBeLessThanOrEqual(offsetX + DEFAULT_DOCUMENT_WIDTH * scale);
    expect(clip.y - box.y).toBeGreaterThanOrEqual(offsetY);
    expect(clip.y - box.y + clip.height).toBeLessThanOrEqual(offsetY + DEFAULT_DOCUMENT_HEIGHT * scale);
  });
});

describe('waitForCanvasRedraw', () => {
  it('captures the box-relative redraw region and returns once a dark pixel appears', async () => {
    const harness = createPollingPage();
    harness.screenshot
      .mockResolvedValueOnce(await createTestImage(WHITE))
      .mockResolvedValue(await createTestImage(DARK_GRAY));

    await expect(waitForCanvasRedraw(harness.page, BOX)).resolves.toBeUndefined();

    expect(harness.clips()).toEqual([BOX_CLIP, BOX_CLIP]);
    expect(harness.screenshot).toHaveBeenCalledTimes(2);
    expect(harness.waitForTimeout).toHaveBeenCalledTimes(1);
  });

  it('uses the very clip canvasRedrawClip derives, so the two entry points cannot drift', async () => {
    const harness = createPollingPage(await createTestImage(BLACK));

    await waitForCanvasRedraw(harness.page, BOX);

    expect(harness.clips()).toEqual([canvasRedrawClip(BOX)]);
    expect(harness.clips()).toEqual([BOX_CLIP]);
  });

  it('lets an explicit clip option override the derived region entirely', async () => {
    const harness = createPollingPage(await createTestImage(BLACK));
    const clip: ClipOptions = { x: 5, y: 6, width: 70, height: 80 };

    await waitForCanvasRedraw(harness.page, BOX, { clip });

    expect(harness.clips()).toEqual([{ x: 5, y: 6, width: 70, height: 80 }]);
  });

  it('keeps the derived region for the fields a partial clip option omits', async () => {
    const harness = createPollingPage(await createTestImage(BLACK));

    await waitForCanvasRedraw(harness.page, BOX, { clip: { x: 5, width: 70 } });

    expect(harness.clips()).toEqual([{ x: 5, y: BOX.y + CANVAS_REDRAW_CLIP.y, width: 70, height: 100 }]);
  });

  it('rejects with the documented dark-pixel message naming the default 10000ms timeout', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, 1, 1));

    await expect(waitForCanvasRedraw(harness.page, BOX)).rejects.toThrow(
      `Canvas did not render dark pixels within ${CANVAS_REDRAW_TIMEOUT_MS}ms`
    );

    expect(harness.waitForTimeout).toHaveBeenCalledTimes(CANVAS_REDRAW_TIMEOUT_MS / CANVAS_REDRAW_POLL_INTERVAL_MS);
    expect(new Set(harness.waitForTimeout.mock.calls.flat())).toEqual(new Set([CANVAS_REDRAW_POLL_INTERVAL_MS]));
  });

  it('rejects with the injected timeout and poll interval when the caller supplies them', async () => {
    const harness = createPollingPage(await createTestImage(WHITE, 1, 1));

    await expect(waitForCanvasRedraw(harness.page, BOX, { timeoutMs: 200, pollIntervalMs: 50 })).rejects.toThrow(
      'Canvas did not render dark pixels within 200ms'
    );

    expect(harness.screenshot).toHaveBeenCalledTimes(5);
    expect(harness.waitForTimeout.mock.calls).toEqual([[50], [50], [50], [50]]);
  });

  it('keeps polling for a light-gray stroke that never reads as dark', async () => {
    const spray = await createTestImage(SPRAY_GRAY);
    expect(await hasDarkPixels(spray)).toBe(false);
    const harness = createPollingPage(spray);

    await expect(waitForCanvasRedraw(harness.page, BOX, { timeoutMs: 0 })).rejects.toThrow(
      'Canvas did not render dark pixels within 0ms'
    );

    expect(harness.screenshot).toHaveBeenCalledTimes(1);
    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });

  it('does not mistake a fully transparent capture for a dark stroke', async () => {
    const transparent = await createTestImage(BLACK, 2, 2, 0);
    expect(await hasDarkPixels(transparent)).toBe(false);
    const harness = createPollingPage(transparent);

    await expect(waitForCanvasRedraw(harness.page, BOX, { timeoutMs: 0 })).rejects.toThrow(
      'Canvas did not render dark pixels within 0ms'
    );
  });

  it('accepts a capture whose only dark pixel is a single one', async () => {
    const harness = createPollingPage(await createTestImage(BLACK, 1, 1));

    await expect(waitForCanvasRedraw(harness.page, BOX)).resolves.toBeUndefined();

    expect(harness.screenshot).toHaveBeenCalledTimes(1);
  });

  it('propagates a capture failure rather than retrying it', async () => {
    const harness = createPollingPage();
    const failure = new Error('target closed');
    harness.screenshot.mockRejectedValue(failure);

    await expect(waitForCanvasRedraw(harness.page, BOX)).rejects.toBe(failure);

    expect(harness.waitForTimeout).not.toHaveBeenCalled();
  });
});
