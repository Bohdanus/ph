import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Page } from '@playwright/test';
import { canvasRedrawClip, waitForCanvasPixels, type CanvasPixelPredicate } from '../canvas-redraw';
import {
  CANVAS_REDRAW_CLIP,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  CANVAS_REDRAW_TIMEOUT_MS,
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

  it('follows CANVAS_REDRAW_CLIP for both the offset and the size', () => {
    expect(canvasRedrawClip(BOX)).toEqual({
      x: BOX.x + CANVAS_REDRAW_CLIP.x,
      y: BOX.y + CANVAS_REDRAW_CLIP.y,
      width: CANVAS_REDRAW_CLIP.width,
      height: CANVAS_REDRAW_CLIP.height,
    });
  });

  it('keeps the region size independent of the box size', () => {
    expect(canvasRedrawClip({ x: BOX.x, y: BOX.y, width: 4, height: 4 })).toEqual(BOX_CLIP);
    expect(canvasRedrawClip({ x: BOX.x, y: BOX.y, width: 5_000, height: 4_000 })).toEqual(BOX_CLIP);
  });

  it('returns the full region for a degenerate zero-size box instead of throwing', () => {
    const degenerate: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

    expect(() => canvasRedrawClip(degenerate)).not.toThrow();
    expect(canvasRedrawClip(degenerate)).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  it('keeps a negative origin arithmetic rather than clamping it', () => {
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
