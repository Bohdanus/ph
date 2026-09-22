import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export type KeyboardShortcut = {
  key: string;
  onKeyDown: (event: KeyboardEvent) => void;
  enabled?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  allowInInput?: boolean; // Default: false. Set to true for shortcuts that should work in input fields (tool commands, not text editing)
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
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcuts = keyDownShortcutsRef.current;

      for (let i = shortcuts.length - 1; i >= 0; i--) {
        const shortcut = shortcuts[i]();
        if (!shortcut || shortcut.enabled === false) continue;

        if (!shortcut.allowInInput && isEditableTarget(event.target)) continue;

        if (!matchesShortcut(event, shortcut)) continue;

        if (shortcut.preventDefault) {
          event.preventDefault();
        }

        if (shortcut.stopPropagation) {
          event.stopPropagation();
        }

        shortcut.onKeyDown(event);
        break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
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
