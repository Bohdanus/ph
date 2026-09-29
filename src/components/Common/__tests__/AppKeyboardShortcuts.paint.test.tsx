import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

/**
 * Adobe's painting keys: <https://helpx.adobe.com/photoshop/using/painting-tools.html>
 *
 * "`[` Decrease brush size" / "`]` Increase brush size", and "To set Opacity to 100%, press 0; to
 * set it to 10%, press 1".
 *
 * These tests use the real KeyboardEventsProvider, so `enabled`, the modifier matching, the
 * editable-target suppression and `preventDefault` all come from production rather than from a
 * mocked registry — the same reason the sibling file says it. Every assertion is on the PATCH
 * the shortcut writes, because the patch is the whole of the behaviour: the options bar re-renders
 * off it, and no canvas is involved.
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
      toolName: 'eraser' as ToolName,
    }) as { hasImage: boolean; toolName: ToolName }
);

const toolState = vi.hoisted(() => ({ toolArgs: { toolName: 'eraser' } as ToolArgs }));

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

/** The single patch the current tool received, or `undefined` when it received none. */
const onlyPatch = () => {
  expect(patchToolArgs).toHaveBeenCalledTimes(1);
  return patchToolArgs.mock.calls[0];
};

/** Select `toolName` with a tip size and an opacity, the way the store would hand it over. */
function selectTool(toolName: ToolName, args: Record<string, unknown>) {
  storeState.toolName = toolName;
  toolState.toolArgs = { toolName, ...args } as ToolArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  canUndo.mockReturnValue(false);
  canRedo.mockReturnValue(false);
  storeState.hasImage = true;
  selectTool('eraser', { lineWidth: 40, alpha: 1, hardness: 50, spacing: 25, mode: 'brush' });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe("Photoshop's bracket tip-size keys", () => {
  it('raises the tip size on `]` and lowers it on `[`, by one pixel each', () => {
    renderShortcuts();

    press(']');
    expect(onlyPatch()).toEqual(['eraser', { lineWidth: 41 }]);

    patchToolArgs.mockClear();
    press('[');
    expect(onlyPatch()).toEqual(['eraser', { lineWidth: 39 }]);
  });

  it('clamps at the tip engine’s ceiling rather than growing past it', () => {
    selectTool('eraser', { lineWidth: BRUSH_SIZE_MAX, alpha: 1, hardness: 50, spacing: 25, mode: 'brush' });
    renderShortcuts();

    press(']');
    expect(onlyPatch()).toEqual(['eraser', { lineWidth: BRUSH_SIZE_MAX }]);
  });

  it('clamps at the tip engine’s floor rather than reaching zero or below it', () => {
    // A fresh render per case: `useCurrentTool` is a mock that reads a hoisted object, and nothing
    // re-renders the component when the test swaps it, so both cases cannot share one mount.
    selectTool('eraser', { lineWidth: BRUSH_SIZE_MIN, alpha: 1, hardness: 50, spacing: 25, mode: 'brush' });
    renderShortcuts();

    press('[');
    expect(onlyPatch()).toEqual(['eraser', { lineWidth: BRUSH_SIZE_MIN }]);
  });

  it('writes `size` on the tools that call their tip `size`', () => {
    selectTool('smudge', { size: 30, hardness: 100, strength: 50 });
    renderShortcuts();

    press(']');
    expect(onlyPatch()).toEqual(['smudge', { size: 31 }]);
  });

  it('writes `lineWidth` on the pen-backed paint family that spells the same tip differently', () => {
    selectTool('brush', { lineWidth: 10, alpha: 0.9 });
    renderShortcuts();

    press(']');
    expect(onlyPatch()).toEqual(['brush', { lineWidth: 11 }]);
  });

  it('falls back to a visible size when the current one is not a number', () => {
    selectTool('eraser', { lineWidth: Number.NaN, alpha: 1, hardness: 50, spacing: 25, mode: 'brush' });
    renderShortcuts();

    press(']');

    // `NaN + 1` is `NaN`, and a `NaN` bound on a range input renders as an empty slider with no
    // value to recover from, so the step has to start from something real.
    expect(Number.isFinite(onlyPatch()[1].lineWidth)).toBe(true);
  });

  it('does nothing on a tool with no tip, and does not swallow the key either', () => {
    selectTool('reposition', { move: { x: 0, y: 0 } });
    renderShortcuts();

    expect(press(']')).toBe(false);
    expect(press('[')).toBe(false);
    expect(patchToolArgs).not.toHaveBeenCalled();
  });

  it('is the UNSHIFTED brackets: Shift+[ is a different key, and mod+[ stays a chord', () => {
    renderShortcuts();

    // `{` is what Shift+[ produces, and `mod: false` is what keeps Ctrl+[ from being a step.
    expect(press('{', { shiftKey: true })).toBe(false);
    expect(press(']', { metaKey: true })).toBe(false);
    expect(press('[', { ctrlKey: true })).toBe(false);
    expect(patchToolArgs).not.toHaveBeenCalled();
  });

  it('steps while the key is held, which is what makes a large tip reachable', () => {
    renderShortcuts();

    // Auto-repeat is suppressed unless the registration opted in, so a repeat event firing at all
    // IS the assertion — and `]` does not claim the key from the browser, so `press` reports no
    // `preventDefault`.
    expect(press(']', { repeat: true })).toBe(false);
    expect(onlyPatch()).toEqual(['eraser', { lineWidth: 41 }]);
  });

  it('does not re-fire the opacity keys on auto-repeat, because one press is one intent', () => {
    renderShortcuts();

    press('1', { repeat: true });
    expect(patchToolArgs).not.toHaveBeenCalled();
  });
});

describe("Photoshop's opacity number keys", () => {
  it('sets Opacity to 100% on `0` and to 10% on `1`', () => {
    renderShortcuts();

    press('0');
    expect(onlyPatch()).toEqual(['eraser', { alpha: 1 }]);

    patchToolArgs.mockClear();
    press('1');
    expect(onlyPatch()).toEqual(['eraser', { alpha: 0.1 }]);
  });

  it('overwrites whatever the slider was set to, because that is the point of the key', () => {
    selectTool('brush', { lineWidth: 10, alpha: 0.35 });
    renderShortcuts();

    press('0');
    expect(onlyPatch()).toEqual(['brush', { alpha: 1 }]);
  });

  it('does nothing on a tool whose bar has no Opacity, and leaves the key to the browser', () => {
    selectTool('reposition', { move: { x: 0, y: 0 } });
    renderShortcuts();

    expect(press('0')).toBe(false);
    expect(press('1')).toBe(false);
    expect(patchToolArgs).not.toHaveBeenCalled();
  });

  it('does not fire while a number input is focused, where the key is text', () => {
    renderShortcuts();
    const input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);

    press('0', {}, input);
    press('1', {}, input);

    expect(patchToolArgs).not.toHaveBeenCalled();
  });
});

describe('the paint keys and the document', () => {
  it('does nothing at all while no image is loaded', () => {
    storeState.hasImage = false;
    renderShortcuts();

    for (const key of [']', '[', '0', '1']) press(key);

    expect(patchToolArgs).not.toHaveBeenCalled();
  });
});
