import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { useDrag } from '../useDrag.ts';

const pointerState = vi.hoisted(() => ({ isMouseDown: { current: false }, moveValid: true }));

function createMockUsePointerPosition() {
  return {
    pointerIdRef: { current: null },
    isPointerDownValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      pointerState.isMouseDown.current = true;
      return true;
    }),
    isPointerMoveValid: vi.fn(() => pointerState.moveValid),
    isPointerUpValid: vi.fn((event: PointerEvent) => {
      if (event.button !== 0) return false;
      pointerState.isMouseDown.current = false;
      return true;
    }),
    getLocalCoords: vi.fn(() => ({ x: 10, y: 20 })),
    isMouseDown: pointerState.isMouseDown,
  };
}

vi.mock('../usePointerPosition.ts', () => ({
  usePointerPosition: createMockUsePointerPosition,
}));

function makeEvent(overrides: Record<string, unknown> = {}): PointerEvent<HTMLDivElement> {
  return { button: 0, clientX: 0, clientY: 0, pointerId: 1, ...overrides } as unknown as PointerEvent<HTMLDivElement>;
}

type DragHandlers = {
  handlePointerHoverMove?: (point: { x: number; y: number }) => void;
  handlePointerDown?: (point: { x: number; y: number }) => void;
  handleDrag?: (point: { x: number; y: number }) => void;
  handleDragEnd?: (point: { x: number; y: number }) => void;
};

function renderUseDrag(handlers: DragHandlers = {}) {
  return renderHook(() =>
    useDrag({
      containerRef: { current: document.createElement('div') },
      imageSize: { width: 800, height: 600 },
      ...handlers,
    })
  );
}

describe('useDrag', () => {
  beforeEach(() => {
    pointerState.isMouseDown.current = false;
    pointerState.moveValid = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('return value', () => {
    it('exposes pointerIdRef and three pointer handlers', () => {
      const { result } = renderUseDrag();

      expect(result.current.pointerIdRef).toEqual({ current: null });
      expect(typeof result.current.onPointerDown).toBe('function');
      expect(typeof result.current.onPointerMove).toBe('function');
      expect(typeof result.current.onPointerUp).toBe('function');
    });
  });

  describe('pointer down', () => {
    it('calls handlePointerDown with local coords on a valid left-click', () => {
      const handler = vi.fn();
      const { result } = renderUseDrag({ handlePointerDown: handler });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    it('does not throw when handlePointerDown is not provided', () => {
      const { result } = renderUseDrag();

      expect(() => {
        act(() => result.current.onPointerDown(makeEvent({ button: 0 })));
      }).not.toThrow();
    });

    it('ignores pointer down with a non-left button', () => {
      const handler = vi.fn();
      const { result } = renderUseDrag({ handlePointerDown: handler });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 1 }));
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('pointer move (hover / no drag)', () => {
    it('does nothing when mouse is not down and no handlers are provided', () => {
      const { result } = renderUseDrag();

      expect(() => {
        act(() => result.current.onPointerMove(makeEvent()));
      }).not.toThrow();
    });

    it('schedules RAF and calls handlePointerHoverMove when not dragging', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      const { result } = renderUseDrag({ handlePointerHoverMove: handler });

      act(() => {
        result.current.onPointerMove(makeEvent());
      });

      expect(handler).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    it('throttles RAF so only one callback fires for multiple moves before the frame', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      const { result } = renderUseDrag({ handlePointerHoverMove: handler });

      act(() => {
        result.current.onPointerMove(makeEvent());
        result.current.onPointerMove(makeEvent());
      });

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('pointer move (dragging)', () => {
    it('does nothing when dragging but no handleDrag is provided', () => {
      const { result } = renderUseDrag({ handlePointerHoverMove: vi.fn() });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });

      expect(() => {
        act(() => result.current.onPointerMove(makeEvent()));
      }).not.toThrow();
    });

    it('ignores pointer move when mouse is down but move is invalid', () => {
      const handler = vi.fn();
      const { result } = renderUseDrag({ handleDrag: handler });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });

      pointerState.moveValid = false;

      act(() => {
        result.current.onPointerMove(makeEvent());
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('schedules RAF and calls handleDrag when dragging with a valid move', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      const { result } = renderUseDrag({ handleDrag: handler });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });

      act(() => {
        result.current.onPointerMove(makeEvent());
      });

      expect(handler).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    it('throttles RAF for drag moves', () => {
      vi.useFakeTimers();
      const handler = vi.fn();
      const { result } = renderUseDrag({ handleDrag: handler });

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });

      act(() => {
        result.current.onPointerMove(makeEvent());
        result.current.onPointerMove(makeEvent());
      });

      act(() => {
        vi.advanceTimersByTime(20);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('pointer up', () => {
    it('calls handleDragEnd with local coords on a valid pointer up', () => {
      const handler = vi.fn();
      const { result } = renderUseDrag({ handleDragEnd: handler });

      act(() => {
        result.current.onPointerUp(makeEvent({ button: 0 }));
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    it('ignores pointer up with a non-left button', () => {
      const handler = vi.fn();
      const { result } = renderUseDrag({ handleDragEnd: handler });

      act(() => {
        result.current.onPointerUp(makeEvent({ button: 1 }));
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('releases the pointer and cancels the queued frame even with no end handler', () => {
      // Every consumer of this hook that needs a release has to name it, and the frame
      // bookkeeping must not be conditional on one existing. A guard that made the release
      // path optional would strand the capture `usePointerPosition` took.
      vi.useFakeTimers();
      const { result } = renderUseDrag();

      act(() => {
        result.current.onPointerDown(makeEvent({ button: 0 }));
      });
      act(() => {
        result.current.onPointerMove(makeEvent());
      });
      act(() => {
        result.current.onPointerUp(makeEvent({ button: 0 }));
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // The mock's `isPointerUpValid` is what clears `isMouseDown`, so the release ran.
      expect(pointerState.isMouseDown.current).toBe(false);
    });

    it('cancels a pending animation frame on pointer up', () => {
      vi.useFakeTimers();
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
      const hoverHandler = vi.fn();
      const { result } = renderUseDrag({ handlePointerHoverMove: hoverHandler });

      act(() => {
        result.current.onPointerMove(makeEvent());
      });
      // Read the handle off the scheduler rather than assuming a value. Whether the fake
      // timers' rAF counter restarts per `vi.useFakeTimers()` call or is shared across
      // this file is a property of the timer library rather than of the hook, and it is
      // not something this assertion should depend on: a literal would pin the handle to
      // the order the runner happened to use.
      const scheduled = rafSpy.mock.results.at(-1)!.value as unknown as number;
      cancelSpy.mockClear();

      act(() => {
        result.current.onPointerUp(makeEvent({ button: 0 }));
      });

      // The EXACT handle the pending frame was registered under. A bare "was called"
      // would be satisfied by a cancel of any handle at all — including `0`, the null
      // sentinel the hook's own `frameRequested.current !== null` guard exists to keep
      // away from `cancelAnimationFrame` — and the frame itself would still run.
      expect(cancelSpy).toHaveBeenCalledExactlyOnceWith(scheduled);
    });

    it('drops the queued hover move rather than flushing it after the release', () => {
      vi.useFakeTimers();
      const hoverHandler = vi.fn();
      const endHandler = vi.fn();
      const { result } = renderUseDrag({ handlePointerHoverMove: hoverHandler, handleDragEnd: endHandler });

      // A press and release with no movement: the queued hover move is the only pending
      // work, and the release has to run the end path anyway.
      act(() => {
        result.current.onPointerMove(makeEvent());
      });
      act(() => {
        result.current.onPointerUp(makeEvent({ button: 0 }));
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(hoverHandler).not.toHaveBeenCalled();
      expect(endHandler).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 20 });
    });
  });

  describe('cleanup', () => {
    it('cancels a pending frame when the hook unmounts', () => {
      vi.useFakeTimers();
      const hoverHandler = vi.fn();
      const { result, unmount } = renderUseDrag({ handlePointerHoverMove: hoverHandler });

      act(() => {
        result.current.onPointerMove(makeEvent());
      });

      unmount();

      act(() => {
        vi.advanceTimersByTime(50);
      });

      expect(hoverHandler).not.toHaveBeenCalled();
    });

    it('does not throw on unmount when no frame was scheduled', () => {
      vi.useFakeTimers();
      const { unmount } = renderUseDrag();

      expect(() => unmount()).not.toThrow();
    });
  });
});
