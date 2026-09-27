import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASH_LENGTH, LINE_WIDTH, SPEED } from '../useAnts.ts';
import { useMarchingPath, type UseMarchingPathProps } from '../usePolylineAnts.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

/**
 * Lifecycle coverage for `useMarchingPath`.
 *
 * `usePolylineAnts.test.tsx` is a protected gold file that pins the paused
 * draw/clear happy path. This file covers the rest of the hook: the degenerate
 * point sets, the pause toggle, the dash-offset bookkeeping, prop updates, and
 * the early returns when the canvas or its context is missing.
 */

const POINTS = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 20, y: 0 },
];

function createRafMocks() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;

  return {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      frames.delete(id);
    }),
    frames,
  };
}

describe('useMarchingPath animation lifecycle', () => {
  let rafMocks: ReturnType<typeof createRafMocks>;
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;
    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    // NOTE: `vi.restoreAllMocks()` must not run before RTL unmounts the hook --
    // the hook's unmount cleanup calls `canvas.getContext('2d')`, and with the
    // prototype stub from `src/test/setup.ts` already restored that reaches
    // jsdom's unimplemented canvas context. The setup file re-installs its stub
    // on every `beforeEach`, so nothing leaks between tests.
  });

  type RenderProps = Omit<UseMarchingPathProps, 'canvasRef'>;

  function setup(props: Partial<RenderProps> = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 50;
    const ctx = createMockCanvasContext(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue(ctx);
    const canvasRef = { current: canvas as HTMLCanvasElement | null };

    const hook = renderHook((current: RenderProps) => useMarchingPath({ ...current, canvasRef }), {
      initialProps: { points: POINTS, ...props } as RenderProps,
    });

    const frame = () => {
      const pending = [...rafMocks.frames.values()];
      rafMocks.frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    };

    return { ...hook, ctx, canvas, canvasRef, frame };
  }

  it('strokes two ant passes per frame and advances the dash offset', () => {
    const offsets: number[] = [];
    const { ctx, frame } = setup();
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
    });

    expect(rafMocks.frames.size).toBe(1);
    frame();

    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 100, 50);
    expect(ctx.setLineDash).toHaveBeenCalledWith([DASH_LENGTH, DASH_LENGTH]);
    expect(ctx.lineWidth).toBe(LINE_WIDTH);
    expect(offsets).toEqual([0, DASH_LENGTH]);

    frame();
    expect(offsets).toEqual([0, DASH_LENGTH, -SPEED, -SPEED + DASH_LENGTH]);
  });

  it('freezes the dash offset while paused but keeps the loop alive', () => {
    const offsets: number[] = [];
    const { result, ctx, frame } = setup({ isPaused: true });
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
    });

    // Paused on mount: nothing is scheduled by the hook itself.
    expect(rafMocks.frames.size).toBe(0);

    act(() => {
      result.current.draw();
    });
    frame();
    frame();

    expect(offsets).toEqual([0, DASH_LENGTH, 0, DASH_LENGTH]);
  });

  it('stops the loop when paused and restarts it when unpaused', () => {
    const { rerender, frame } = setup();
    expect(rafMocks.frames.size).toBe(1);
    frame();
    expect(rafMocks.frames.size).toBe(1);

    rerender({ points: POINTS, isPaused: true });
    expect(rafMocks.frames.size).toBe(0);
    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalled();

    rerender({ points: POINTS, isPaused: false });
    expect(rafMocks.frames.size).toBe(1);
  });

  it.fails('stops the loop when paused before the first frame has run (src/hooks/usePolylineAnts.ts:141)', () => {
    // Product defect: the effect cleanup guards on `if (animationIdRef.current)`,
    // and the first frame handle is 0. Pausing while frame 0 is still pending
    // therefore never cancels it, so the animation loop keeps running (frozen,
    // but never stopping) for the lifetime of the component. The pause branch
    // in the effect body is gone; this cleanup guard is the only remaining
    // falsy-0 path.
    const { rerender } = setup();
    expect([...rafMocks.frames.keys()]).toEqual([0]);

    rerender({ points: POINTS, isPaused: true });

    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledWith(0);
    expect(rafMocks.frames.size).toBe(0);
  });

  it('bounds the dash offset instead of growing without limit', () => {
    const offsets: number[] = [];
    const { ctx, frame } = setup({ speed: 999 });
    vi.mocked(ctx.stroke).mockImplementation(() => {
      offsets.push(ctx.lineDashOffset);
    });

    frame();
    frame();
    frame();

    // -1998 wraps back into the [ -999 .. 0 ] window (see DASH_OFFSET_CYCLE).
    expect(offsets).toEqual([0, DASH_LENGTH, -999, -999 + DASH_LENGTH, -998, -998 + DASH_LENGTH]);
  });

  it.each([
    ['no points', []],
    ['a single point', [{ x: 5, y: 5 }]],
  ])('clears but never strokes for %s', (_name, points) => {
    const { ctx, frame } = setup({ points });

    frame();

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 100, 50);
  });

  it('rebuilds the path when the points change and drops it when they degenerate', () => {
    const { ctx, rerender, frame } = setup();

    frame();
    const first = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(first.moveTo).toHaveBeenCalledWith(0, 0);

    rerender({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    frame();
    const second = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(second).not.toBe(first);
    expect(second.moveTo).toHaveBeenCalledWith(1, 2);
    expect(second.lineTo).toHaveBeenCalledWith(3, 4);

    rerender({ points: [] });
    vi.mocked(ctx.stroke).mockClear();
    frame();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('applies custom dash, gap and line-width props', () => {
    const { ctx, rerender, frame } = setup({ dashLength: 3, gapLength: 9, lineWidth: 4 });
    frame();

    expect(ctx.setLineDash).toHaveBeenCalledWith([3, 9]);
    expect(ctx.lineWidth).toBe(4);

    rerender({ points: POINTS, dashLength: 12, gapLength: 2, lineWidth: 5 });
    frame();
    expect(ctx.setLineDash).toHaveBeenLastCalledWith([12, 2]);
    expect(ctx.lineWidth).toBe(5);
  });

  it('cancels the pending frame when draw is called again', () => {
    const { result, frame } = setup();
    // Consume frame 0 so the pending id is a non-zero value.
    frame();
    const pendingId = [...rafMocks.frames.keys()][0];
    expect(pendingId).toBeGreaterThan(0);

    act(() => {
      result.current.draw();
    });

    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledWith(pendingId);
    expect(rafMocks.frames.size).toBe(1);
  });

  it.fails('cancels the very first pending frame when draw is called again (src/hooks/usePolylineAnts.ts:124)', () => {
    // Product defect: the guard is `if (animationIdRef.current)`, and the first
    // frame handle a fresh hook receives is 0. A falsy 0 skips the
    // cancelAnimationFrame, so the first loop is never cancelled and a second
    // animation loop runs in parallel (the ants march at double speed).
    const { result, frame } = setup();
    const firstId = [...rafMocks.frames.keys()][0];
    expect(firstId).toBe(0);

    act(() => {
      result.current.draw();
    });

    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledWith(firstId);
    expect(rafMocks.frames.size).toBe(1);

    frame();
    expect(rafMocks.frames.size).toBe(1);
  });

  it('drops the frame when the canvas is detached mid-animation', () => {
    const { ctx, canvasRef, frame } = setup();
    canvasRef.current = null;

    expect(() => frame()).not.toThrow();

    expect(ctx.stroke).not.toHaveBeenCalled();
    // The loop ends instead of rescheduling against a missing canvas.
    expect(rafMocks.frames.size).toBe(0);
  });

  it('drops the frame when the canvas has no 2d context', () => {
    const { canvas, frame } = setup();
    vi.mocked(canvas.getContext).mockReturnValue(null);

    expect(() => frame()).not.toThrow();
    expect(rafMocks.frames.size).toBe(0);
  });

  it('tolerates clear without a canvas and without a context', () => {
    const { result, canvas, canvasRef } = setup();

    canvasRef.current = null;
    expect(() => {
      result.current.clear();
    }).not.toThrow();

    canvasRef.current = canvas;
    vi.mocked(canvas.getContext).mockReturnValue(null);
    expect(() => {
      result.current.clear();
    }).not.toThrow();
  });

  it('clears the canvas and stops the loop on unmount', () => {
    const { ctx, unmount, frame } = setup();
    frame();
    vi.mocked(ctx.clearRect).mockClear();

    unmount();

    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(rafMocks.frames.size).toBe(0);
  });
});
