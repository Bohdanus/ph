import React, { useEffect, useRef } from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useMarchingPath } from '../usePolylineAnts';

describe('useMarchingPath basic behavior', () => {
  let origRaf: any;
  let origCancel: any;

  beforeEach(() => {
    // Provide simple rAF/cancel implementations that use setTimeout so we can
    // observe calls. We wrap them with vi.fn so assertions are possible.
    origRaf = global.requestAnimationFrame;
    origCancel = global.cancelAnimationFrame;

    global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      // schedule the callback but return the timeout id as the raf id
      return setTimeout(cb as TimerHandler, 16) as unknown as number;
    });

    global.cancelAnimationFrame = vi.fn((id: number) => {
      clearTimeout(id as unknown as number);
    });
  });

  afterEach(() => {
    // restore
    global.requestAnimationFrame = origRaf;
    global.cancelAnimationFrame = origCancel;
    vi.restoreAllMocks();
  });

  it('draw() schedules a requestAnimationFrame', () => {
    const apiRef: { current: any } = { current: null };

    const mockCtx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = { width: 100, height: 100, getContext: () => mockCtx } as unknown as HTMLCanvasElement;

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(mockCanvas);
      const api = useMarchingPath({ canvasRef, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], isPaused: true });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    act(() => {
      apiRef.current.draw();
    });

    expect((global.requestAnimationFrame as unknown as vi.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('clear() cancels the animation and clears the canvas', () => {
    const apiRef: { current: any } = { current: null };

    const mockCtx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const mockCanvas = { width: 42, height: 42, getContext: () => mockCtx } as unknown as HTMLCanvasElement;

    function TestComp() {
      const canvasRef = useRef<HTMLCanvasElement | null>(mockCanvas);
      const api = useMarchingPath({ canvasRef, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], isPaused: false });
      useEffect(() => {
        apiRef.current = api;
      }, [api]);
      return null;
    }

    render(<TestComp />);

    act(() => {
      // start animation
      apiRef.current.draw();
    });

    act(() => {
      apiRef.current.clear();
    });

    // cancelAnimationFrame should have been called when clear() was invoked
    expect((global.cancelAnimationFrame as unknown as vi.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    // the canvas clearRect should also have been called
    expect((mockCtx.clearRect as unknown as vi.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
