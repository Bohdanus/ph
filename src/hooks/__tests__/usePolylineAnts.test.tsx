import { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { useMarchingPath } from '../usePolylineAnts';

const testGlobal = globalThis as typeof globalThis & { Path2D?: typeof Path2D };

describe('useMarchingPath basic behavior', () => {
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;
  let origPath2D: typeof Path2D | undefined;

  beforeEach(() => {
    // Capture the real globals before faking timers. The hook's animate loop
    // reschedules itself via setTimeout(cb, 16) (our rAF shim), so with fake
    // timers every frame is fully controlled by the test. vi.useRealTimers()
    // in afterEach discards any pending frames instead of letting a late
    // callback fire against a restored (undefined) requestAnimationFrame.
    origRaf = testGlobal.requestAnimationFrame;
    origCancel = testGlobal.cancelAnimationFrame;
    origPath2D = testGlobal.Path2D;

    vi.useFakeTimers();

    testGlobal.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(cb as TimerHandler, 16) as unknown as number;
    });

    testGlobal.cancelAnimationFrame = vi.fn((id: number) => {
      clearTimeout(id as unknown as number);
    });

    testGlobal.Path2D = vi.fn().mockImplementation(function MockPath2D() {
      return {
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
      };
    }) as unknown as typeof Path2D;
  });

  afterEach(() => {
    // Restoring real timers also clears pending fake timers, which is what
    // prevents the unhandled "requestAnimationFrame is not defined" error.
    vi.useRealTimers();

    testGlobal.requestAnimationFrame = origRaf;
    testGlobal.cancelAnimationFrame = origCancel;
    if (origPath2D) {
      testGlobal.Path2D = origPath2D;
    } else {
      delete (testGlobal as { Path2D?: typeof Path2D }).Path2D;
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
    const apiRef: { current: any } = { current: null };
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
      apiRef.current.draw();
    });

    expect((testGlobal.requestAnimationFrame as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('draw() actually draws on the canvas each frame', () => {
    const apiRef: { current: any } = { current: null };
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
      apiRef.current.draw();
    });

    // Frame not flushed yet: nothing drawn.
    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(16);
    });

    // After one frame the path is stroked and the canvas is cleared first.
    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls[0]).toEqual([0, 0, 100, 100]);
  });

  it('clear() cancels the animation and clears the canvas', () => {
    const apiRef: { current: any } = { current: null };
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
      apiRef.current.draw();
    });

    // Let one frame actually draw before cancelling.
    act(() => {
      vi.advanceTimersByTime(16);
    });

    act(() => {
      apiRef.current.clear();
    });

    // cancelAnimationFrame should have been called when clear() was invoked.
    expect((testGlobal.cancelAnimationFrame as unknown as Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    // The canvas should have been cleared (both by animate and by clear()).
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    const lastClearRect = (mockCtx.clearRect as unknown as Mock).mock.calls.slice(-1)[0];
    expect(lastClearRect).toEqual([0, 0, 42, 42]);
  });
});
