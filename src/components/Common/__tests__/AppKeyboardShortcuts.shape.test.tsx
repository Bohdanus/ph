import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

const goToToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());
const resetToLastSavedArgsMock = vi.hoisted(() => vi.fn());
const shortcutHandlers = vi.hoisted(() => [] as { key: string; shift: boolean; handler: () => void }[]);

const storeState = vi.hoisted(
  () =>
    ({
      hasImage: true,
      isToolDirty: false,
      toolName: 'brush',
    }) as { hasImage: boolean; isToolDirty: boolean; toolName: ToolName }
);

const toolState = vi.hoisted(
  () =>
    ({
      toolArgs: { toolName: 'brush' } as ToolArgs,
    }) as { toolArgs: ToolArgs }
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({ canUndo: false, undo: vi.fn(), canRedo: false, redo: vi.fn() }),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolState.toolArgs,
    patchToolArgs: patchToolArgsMock,
    resetToLastSavedArgs: resetToLastSavedArgsMock,
  }),
}));

vi.mock('../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    copyActiveSelection: vi.fn(),
    pasteSelectionClipboard: vi.fn(),
    layerViaCopy: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useKeyboardEvents.tsx', () => ({
  useKeyDownShortcut: ({
    key,
    shift,
    onKeyDown,
  }: {
    key: string;
    shift?: boolean;
    onKeyDown: (event: { shiftKey: boolean }) => void;
  }) => {
    shortcutHandlers.push({ key, shift: Boolean(shift), handler: () => onKeyDown({ shiftKey: Boolean(shift) }) });
  },
}));

const pressU = (shift: boolean) => {
  const match = shortcutHandlers.filter((entry) => entry.key === 'u' && entry.shift === shift);
  expect(match.length).toBeGreaterThan(0);
  match.forEach((entry) => entry.handler());
};

const renderShortcuts = (toolName: ToolName, figure?: string) => {
  shortcutHandlers.length = 0;
  goToToolMock.mockClear();
  patchToolArgsMock.mockClear();
  storeState.toolName = toolName;
  toolState.toolArgs = (figure ? { toolName: 'shape', figure } : { toolName: 'brush' }) as unknown as ToolArgs;
  const view = render(<AppKeyboardShortcuts />);
  return {
    ...view,
    dispose: () => {
      view.unmount();
      shortcutHandlers.length = 0;
    },
  };
};

describe('AppKeyboardShortcuts shape selection', () => {
  beforeEach(() => {
    shortcutHandlers.length = 0;
    goToToolMock.mockClear();
    patchToolArgsMock.mockClear();
    resetToLastSavedArgsMock.mockClear();
    storeState.toolName = 'brush';
    toolState.toolArgs = { toolName: 'brush' } as ToolArgs;
  });

  it('registers a plain and a shift variant of the U shortcut', () => {
    shortcutHandlers.length = 0;
    storeState.toolName = 'brush';
    toolState.toolArgs = { toolName: 'brush' } as ToolArgs;
    const view = render(<AppKeyboardShortcuts />);
    expect(shortcutHandlers.filter((entry) => entry.key === 'u')).toHaveLength(2);
    view.unmount();
  });

  it('U selects the shared shape tool with the Rectangle figure', () => {
    const view = renderShortcuts('brush');

    pressU(false);

    expect(patchToolArgsMock).toHaveBeenCalledWith('shape', { figure: 'rectangle' });
    expect(goToToolMock).toHaveBeenCalledWith('shape');
    view.dispose();
  });

  it('U keeps the current figure when the shape tool is already active', () => {
    const view = renderShortcuts('shape', 'oval');

    pressU(false);

    expect(patchToolArgsMock).not.toHaveBeenCalled();
    expect(goToToolMock).toHaveBeenCalledWith('shape');
    view.dispose();
  });

  it('Shift+U cycles Rectangle, Ellipse, Line and Custom Shape', () => {
    const seen: { patched: string | undefined; selected: unknown }[] = [];

    for (const figure of ['rectangle', 'oval', 'line'] as const) {
      const view = renderShortcuts('shape', figure);
      pressU(true);
      seen.push({
        patched: patchToolArgsMock.mock.calls[0]?.[1]?.figure,
        selected: goToToolMock.mock.calls[0]?.[0],
      });
      view.dispose();
    }

    expect(seen).toEqual([
      { patched: 'oval', selected: 'shape' },
      { patched: 'line', selected: 'shape' },
      { patched: undefined, selected: 'custom-shape' },
    ]);
  });

  it('Shift+U reaches the custom-shape tool after Line', () => {
    const view = renderShortcuts('shape', 'line');

    pressU(true);

    expect(goToToolMock).toHaveBeenCalledWith('custom-shape');
    expect(patchToolArgsMock).not.toHaveBeenCalled();
    view.dispose();
  });

  it('Shift+U falls back to Rectangle from a figure outside the cycle', () => {
    const view = renderShortcuts('shape', 'triangle');

    pressU(true);

    expect(patchToolArgsMock).toHaveBeenCalledWith('shape', { figure: 'rectangle' });
    expect(goToToolMock).toHaveBeenCalledWith('shape');
    view.dispose();
  });

  it.each(['rectangle', 'oval', 'line', 'triangle', 'polygon'] as const)(
    'Shift+U from %s never selects a legacy circle or square figure',
    (figure) => {
      const view = renderShortcuts('shape', figure);

      pressU(true);

      const patched = patchToolArgsMock.mock.calls[0]?.[1] as { figure?: string } | undefined;
      if (patched) expect(['rectangle', 'oval', 'line']).toContain(patched.figure);
      for (const call of goToToolMock.mock.calls) expect(call[0]).not.toBe('circle');
      view.dispose();
    }
  );
});
