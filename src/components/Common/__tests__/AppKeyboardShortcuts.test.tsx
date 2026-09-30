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
      toolName: 'brush' as ToolName,
    }) as { hasImage: boolean; toolName: ToolName }
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
  // The real hook returns `true` on success (`useSelectionClipboard.ts:61`) and Meta+C now READS
  // that boolean, so the `undefined` a bare `vi.fn()` returns would be indistinguishable from a
  // refused copy in every test that presses the key.
  copyActiveSelection.mockReturnValue(true);
  storeState.hasImage = true;
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
  it('undoes history when the history allows it', () => {
    canUndo.mockReturnValue(true);
    renderShortcuts();

    press('z', { metaKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the history cannot undo', () => {
    renderShortcuts();

    press('z', { metaKey: true });

    expect(undo).not.toHaveBeenCalled();
  });

  it('redoes on Meta+Shift+Z only when redo is available', () => {
    renderShortcuts();
    press('z', { metaKey: true, shiftKey: true });
    expect(redo).not.toHaveBeenCalled();

    canRedo.mockReturnValue(true);
    press('z', { metaKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('redoes on Ctrl+Y without touching undo', () => {
    canRedo.mockReturnValue(true);
    renderShortcuts();

    press('y', { ctrlKey: true });

    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
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

  it('reports a Meta+C copy that returns false instead of dropping the failure', () => {
    // The one call site with no `try` around it. `copySelection` returns `false` rather than
    // throwing when no snapshot is possible, so before the boolean was read this press left
    // nothing at all behind: no log, no UI change, and the key consumed by `preventDefault`.
    copyActiveSelection.mockReturnValue(false);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderShortcuts();

      press('c', { metaKey: true });

      expect(copyActiveSelection).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to copy selection');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('logs nothing when Meta+C copies successfully', () => {
    // The other half of the contract, and the one an unconditional `console.error` would pass
    // while breaking every copy: a successful copy is not a failure.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderShortcuts();

      press('c', { metaKey: true });

      expect(copyActiveSelection).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not repeat the copy, or the failure report, while Meta+C is held', () => {
    // The spam risk the new log could have introduced, pinned in the direction that matters:
    // the registration does NOT set `repeat`, and `useKeyboardEvents.tsx:154` drops an
    // `event.repeat` BEFORE `onKeyDown` runs, so a held key never reaches the copy and never
    // reaches the log. Give this registration `repeat: true` and the refusal below would
    // repeat at the OS auto-repeat rate, one line per repeat.
    copyActiveSelection.mockReturnValue(false);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderShortcuts();

      expect(press('c', { metaKey: true })).toBe(true);

      const repeats = Array.from({ length: 5 }, () => press('c', { metaKey: true, repeat: true }));

      // The key is still claimed for the lifetime of the press, which is what the provider's
      // own comment at `useKeyboardEvents.tsx:148-153` pins: a repeat cancels the browser
      // default and then stops.
      expect(repeats).toEqual([true, true, true, true, true]);
      expect(copyActiveSelection).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    } finally {
      consoleErrorSpy.mockRestore();
    }
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

  it('keeps the eraser on a bare B, because the eraser is a brush group member', () => {
    // `toolbar-mapping.ts` puts the eraser in the Brush flyout, so `AppKeyboardShortcuts.tsx:18`
    // lists it in `brushGroup` as well. It additionally owns a bare `E`; both are correct,
    // and a bare `B` from the eraser has to stay on the eraser rather than snapping to the
    // brush.
    storeState.toolName = 'eraser';
    renderShortcuts();

    press('b');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('eraser');
  });

  it.each([
    ['brush', 'pencil'],
    ['pencil', 'color-replacement'],
    ['color-replacement', 'eraser'],
    ['eraser', 'brush'],
  ])('cycles Shift+B from %s to %s', (from, to) => {
    // The brush group is four members now, so the cycle has to close: without the
    // `eraser -> brush` row a regression that dropped the eraser out of the array would
    // leave the other three rows green.
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
    ['rectangular-selection', 'elliptical-selection'],
    ['elliptical-selection', 'rectangular-selection'],
  ])('cycles Shift+M from %s to %s', (from, to) => {
    // `M` is the MARQUEE tile, and the marquee tile holds the rectangular and elliptical
    // marquees. The magic wand moved to the object-selection tile on `W` when the quick
    // selection joined it, so `M` no longer reaches it — `AppKeyboardShortcuts.tsx:25`.
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('m', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it.each([
    ['magic-wand', 'quick-selection'],
    ['quick-selection', 'magic-wand'],
  ])('cycles Shift+W from %s to %s', (from, to) => {
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('w', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it.each([
    ['paint-bucket', 'gradient'],
    ['gradient', 'paint-bucket'],
  ])('cycles Shift+G from %s to %s', (from, to) => {
    // `G` is the fill tile: one click against one drag, sharing the pair of options bars.
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('g', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it.each([
    ['dodge', 'burn'],
    ['burn', 'dodge'],
  ])('cycles Shift+O from %s to %s', (from, to) => {
    // `O` is the dodge/burn tile, whose two tools share one options bar.
    storeState.toolName = from as ToolName;
    renderShortcuts();

    press('o', { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(to);
  });

  it.each([
    ['eyedropper', 'I'],
    ['eraser', 'E'],
    ['clone-stamp', 'S'],
  ] as const)('selects %s with a bare %s and with Shift+%s', (toolName, key) => {
    // The three single-tool tiles get one plain registration each and no `shift: true` twin.
    // `matchesShortcut` only compares a modifier the registration actually declares
    // (`src/hooks/useKeyboardEvents.tsx:70`), so these keys are unshifted-only by DEFAULT
    // rather than by an explicit `shift: false` — a shifted press falls through to the same
    // registration and selects the tool once, which is the whole reason a twin would be
    // redundant rather than load-bearing here.
    storeState.toolName = 'text';
    renderShortcuts();

    press(key);
    press(key, { shiftKey: true });

    expect(goToTool.mock.calls).toEqual([[toolName], [toolName]]);
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

describe('AppKeyboardShortcuts group fallbacks', () => {
  // `b` and `m` are absent from the table because two dedicated tests above already pin their
  // anchors from the same non-member (`text`); every OTHER group is table-driven here, so a
  // new flyout tile has to add its row rather than go untested.
  it.each([
    ['l', 'freehand-lasso'],
    ['p', 'pen'],
    ['w', 'magic-wand'],
    ['g', 'paint-bucket'],
    ['o', 'dodge'],
  ] as const)('falls back to the group anchor %s -> %s for a bare key from a non-member tool', (key, anchor) => {
    storeState.toolName = 'text';
    renderShortcuts();

    press(key);

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(anchor);
  });

  it.each([
    ['w', 'quick-selection'],
    ['g', 'gradient'],
    ['o', 'burn'],
  ] as const)('keeps the current %s group member for a bare key', (key, member) => {
    // The second half of the group contract, and the one that caught the old map: a bare key
    // from a MEMBER keeps the member, so a key whose group gained a tool (`W` with the quick
    // selection, `G` with the gradient, `O` with the burn) has to keep the second member too.
    storeState.toolName = member as ToolName;
    renderShortcuts();

    press(key);

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(member);
  });

  it('keeps the current marquee member for a bare M', () => {
    // The elliptical marquee is the marquee group's second member. The magic wand used to sit
    // here and no longer does, which is what this row now has to name.
    storeState.toolName = 'elliptical-selection';
    renderShortcuts();

    press('m');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('elliptical-selection');
  });

  it('falls back to the group anchor for a bare M from the magic wand, which left the marquee group', () => {
    // The inverse of the row above: the wand is not a marquee member any more, so a bare `M`
    // from it lands on the marquee anchor rather than preserving the wand. This is the
    // assertion the previous map got exactly backwards — it asserted the wand was kept.
    storeState.toolName = 'magic-wand';
    renderShortcuts();

    press('m');

    expect(goToTool).toHaveBeenCalledExactlyOnceWith('rectangular-selection');
  });

  it.each([
    ['b', 'pencil'],
    ['m', 'elliptical-selection'],
    ['p', 'freeform-pen'],
    ['l', 'polygonal-lasso'],
    ['w', 'quick-selection'],
    ['g', 'gradient'],
    ['o', 'burn'],
  ] as const)('starts the Shift+%s cycle at the group anchor and advances once', (key, expected) => {
    // `cycleToolGroup` starts at index 0 for a non-member and then advances one step, so the
    // result is the group's SECOND member rather than its anchor. The anchor itself is pinned
    // by the bare-key table above, which is what makes these two together a description of a
    // cycle rather than two unrelated expectations.
    storeState.toolName = 'text';
    renderShortcuts();

    press(key, { shiftKey: true });

    expect(goToTool).toHaveBeenCalledExactlyOnceWith(expected);
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
