import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';
import { isFigureType, type FigureType } from '../../../tools/shape.ts';
import { savedArgsPerFigure } from '../../../tools/settings.ts';

const goToToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());
const shortcutHandlers = vi.hoisted(() => [] as { key: string; shift: boolean; handler: () => void }[]);

const storeState = vi.hoisted(
  () =>
    ({
      hasImage: true,
      toolName: 'brush',
    }) as { hasImage: boolean; toolName: ToolName }
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
  useHistory: () => ({ canUndo: () => false, undo: vi.fn(), canRedo: () => false, redo: vi.fn() }),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock, handleImageSave: vi.fn() }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => ({ openSaveImageDialog: vi.fn() }) }));

vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => ({ commitDirtyTool: vi.fn(() => ({})) }) }));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolState.toolArgs,
    patchToolArgs: patchToolArgsMock,
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

/**
 * Runtime value set of the narrowed `FigureType` union, taken from the
 * `Record<FigureType, ...>` index signature so the assertion is derived from
 * the type rather than from a hand-written list.
 */
const FIGURE_TYPE_VALUES = Object.keys(savedArgsPerFigure) as FigureType[];

type CycleState = { toolName: ToolName; figure: FigureType | null };

const describeState = (state: CycleState) => (state.figure ? `shape:${state.figure}` : state.toolName);

const applyToolState = (state: CycleState) => {
  shortcutHandlers.length = 0;
  goToToolMock.mockClear();
  patchToolArgsMock.mockClear();
  storeState.toolName = state.toolName;
  toolState.toolArgs = (state.figure
    ? { toolName: 'shape', figure: state.figure }
    : { toolName: state.toolName }) as unknown as ToolArgs;
};

const renderAt = (state: CycleState) => {
  applyToolState(state);
  return render(<AppKeyboardShortcuts />);
};

const rerenderAt = (view: ReturnType<typeof renderAt>, state: CycleState) => {
  applyToolState(state);
  view.rerender(<AppKeyboardShortcuts />);
};

/**
 * Presses Shift+U once and folds the *observed* `patchToolArgs` / `goToTool`
 * calls back into the virtual tool state, so every following press is driven by
 * what production actually asked for rather than by a re-implementation of the
 * cycle.
 */
const stepWithShiftU = (state: CycleState): CycleState => {
  pressU(true);

  const patchCalls = [...patchToolArgsMock.mock.calls];
  const selectCalls = [...goToToolMock.mock.calls];
  patchToolArgsMock.mockClear();
  goToToolMock.mockClear();

  const selected = selectCalls[0]?.[0] as ToolName | undefined;
  const patchedFigure = (patchCalls[0]?.[1] as { figure?: unknown } | undefined)?.figure;

  if (selected === 'shape' && typeof patchedFigure === 'string') {
    return { toolName: 'shape', figure: patchedFigure as FigureType };
  }

  return { toolName: selected ?? state.toolName, figure: null };
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
    storeState.toolName = 'brush';
    toolState.toolArgs = { toolName: 'brush' } as ToolArgs;
  });

  afterEach(() => {
    shortcutHandlers.length = 0;
    goToToolMock.mockClear();
    patchToolArgsMock.mockClear();
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

  describe('Shift+U figure cycle', () => {
    it('registers the shift variant of U after the plain variant so the reverse-order matcher wins', () => {
      const view = renderAt({ toolName: 'brush', figure: null });

      const uShortcuts = shortcutHandlers.filter((entry) => entry.key === 'u');
      expect(uShortcuts.map((entry) => entry.shift)).toEqual([false, true]);
      view.unmount();
    });

    it('advances Rectangle to Oval, patching the figure and selecting the shape tool once', () => {
      const view = renderAt({ toolName: 'shape', figure: 'rectangle' });

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'oval' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.unmount();
    });

    it('advances Ellipse to Line instead of re-selecting Ellipse', () => {
      // Regression: matching the display name 'ellipse' against the stored
      // figure 'oval' made indexOf() return -1, so Shift+U from the Ellipse tool
      // wrapped back to Rectangle.
      const view = renderAt({ toolName: 'shape', figure: 'oval' });

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'line' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      const patchedFigure = (patchToolArgsMock.mock.calls[0][1] as { figure: string }).figure;
      expect(patchedFigure).not.toBe('oval');
      expect(isFigureType(patchedFigure)).toBe(true);
      view.unmount();
    });

    it('hands off to the custom-shape tool from Line without patching figure args', () => {
      const view = renderAt({ toolName: 'shape', figure: 'line' });

      pressU(true);

      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(goToToolMock.mock.calls).toEqual([['custom-shape']]);
      view.unmount();
    });

    it('wraps back to Rectangle when the active figure is outside the cycle', () => {
      // 'custom-shape' is not a member of orderedFigures, so indexOf() is -1
      // and (-1 + 1) % 4 === 0, which lands on Rectangle.
      const view = renderShortcuts('shape', 'custom-shape');

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'rectangle' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.dispose();
    });

    it.each(['brush', 'crop', 'custom-shape', 'text'] as const)(
      'starts the cycle from Rectangle and advances to Oval when the %s tool is active',
      (toolName) => {
        const view = renderAt({ toolName, figure: null });

        pressU(true);

        expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'oval' }]]);
        expect(goToToolMock.mock.calls).toEqual([['shape']]);
        view.unmount();
      }
    );

    it('leaves the figure untouched on a plain U while the shape tool is active', () => {
      const view = renderAt({ toolName: 'shape', figure: 'oval' });

      pressU(false);

      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.unmount();
    });

    it.each([
      { figure: 'oval' as const, expected: ['shape:line', 'custom-shape', 'shape:oval'] },
      { figure: 'line' as const, expected: ['custom-shape', 'shape:oval', 'shape:line'] },
    ])('returns to $figure after a full three-press cycle', ({ figure, expected }) => {
      const view = renderAt({ toolName: 'shape', figure });
      const start = { toolName: 'shape' as ToolName, figure };
      const visited: string[] = [];
      let state: CycleState = start;

      for (let press = 0; press < 3; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual(expected);
      expect(describeState(state)).toBe(describeState(start));
      view.unmount();
    });

    it('returns to the custom-shape tool after a full three-press cycle', () => {
      const view = renderAt({ toolName: 'custom-shape', figure: null });
      const visited: string[] = [];
      let state: CycleState = { toolName: 'custom-shape', figure: null };

      for (let press = 0; press < 3; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual(['shape:oval', 'shape:line', 'custom-shape']);
      expect(describeState(state)).toBe('custom-shape');
      view.unmount();
    });

    it('never re-enters Rectangle once the cycle has advanced past it', () => {
      // The cycle is not closed: the custom-shape step is a different toolName,
      // so the next press re-enters the cycle at Oval rather than at Rectangle.
      const view = renderAt({ toolName: 'shape', figure: 'rectangle' });
      const visited: string[] = [];
      let state: CycleState = { toolName: 'shape', figure: 'rectangle' };

      for (let press = 0; press < 6; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual(['shape:oval', 'shape:line', 'custom-shape', 'shape:oval', 'shape:line', 'custom-shape']);
      expect(visited).not.toContain('shape:rectangle');
      view.unmount();
    });

    it('patches exactly once per non-custom-shape press with a narrowed FigureType value', () => {
      expect([...FIGURE_TYPE_VALUES].sort()).toEqual(['line', 'oval', 'polygon', 'rectangle', 'triangle']);

      const starts: CycleState[] = [
        ...FIGURE_TYPE_VALUES.map((figure) => ({ toolName: 'shape' as ToolName, figure })),
        { toolName: 'custom-shape', figure: null },
        { toolName: 'brush', figure: null },
      ];
      const seenFigures: string[] = [];

      for (const start of starts) {
        const label = describeState(start);
        const view = renderAt(start);

        pressU(true);

        const patchCalls = [...patchToolArgsMock.mock.calls];
        const selectCalls = [...goToToolMock.mock.calls];
        expect(selectCalls, label).toHaveLength(1);

        if (patchCalls.length === 0) {
          expect(selectCalls[0][0], label).toBe('custom-shape');
        } else {
          expect(selectCalls[0][0], label).toBe('shape');
          expect(patchCalls, label).toHaveLength(1);
          expect(patchCalls[0][0], label).toBe('shape');
          const figure = (patchCalls[0][1] as { figure?: unknown }).figure;
          expect(isFigureType(figure), label).toBe(true);
          expect(FIGURE_TYPE_VALUES, label).toContain(figure);
          expect(['circle', 'square'], label).not.toContain(figure);
          seenFigures.push(figure as string);
        }

        view.unmount();
      }

      expect(new Set(seenFigures)).toEqual(new Set(['rectangle', 'oval', 'line']));
    });
  });
});
