import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { usePointerPosition } from '../usePointerPosition.ts';
import { useResizeObserverRAF } from '../useResizeObserver.ts';

let resizeObserverInstance: MockResizeObserver | null;

class MockResizeObserver {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    resizeObserverInstance = this;
  }
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

function makeEntry(width: number, height: number): ResizeObserverEntry {
  return {
    contentRect: {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => {},
    },
    contentBoxSize: [],
    contentRectSize: [] as any,
    borderBoxSize: [],
    devicePixelContentBoxSize: [] as any,
    observedFontData: [],
    target: null as any,
  } as unknown as ResizeObserverEntry;
}

describe('useResizeObserverRAF', () => {
  beforeEach(() => {
    resizeObserverInstance = null;
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('calls onResize with the element position and the new content rect dimensions', () => {
    const el = makeElement({ left: 10, top: 20 });
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    expect(resizeObserverInstance).not.toBeNull();
    expect(resizeObserverInstance!.observe).toHaveBeenCalled();

    resizeObserverInstance!.callback([makeEntry(50, 60)], resizeObserverInstance! as unknown as ResizeObserver);

    expect(onResize).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(onResize).toHaveBeenCalledWith({ x: 10, y: 20, width: 50, height: 60 });
  });

  it('throttles consecutive resize notifications to one per animation frame', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    resizeObserverInstance!.callback([makeEntry(30, 40)], resizeObserverInstance! as unknown as ResizeObserver);
    resizeObserverInstance!.callback([makeEntry(70, 80)], resizeObserverInstance! as unknown as ResizeObserver);

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

    resizeObserverInstance!.callback([makeEntry(70, 80)], resizeObserverInstance! as unknown as ResizeObserver);

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
    } as any;

    expect(result.current.getLocalCoords(event)).toEqual({ x: 43.333333333333336, y: 20 });
  });

  it('does not set up an observer when the ref is null', () => {
    const ref = { current: null } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    expect(resizeObserverInstance).toBeNull();
    expect(onResize).not.toHaveBeenCalled();
  });

  it('does not set up an observer when ResizeObserver is undefined', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    renderHook(() => useResizeObserverRAF(ref, onResize));

    expect(resizeObserverInstance).toBeNull();
  });

  it('disconnects the observer on unmount', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    const { unmount } = renderHook(() => useResizeObserverRAF(ref, onResize));
    unmount();

    expect(resizeObserverInstance!.disconnect).toHaveBeenCalled();
  });

  it('cancels a pending animation frame on unmount', () => {
    const el = makeElement();
    const ref = { current: el } as RefObject<HTMLElement | null>;
    const onResize = vi.fn();

    const { unmount } = renderHook(() => useResizeObserverRAF(ref, onResize));

    resizeObserverInstance!.callback([makeEntry(20, 20)], resizeObserverInstance! as unknown as ResizeObserver);

    unmount();

    vi.advanceTimersByTime(16);

    expect(onResize).not.toHaveBeenCalled();
  });
});
