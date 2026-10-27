import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { isDocumentGestureOpen, resetDocumentGestures } from './document-gesture.ts';

export type KeyboardShortcut = {
  key: string;
  onKeyDown: (event: KeyboardEvent) => void;
  /**
   * The same registration's RELEASE, dispatched from a `keyup` listener.
   *
   * Optional and additive: a registration that omits it registers nothing on the keyup
   * channel and behaves exactly as it did before this field existed, which is what keeps this
   * change safe on a primitive every shortcut in the app depends on.
   *
   * `mutatesDocument`, `allowInInput` and `enabled` all still apply to the release, so a
   * registration that arms on keydown must reason about whether its release is gated. The two
   * halves of a press are separate decisions with separate justifications — the spring-loaded
   * Hand refuses to ARM while a document gesture is open and must always be able to DISARM,
   * which is why it uses two registrations rather than one.
   */
  onKeyUp?: (event: KeyboardEvent) => void;
  enabled?: boolean | (() => boolean); // Default: enabled. A FUNCTION is read at event time rather than per render, which is what a gate over mutable state owned by another module needs — a flyout can open between two renders, and a boolean captured at the last render would arm a shortcut that was supposed to be refused. A boolean still works and behaves exactly as it did before the union.
  mutatesDocument?: boolean; // Default: true. A document-committing gesture is in progress, so this registration must not run. Set to `false` ONLY for a shortcut that is about the gesture itself — `Escape` cancelling the draft, `Enter` finishing it, `Backspace` removing the last anchor, a popup's own `Escape`, a spring-loaded release — because refusing those would leave the gesture with no way out. A registration that defaults to `true` is safe without anyone having thought about it; the exemption has to be argued for.
  preventDefault?: boolean;
  stopPropagation?: boolean;
  allowInInput?: boolean; // Default: false. Set to true for shortcuts that should work in input fields (tool commands, not text editing)
  repeat?: boolean; // Default: false. Set to true for shortcuts that should re-fire while held (a zoom stepper, a scrub). The default is the safety property: one press is one intent. A `repeat: true` registration is resolved independently of the last-registered-wins rule used for the initial press, so a key already owned by a later registration will dispatch the earlier one while held.
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  mod?: boolean;
};

type KeyboardShortcutGetter = () => KeyboardShortcut;

type KeyboardEventsContextState = {
  registerKeyDownShortcut: (shortcutGetter: KeyboardShortcutGetter) => () => void;
  registerKeyUpShortcut: (shortcutGetter: KeyboardShortcutGetter) => () => void;
};

const KeyboardEventsContext = createContext<KeyboardEventsContextState | undefined>(undefined);

function normalizeKey(key: string) {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  // Textarea is always editable
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  // Contenteditable elements are editable
  if ((target instanceof HTMLElement && target.isContentEditable) || !!target.closest('[contenteditable="true"]')) {
    return true;
  }

  // For inputs, only text-like inputs are editable (not controls like range, checkbox, etc.)
  if (target instanceof HTMLInputElement) {
    const textLikeTypes = ['text', 'password', 'search', 'email', 'url', 'tel', 'number'];
    return textLikeTypes.includes(target.type);
  }

  // Select elements are editable
  if (target instanceof HTMLSelectElement) {
    return true;
  }

  return false;
}

/**
 * Whether a registration is live at this instant.
 *
 * A getter form is read HERE, per event, rather than per render — see the `enabled` field.
 */
function isEnabled(shortcut: KeyboardShortcut): boolean {
  const { enabled } = shortcut;
  if (typeof enabled === 'function') return enabled();
  return enabled !== false;
}

/**
 * Run one shared predicate chain over a registration list and invoke the first match.
 *
 * EXTRACTED rather than written twice because the keydown and keyup channels must agree
 * exactly. A release that applied a weaker set of conditions than its press would be a bug
 * that only appears on one side of a keypress — the shape that produces a stuck modifier — and
 * the two lists are the same type for the same reason.
 *
 * `isRelease` skips the `event.repeat` gate: auto-repeat is a property of a held key down, and
 * a keyup never carries it.
 */
function dispatchShortcut(
  registry: KeyboardShortcutGetter[],
  event: KeyboardEvent,
  isRelease: boolean,
  invoke: (shortcut: KeyboardShortcut) => void
) {
  for (let i = registry.length - 1; i >= 0; i--) {
    const shortcut = registry[i]();
    if (!shortcut || !isEnabled(shortcut)) continue;

    // A document-committing gesture is in progress, and a gesture commits on
    // release. Undo/redo here replaces `selections` from the SAME `history`
    // array, so `history.length` never moves and the pending commit's
    // `entries.slice(0, cursor + 1)` then truncates the redo tail with no
    // other symptom; `mod+c` bumps `metadata.copiedAtVersion` in place with
    // no append at all. Both are invisible from the writer, and neither is
    // detectable by comparing `history.length`.
    //
    // THE GUARANTEE IS STRUCTURAL, NOT A GUARD SOMEWHERE DEEPER: refusal
    // happens here, at `keydown`, so no dispatch occurs, therefore no append
    // occurs, therefore nothing truncates. `useSelectionHistory` stays
    // untouched, and `previousSelectionState` is still captured from live
    // state at commit time.
    //
    // Placed next to `enabled` and deliberately NOT after `preventDefault`:
    // a refused shortcut then behaves exactly like a disabled one — the
    // browser default is left untouched, no `stopPropagation` claim is made
    // for the lifetime of the press, and the loop still falls through to a
    // lower-priority registration. This is the same rule
    // `usePointerPosition.isPointerDownValid` already applies to a second
    // pointer, applied to the keyboard channel where it was missing.
    if (shortcut.mutatesDocument !== false && isDocumentGestureOpen()) continue;

    if (!shortcut.allowInInput && isEditableTarget(event.target)) continue;

    if (!matchesShortcut(event, shortcut)) continue;

    if (shortcut.preventDefault) {
      event.preventDefault();
    }

    if (shortcut.stopPropagation) {
      event.stopPropagation();
    }

    // Suppress OS auto-repeat unless this registration opted in. Deliberately AFTER
    // preventDefault/stopPropagation: those two are how the app claims the key for the
    // lifetime of the press, so a held key must keep cancelling the browser default on every
    // repeat. Gating above them would hand the browser a default it has never had — a held
    // Backspace would mung the layer-rename field once its first press matched an
    // allowInInput + preventDefault registration (the lasso/polygon tools' Backspace/Delete).
    if (!isRelease && event.repeat && !shortcut.repeat) continue;

    invoke(shortcut);
    break;
  }
}

function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut) {
  if (normalizeKey(event.key) !== normalizeKey(shortcut.key)) {
    return false;
  }

  if (shortcut.mod !== undefined && (event.metaKey || event.ctrlKey) !== shortcut.mod) {
    return false;
  }

  if (shortcut.ctrl !== undefined && event.ctrlKey !== shortcut.ctrl) {
    return false;
  }

  if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) {
    return false;
  }

  if (shortcut.alt !== undefined && event.altKey !== shortcut.alt) {
    return false;
  }

  if (shortcut.meta !== undefined && event.metaKey !== shortcut.meta) {
    return false;
  }

  return true;
}

export const KeyboardEventsProvider = ({ children }: { children: React.ReactNode }) => {
  const keyDownShortcutsRef = useRef<KeyboardShortcutGetter[]>([]);
  const keyUpShortcutsRef = useRef<KeyboardShortcutGetter[]>([]);

  const registerKeyDownShortcut = useCallback((shortcutGetter: KeyboardShortcutGetter) => {
    keyDownShortcutsRef.current.push(shortcutGetter);

    return () => {
      keyDownShortcutsRef.current = keyDownShortcutsRef.current.filter((item) => item !== shortcutGetter);
    };
  }, []);

  const registerKeyUpShortcut = useCallback((shortcutGetter: KeyboardShortcutGetter) => {
    keyUpShortcutsRef.current.push(shortcutGetter);

    return () => {
      keyUpShortcutsRef.current = keyUpShortcutsRef.current.filter((item) => item !== shortcutGetter);
    };
  }, []);

  useEffect(() => {
    // The gesture slot is module-level, so it outlives any one mount. A claim
    // leaked by a mount that is already gone — an unmount between claim and
    // commit, or a test case that never released — would otherwise gate every
    // later keystroke in the session. Clearing on mount and again on cleanup
    // bounds that leak to the mount that leaked it.
    resetDocumentGestures();

    const handleKeyDown = (event: KeyboardEvent) => {
      dispatchShortcut(keyDownShortcutsRef.current, event, false, (shortcut) => shortcut.onKeyDown(event));
    };

    /**
     * The RELEASE channel.
     *
     * A SEPARATE listener rather than a second pass over the keydown registry, for one
     * concrete reason: a registration that declares `onKeyUp` must not make its own keydown
     * dispatch twice. And a separate registry, rather than one list holding both halves,
     * because the two halves resolve independently — the spring-loaded Hand refuses to arm
     * while a document gesture is open and must always be able to disarm, which is one
     * registration with two different `mutatesDocument` answers, and a single list cannot
     * express two answers for one key.
     */
    const handleKeyUp = (event: KeyboardEvent) => {
      dispatchShortcut(keyUpShortcutsRef.current, event, true, (shortcut) => shortcut.onKeyUp?.(event));
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      // Paired with the mount-time clear: the provider going away must not leave
      // a claim behind for whatever mounts next, or the keyboard stays dead for
      // the rest of the session with nothing on screen to explain it.
      resetDocumentGestures();
    };
  }, []);

  const value = useMemo(
    () => ({
      registerKeyDownShortcut,
      registerKeyUpShortcut,
    }),
    [registerKeyDownShortcut, registerKeyUpShortcut]
  );

  return <KeyboardEventsContext.Provider value={value}>{children}</KeyboardEventsContext.Provider>;
};

function useKeyboardEvents() {
  const context = useContext(KeyboardEventsContext);
  if (!context) {
    throw new Error('useKeyboardEvents must be used within a KeyboardEventsProvider');
  }
  return context;
}

export function useKeyDownShortcut(shortcut: KeyboardShortcut) {
  const { registerKeyDownShortcut } = useKeyboardEvents();
  const shortcutRef = useRef(shortcut);

  useLayoutEffect(() => {
    shortcutRef.current = shortcut;
  }, [shortcut]);

  useEffect(() => {
    return registerKeyDownShortcut(() => shortcutRef.current);
  }, [registerKeyDownShortcut]);
}

/**
 * A RELEASE-only registration.
 *
 * `KeyboardShortcut` minus `onKeyDown`, so that a hook which never reads the press cannot
 * demand one. Making `onKeyDown` optional on the shared type instead would have been the
 * worse trade: every existing registration supplies it, and a type error is the only thing
 * standing between a new shortcut and a silently inert one.
 */
export type KeyUpShortcut = Omit<KeyboardShortcut, 'onKeyDown'>;

/**
 * Register the RELEASE half of a shortcut.
 *
 * **A separate hook, not a flag on `useKeyDownShortcut`.** One registration cannot carry two
 * different `mutatesDocument` answers, and the spring-loaded Hand needs exactly that: its press
 * must be refused while a document-committing gesture is open, and its release must never be.
 * Registering both halves here would force that pair into a single shortcut object and quietly
 * make the release as refusable as the press, which is how a modifier gets stuck.
 */
export function useKeyUpShortcut(shortcut: KeyUpShortcut) {
  const { registerKeyUpShortcut } = useKeyboardEvents();
  const shortcutRef = useRef(shortcut);

  useLayoutEffect(() => {
    shortcutRef.current = shortcut;
  }, [shortcut]);

  useEffect(() => {
    // The registry is typed over `KeyboardShortcut` because the dispatch chain is shared; the
    // keyup branch is the only one that ever reads `onKeyUp`, and it guards the optional call.
    return registerKeyUpShortcut(() => shortcutRef.current as KeyboardShortcut);
  }, [registerKeyUpShortcut]);
}
