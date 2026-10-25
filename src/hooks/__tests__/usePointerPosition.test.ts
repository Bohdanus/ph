import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { usePointerPosition, type ContainDimensions } from '../usePointerPosition.ts';
import { createPointerEvent } from '@/__tests__/fixtures/pointer.ts';
import { DEFAULT_VIEW_STATE, viewStateRef } from '../../contexts/view-state.ts';

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
  viewStateRef.current = DEFAULT_VIEW_STATE;
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

    it('maps from a measurement-only ref attached after mount', () => {
      const ref = createRef(null);
      const { result } = renderHook(() => usePointerPosition({ ref, imageSize: IMAGE }));
      const measuredStub = {
        getBoundingClientRect: () => toDomRect({ left: 10, top: 20, width: 400, height: 200 }),
      } as unknown as HTMLDivElement;

      act(() => {
        ref.current = measuredStub;
      });

      // The measurement-only stub deliberately has no scroll or listener API; those must not
      // be required for a live geometry read or the default zero-scroll coordinate mapping.
      expect(result.current.getLocalCoordsFromClientPoint(120, 34)).toEqual({ x: 5, y: 7 });
    });

    it('maps geometry when a measurement-only ref is present at mount', () => {
      const { el } = createContainer({ left: 10, top: 20, width: 400, height: 200 });
      Object.defineProperty(el, 'addEventListener', { configurable: true, value: undefined });
      Object.defineProperty(el, 'removeEventListener', { configurable: true, value: undefined });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      expect(result.current.getLocalCoordsFromClientPoint(120, 34)).toEqual({ x: 5, y: 7 });
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

    it('accounts for the container scroll offset without adding window scroll twice', () => {
      const { el } = createContainer({ left: 50, top: 25, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));
      el.scrollLeft = 8;
      el.scrollTop = 20;
      el.dispatchEvent(new Event('scroll'));

      // The element's own scroll shifts the document point (10, 20) from content-space
      // coordinates (20, 40) to scrollport-relative coordinates (12, 20), or client (62, 45).
      const event = pointerEvent(el, { clientX: 50 + 2 * 10 - 8, clientY: 25 + 2 * 20 - 20 });
      expect(result.current.getLocalCoords(event)).toEqual({ x: 10, y: 20 });
    });

    it('retains the latest container scroll offset if its ref is detached', () => {
      const { el } = createContainer({ left: 10, top: 20, width: 400, height: 200 });
      const ref = createRef(el);
      const { result } = renderHook(() => usePointerPosition({ ref, imageSize: IMAGE }));

      act(() => {
        el.scrollLeft = 8;
        el.scrollTop = 20;
        el.dispatchEvent(new Event('scroll'));
        ref.current = null;
      });

      // Cached rect has offsetX 100, offsetY 0, scale 2. The pointer maps to (5, 7)
      // only when the cached content-space scroll offset is restored after detachment.
      const event = pointerEvent(el, { clientX: 10 + 100 + 2 * 5 - 8, clientY: 20 + 2 * 7 - 20 });
      expect(result.current.getLocalCoords(event)).toEqual({ x: 5, y: 7 });
    });

    it('inverts a transient pan and zoom before returning document coordinates', () => {
      const { el } = createContainer({ left: 50, top: 25, width: 400, height: 200 });
      viewStateRef.current = {
        panX: 20,
        panY: -10,
        zoom: 2,
        fitScaleCompensation: 1,
        rotation: 0,
        fitToScreen: false,
      };
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      // The document point (10, 20) is at (120, 40) in the untransformed contain-fit viewport.
      // The view then scales around the viewport centre (200, 100) and pans by (20, -10).
      const event = pointerEvent(el, { clientX: 50 + 60, clientY: 25 - 30 });
      expect(result.current.getLocalCoords(event)).toEqual({ x: 10, y: 20 });
    });

    it('handles a negative client coordinate (outside the container)', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      // scale 2, offsetX/Y = 0
      expect(result.current.getLocalCoords(pointerEvent(el, { clientX: -20, clientY: -6 }))).toEqual({ x: -10, y: -3 });
    });

    it('does not add window scroll to viewport coordinates a second time', () => {
      // Window scrolling shifts both the event's client coordinates and the element's
      // getBoundingClientRect() position. Unlike the element's own scrollTop/scrollLeft,
      // window.scrollX/scrollY must not be added to that already viewport-relative pair.
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

    it('notifies onResize only when the measured fit changes', () => {
      //
      // Payload, derived from `calculateDimensions` over these fixtures:
      //   container 400x200 at (50, 25), image 100x100
      //   scaleX = 400/100 = 4, scaleY = 200/100 = 2  =>  scale = min(4, 2) = 2
      //   innerWidth  = 100 * 2 = 200      innerHeight = 100 * 2 = 200
      //   offsetX = (400 - 200) / 2 = 100  offsetY   = (200 - 200) / 2 = 0
      const { el, getBoundingClientRect } = createContainer({ left: 50, top: 25, width: 400, height: 200 });
      const onResize = vi.fn();
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));

      // The mount effect already notified once; that is not what this test is about.
      expect(onResize).toHaveBeenCalledTimes(1);
      onResize.mockClear();

      const event = pointerEvent(el, { clientX: 70, clientY: 45 });

      act(() => {
        result.current.getLocalCoords(event);
      });
      expect(onResize).not.toHaveBeenCalled();

      // The SAME event object, so the coordinates are provably identical.
      act(() => {
        result.current.getLocalCoords(event);
      });

      // Re-reading the same fit must not make `useRect` repaint the previous crop rect.
      expect(onResize).not.toHaveBeenCalled();

      getBoundingClientRect.mockReturnValue(toDomRect({ left: 50, top: 25, width: 500, height: 200 }));
      act(() => {
        result.current.getLocalCoords(event);
      });

      expect(onResize).toHaveBeenCalledTimes(1);
      expect(onResize).toHaveBeenLastCalledWith({
        innerWidth: 200,
        innerHeight: 200,
        outerWidth: 500,
        outerHeight: 200,
        offsetX: 150,
        offsetY: 0,
        scale: 2,
      });
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

    it('clears the pointer claim when capture fails so a later press can start', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const setPointerCapture = el.setPointerCapture as ReturnType<typeof vi.fn>;
      setPointerCapture.mockImplementationOnce(() => {
        throw new DOMException('Pointer capture target is detached', 'NotFoundError');
      });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      let failedPressAccepted: boolean | undefined;
      act(() => {
        failedPressAccepted = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 7 }));
      });

      expect(failedPressAccepted).toBe(false);
      expect(result.current.pointerIdRef.current).toBeNull();
      expect(result.current.isMouseDown.current).toBe(false);
      expect(el.releasePointerCapture).toHaveBeenCalledWith(7);

      let laterPressAccepted: boolean | undefined;
      act(() => {
        laterPressAccepted = result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 8 }));
      });

      expect(laterPressAccepted).toBe(true);
      expect(result.current.pointerIdRef.current).toBe(8);
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

    it('refuses a non-primary release and leaves the captured pointer active', () => {
      // The symmetric half of `isPointerDownValid`'s `button !== 0` refusal. Without it a
      // right-button release mid left-drag is accepted on pointerId alone, so a tool area's
      // release path — commit, claim release, all of it — runs for a release the press never
      // made, and the tool areas' test doubles, which DO check `button`, pin behaviour the
      // product does not have.
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      act(() => {
        result.current.isPointerDownValid(pointerEvent(el, { button: 0, pointerId: 5 }));
      });
      expect(result.current.isMouseDown.current).toBe(true);

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(pointerEvent(el, { button: 2, pointerId: 5 }));
      });

      // Refused, so it neither ends the gesture nor tears its tracking down: the real left
      // release still arrives and is the one that ends it.
      expect(handled).toBe(false);
      expect(el.releasePointerCapture).not.toHaveBeenCalled();
      expect(result.current.pointerIdRef.current).toBe(5);
      expect(result.current.isMouseDown.current).toBe(true);
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
      // `0` is a legitimate `PointerEvent.pointerId` -- Pointer Events reserves only
      // `-1`, and whether a UA numbers from 0 is implementation-specific -- so it must
      // not be confused with the "no active pointer" sentinel. Defensive: no shipping
      // engine is known to do this, and the hook is not guarding a reported bug.
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

    it('never hands the null sentinel to releasePointerCapture from the cleanup guard', () => {
      // `isPointerUpValid` gates on `activePointerId.current === e.pointerId`, so an
      // event whose own `pointerId` is the `null` sentinel is the only way to reach
      // `clearEvent` with no active pointer -- which is exactly the state the
      // `activePointerId.current !== null` guard exists for. Deleting the guard calls
      // `releasePointerCapture(null)`, and this assertion is what says it must not.
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));
      const sentinelEvent = pointerEvent(el, { pointerId: null as unknown as number });

      let handled: boolean | undefined;
      act(() => {
        handled = result.current.isPointerUpValid(sentinelEvent);
      });

      expect(handled).toBe(true);
      expect(el.releasePointerCapture).not.toHaveBeenCalled();
      // The rest of the cleanup still runs, so a stray event cannot leave a stale
      // isMouseDown behind.
      expect(result.current.isMouseDown.current).toBe(false);
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

    it('tracks pointercancel when the ref appears and changes during an active gesture', () => {
      const first = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const second = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const ref = createRef(null);
      const { result } = renderHook(() => usePointerPosition({ ref, imageSize: IMAGE }));

      act(() => {
        ref.current = first.el;
        result.current.isPointerDownValid(pointerEvent(first.el, { pointerId: 1 }));
      });
      expect(first.added.filter((listener) => listener.type === 'pointercancel')).toHaveLength(1);

      act(() => {
        ref.current = second.el;
      });
      act(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        first.el.dispatchEvent(event);
      });

      expect(result.current.pointerIdRef.current).toBeNull();
      expect(first.removed.filter((listener) => listener.type === 'pointercancel')).toHaveLength(1);
      expect(second.added.filter((listener) => listener.type === 'pointercancel')).toHaveLength(1);

      let accepted: boolean | undefined;
      act(() => {
        accepted = result.current.isPointerDownValid(pointerEvent(second.el, { pointerId: 2 }));
      });
      expect(accepted).toBe(true);

      act(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 2 });
        second.el.dispatchEvent(event);
      });
      expect(result.current.pointerIdRef.current).toBeNull();
    });

    it('keeps the active cancellation listener when the ref object is replaced', () => {
      const first = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const second = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result, rerender } = renderHook(
        ({ ref }: { ref: RefObject<HTMLDivElement | null> }) => usePointerPosition({ ref, imageSize: IMAGE }),
        { initialProps: { ref: createRef(first.el) } }
      );

      act(() => {
        result.current.isPointerDownValid(pointerEvent(first.el, { pointerId: 1 }));
      });
      rerender({ ref: createRef(second.el) });

      expect(first.removed.filter((listener) => listener.type === 'pointercancel')).toHaveLength(0);
      expect(second.added.filter((listener) => listener.type === 'pointercancel')).toHaveLength(0);

      act(() => {
        const event = new Event('pointercancel', { bubbles: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        first.el.dispatchEvent(event);
      });

      expect(result.current.pointerIdRef.current).toBeNull();
      expect(first.removed.filter((listener) => listener.type === 'pointercancel')).toHaveLength(1);
      expect(second.added.filter((listener) => listener.type === 'pointercancel')).toHaveLength(1);
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

  describe('container scroll listener', () => {
    it('registers once and removes the same handler on unmount', () => {
      const { el, added, removed } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { unmount } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const registered = added.find((listener) => listener.type === 'scroll');
      expect(registered).toBeDefined();
      expect(added.filter((listener) => listener.type === 'scroll')).toHaveLength(1);

      unmount();

      const unregistered = removed.find((listener) => listener.type === 'scroll');
      expect(unregistered?.handler).toBe(registered?.handler);
      expect(removed.filter((listener) => listener.type === 'scroll')).toHaveLength(1);
    });

    it('does not subscribe when the ref only supports adding listeners', () => {
      const { el, added } = createContainer({ left: 10, top: 20, width: 400, height: 200 });
      Object.defineProperty(el, 'removeEventListener', { configurable: true, value: undefined });
      const { result, unmount } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      expect(result.current.getLocalCoordsFromClientPoint(120, 34)).toEqual({ x: 5, y: 7 });
      expect(added.filter((listener) => listener.type === 'scroll')).toHaveLength(0);
      expect(added.filter((listener) => listener.type === 'pointercancel')).toHaveLength(0);
      expect(() => unmount()).not.toThrow();
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
        // 4px border: the border box is 400x300, the content box 392x292.
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

  describe('edge cases', () => {
    it('propagates non-finite client coordinates as NaN without throwing', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: NaN, clientY: NaN }));

      expect(Number.isNaN(coords.x)).toBe(true);
      expect(Number.isNaN(coords.y)).toBe(true);
    });

    it('collapses infinite client coordinates to NaN through the view transform', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: Infinity, clientY: -Infinity }));

      // Even with zero rotation the inverse-view math evaluates
      // `translated.x * cos - translated.y * sin` with `sin === 0`, and
      // `(-Infinity) * 0` is NaN, so an infinite client coordinate cannot
      // survive the transform and the mapped coordinate is NaN rather than
      // Infinity.
      expect(Number.isNaN(coords.x)).toBe(true);
      expect(Number.isNaN(coords.y)).toBe(true);
    });

    it('tolerates a null event target for coordinate mapping', () => {
      // `getLocalCoords` reads layout from the container ref, not from the event's target,
      // so a detached / null-targeted pointer event must map just like a targeted one.
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: 10, clientY: 20, target: null }));

      expect(coords).toEqual({ x: 5, y: 10 });
    });

    it('maps captured client coordinates through the same current fit as a pointer event', () => {
      const { el } = createContainer({ left: 25, top: 40, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const eventCoords = result.current.getLocalCoords(pointerEvent(el, { clientX: 45, clientY: 70 }));
      const capturedCoords = result.current.getLocalCoordsFromClientPoint(45, 70);

      expect(capturedCoords).toEqual(eventCoords);
    });

    it('does not throw for a zero-size container and reports a zero scale to onResize', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 0, height: 0 });
      const onResize = vi.fn();
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE, onResize }));

      expect(onResize).toHaveBeenCalledWith(
        expect.objectContaining({ scale: 0, outerWidth: 0, outerHeight: 0, innerWidth: 0, innerHeight: 0 })
      );

      // A zero scale means dividing by zero, so the mapped coordinates are NaN rather than
      // finite. This pins the current behaviour: the call must not throw.
      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: 0, clientY: 0 }));
      expect(Number.isNaN(coords.x)).toBe(true);
      expect(Number.isNaN(coords.y)).toBe(true);
    });

    // Desired behaviour: non-finite client coordinates are clamped to the document origin
    // rather than leaking NaN into downstream drawing / masking math. The hook currently
    // propagates NaN, so this tripwire is expected to fail until the guard lands.
    it.fails('clamps non-finite client coordinates to {0,0}', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 200, height: 200 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: NaN, clientY: NaN }));

      expect(coords).toEqual({ x: 0, y: 0 });
    });

    // Desired behaviour: a zero-size container must not divide through a zero scale and emit
    // NaN; it should fall back to finite coordinates. The hook currently produces a zero
    // scale, so this tripwire is expected to fail until the zero-scale guard lands.
    it.fails('returns finite coordinates for a zero-size container', () => {
      const { el } = createContainer({ left: 0, top: 0, width: 0, height: 0 });
      const { result } = renderHook(() => usePointerPosition({ ref: createRef(el), imageSize: IMAGE }));

      const coords = result.current.getLocalCoords(pointerEvent(el, { clientX: 0, clientY: 0 }));

      expect(Number.isFinite(coords.x)).toBe(true);
      expect(Number.isFinite(coords.y)).toBe(true);
    });
  });
});
