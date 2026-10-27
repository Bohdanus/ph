import { useEffect, useState } from 'react';

import { isKeyCaptured, resetKeyCaptures } from './input-capture.ts';
import { useKeyDownShortcut, useKeyUpShortcut } from './useKeyboardEvents.tsx';

/**
 * Is the spring-loaded Hand armed right now?
 *
 * A MODULE-LEVEL flag with a React mirror, and the split is the design rather than a
 * convenience.
 *
 * The flag is what `Main` reads to decide which tool area to mount, and that decision has to
 * be synchronous — a `useState` update from a `keydown` handler is not applied until React
 * re-renders, so a press-then-immediately-drag would mount the brush's area for the first
 * pointermove and the pan would never happen. Reading a module value costs nothing and is
 * correct on the same tick.
 *
 * The mirror exists because the rail has to re-render to change a cursor. Without it, pressing
 * Space would swap the canvas behaviour while the cursor kept saying the brush's, which is the
 * kind of half-state that only shows up as "the cursor is wrong" in a bug report.
 *
 * Two consequences of the module-level half, both handled below: the flag outlives any one mount
 * and has to be cleared when the window loses focus, or a release the page never sees leaves it
 * armed for the rest of the session.
 */
let spaceHeld = false;

const listeners = new Set<() => void>();

function setSpaceHeld(next: boolean) {
  if (spaceHeld === next) return;
  spaceHeld = next;
  for (const listener of listeners) listener();
}

/** Synchronous read, for the tool-area decision. */
export function isSpaceHeld(): boolean {
  return spaceHeld;
}

/** Subscribe to the armed state. Returns an unsubscribe function. */
export function subscribeSpaceHeld(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop any armed state. The module-level slot outlives every mount, so a leak is unbounded. */
export function resetTemporaryHand(): void {
  setSpaceHeld(false);
}

/**
 * Whether the press should be refused.
 *
 * Read at event time rather than captured in a closure, because both gates are mutable state
 * owned by other modules: a flyout can open between two presses, and a document gesture can open
 * between the arm and the release.
 *
 * `isKeyCaptured` first because a modal surface with the keyboard is the case where a pan is
 * least wanted and most confusing — `PanelGroup` and `SidebarLeft` both read `Space` in their own
 * handlers, and without this a Space over a flyout would both activate the highlighted item and
 * start a pan.
 *
 * The gesture gate is the one that makes this feature safe rather than merely working. Arming
 * swaps the mounted tool area, and every tool area releases its `document-gesture` claim on
 * unmount — so arming mid-stroke would abort the stroke in flight. It also collides with
 * `ShapeToolArea`, which already owns `Space` for shape repositioning.
 *
 * Divergence, deliberately: Photoshop pans mid-brush-stroke and moves an in-progress marquee
 * instead. This app refuses, which is recorded for the operator in `docs/OVERRIDES.md` — a
 * register this repository does not write.
 */
function canArm(): boolean {
  return !isKeyCaptured();
}

/**
 * Register the spring-loaded Hand with the keyboard. Call once, from `AppKeyboardShortcuts`.
 *
 * DELIBERATELY NOT CALLED FROM `Main`, and the reason is structural rather than stylistic: this
 * hook needs `KeyboardEventsProvider`, and `Main` is rendered by tests that deliberately do not
 * wrap it — `useKeyboardEvents` throws rather than degrading, so a `Main` that owned the
 * registration could not be rendered at all in those files. `AppKeyboardShortcuts` is where every
 * other shortcut is registered and it is inside the provider, so that is where this belongs.
 *
 * `Main` then reads the armed state through {@link useSpaceHeld}, which needs no provider. The
 * split is one registration owner and one reader, and neither has to know about the other's
 * dependency.
 *
 * The `blur` and `visibilitychange` handlers are not defensive padding. A keyup is delivered to
 * the focused document, so releasing `Space` while another window has focus — or switching tabs
 * mid-press — delivers nothing, and without these the flag stays armed with no key down. The
 * result would be a cursor that pans and a view that moves, in a tool the user is not holding.
 */
export function useRegisterTemporaryHand(): void {
  useEffect(() => {
    // Paired with the provider's own `resetDocumentGestures()` for the same reason and with
    // the same reasoning: the flag is module-level, so a leaked arm would outlive the mount
    // that leaked it.
    resetKeyCaptures();
    return () => {
      resetTemporaryHand();
    };
  }, []);

  useEffect(() => {
    const release = () => setSpaceHeld(false);

    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);

    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, []);

  useKeyDownShortcut({
    key: ' ',
    onKeyDown: () => {
      if (!canArm()) return;
      setSpaceHeld(true);
    },
    // The default `true`, and it is what makes the gesture gate above unnecessary to
    // re-implement: a press that arrives while a document gesture is open is refused by the
    // shared channel itself, with the structural guarantee that no dispatch occurs.
    enabled: canArm,
    // Claimed so the page does not scroll under the pointer while a pan is in flight, and so
    // the press is recognisably the app's.
    preventDefault: true,
  });

  useKeyUpShortcut({
    key: ' ',
    onKeyUp: () => setSpaceHeld(false),
    // `false`, and this is the asymmetry that matters: the press may be refused, but the
    // RELEASE may never be. Disarming can only reduce the amount of state in play, so it is
    // correct in every situation a press can be refused in — including a gesture that opened
    // while `Space` was held, and a flyout that claimed the keyboard after the arm.
    mutatesDocument: false,
    enabled: () => true,
  });
}

/**
 * The armed state, as a boolean a component can branch on.
 *
 * The mirror exists because the canvas CURSOR has to change: without it, pressing `Space` would
 * swap the mounted tool area while the cursor kept saying the brush's, which is the kind of
 * half-state that arrives as "the cursor is wrong" in a bug report.
 *
 * The tool-area decision itself must NOT use this. A `keydown` handler's state update is not
 * applied until React re-renders, so a press-then-immediately-drag would mount the previous
 * tool's area for the first pointermove and the pan would never happen. `Main` therefore reads
 * {@link isSpaceHeld} for routing and this hook only for rendering.
 */
export function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(spaceHeld);

  useEffect(() => {
    // Reads the module flag rather than the argument, so the mirror follows the source of
    // truth instead of a second copy of it that could disagree.
    const unsubscribe = subscribeSpaceHeld(() => setHeld(spaceHeld));
    return unsubscribe;
  }, []);

  return held;
}
