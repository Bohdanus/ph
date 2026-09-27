import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { usePointerPosition, type ContainDimensions } from '../usePointerPosition.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';

const IMAGE = { width: 100, height: 100 };

type Rect = { left: number; top: number; width: number; height: number };
type ListenerRecord = { type: string; handler: EventListenerOrEventListenerObject };

function toDomRect({ left, top, width, height }: Rect): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createContainer(rect: Rect) {
  const el = document.createElement('div');
  const getBoundingClientRect = vi.fn(() => toDomRect(rect));
  el.getBoundingClientRect = getBoundingClientRect;
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();

  const added: ListenerRecord[] = [];
  const removed: ListenerRecord[] = [];
  // Keep real jsdom listener registration (so dispatchEvent() reaches the
  // handler) while recording every add/remove pair for leak assertions.
  const nativeAdd = Element.prototype.addEventListener.bind(el);
  const nativeRemove = Element.prototype.removeEventListener.bind(el);

  const addEventListener = vi
    .spyOn(el, 'addEventListener')
    .mockImplementation((type: string, handler: EventListenerOrEventListenerObject | null) => {
      if (!handler) return;
      added.push({ type, handler });
      nativeAdd(type, handler);
    });
  const removeEventListener = vi
    .spyOn(el, 'removeEventListener')
    .mockImplementation((type: string, handler: EventListenerOrEventListenerObject | null) => {
      if (!handler) return;
      removed.push({ type, handler });
      nativeRemove(type, handler);
    });

  return { el, getBoundingClientRect, addEventListener, removeEventListener, added, removed };
}

function createRef(el: HTMLDivElement | null): RefObject<HTMLDivElement | null> {
  return { current: el };
}

type Size = { width: number; height: number };

function createResizeEntry(borderBox: Size, contentBox: Size = borderBox): ResizeObserverEntry {
  return {
    contentRect: DOMRect.fromRect({ x: 0, y: 0, width: contentBox.width, height: contentBox.height }),
    contentBoxSize: [{ inlineSize: contentBox.width, blockSize: contentBox.height }],
    borderBoxSize: [{ inlineSize: borderBox.width, blockSize: borderBox.height }],
    devicePixelContentBoxSize: [],
    target: document.createElement('div'),
  };
}

class ControllableResizeObserver implements ResizeObserver {
  static instances: ControllableResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnectCalls = 0;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve(target: Element) {
    this.observed = this.observed.filter((observed) => observed !== target);
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  emit(borderBox: Size, contentBox: Size = borderBox) {
    this.callback([createResizeEntry(borderBox, contentBox)], this);
  }

  emitEmpty() {
    this.callback([], this);
  }
}

function pointerEvent(el: HTMLDivElement, overrides: Parameters<typeof createPointerEvent>[0] = {}) {
  return createPointerEvent<HTMLDivElement>({ target: el, currentTarget: el, ...overrides });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ControllableResizeObserver.instances = [];
});

describe('usePointerPosition', () => {
  describe('contain dimensions', () => {
    it('computes centered contain dimensions on mount and reports them to onResize', () => {
      // container 400x200, square image => scale limited by height (2)
      const { el } = createContainer({ left: 0, top: 0, width: 400, height: 200 });
      const onResize = vi.fn();

      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));

      expect(onResize).toHaveBeenCalledTimes(1);
      const reported: ContainDimensions = onResize.mock.calls[0][0];
      expect(reported).toEqual({
        innerWidth: 200,
        innerHeight: 200,
        outerWidth: 400,
        outerHeight: 200,
        offsetX: 100,
        offsetY: 0,
        scale: 2,
      });
    });

    it('scales by width when the container is wider than tall', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 400, height: 400 });
      const onResize = vi.fn();

      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: { width: 200, height: 100 }, onResize }));

      // scale = min(400/200, 400/100) = min(2, 4) = 2
      expect(onResize).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 2, innerWidth: 400, innerHeight: 200, offsetX: 0, offsetY: 100 })
      );
    });

    it('scales by height when the container is taller than wide', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 400 });
      const onResize = vi.fn();

      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: { width: 200, height: 100 }, onResize }));

      // scale = min(200/200, 400/100) = min(1, 4) = 1
      expect(onResize).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 1, innerWidth: 200, innerHeight: 100, offsetX: 0, offsetY: 150 })
      );
    });

    it('recomputes and reports when imageSize changes, and uses the latest onResize callback', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const first = vi.fn();
      const second = vi.fn();

      const { rerender } = renderHook(
        ({ imageSize, onResize }: { imageSize: { width: number; height: number }; onResize: () => void }) =>
          usePointerPosition({ ref: createRef(el), imageSize, onResize }),
        { initialProps: { imageSize: IMAGE, onResize: first } }
      );

      expect(first).toHaveBeenCalledTimes(1);
      first.mockClear();

      rerender({ imageSize: { width: 50, height: 100 }, onResize: second });

      // Stale closure check: the *new* callback must be the one invoked.
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(expect.objectContaining({ scale: 2, innerWidth: 100, innerHeight: 200 }));
    });

    it('does not throw when onResize is omitted', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 100, height: 100 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));
      expect(result.current.dimensionsRef.current.scale).toBe(1);
    });

    it('leaves dimensions untouched when the ref is null and never attached', () => {
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(null), imageSize: IMAGE }));

      expect(result.current.dimensionsRef.current).toEqual({
        innerWidth: 0,
        innerHeight: 0,
        outerWidth: 0,
        outerHeight: 0,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
      });
      expect(
        result.current.getLocalCoords(pointerEvent(document.createElement('div'), { clientX: 42, clientY: 42 }))
      ).toEqual({
        x: 0,
        y: 0,
      });
    });

    it('keeps the last measured rect when the element is later detached from the ref', () => {
      const { el } = createContainer({ left: 10, top: 20, width: 400, height: 200 });
      const ref = createRef(el);
      const { result } = renderHook(() => usePointerPosition({ ref, imageSize: IMAGE }));

      act(() => {
        ref.current = null;
      });

      // cached rect: offsetX 100, offsetY 0, scale 2, x 10, y 20
      // clientX = 10 + 100 + 2*5 = 120 ; clientY = 20 + 0 + 2*7 = 34
      expect(result.current.getLocalCoords(pointerEvent(el, { clientX: 120, clientY: 34 }))).toEqual({ x: 5, y: 7 });
    });
  });

  describe('getLocalCoords', () => {
    it('maps client coordinates into image space, accounting for offset and scale', () => {
      const { el } = createContainer({ left: 50, top: 25, width: 400, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      // scale 2, offsetX 100, offsetY 0, rect origin (50, 25)
      const event = pointerEvent(el, { clientX: 50 + 100 + 2 * 10, clientY: 25 + 2 * 20 });
      expect(result.current.getLocalCoords(event)).toEqual({ x: 10, y: 20 });
    });

    it('handles a negative client coordinate (outside the container)', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      // scale 2, offsetX/Y = 0
      expect(result.current.getLocalCoords(pointerEvent(el, { clientX: -20, clientY: -6 }))).toEqual({ x: -10, y: -3 });
    });

    it('does not compensate for scrolling twice', () => {
      // `getLocalCoords` reads viewport coordinates, and `getBoundingClientRect()`
      // is already expressed in the scrolled viewport, so a scrolled page must not
      // shift the mapping by another scrollX/scrollY. This pins that contract:
      // adding scroll compensation here would break every scrolled document.
      const { el } = createContainer({ left: 50, top: 40, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const originalX = window.scrollX;
      const originalY = window.scrollY;
      Object.defineProperty(window, 'scrollX', { value: 30, configurable: true });
      Object.defineProperty(window, 'scrollY', { value: 20, configurable: true });
      try {
        // scale 2, offsets 0 => x = (clientX - 50) / 2
        expect(result.current.getLocalCoords(pointerEvent(el, { clientX: 50 + 2 * 10, clientY: 40 + 2 * 20 }))).toEqual(
          {
            x: 10,
            y: 20,
          }
        );
      } finally {
        Object.defineProperty(window, 'scrollX', { value: originalX, configurable: true });
        Object.defineProperty(window, 'scrollY', { value: originalY, configurable: true });
      }
    });

    it('re-measures the container on every call instead of using stale dimensions', () => {
      const rect: Rect = { left: 0, top: 0, width: 200, height: 200 };
      const { el, getBoundingClientRect } = createContainer(rect);
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      getBoundingClientRect.mockClear();

      act(() => {
        result.current.getLocalCoords(pointerEvent(el, { clientX: 20, clientY: 20 }));
      });

      expect(getBoundingClientRect).toHaveBeenCalled();
    });
  });

  describe('pointer capture lifecycle', () => {
    it('rejects non-primary buttons without capturing', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      for (const button of [1, 2, -1]) {
        let accepted: boolean | undefined;
        act(() => {
          accepted = result.current.isPointerDownValid(pointerEvent(el, { button, pointerId: 7 }));
        });
        expect(accepted).toBe(false);
      }

      expect(el.setPointerCapture).not.toHaveBeenCalled();
      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);
    });

    it('captures the first pointer and records it in pointerIdRef/isMouseDown', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 3 }));
      });

      expect(accepted).toBe(true);
      expect(el.setPointerCapture).toHaveBeenCalledWith(3);
      expect(result.current.pointerIdRef.current).toBe(3);
      expect(result.current.isMouseDown.current).toBe(true);
    });

    it('ignores a second concurrent pointer and keeps the first one active', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });
      (el.setPointerCapture as ReturnType<typeof vi.fn>).mockClear();

      let second: boolean | undefined;
      act(() => {
        second = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 2 }));
      });

      expect(second).toBe(false);
      expect(el.setPointerCapture).not.toHaveBeenCalledWith(2);
      expect(result.current.pointerIdRef.current).toBe(1);
    });

    it('accepts pointermove only for the captured pointer id', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });

      let other: boolean | undefined;
      let own: boolean | undefined;
      act(() => {
        other = result.current.isPointerMoveValid(pointerEvent(el, { pointerId: 2 }));
        own = result.current.isPointerMoveValid(pointerEvent(el, { pointerId: 1 }));
      });

      expect(other).toBe(false);
      expect(own).toBe(true);
    });

    it('releases capture and clears all pointer state on pointerup of the active pointer', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 5 }));
      });

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { pointerId: 5 }));
      });

      expect(handled).toBe(true);
      expect(el.releasePointerCapture).toHaveBeenCalledWith(5);
      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);
    });

    it('leaves state untouched on pointerup from a different pointer id', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { pointerId: 99 }));
      });

      expect(handled).toBe(false);
      expect(el.releasePointerCapture).not.toHaveBeenCalled();
      expect(result.current.pointerIdRef.current).toBe(1);
      expect(result.current.isMouseDown.current).toBe(true);
    });

    it('releases capture and clears all pointer state on pointerup of a pointer id of 0', () => {
      // `0` is a legitimate `PointerEvent.pointerId` and some touch engines number
      // from it, so it must not be confused with the "no active pointer" sentinel.
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 0 }));
      });

      expect(result.current.pointerIdRef.current).toBe(0);
      expect(el.setPointerCapture).toHaveBeenCalledWith(0);

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { pointerId: 0 }));
      });

      expect(handled).toBe(true);
      expect(el.releasePointerCapture).toHaveBeenCalledWith(0);
      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);
    });

    it('does not release a capture for a pointerup with no active pointer', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { pointerId: 0 }));
      });

      expect(handled).toBe(false);
      expect(el.releasePointerCapture).not.toHaveBeenCalled();
    });

    it('still clears state when releasePointerCapture throws (capture already lost)', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      vi.mocked(el.releasePointerCapture).mockImplementation(() => {
        throw new Error('InvalidPointerId');
      });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 4 }));
      });

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { pointerId: 4 }));
      });

      expect(handled).toBe(true);
      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);
    });

    it('allows a fresh pointer to be captured after a completed gesture', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });
      act(() => {
        result.current.isPointerUpValid(pointerEvent(el, { pointerId: 1 }));
      });

      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 2 }));
      });

      expect(accepted).toBe(true);
      expect(result.current.pointerIdRef.current).toBe(2);
    });
  });

  describe('pointercancel listener', () => {
    it('registers exactly one pointercancel listener on the container', () => {
      const { el, added } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const cancels = added.filter((l) => l.type === 'pointercancel');
      expect(cancels).toHaveLength(1);
    });

    it('removes the pointercancel listener on unmount using the identical handler reference', () => {
      const { el, added, removed } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { unmount } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const registered = added.find((l) => l.type === 'pointercancel');
      expect(registered).toBeDefined();

      unmount();

      const unregistered = removed.find((l) => l.type === 'pointercancel');
      expect(unregistered).toBeDefined();
      // Same function identity => no leaked listener.
      expect(unregistered!.handler).toBe(registered!.handler);
      expect(removed.filter((l) => l.type === 'pointercancel')).toHaveLength(1);
    });

    it('resets pointer state when a native pointercancel for the active pointer arrives', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });
      expect(result.current.isMouseDown.current).toBe(true);

      act(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        el.dispatchEvent(event);
      });

      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);

      // a new pointer can now be captured
      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 2 }));
      });
      expect(accepted).toBe(true);
    });

    it('ignores pointercancel from a pointer that is not active', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });

      act(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 42 });
        el.dispatchEvent(event);
      });

      expect(result.current.pointerIdRef.current).toBe(1);
      expect(result.current.isMouseDown.current).toBe(true);
    });

    it('stops reacting to pointercancel after unmount', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result, unmount } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 1 }));
      });

      unmount();

      expect(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        el.dispatchEvent(event);
      }).not.toThrow();
    });

    it('registers no pointercancel listener when the ref is null at mount', () => {
      const { added } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      renderHook(() => usePointerPosition({ ref: createRef(null), imageSize: IMAGE }));
      expect(added.filter((l) => l.type === 'pointercancel')).toHaveLength(0);
    });
  });

  describe('resize observer integration', () => {
    it('schedules a single throttled recompute when ResizeObserver reports a resize', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      const rect: Rect = { left: 0, top: 0, width: 200, height: 200 };
      const { el, getBoundingClientRect } = createContainer(rect);
      const onResize = vi.fn();

      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));
      expect(ControllableResizeObserver.instances).toHaveLength(1);
      const observer = ControllableResizeObserver.instances[0];
      expect(observer.observed).toEqual([el]);
      onResize.mockClear();
      getBoundingClientRect.mockClear();

      act(() => {
        observer.emit({ width: 500, height: 100 });
      });

      // Throttled: nothing until the frame runs.
      expect(onResize).not.toHaveBeenCalled();
      expect(getBoundingClientRect).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(32);
      });

      expect(onResize).toHaveBeenCalledTimes(1);
      expect(getBoundingClientRect).toHaveBeenCalled();
      // The observed rect drives the recompute: 500x100 around a 100x100 image
      // scales by 1 and leaves a 200px gap on each horizontal side.
      expect(onResize).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 1, innerWidth: 100, innerHeight: 100, offsetX: 200, offsetY: 0 })
      );
    });

    it('sizes the recompute from the observed border box, not the content box or a re-read', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      // The element's own rect keeps reporting 200x200, so a re-read of
      // getBoundingClientRect() would silently replace the observed measurement.
      const { el, getBoundingClientRect } = createContainer({ left: 5, top: 6, width: 200, height: 200 });
      const onResize = vi.fn();

      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));
      onResize.mockClear();
      getBoundingClientRect.mockClear();

      act(() => {
        // 8px border: the border box is 400x300, the content box 392x292.
        ControllableResizeObserver.instances[0].emit({ width: 400, height: 300 }, { width: 392, height: 292 });
        vi.advanceTimersByTime(32);
      });

      expect(onResize).toHaveBeenCalledTimes(1);
      // 400x300 around a 100x100 image scales by 3 and centres the 300x300 image
      // with a 50px gap on each side. The re-read 200x200 would give scale 2, and
      // the 392x292 content box would give 2.92.
      expect(onResize).toHaveBeenCalledWith(
        expect.objectContaining({
          outerWidth: 400,
          outerHeight: 300,
          scale: 3,
          innerWidth: 300,
          innerHeight: 300,
          offsetX: 50,
          offsetY: 0,
        })
      );
    });

    it('uses the container origin from getBoundingClientRect for coordinate mapping after a resize', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      const rect: Rect = { left: 33, top: 44, width: 10, height: 10 };
      const { el, getBoundingClientRect } = createContainer(rect);
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        ControllableResizeObserver.instances[0].emit({ width: 200, height: 200 });
        vi.advanceTimersByTime(32);
      });

      // Container actually resized to 200x200; scale 2, offsets 0.
      getBoundingClientRect.mockReturnValue(toDomRect({ left: 33, top: 44, width: 200, height: 200 }));

      // scale 2, offsets 0 => x = (clientX - 33) / 2
      expect(result.current.getLocalCoords(pointerEvent(el, { clientX: 33 + 2 * 5, clientY: 44 + 2 * 6 }))).toEqual({
        x: 5,
        y: 6,
      });
    });

    it('ignores an empty ResizeObserver entries batch', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const onResize = vi.fn();
      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));
      onResize.mockClear();

      act(() => {
        ControllableResizeObserver.instances[0].emitEmpty();
        vi.advanceTimersByTime(32);
      });

      expect(onResize).not.toHaveBeenCalled();
    });

    it('coalesces multiple resize notifications into a single frame callback', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const onResize = vi.fn();
      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));
      onResize.mockClear();

      act(() => {
        ControllableResizeObserver.instances[0].emit({ width: 300, height: 300 });
        ControllableResizeObserver.instances[0].emit({ width: 400, height: 400 });
        ControllableResizeObserver.instances[0].emit({ width: 500, height: 500 });
        vi.advanceTimersByTime(64);
      });

      // Only the latest pending frame survives => a single call.
      expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('does not resize when the observer never fires', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const onResize = vi.fn();
      renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));

      expect(ControllableResizeObserver.instances).toHaveLength(0);
      expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('disconnects the observer and cancels the pending frame on unmount', () => {
      vi.useFakeTimers();
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);

      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const { unmount } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));
      expect(ControllableResizeObserver.instances).toHaveLength(1);

      const observer = ControllableResizeObserver.instances[0];
      act(() => {
        observer.emit({ width: 300, height: 300 });
      });
      cancelSpy.mockClear();

      unmount();

      expect(observer.disconnectCalls).toBe(1);
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('tolerates a missing ResizeObserver global', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const onResize = vi.fn();

      expect(() =>
        renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }))
      ).not.toThrow();
      expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('tolerates a null container (no element observed, no listener registered)', () => {
      vi.stubGlobal('ResizeObserver', ControllableResizeObserver);
      const onResize = vi.fn();

      expect(() =>
        renderHook(() => usePointerPosition({ ref: createRef(null), imageSize: IMAGE, onResize }))
      ).not.toThrow();
      expect(ControllableResizeObserver.instances).toHaveLength(0);
      expect(onResize).not.toHaveBeenCalled();
    });
  });

  describe('devicePixelRatio independence', () => {
    it('derives scale from layout pixels only, not from window.devicePixelRatio', () => {
      const original = window.devicePixelRatio;
      const { el } = createContainer({ left: 0, top: 0, width: 400, height: 200 });
      const onResize = vi.fn();

      Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
      try {
        renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));
        expect(onResize).toHaveBeenCalledWith(expect.objectContaining({ scale: 2, innerWidth: 200, innerHeight: 200 }));
      } finally {
        Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
      }
    });
  });
});
