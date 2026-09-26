import { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { useMarchingPath } from '../usePolylineAnts';

function createRafMocks() {
  const frames: Map<number, FrameRequestCallback> = new Map();
  let nextId = 0;

  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    // Use setTimeout to work with fake timers
    setTimeout(callback, 16);
    return id;
  });

  const cancelAnimationFrame = vi.fn((id: number) => {
    frames.delete(id);
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

    expect(rafMocks.requestAnimationFrame.mock.calls.length).toBeGreaterThan(0);
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

    // After one frame the path is stroked and the canvas is cleared first.
    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
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

    act(() => {
      apiRef.current!.clear();
    });

    // cancelAnimationFrame should have been called when clear() was invoked.
    expect(rafMocks.cancelAnimationFrame.mock.calls.length).toBeGreaterThanOrEqual(1);
    // The canvas should have been cleared (both by animate and by clear()).
    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    const lastClearRect = (mockCtx.clearRect as unknown as Mock).mock.calls.slice(-1)[0];
    expect(lastClearRect).toEqual([0, 0, 42, 42]);
  });
});
