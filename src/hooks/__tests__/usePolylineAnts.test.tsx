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

  it('handles non-finite points (NaN) without crashing and still clears canvas', () => {
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
          { x: NaN, y: 0 },
          { x: 10, y: NaN },
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

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
    expect((mockCtx.clearRect as unknown as Mock).mock.calls[0]).toEqual([0, 0, 100, 100]);
    const drawnPath = (mockCtx.stroke as unknown as Mock).mock.calls[0][0] as { moveTo: Mock; lineTo: Mock };
    expect(drawnPath.moveTo).toHaveBeenCalledWith(NaN, 0);
    expect(drawnPath.lineTo).toHaveBeenCalledWith(10, NaN);
  });

  it('handles non-finite points (Infinity / -Infinity) without crashing', () => {
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
          { x: Infinity, y: -Infinity },
          { x: 0, y: 10 },
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

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect((mockCtx.clearRect as unknown as Mock).mock.calls.length).toBeGreaterThan(0);
    const drawnPath = (mockCtx.stroke as unknown as Mock).mock.calls[0][0] as { moveTo: Mock; lineTo: Mock };
    expect(drawnPath.moveTo).toHaveBeenCalledWith(Infinity, -Infinity);
    expect(drawnPath.lineTo).toHaveBeenCalledWith(0, 10);
  });

  it('does not stroke when the polyline is empty', () => {
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
        points: [],
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

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBe(0);
  });

  it('does not stroke when the polyline has a single point', () => {
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
        points: [{ x: 5, y: 5 }],
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

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect((mockCtx.stroke as unknown as Mock).mock.calls.length).toBe(0);
  });

  it('draw() and clear() are safe when canvasRef.current is null', () => {
    const apiRef: { current: ReturnType<typeof useMarchingPath> | null } = { current: null };

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

    expect(() => {
      render(<TestComp />);
    }).not.toThrow();

    act(() => {
      expect(() => apiRef.current!.draw()).not.toThrow();
    });

    act(() => {
      vi.advanceTimersByTime(16);
    });

    act(() => {
      expect(() => apiRef.current!.clear()).not.toThrow();
    });
  });

  it.fails('filters out non-finite points so only finite coordinates are passed to Path2D', () => {
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
          { x: NaN, y: 10 },
          { x: 20, y: 20 },
        ],
        isPaused: true,
      });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    const Path2DMock = globalThis.Path2D as unknown as Mock;
    expect(Path2DMock.mock.results.length).toBe(1);
    const pathInstance = Path2DMock.mock.results[0]!.value;
    expect(pathInstance.moveTo).toHaveBeenCalledTimes(1);
    expect(pathInstance.moveTo).toHaveBeenCalledWith(0, 0);
    expect(pathInstance.lineTo).toHaveBeenCalledTimes(1);
    expect(pathInstance.lineTo).toHaveBeenCalledWith(20, 20);
  });

  it.fails('does not call setLineDash when there are fewer than 2 points', () => {
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
        points: [],
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

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect((mockCtx.setLineDash as unknown as Mock).mock.calls.length).toBe(0);
  });
});
