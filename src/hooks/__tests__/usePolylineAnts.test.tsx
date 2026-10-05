import { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { useMarchingPath } from '../usePolylineAnts';

function createRafMocks() {
  const frames: Map<number, FrameRequestCallback> = new Map();
  /** The pending `setTimeout` behind each frame, so a cancel can stop its delivery. */
  const timers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  // Starts at 1, not 0. HTML Standard §8.12 makes the handle a pre-increment of a counter
  // that "must initially be zero", so the identifiers a user agent hands back are 1, 2, 3,
  // … and 0 is unreachable. Counting from 0 here manufactured the one input that trips
  // `usePolylineAnts`'s truthiness guards (`if (animationIdRef.current)`), which is why the
  // tests below pass against `useMarchingPath` and could not be trusted: they were pinned to
  // an artefact of the mock. `usePolylineAnts.animation.test.tsx` states the same rule.
  let nextId = 1;

  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    // The handle is removed when the callback RUNS, not only when it is cancelled, so
    // `frames` means "requests a browser would still deliver". Without this the map
    // accumulated every frame ever asked for and `frames.size` after a cancel counted
    // the frame that had already fired — which is how a loop that correctly cancelled
    // itself still read as one pending frame.
    //
    // The matching half is on the timer: a cancelled frame must not be delivered either.
    // `setTimeout` was left running on cancel, so `clear()` removed the handle from
    // `frames` while the callback was still queued to fire on the next advance.
    const timer = setTimeout(() => {
      frames.delete(id);
      callback(performance.now());
    }, 16);
    timers.set(id, timer);
    frames.set(id, callback);
    return id;
  });

  const cancelAnimationFrame = vi.fn((id: number) => {
    frames.delete(id);
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
  });

  return { requestAnimationFrame, cancelAnimationFrame, frames, getNextId: () => nextId };
}

describe('useMarchingPath basic behavior', () => {
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;
  let origPath2D: typeof Path2D | undefined;
  let rafMocks: ReturnType<typeof createRafMocks>;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;
    origPath2D = globalThis.Path2D;

    vi.useFakeTimers();

    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;

    globalThis.Path2D = vi.fn().mockImplementation(function MockPath2D() {
      return {
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
      };
    }) as unknown as typeof Path2D;
  });

  afterEach(() => {
    vi.useRealTimers();

    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    if (origPath2D) {
      globalThis.Path2D = origPath2D;
    } else {
      delete (globalThis as { Path2D?: typeof Path2D }).Path2D;
    }
    vi.restoreAllMocks();
  });

  function makeCtx() {
    return {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }

  it('draw() schedules a requestAnimationFrame', () => {
    const apiRef: { current: ReturnType<typeof useMarchingPath> | null } = { current: null };
    const mockCtx = makeCtx();
    const mockCanvas = {
      width: 100,
      height: 100,
      getContext: () => mockCtx,
    } as unknown as HTMLCanvasElement;

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(mockCanvas);
      const api = useMarchingPath({
        canvasRef,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        isPaused: true,
      });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    act(() => {
      apiRef.current!.draw();
    });

    // Exactly one frame, under the exact identifier the first handle is: a `draw()` that
    // scheduled two loops would still satisfy "greater than 0".
    expect(rafMocks.requestAnimationFrame).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
    expect([...rafMocks.frames.keys()]).toEqual([1]);
  });

  it('draw() actually draws on the canvas each frame', () => {
    const apiRef: { current: ReturnType<typeof useMarchingPath> | null } = { current: null };
    const mockCtx = makeCtx();
    const mockCanvas = {
      width: 100,
      height: 100,
      getContext: () => mockCtx,
    } as unknown as HTMLCanvasElement;

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(mockCanvas);
      const api = useMarchingPath({
        canvasRef,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        isPaused: true,
      });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    act(() => {
      apiRef.current!.draw();
    });

    // Frame not flushed yet: nothing drawn.
    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // After one frame the path is stroked once per ant pass and the canvas is cleared first.
    // EXACT counts, because "more than zero" is satisfied by a loop that painted the same
    // contour four times, which is what a stray extra stroke would look like.
    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBe(2);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBe(1);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls[0]).toEqual([0, 0, 100, 100]);
  });

  it('clear() cancels the animation and clears the canvas', () => {
    const apiRef: { current: ReturnType<typeof useMarchingPath> | null } = { current: null };
    const mockCtx = makeCtx();
    const mockCanvas = {
      width: 42,
      height: 42,
      getContext: () => mockCtx,
    } as unknown as HTMLCanvasElement;

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(mockCanvas);
      const api = useMarchingPath({
        canvasRef,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        isPaused: true,
      });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    act(() => {
      apiRef.current!.draw();
    });

    // Let one frame actually draw before cancelling.
    act(() => {
      vi.advanceTimersByTime(16);
    });

    // `clear()` cancels the handle the LOOP scheduled (the second one), not merely any
    // handle. It also issues a second clear, and the COUNT is what proves that: this
    // canvas is 42x42, so the per-frame clear and the full-canvas clear are byte-identical
    // `clearRect(0, 0, 42, 42)` calls and the arguments cannot tell them apart.
    const loopHandle = [...rafMocks.frames.keys()].at(-1)!;
    act(() => {
      apiRef.current!.clear();
    });

    expect(rafMocks.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(loopHandle);
    expect(rafMocks.frames.size).toBe(0);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBe(2);
    const lastClearRect = (mockCtx.clearRect as unknown as Mock).mock.calls.slice(-1)[0];
    expect(lastClearRect).toEqual([0, 0, 42, 42]);
  });
});
