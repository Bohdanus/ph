import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

/**
 * These tests use the real KeyboardEventsProvider, so the guard conditions
 * (enabled flag, modifier matching, editable-target suppression, preventDefault)
 * come from production rather than from a mocked shortcut registry.
 */

const goToTool = vi.hoisted(() => vi.fn());
const patchToolArgs = vi.hoisted(() => vi.fn());
const resetToLastSavedArgs = vi.hoisted(() => vi.fn());
const copyActiveSelection = vi.hoisted(() => vi.fn());
const pasteSelectionClipboard = vi.hoisted(() => vi.fn());
const layerViaCopy = vi.hoisted(() => vi.fn());
const undo = vi.hoisted(() => vi.fn());
const redo = vi.hoisted(() => vi.fn());
const canUndo = vi.hoisted(() => vi.fn(() => false));
const canRedo = vi.hoisted(() => vi.fn(() => false));

const storeState = vi.hoisted(
  () =>
    ({
      hasImage: true,
      isToolDirty: false,
      toolName: 'brush' as ToolName,
    }) as { hasImage: boolean; isToolDirty: boolean; toolName: ToolName }
);

const toolState = vi.hoisted(() => ({ toolArgs: { toolName: 'brush' } as ToolArgs }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => ({ canUndo, undo, canRedo, redo }) }));

vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => ({ goToTool }) }));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolState.toolArgs,
    patchToolArgs,
    resetToLastSavedArgs,
  }),
}));

vi.mock('../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({ copyActiveSelection, pasteSelectionClipboard, layerViaCopy }),
}));

function press(key: string, init: Partial<KeyboardEventInit> = {}, target: Element | Document = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  const prevented = !fireEvent(target, event);
  return prevented;
}

function renderShortcuts() {
  return render(
    <KeyboardEventsProvider>
      <AppKeyboardShortcuts />
    </KeyboardEventsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  canUndo.mockReturnValue(false);
  canRedo.mockReturnValue(false);
  storeState.hasImage = true;
  storeState.isToolDirty = false;
  storeState.toolName = 'brush';
  toolState.toolArgs = { toolName: 'brush' } as ToolArgs;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AppKeyboardShortcuts guards', () => {
  it('does nothing at all while no image is loaded', () => {
    storeState.hasImage = false;
    renderShortcuts();

    for (const key of ['b', 'c', 'v', 'j', 'u', 't', 'l', 'w', 'm', 'p']) {
      press(key);
    }
    press('z', { metaKey: true });
    press('y', { metaKey: true });

    expect(goToTool).not.toHaveBeenCalled();
    expect(patchToolArgs).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(copyActiveSelection).not.toHaveBeenCalled();
    expect(pasteSelectionClipboard).not.toHaveBeenCalled();
    expect(layerViaCopy).not.toHaveBeenCalled();
  });

  it.each([
    ['text', 'text'],
    ['password', 'password'],
    ['search', 'search'],
    ['email', 'email'],
    ['url', 'url'],
    ['tel', 'tel'],
    ['number', 'number'],
  ])('does not run any shortcut while a %s input is focused', (_type, type) => {
    renderShortcuts();
    const input = document.createElement('input');
    input.type = type;
    document.body.appendChild(input);

    press('b', {}, input);
    press('t', {}, input);
    press('z', { metaKey: true }, input);
    press('c', { metaKey: true }, input);

    expect(goToTool).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(copyActiveSelection).not.toHaveBeenCalled();
  });

  it('does not run any shortcut while a textarea is focused', () => {
    renderShortcuts();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    press('t', {}, textarea);
    press('z', { ctrlKey: true }, textarea);

    expect(goToTool).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not run any shortcut while a contenteditable element is focused', () => {
    renderShortcuts();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);

    press('p', {}, editable);

    expect(goToTool).not.toHaveBeenCalled();
  });

  it('still runs shortcuts from a non text-like input control', () => {
    renderShortcuts();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);

    press('t', {}, checkbox);

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('text');
  });

  it('is case insensitive for the shortcut key', () => {
    renderShortcuts();

    press('T');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('text');
  });

  it('ignores a shortcut when only one of meta/ctrl is held', () => {
    canUndo.mockReturnValue(true);
    renderShortcuts();

    press('z', { metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);

    undo.mockClear();
    press('z');
    expect(undo).not.toHaveBeenCalled();

    press('z', { ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('prevents the browser default only for shortcuts that ask for it', () => {
    renderShortcuts();

    expect(press('z', { metaKey: true })).toBe(true);
    expect(press('b')).toBe(false);
  });
});

describe('AppKeyboardShortcuts undo and redo', () => {
  it('resets a dirty tool instead of undoing history', () => {
    storeState.isToolDirty = true;
    canUndo.mockReturnValue(true);
    renderShortcuts();

    press('z', { metaKey: true });

    expect(resetToLastSavedArgs).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('undoes history when the tool is clean and history allows it', () => {
    canUndo.mockReturnValue(true);
    renderShortcuts();

    press('z', { metaKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('does nothing when the tool is clean and history cannot undo', () => {
    renderShortcuts();

    press('z', { metaKey: true });

    expect(undo).not.toHaveBeenCalled();
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('redoes on Meta+Shift+Z only when redo is available', () => {
    renderShortcuts();
    press('z', { metaKey: true, shiftKey: true });
    expect(redo).not.toHaveBeenCalled();

    canRedo.mockReturnValue(true);
    press('z', { metaKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('redoes on Ctrl+Y without shifting the dirty tool', () => {
    storeState.isToolDirty = true;
    canRedo.mockReturnValue(true);
    renderShortcuts();

    press('y', { ctrlKey: true });

    expect(redo).toHaveBeenCalledTimes(1);
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('keeps redo availability independent of the dirty flag', () => {
    canRedo.mockReturnValue(false);
    renderShortcuts();

    press('y', { metaKey: true });
    expect(redo).not.toHaveBeenCalled();

    storeState.isToolDirty = true;
    press('y', { metaKey: true });
    expect(redo).not.toHaveBeenCalled();
  });

  it('propagates a throwing canUndo() out of the keydown handler (AppKeyboardShortcuts.tsx:117 has no try/catch)', () => {
    const seen: string[] = [];
    const onError = (event: ErrorEvent) => {
      seen.push(event.message);
      event.preventDefault();
    };
    canUndo.mockImplementation(() => {
      throw new Error('history exploded');
    });
    window.addEventListener('error', onError);
    try {
      renderShortcuts();
      press('z', { metaKey: true });
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(seen).toEqual(['history exploded']);
    expect(undo).not.toHaveBeenCalled();
  });

  it('re-invokes canUndo() and re-throws on every subsequent Meta+Z press (stale registry entry)', () => {
    const seen: string[] = [];
    const onError = (event: ErrorEvent) => {
      seen.push(event.message);
      event.preventDefault();
    };
    let attempts = 0;
    canUndo.mockImplementation(() => {
      attempts += 1;
      throw new Error(`history exploded #${attempts}`);
    });
    window.addEventListener('error', onError);
    try {
      renderShortcuts();
      press('z', { metaKey: true });
      press('z', { metaKey: true });
      press('z', { metaKey: true });
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(attempts).toBe(3);
    expect(seen).toEqual(['history exploded #1', 'history exploded #2', 'history exploded #3']);
  });

  it('calls canUndo() again on a later press even after an earlier throw (AppKeyboardShortcuts.tsx:117 keeps the stale entry)', () => {
    const onError = (event: ErrorEvent) => event.preventDefault();
    let attempts = 0;
    canUndo.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('history exploded');
      return true;
    });
    window.addEventListener('error', onError);
    try {
      renderShortcuts();
      press('z', { metaKey: true });
      press('z', { metaKey: true });
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(attempts).toBe(2);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it.fails(
    'retires the Meta+Z shortcut after canUndo() throws instead of re-invoking it (AppKeyboardShortcuts.tsx:117)',
    () => {
      const onError = (event: ErrorEvent) => event.preventDefault();
      let attempts = 0;
      canUndo.mockImplementation(() => {
        attempts += 1;
        if (attempts === 1) throw new Error('history exploded');
        return true;
      });
      window.addEventListener('error', onError);
      try {
        renderShortcuts();
        press('z', { metaKey: true });
        press('z', { metaKey: true });
      } finally {
        window.removeEventListener('error', onError);
      }

      expect(attempts).toBe(1);
      expect(undo).not.toHaveBeenCalled();
    }
  );
});

describe('AppKeyboardShortcuts clipboard', () => {
  it('copies the active selection with Meta+C and pastes with Meta+V', () => {
    renderShortcuts();

    press('c', { metaKey: true });
    press('v', { metaKey: true });

    expect(copyActiveSelection).toHaveBeenCalledTimes(1);
    expect(pasteSelectionClipboard).toHaveBeenCalledTimes(1);
  });

  it('duplicates through the clipboard with Meta+J', () => {
    renderShortcuts();

    press('j', { metaKey: true });

    expect(layerViaCopy).toHaveBeenCalledTimes(1);
    expect(copyActiveSelection).not.toHaveBeenCalled();
  });

  it('switches to the move tool with a bare V but never with Meta+V', () => {
    renderShortcuts();

    press('v', { metaKey: true });
    expect(goToTool).not.toHaveBeenCalled();

    press('v');
    expect(goToTool).toHaveBeenCalledExactlyOnceWith('reposition');
  });

  it('switches to the crop tool with a bare C but never with Meta+C', () => {
    renderShortcuts();

    press('c', { metaKey: true });
    expect(goToTool).not.toHaveBeenCalled();

    press('c');
    expect(goToTool).toHaveBeenCalledExactlyOnceWith('crop');
  });
});

describe('AppKeyboardShortcuts tool cycling', () => {
  it('selects the brush group anchor for a bare B from any other tool', () => {
    storeState.toolName = 'text';
    renderShortcuts();

    press('b');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('brush');
  });

  it('keeps the current brush group member for a bare B', () => {
    storeState.toolName = 'pencil';
    renderShortcuts();

    press('b');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('pencil');
  });

  it.each([
    ['brush', 'pencil'],
    ['pencil', 'color-replacement'],
    ['color-replacement', 'brush'],
  ])('cycles Shift+B from %s to %s', (from, to) => {
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('b', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it.each([
    ['freehand-lasso', 'polygonal-lasso'],
    ['polygonal-lasso', 'feather-magnetic-lasso'],
    ['feather-magnetic-lasso', 'freehand-lasso'],
  ])('cycles Shift+L from %s to %s', (from, to) => {
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('l', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('starts the lasso cycle at the freehand lasso for a non-member tool', () => {
    storeState.toolName = 'text';
    renderShortcuts();

    press('l', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('polygonal-lasso');
  });

  it('keeps the current lasso group member for a bare L', () => {
    storeState.toolName = 'polygonal-lasso';
    renderShortcuts();

    press('l');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('polygonal-lasso');
  });

  it.each([
    ['rectangular-selection', 'magic-wand'],
    ['magic-wand', 'rectangular-selection'],
  ])('cycles Shift+M from %s to %s', (from, to) => {
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('m', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('falls back to the rectangular selection for a bare M from another tool', () => {
    storeState.toolName = 'text';
    renderShortcuts();

    press('m');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('rectangular-selection');
  });

  it.each([
    ['pen', 'freeform-pen'],
    ['freeform-pen', 'curvature-pen'],
    ['curvature-pen', 'pen'],
  ])('cycles Shift+P from %s to %s', (from, to) => {
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('p', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('keeps the current pen group member for a bare P', () => {
    storeState.toolName = 'curvature-pen';
    renderShortcuts();

    press('p');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('curvature-pen');
  });

  it('selects the text tool with a bare T and the magic wand with a bare W', () => {
    renderShortcuts();

    press('t');
    press('w');

    expect(goToTool.mock.calls).toEqual([['text'], ['magic-wand']]);
  });

  it('enters the shape tool with a bare U from another tool', () => {
    storeState.toolName = 'brush';
    renderShortcuts();

    press('u');

    expect(patchToolArgs).toHaveBeenCalledExactlyOnceWith('shape', { figure: 'rectangle' });
    expect(goToTool).toHaveBeenCalledExactlyOnceWith('shape');
  });

  it('advances the figure with Shift+U without disturbing the other groups', () => {
    storeState.toolName = 'shape';
    toolState.toolArgs = { toolName: 'shape', figure: 'rectangle' } as ToolArgs;
    renderShortcuts();

    press('u', { shiftKey: true });

    expect(patchToolArgs).toHaveBeenCalledExactlyOnceWith('shape', { figure: 'oval' });
    expect(goToTool).toHaveBeenCalledExactlyOnceWith('shape');
  });
});

describe('AppKeyboardShortcuts failure isolation', () => {
  it('surfaces a throwing tool selection to the window error handler instead of swallowing it', () => {
    const seen: string[] = [];
    const onError = (event: ErrorEvent) => {
      seen.push(event.message);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      storeState.toolName = 'text';
      goToTool.mockImplementationOnce(() => {
        throw new Error('goToTool failed');
      });
      renderShortcuts();

      press('t');
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(seen).toEqual(['goToTool failed']);
  });

  it('keeps serving shortcuts after a handler threw', () => {
    // The throw escapes the document listener as an uncaught exception, so it
    // must be absorbed here; otherwise vitest reports an unhandled error.
    const onError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', onError);
    try {
      goToTool.mockImplementationOnce(() => {
        throw new Error('goToTool failed');
      });
      renderShortcuts();

      press('t');
      goToTool.mockClear();
      press('w');
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('magic-wand');
  });

  it('unregisters every shortcut on unmount', () => {
    const { unmount } = renderShortcuts();
    unmount();

    press('t');
    press('z', { metaKey: true });

    expect(goToTool).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });
});
