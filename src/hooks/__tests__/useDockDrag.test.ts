import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockDrag, type DragDelta } from '../useDockDrag.ts';

/**
 * The pointer primitive, tested on its own because every one of its rules is a rule about what
 * happens AROUND a drag, and a dock that only works while the pointer is over the handle is not
 * a dock.
 *
 * jsdom has no `setPointerCapture`, so the handle is rendered with a stub that records the
 * calls. That is not a weakening: capture is what the browser uses to keep delivering moves
 * past the handle, and the document listeners below deliver the gesture whether or not capture
 * took, which is exactly the degraded path `onPointerDown` catches. What these tests pin is
 * the delivery, the button guard, the Escape cancel, and the cursor/selection cleanup — none
 * of which involve layout, and none of which jsdom can fake into agreement.
 */

const results: DragDelta[] = [];
const ends: boolean[] = [];

/** A pointer event shaped the way `useDockDrag` reads it, with a capture stub. */
const pointerEvent = (init: Partial<PointerEvent> & { button?: number; buttons?: number }) => {
  const target = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
  return {
    currentTarget: target,
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    buttons: init.buttons ?? 1,
    ...init,
  } as unknown as React.PointerEvent<HTMLElement>;
};

const dispatch = (type: string, init: Partial<PointerEvent> = {}) => {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.assign(event, { pointerId: 1, ...init });
  return act(() => {
    document.dispatchEvent(event);
  });
};

const setup = (options: Parameters<typeof useDockDrag>[0] = { onMove: () => {} }) =>
  renderHook(() => useDockDrag(options));

describe('useDockDrag', () => {
  beforeEach(() => {
    results.length = 0;
    ends.length = 0;
    document.body.className = '';
    document.body.style.userSelect = '';
    // A `visibilityState` left at 'hidden' by the mid-drag test would make every later gesture
    // in this file cancel itself on the first `visibilitychange` it happened to dispatch.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  describe('what starts a drag', () => {
    it('accepts a primary-button press', () => {
      const { result } = setup();

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ button: 0, buttons: 1 })));

      expect(result.current.isDragging).toBe(true);
      expect(document.body).toHaveClass('cursor-grabbing');
    });

    it.each([
      ['a right-click', { button: 2, buttons: 2 }],
      ['a middle-click', { button: 1, buttons: 4 }],
      ['a press with no buttons down', { button: 0, buttons: 0 }],
    ])('ignores %s', (_label, init) => {
      const { result } = setup();

      act(() => result.current.handleProps.onPointerDown(pointerEvent(init)));

      expect(result.current.isDragging).toBe(false);
      expect(document.body).not.toHaveClass('cursor-grabbing');
    });

    it('ignores a second press while one is already in flight', () => {
      const onStart = vi.fn();
      const { result } = setup({ onMove: () => {}, onStart });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));

      // A second finger on a stylus is the real case, and two overlapping gestures would each
      // write a width and the second would win.
      expect(onStart).toHaveBeenCalledTimes(1);
    });
  });

  describe('what a drag reports', () => {
    it('reports the delta from where the gesture started, not the absolute position', () => {
      const onMove = (delta: DragDelta) => results.push(delta);
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 500, clientY: 200 })));
      dispatch('pointermove', { clientX: 460, clientY: 260 });
      dispatch('pointermove', { clientX: 380, clientY: 200 });

      expect(results).toEqual([
        { dx: -40, dy: 60 },
        { dx: -120, dy: 0 },
      ]);
    });

    // A divider is an 8px target; tracking a drag by hand once the pointer is 300px away is
    // the failure this capture exists to prevent.
    it('keeps reporting after the pointer has left the handle', () => {
      const onMove = vi.fn();
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 10, clientY: 10 })));
      // No event target is ever the handle: the listeners are on the document, which is what a
      // captured pointer reports to and what an uncaptured one would not.
      dispatch('pointermove', { clientX: 900, clientY: 10 });

      expect(onMove).toHaveBeenCalledWith({ dx: 890, dy: 0 });
    });

    it('ignores moves from a different pointer', () => {
      const onMove = vi.fn();
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ pointerId: 1 })));
      dispatch('pointermove', { pointerId: 7, clientX: 400, clientY: 0 });

      expect(onMove).not.toHaveBeenCalled();
    });
  });

  describe('what ends a drag', () => {
    it('commits on a primary-button release and clears the gesture', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      dispatch('pointerup');

      expect(ends).toEqual([false]);
      expect(result.current.isDragging).toBe(false);
    });

    // "Press Esc while moving the panel to cancel the operation." (Adobe, move-panels)
    it('cancels on Escape and stops reporting', () => {
      const onMove = vi.fn();
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result } = setup({ onMove, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })));
      dispatch('pointermove', { clientX: 50, clientY: 0 });
      onMove.mockClear();

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      dispatch('pointermove', { clientX: 400, clientY: 0 });

      expect(ends).toEqual([true]);
      expect(onMove).not.toHaveBeenCalled();
      expect(result.current.isDragging).toBe(false);
    });

    it('cancels on a pointercancel', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      dispatch('pointercancel');

      expect(ends).toEqual([true]);
    });

    // A pointerup that never arrives leaves the body stuck in the grabbing cursor with text
    // selection disabled, which is the failure a user cannot undo.
    it.each([
      [
        'the window loses focus',
        () =>
          act(() => {
            window.dispatchEvent(new Event('blur'));
          }),
      ],
      [
        'the tab is hidden',
        () =>
          act(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
          }),
      ],
    ])('releases the cursor when %s mid-drag', (_label, loseThePointer) => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      expect(document.body).toHaveClass('cursor-grabbing');
      expect(document.body.style.userSelect).toBe('none');

      loseThePointer();

      expect(ends).toEqual([true]);
      expect(document.body).not.toHaveClass('cursor-grabbing');
      expect(document.body.style.userSelect).toBe('');
    });

    it('ends once, even if a release follows the cancel', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      dispatch('pointerup');

      expect(ends).toEqual([true]);
    });
  });

  describe('cancelSignal', () => {
    it('cancels a live drag when the caller invalidates it', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result, rerender } = renderHook(
        ({ signal }: { signal: boolean }) => useDockDrag({ onMove: () => {}, onEnd, cancelSignal: signal }),
        {
          initialProps: { signal: false },
        }
      );

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      rerender({ signal: true });

      expect(ends).toEqual([true]);
      expect(result.current.isDragging).toBe(false);
    });
  });

  describe('two gestures at once', () => {
    // The guard against a second gesture is PER HOOK INSTANCE, and the cursor and selection lock
    // live on `document.body` — so the first gesture to end used to take the lock away from the
    // one still running. A live resize with the cursor snapped back to an I-beam and text
    // selection re-enabled under the pointer.
    it('keeps the cursor lock until the last concurrent gesture ends', () => {
      const first = setup({ onMove: () => {} });
      const second = setup({ onMove: () => {} });

      act(() => first.result.current.handleProps.onPointerDown(pointerEvent({ pointerId: 1 })));
      act(() => second.result.current.handleProps.onPointerDown(pointerEvent({ pointerId: 2 })));
      expect(document.body).toHaveClass('cursor-grabbing');

      dispatch('pointerup', { pointerId: 1 });
      // The second is still live, so the lock must survive.
      expect(document.body).toHaveClass('cursor-grabbing');
      expect(document.body.style.userSelect).toBe('none');

      dispatch('pointerup', { pointerId: 2 });
      expect(document.body).not.toHaveClass('cursor-grabbing');
      expect(document.body.style.userSelect).toBe('');
    });

    it('unlocks once even when both are cancelled by the same Escape', () => {
      const first = setup({ onMove: () => {}, onEnd: (c) => ends.push(c) });
      const second = setup({ onMove: () => {}, onEnd: (c) => ends.push(c) });

      act(() => first.result.current.handleProps.onPointerDown(pointerEvent({ pointerId: 1 })));
      act(() => second.result.current.handleProps.onPointerDown(pointerEvent({ pointerId: 2 })));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(ends).toEqual([true, true]);
      expect(document.body).not.toHaveClass('cursor-grabbing');
    });
  });

  describe('unmount', () => {
    it('takes the cursor class with it', () => {
      const { result, unmount } = setup({ onMove: () => {} });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      expect(document.body).toHaveClass('cursor-grabbing');

      unmount();

      // A provider that unmounts mid-drag — a route change, a thrown boundary — must not leave
      // the whole app unselectable.
      expect(document.body).not.toHaveClass('cursor-grabbing');
      expect(document.body.style.userSelect).toBe('');
    });

    // A caller that keeps its own drag state set because `onEnd` never ran is left with a
    // permanently highlighted tab and a blue drop line and no gesture in flight, and nothing
    // clears it. The caller is very often still mounted when this hook's owner is not: a narrow
    // dock crossing the label threshold unmounts every panel group underneath a live drag.
    it('reports the in-flight gesture as cancelled, so the caller can clear its own state', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result, unmount } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      unmount();

      expect(ends).toEqual([true]);
      expect(document.body).not.toHaveClass('cursor-grabbing');
    });

    it('does not report a gesture that already ended', () => {
      const onEnd = (cancelled: boolean) => ends.push(cancelled);
      const { result, unmount } = setup({ onMove: () => {}, onEnd });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({})));
      dispatch('pointerup');
      unmount();

      // One release, one report. A second on unmount would double-apply whatever the caller
      // does at the end of a gesture.
      expect(ends).toEqual([false]);
    });
  });

  describe('edge cases', () => {
    it('starts the drag from a null target via the degraded capture path', () => {
      const onMove = vi.fn();
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ currentTarget: null })));

      // `setPointerCapture` throws on a null target, but the hook swallows that: the document
      // listeners still deliver the gesture, so the drag is live even without capture.
      expect(result.current.isDragging).toBe(true);
      dispatch('pointermove', { clientX: 10, clientY: 10 });
      expect(onMove).toHaveBeenCalledWith({ dx: 10, dy: 10 });
    });

    it('reports NaN deltas when the start coordinate is non-finite', () => {
      const onMove = (delta: DragDelta) => results.push(delta);
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: NaN, clientY: NaN })));
      dispatch('pointermove', { clientX: 10, clientY: 20 });

      expect(results).toEqual([{ dx: NaN, dy: NaN }]);
    });

    it('reports an Infinity delta when the pointer moves to an Infinity coordinate', () => {
      const onMove = (delta: DragDelta) => results.push(delta);
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })));
      dispatch('pointermove', { clientX: Infinity, clientY: 50 });

      expect(results).toEqual([{ dx: Infinity, dy: 50 }]);
    });

    it('reports a zero delta when the pointer has not moved', () => {
      const onMove = (delta: DragDelta) => results.push(delta);
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 5, clientY: 5 })));
      dispatch('pointermove', { clientX: 5, clientY: 5 });

      expect(results).toEqual([{ dx: 0, dy: 0 }]);
    });
  });

  // `it.fails` marks each test as expected to fail: the assertion below is the DESIRED behavior the
  // hook does not yet harden, so a green assertion would turn the suite red. That is the point —
  // when someone adds non-finite-coord guards, these stop failing and demand a review.
  describe('tripwires', () => {
    it.fails('never emits a non-finite delta from a NaN start', () => {
      const onMove = vi.fn();
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: NaN, clientY: NaN })));
      dispatch('pointermove', { clientX: 10, clientY: 20 });

      expect(onMove).toHaveBeenCalled();
      const [delta] = onMove.mock.calls[0]!;
      expect(Number.isFinite(delta.dx)).toBe(true);
      expect(Number.isFinite(delta.dy)).toBe(true);
    });

    it.fails('never emits a non-finite delta from an Infinity coordinate', () => {
      const onMove = vi.fn();
      const { result } = setup({ onMove });

      act(() => result.current.handleProps.onPointerDown(pointerEvent({ clientX: 0, clientY: 0 })));
      dispatch('pointermove', { clientX: Infinity, clientY: 50 });

      expect(onMove).toHaveBeenCalled();
      const [delta] = onMove.mock.calls[0]!;
      expect(Number.isFinite(delta.dx)).toBe(true);
      expect(Number.isFinite(delta.dy)).toBe(true);
    });
  });
});
