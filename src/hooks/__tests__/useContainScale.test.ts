import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContainScale } from '../useContainScale.ts';

const IMAGE = { width: 100, height: 100 };
type ClientViewport = {
  left?: number;
  top?: number;
  width: number;
  height: number;
  offsetWidth?: number;
  offsetHeight?: number;
};

function setClientViewport(
  el: HTMLDivElement,
  {
    left = 0,
    top = 0,
    width,
    height,
    offsetWidth = Math.round(width),
    offsetHeight = Math.round(height),
  }: { left?: number; top?: number; width: number; height: number; offsetWidth?: number; offsetHeight?: number }
) {
  Object.defineProperties(el, {
    clientLeft: { configurable: true, value: left },
    clientTop: { configurable: true, value: top },
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    offsetWidth: { configurable: true, value: offsetWidth },
    offsetHeight: { configurable: true, value: offsetHeight },
  });
}

function container(
  width: number,
  height: number,
  client: ClientViewport = {
    width: Math.round(width),
    height: Math.round(height),
    offsetWidth: Math.round(width),
    offsetHeight: Math.round(height),
  }
) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  setClientViewport(el, client);
  return el;
}

function resizeEntry(borderWidth: number, borderHeight: number, clientWidth: number, clientHeight: number) {
  return {
    contentRect: DOMRect.fromRect({ x: 0, y: 0, width: clientWidth, height: clientHeight }),
    contentBoxSize: [{ inlineSize: clientWidth, blockSize: clientHeight }],
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ControllableResizeObserver.instances = [];
});

describe('useContainScale', () => {
  it('reports CSS px per document px from the container it is given', () => {
    // 400x200 holding a 100x100 document: 4 across, 2 down, contained at 2.
    const ref = { current: container(400, 200) };
    const { result } = renderHook(() => useContainScale(ref, IMAGE));

    expect(result.current.current).toBe(2);
  });

  it('uses the same scrollport fit as pointer coordinates when a scrollbar reduces client width', () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

    const el = container(415, 220, { left: 2, top: 2, width: 400, height: 200, offsetWidth: 415, offsetHeight: 220 });
    const ref = { current: el };
    const { result } = renderHook(() => useContainScale(ref, { width: 200, height: 100 }));

    expect(result.current.current).toBe(2);
    setClientViewport(el, { left: 2, top: 2, width: 385, height: 200, offsetWidth: 415, offsetHeight: 220 });

    act(() => {
      ControllableResizeObserver.instances[0].emit(resizeEntry(415, 220, 385, 200));
      vi.advanceTimersByTime(32);
    });

    expect(result.current.current).toBe(1.925);
  });

  /**
   * The default is the identity divisor, and that is the point: a container that has not been
   * measured — not mounted yet, zero-sized, or a jsdom rect that reports nothing — must leave a
   * painter drawing what it drew before this hook existed, rather than dividing by 0 and producing
   * an infinite line width.
   */
  it('holds at 1 when the container cannot be measured', () => {
    const { result } = renderHook(() => useContainScale({ current: null }, IMAGE));

    expect(result.current.current).toBe(1);
  });

  it('holds at 1 for a mounted container that reports a zero size', () => {
    const ref = { current: container(0, 0) };
    const { result } = renderHook(() => useContainScale(ref, IMAGE));

    expect(result.current.current).toBe(1);
  });

  it('holds at 1 for a document with no size, which would otherwise divide by 0', () => {
    const ref = { current: container(400, 200) };
    const { result } = renderHook(() => useContainScale(ref, { width: 0, height: 0 }));

    expect(result.current.current).toBe(1);
  });

  /**
   * The reason this is a ref and not state. The marching ants read it inside a 60fps loop, so a
   * value that scheduled a render on measurement would either re-render the tree sixty times a
   * second or have to be read from a closure that goes stale. Reading `.current` schedules nothing.
   */
  it('publishes through a ref, so reading it schedules no render', () => {
    const ref = { current: container(400, 200) };
    const renders: number[] = [];
    const { result } = renderHook(() => {
      renders.push(1);
      return useContainScale(ref, IMAGE);
    });

    const afterMount = renders.length;
    void result.current.current;

    expect(renders.length).toBe(afterMount);
  });

  it('re-measures when the ref identity changes, without re-reading on every render', () => {
    const getBoundingClientRect = vi.fn(() => container(400, 200).getBoundingClientRect());
    const el = document.createElement('div');
    el.getBoundingClientRect = getBoundingClientRect as unknown as typeof el.getBoundingClientRect;
    const ref = { current: el };

    const { rerender } = renderHook(() => useContainScale(ref, IMAGE));
    const afterMount = getBoundingClientRect.mock.calls.length;
    rerender();
    rerender();

    expect(getBoundingClientRect.mock.calls.length).toBe(afterMount);
  });

  describe('edge cases: non-finite and zero/negative dimensions', () => {
    /**
     * NaN is falsy, so the guard `!rect.width` catches it before it reaches
     * `containFit`. The scale holds at 1 — the identity divisor — rather than
     * dividing by a NaN and propagating it through every painter.
     */
    it('holds at 1 when the container reports NaN in both dimensions', () => {
      const ref = { current: container(Number.NaN, Number.NaN) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when the document reports NaN in either dimension', () => {
      const ref = { current: container(400, 200) };
      const { result } = renderHook(() => useContainScale(ref, { width: Number.NaN, height: 100 }));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when only the container width is zero', () => {
      const ref = { current: container(0, 200) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when only the image height is zero', () => {
      const ref = { current: container(400, 200) };
      const { result } = renderHook(() => useContainScale(ref, { width: 100, height: 0 }));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 when a NaN and a valid dimension are mixed in the container', () => {
      const ref = { current: container(Number.NaN, 300) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });
  });

  /**
   * Infinity remains a tripwire: it is truthy, so it reaches `containFit` and produces a
   * non-finite scale. Negative measurements are clamped by `readClientViewportRect` above.
   */
  describe('tripwires (it.fails: desired guard not yet implemented)', () => {
    it.fails('holds at 1 for a non-finite (Infinity) container dimension', () => {
      const ref = { current: container(Infinity, Infinity) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });

    it('holds at 1 for a negative container dimension', () => {
      const ref = { current: container(-400, 200) };
      const { result } = renderHook(() => useContainScale(ref, IMAGE));

      expect(result.current.current).toBe(1);
    });
  });
});
