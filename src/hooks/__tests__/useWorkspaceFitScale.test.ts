import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({
  store: {
    containerRef: { current: null as HTMLElement | null },
    totalSize: { width: 200, height: 100 },
  },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store],
}));

import { useWorkspaceFitScale } from '../useWorkspaceFitScale.ts';

function setClientViewport(
  element: HTMLElement,
  { clientWidth, clientHeight, offsetWidth, offsetHeight }: Record<string, number>
) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    clientHeight: { configurable: true, value: clientHeight },
    offsetWidth: { configurable: true, value: offsetWidth },
    offsetHeight: { configurable: true, value: offsetHeight },
  });
}

function createViewport(width = 415, height = 220) {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({
      left: 50,
      top: 100,
      width,
      height,
      right: 50 + width,
      bottom: 100 + height,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  setClientViewport(element, {
    clientWidth: 385,
    clientHeight: 200,
    offsetWidth: 415,
    offsetHeight: 220,
  });
  return element;
}

function resizeEntry(borderWidth: number, borderHeight: number): ResizeObserverEntry {
  return {
    contentRect: DOMRect.fromRect({ x: 0, y: 0, width: borderWidth, height: borderHeight }),
    contentBoxSize: [{ inlineSize: borderWidth, blockSize: borderHeight }],
    borderBoxSize: [{ inlineSize: borderWidth, blockSize: borderHeight }],
    devicePixelContentBoxSize: [],
    target: document.createElement('div'),
  } as unknown as ResizeObserverEntry;
}

class ControllableResizeObserver implements ResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  emit(entry: ResizeObserverEntry) {
    this.callback([entry], this);
  }
}

afterEach(() => {
  store.containerRef.current = null;
  store.totalSize = { width: 200, height: 100 };
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ControllableResizeObserver.instances = [];
});

describe('useWorkspaceFitScale', () => {
  it('fits the document into the measured client viewport, including borders and scrollbars', () => {
    store.containerRef.current = createViewport();

    const { result } = renderHook(() => useWorkspaceFitScale());

    expect(result.current).toBe(1.925);
  });

  it('keeps the last valid scale while document dimensions are unavailable', () => {
    store.containerRef.current = createViewport();
    store.totalSize = { width: 400, height: 200 };

    const { result, rerender } = renderHook(() => useWorkspaceFitScale());
    expect(result.current).toBe(0.9625);

    store.totalSize = { width: 0, height: 100 };
    rerender();
    expect(result.current).toBe(0.9625);

    store.totalSize = { width: 400, height: 200 };
    rerender();
    expect(result.current).toBe(0.9625);
  });

  it('keeps the default scale when no container or measurable viewport is available', () => {
    const { result, rerender } = renderHook(() => useWorkspaceFitScale());
    expect(result.current).toBe(1);

    const zeroSizeViewport = createViewport(0, 0);
    setClientViewport(zeroSizeViewport, {
      clientWidth: 0,
      clientHeight: 0,
      offsetWidth: 0,
      offsetHeight: 0,
    });
    store.containerRef.current = zeroSizeViewport;
    rerender();
    expect(result.current).toBe(1);
  });

  it('does not remeasure on rerenders when the inputs are unchanged', () => {
    const element = createViewport();
    const getBoundingClientRect = vi.spyOn(element, 'getBoundingClientRect');
    store.containerRef.current = element;

    const { rerender } = renderHook(() => useWorkspaceFitScale());
    const measurementsAfterMount = getBoundingClientRect.mock.calls.length;
    rerender();
    rerender();

    expect(measurementsAfterMount).toBe(1);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(measurementsAfterMount);
  });

  it('preserves fractional CSS viewport dimensions with integer DOM client metrics', () => {
    const element = createViewport(333.333, 222.222);
    setClientViewport(element, {
      clientWidth: 333,
      clientHeight: 222,
      offsetWidth: 333,
      offsetHeight: 222,
    });
    store.containerRef.current = element;
    store.totalSize = { width: 1000, height: 666.666 };

    const { result } = renderHook(() => useWorkspaceFitScale());

    expect(result.current).toBeCloseTo(0.333333, 5);
  });

  describe('resize observer integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('recalculates the fit when ResizeObserver reports a changed client viewport', () => {
      const element = createViewport();
      setClientViewport(element, {
        clientWidth: 400,
        clientHeight: 200,
        offsetWidth: 415,
        offsetHeight: 220,
      });
      store.containerRef.current = element;

      const { result } = renderHook(() => useWorkspaceFitScale());
      expect(result.current).toBe(2);

      setClientViewport(element, {
        clientWidth: 385,
        clientHeight: 200,
        offsetWidth: 415,
        offsetHeight: 220,
      });
      act(() => {
        ControllableResizeObserver.instances[0].emit(resizeEntry(415, 220));
        vi.advanceTimersByTime(16);
      });

      expect(result.current).toBe(1.925);
    });

    it('throttles consecutive resize notifications to one per animation frame', () => {
      const element = createViewport();
      setClientViewport(element, {
        clientWidth: 400,
        clientHeight: 200,
        offsetWidth: 415,
        offsetHeight: 220,
      });
      store.containerRef.current = element;
      // Use default totalSize (200x100) so initial scale is 2 (400/200 = 2, 200/100 = 2)

      const { result } = renderHook(() => useWorkspaceFitScale());
      expect(result.current).toBe(2);

      setClientViewport(element, {
        clientWidth: 385,
        clientHeight: 200,
        offsetWidth: 415,
        offsetHeight: 220,
      });
      act(() => {
        ControllableResizeObserver.instances[0].emit(resizeEntry(415, 220));
        ControllableResizeObserver.instances[0].emit(resizeEntry(410, 220));
        ControllableResizeObserver.instances[0].emit(resizeEntry(405, 220));
        vi.advanceTimersByTime(16);
      });

      expect(result.current).toBe(1.925);
    });
  });
});
