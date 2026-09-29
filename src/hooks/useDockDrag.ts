import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The pointer primitive every dock drag is built on: resize a column, resize the divider
 * between two panels, drag a panel to a new slot, drag the whole dock to the other edge.
 *
 * ## Why this exists rather than a `useState` per drag site
 *
 * Four separate interactions need the same four things, and getting any of them wrong is a
 * different bug each time:
 *
 *  - **Pointer capture**, so a drag that leaves the 4px-wide divider keeps receiving moves.
 *    A divider is a terrible hit target to track by hand.
 *  - **Primary button only.** A right-click that starts a resize and a middle-click paste that
 *    resizes are both real, and neither is a drag.
 *  - **`Escape` cancels.** "Press Esc while moving the panel to cancel the operation."
 *    (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)
 *    Dragging a divider is destructive enough that a keyboard escape has to exist, even though
 *    the divider itself is not a Photoshop-documented gesture.
 *  - **No text selection and a stable cursor for the whole gesture**, including the part where
 *    the pointer is somewhere else entirely.
 *
 * ## Why deltas and not coordinates
 *
 * `onMove` gets a delta from where the gesture started, not an absolute client coordinate. A
 * resize that reads `event.clientX` directly accumulates rounding across a long drag, and a
 * reorder that reads `clientY` cannot answer "which slot is this over" without re-measuring
 * the panels on every move. The delta is the stable primitive; the caller decides what it means.
 *
 * ## Why the listeners are on the document and not on the handle
 *
 * Capture is set on the handle, but `pointermove`/`pointerup` are registered on the document
 * anyway. The capture makes the document the event target for a captured pointer, so both
 * paths deliver; the document listener is what makes the drag survive the handle being
 * unmounted mid-gesture, which happens whenever a drag commits a state change that re-renders
 * the very element that started it.
 */

export type DragDelta = { dx: number; dy: number };

export interface DockDragOptions {
  /** Runs once when a drag is accepted. Receives the pointer-down event. */
  onStart?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Runs per move, with the delta from the drag's starting point. */
  onMove: (delta: DragDelta) => void;
  /**
   * Runs once when the gesture ends. `cancelled` is true for an Escape, a pointercancel, or a
   * non-primary button — the three cases where the caller has to put its own state back.
   */
  onEnd?: (cancelled: boolean) => void;
  /**
   * Cancels an in-flight drag when this becomes true. Used by the panel reorder, which cancels
   * the moment the pointer is released outside a valid drop slot, and by the dock side drag,
   * which cancels when the pointer comes back over its origin edge.
   */
  cancelSignal?: boolean;
}

export interface DockDrag {
  /**
   * Spread onto the handle. `onPointerDown` is the only handler needed: the document-level
   * listeners below cover the rest of the gesture, including `Escape`.
   */
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** True while a drag is in flight. Drives the "is being dragged" affordance. */
  isDragging: boolean;
}

export function useDockDrag({ onStart, onMove, onEnd, cancelSignal = false }: DockDragOptions): DockDrag {
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // The latest callbacks, in a ref the document listeners below read through.
  //
  // Every caller here passes a fresh closure on every render, and the listeners are registered
  // once per drag rather than per render, so the listener has to read the current closure
  // instead of the one it closed over — otherwise the second pointermove of a drag reports into
  // a stale callback and, for a resize, writes a width computed from an old starting point.
  //
  // The ref is written in an EFFECT rather than in the render body. A render-body write is what
  // the React compiler's `react-hooks/refs` rule rejects, and `useEffectEvent` is not the
  // substitute here: its result may only be called from an effect, and `onPointerDown` is an
  // event handler. An effect is the rule's own escape hatch for "latest value", and it is safe
  // because every reader is a DOM listener, which cannot run before effects have flushed.
  const latest = useRef({ onStart, onMove, onEnd, cancelSignal });
  useEffect(() => {
    latest.current = { onStart, onMove, onEnd, cancelSignal };
  });

  const finish = useCallback((cancelled: boolean) => {
    if (gestureRef.current === null) return;
    gestureRef.current = null;
    setIsDragging(false);
    document.body.classList.remove('cursor-grabbing');
    document.body.style.removeProperty('user-select');
    latest.current.onEnd?.(cancelled);
  }, []);

  // A drag that never ends — a pointerup delivered to another element, a window that lost
  // focus mid-gesture — leaves the body stuck in the grabbing cursor with selection disabled.
  // `blur` and `visibilitychange` are the two ways that happens in a real browser.
  useEffect(() => {
    if (!isDragging) return;
    const onBlur = () => finish(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finish(true);
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isDragging, finish]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // Primary button only. `button === 0` is true for a pen contact and for an un-pressed
    // pointer on some engines, so the buttons bitmask is the second half of the guard.
    if (event.button !== 0 || (event.buttons & 1) === 0) return;
    if (gestureRef.current !== null) return;

    gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsDragging(true);
    // `cursor-grabbing` is already a rule in `index.scss:69-71` and is applied to the whole
    // tree by `*`, which is what keeps the cursor steady once the pointer is off the handle.
    document.body.classList.add('cursor-grabbing');
    document.body.style.setProperty('user-select', 'none');
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A handle that is not connected cannot be captured. The document listeners below
      // still deliver the gesture, so this is a degraded path, not a broken one.
    }
    latest.current.onStart?.(event);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (gesture === null || event.pointerId !== gesture.pointerId) return;
      latest.current.onMove({ dx: event.clientX - gesture.x, dy: event.clientY - gesture.y });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (gestureRef.current === null || event.pointerId !== gestureRef.current.pointerId) return;
      finish(latest.current.cancelSignal);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (gestureRef.current === null || event.pointerId !== gestureRef.current.pointerId) return;
      finish(true);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(true);
    };

    // `cancelSignal` is read through the ref above for the same reason `onMove` is: this
    // listener is registered once per drag.
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('keydown', onKeyDown, true);
      // The gesture's own cleanup only runs if a pointerup arrives. Unmounting mid-drag — a
      // route change, a thrown error boundary, a StrictMode remount — takes this cleanup
      // instead, and without this the app is left with a stuck grabbing cursor and text
      // selection disabled for the rest of the session. `onEnd` is deliberately NOT called:
      // an unmounted drag has no caller left to report to, and calling one would be a
      // setState on an unmounted provider.
      document.body.classList.remove('cursor-grabbing');
      document.body.style.removeProperty('user-select');
    };
  }, [isDragging, finish]);

  // A ref mirroring `cancelSignal` for the pointerup listener, which closes over nothing.
  useEffect(() => {
    if (cancelSignal && isDragging) finish(true);
  }, [cancelSignal, isDragging, finish]);

  return {
    isDragging,
    // No `onKeyDown` here: the document listener above is registered with capture while a
    // drag is live, so it sees Escape from anywhere including the focused handle, and there is
    // nothing to cancel when no drag is live. A handler that only ever fired on a no-op press
    // would be a second, weaker path to the same rule.
    handleProps: { onPointerDown },
  };
}
