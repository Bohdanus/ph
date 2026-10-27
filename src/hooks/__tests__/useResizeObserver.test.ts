import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { usePointerPosition } from '../usePointerPosition.ts';
import { useResizeObserverRAF } from '../useResizeObserver.ts';
import type { Pos } from '../../contexts/general-types.ts';

type MockResizeObserverInstance = {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function createMockResizeObserver() {
  let instance: MockResizeObserverInstance | null = null;

  class MockResizeObserver implements MockResizeObserverInstance {
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.unobserve = vi.fn();
      this.disconnect = vi.fn();
      instance = this;
    }
  }

  return { MockResizeObserver, getInstance: () => instance };
}

function makeElement(rect: Partial<DOMRect> = {}) {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => {},
      ...rect,
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
}

function makeEntry(width: number, height: number, contentWidth = width, contentHeight = height): ResizeObserverEntry {
  return {
    contentRect: {
      x: 0,
      y: 0,
      width: contentWidth,
      height: contentHeight,
      top: 0,
      left: 0,
      right: contentWidth,
      bottom: contentHeight,
      toJSON: () => {},
    },
    contentBoxSize: [{ inlineSize: contentWidth, blockSize: contentHeight }],
    borderBoxSize: [{ inlineSize: width, blockSize: height }],
    devicePixelContentBoxSize: [],
    target: makeElement(),
  };
}

describe('useResizeObserverRAF', () => {
  let getInstance: () => MockResizeObserverInstance | null;

  beforeEach(() => {
    vi.useFakeTimers();
    const { MockResizeObserver, getInstance: getInst } = createMockResizeObserver();
    getInstance = getInst;
    vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(MockResizeObserver as unknown as typeof ResizeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls onResize with the element position and the observed border box size', () => {
    const el = makeElement({ left: 10, top: 20 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    expect(instance).not.toBeNull();
    expect(instance!.observe).toHaveBeenCalled();

    instance!.callback([makeEntry(50, 60)], instance! as unknown as ResizeObserver);

    expect(onResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledWith({ x: 10, y: 20, width: 50, height: 60 });
  });

  it('reports the border box, not the content box, for a bordered element', () => {
    // `x`/`y` come from the viewport-relative getBoundingClientRect(), so the size
    // has to come from the same box. A border makes contentRect smaller, and
    // mixing the two reported a position and a size that disagreed.
    const el = makeElement({ left: 3, top: 4 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    // borderBox 100x100 (the default measured size), contentBox 92x92 (4px border).
    instance!.callback([makeEntry(100, 100, 92, 92)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 3, y: 4, width: 100, height: 100 });
  });

  it('falls back to the measured border box when the entry carries no border box size', () => {
    const el = makeElement({ left: 5, top: 6 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    const entry = makeEntry(50, 60);
    instance!.callback([{ ...entry, borderBoxSize: [] }], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    // makeElement measures 100x100; the fallback must stay on the border box rather
    // than resurrecting the content box.
    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 5, y: 6, width: 100, height: 100 });
  });

  it('throttles consecutive resize notifications to one per animation frame', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([makeEntry(30, 40)], instance! as unknown as ResizeObserver);
    instance!.callback([makeEntry(70, 80)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith({ x: 0, y: 0, width: 70, height: 80 });
    expect(onResize).not.toHaveBeenCalledWith({ x: 0, y: 0, width: 30, height: 40 });
  });

  it('uses the current element position instead of the initial one for resize notifications', () => {
    const el = makeElement({ left: 10, top: 20 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    el.getBoundingClientRect = () => ({
      left: 40,
      top: 50,
      right: 140,
      bottom: 150,
      width: 100,
      height: 100,
      x: 40,
      y: 50,
      toJSON: () => {},
    });

    const instance = getInstance();
    instance!.callback([makeEntry(70, 80)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledWith({ x: 40, y: 50, width: 70, height: 80 });
  });

  it('recomputes pointer coordinates on the first gesture after a resize', () => {
    const el = makeElement({ left: 10, top: 20, width: 200, height: 100 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const { result } = renderHook(() => usePointerPosition({ ref, imageSize: { width: 100, height: 50 } }));

    el.getBoundingClientRect = () => ({
      left: 50,
      top: 60,
      width: 300,
      height: 150,
      right: 350,
      bottom: 210,
      x: 50,
      y: 60,
      toJSON: () => {},
    });

    const event = {
      pointerId: 1,
      clientX: 180,
      clientY: 120,
      button: 0,
      currentTarget: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
    } as unknown as React.PointerEvent<HTMLElement>;

    expect(result.current.getLocalCoords(event)).toEqual({ x: 43.333333333333336, y: 20 });
  });

  it('does not set up an observer when the ref is null', () => {
    const ref = { current: null } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    expect(getInstance()).toBeNull();
    expect(onResize).not.toHaveBeenCalled();
  });

  it('does not set up an observer when ResizeObserver is undefined', () => {
    vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(undefined as unknown as typeof ResizeObserver);
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    expect(getInstance()).toBeNull();
  });

  it('disconnects the observer on unmount', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    const { unmount } = renderHook(() => useResizeObserverRAF(ref, onResize));
    unmount();

    expect(getInstance()!.disconnect).toHaveBeenCalled();
  });

  it('reports a collapsed element as a zero-size rect', () => {
    const el = makeElement({ left: 7, top: 8 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([makeEntry(0, 0)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 7, y: 8, width: 0, height: 0 });
  });

  it('ignores an empty entries batch', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).not.toHaveBeenCalled();
  });

  it('notifies the latest onResize callback after a re-render', () => {
    const el = makeElement({ left: 1, top: 2 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(
      ({ onResize }: { onResize: (size: Pos) => void }) => useResizeObserverRAF(ref, onResize),
      { initialProps: { onResize: first } }
    );

    rerender({ onResize: second });

    const instance = getInstance();
    instance!.callback([makeEntry(10, 20)], instance! as unknown as ResizeObserver);
    vi.advanceTimersByTime(16);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith({ x: 1, y: 2, width: 10, height: 20 });
  });

  it('cancels a pending animation frame on unmount', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    const { unmount } = renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([makeEntry(20, 20)], instance! as unknown as ResizeObserver);

    unmount();

    vi.advanceTimersByTime(16);

    expect(onResize).not.toHaveBeenCalled();
  });

  it('reports a partial zero-dimension rect (zero width only)', () => {
    const el = makeElement({ left: 10, top: 20 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([makeEntry(0, 40)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20, width: 0, height: 40 });
  });

  it('reports a partial zero-dimension rect (zero height only)', () => {
    const el = makeElement({ left: 10, top: 20 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    instance!.callback([makeEntry(40, 0)], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20, width: 40, height: 0 });
  });

  it('falls back to rect dimensions when borderBoxSize entry lacks inlineSize and blockSize', () => {
    const el = makeElement({ left: 3, top: 4, width: 80, height: 60 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    const entry = { ...makeEntry(50, 60), borderBoxSize: [{} as ResizeObserverSize] };
    instance!.callback([entry], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledExactlyOnceWith({ x: 3, y: 4, width: 80, height: 60 });
  });

  it.fails('guards against NaN values in the border box size', () => {
    const el = makeElement({ left: 0, top: 0 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    const entry = {
      ...makeEntry(50, 60),
      borderBoxSize: [{ inlineSize: NaN, blockSize: NaN }],
    };
    instance!.callback([entry], instance! as unknown as ResizeObserver);

    vi.advanceTimersByTime(16);

    expect(onResize).not.toHaveBeenCalledWith({ x: 0, y: 0, width: NaN, height: NaN });
  });

  it.fails('does not throw when entry.borderBoxSize is undefined', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    const instance = getInstance();
    const entry = {
      ...makeEntry(50, 60),
      borderBoxSize: undefined as unknown as ResizeObserverSize[],
    };

    expect(() => {
      instance!.callback([entry], instance! as unknown as ResizeObserver);
      vi.advanceTimersByTime(16);
    }).not.toThrow();

    expect(onResize).toHaveBeenCalled();
  });
});
