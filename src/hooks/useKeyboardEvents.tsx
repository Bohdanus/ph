import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { isDocumentGestureOpen, resetDocumentGestures } from './document-gesture.ts';

export type KeyboardShortcut = {
  key: string;
  onKeyDown: (event: KeyboardEvent) => void;
  enabled?: boolean;
  mutatesDocument?: boolean; // Default: true. A document-committing gesture is in progress, so this registration must not run. Set to `false` ONLY for a shortcut that is about the gesture itself — `Escape` cancelling the draft, `Enter` finishing it, `Backspace` removing the last anchor, a popup's own `Escape` — because refusing those would leave the gesture with no way out. A registration that defaults to `true` is safe without anyone having thought about it; the exemption has to be argued for.
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

  const registerKeyDownShortcut = useCallback((shortcutGetter: KeyboardShortcutGetter) => {
    keyDownShortcutsRef.current.push(shortcutGetter);

    return () => {
      keyDownShortcutsRef.current = keyDownShortcutsRef.current.filter((item) => item !== shortcutGetter);
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
      const shortcuts = keyDownShortcutsRef.current;

      for (let i = shortcuts.length - 1; i >= 0; i--) {
        const shortcut = shortcuts[i]();
        if (!shortcut || shortcut.enabled === false) continue;

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
        if (event.repeat && !shortcut.repeat) continue;

        shortcut.onKeyDown(event);
        break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Paired with the mount-time clear: the provider going away must not leave
      // a claim behind for whatever mounts next, or the keyboard stays dead for
      // the rest of the session with nothing on screen to explain it.
      resetDocumentGestures();
    };
  }, []);

  const value = useMemo(
    () => ({
      registerKeyDownShortcut,
    }),
    [registerKeyDownShortcut]
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
