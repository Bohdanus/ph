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
  createPageMock,
  createScreenshotSpy,
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
