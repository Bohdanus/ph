import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';
import { isFigureType, type FigureType } from '../../../tools/shape.ts';
import { savedArgsPerFigure } from '../../../tools/settings.ts';
import { toolbarMap } from '../../../../toolbar-mapping.ts';
import type { ToolbarTool } from '../../../../toolbar-mapping.ts';

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

/**
 * The shapes flyout, read off `toolbar-mapping.ts` rather than copied: the shape cycle is
 * supposed to be that flyout, so an expected chain typed out here is a second transcription
 * of the order that can drift from the first one — which is exactly how the Triangle and the
 * Polygon ended up unreachable.
 */
const shapeFlyout = (toolbarMap.flat() as readonly (readonly ToolbarTool[])[]).find((group) =>
  group.some((tool) => tool.name === 'shape')
)!;

/** The flyout's entries as the state the cycle passes through, `figure` or `toolName`. */
const flyoutStates: readonly CycleState[] = shapeFlyout.map((tool) =>
  tool.figure ? { toolName: 'shape', figure: tool.figure } : { toolName: tool.name, figure: null }
);

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
  // The no-figure case carries the REQUESTED tool name, not a hard-coded brush: the Custom Shape
  // tool has no `figure` of its own, and reading it as a brush made `renderShortcuts('custom-shape')`
  // a test of the plain-U fallback instead of the cycle.
  toolState.toolArgs = (figure ? { toolName: 'shape', figure } : { toolName }) as unknown as ToolArgs;
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
    expect(goToToolMock.mock.invocationCallOrder[0]).toBeLessThan(patchToolArgsMock.mock.invocationCallOrder[0]);
    view.dispose();
  });

  it('U keeps the current figure when the shape tool is already active', () => {
    const view = renderShortcuts('shape', 'oval');

    pressU(false);

    expect(patchToolArgsMock).not.toHaveBeenCalled();
    expect(goToToolMock).toHaveBeenCalledWith('shape');
    view.dispose();
  });

  it('Shift+U advances every flyout entry to the next one and closes on the first', () => {
    // The chain is the flyout itself, read off `toolbar-mapping.ts`, so the assertion is the
    // mapping's six entries and not a hand-copied order that could drift from it again. The loop
    // runs `index <= length` rather than `< length - 1`: the LAST step is the one that closes the
    // group, Custom Shape back onto Rectangle, and a bound that stopped short of it would leave
    // the wrap unasserted while this title claimed every entry.
    expect(flyoutStates.map(describeState)).toEqual([
      'shape:rectangle',
      'shape:oval',
      'shape:line',
      'shape:triangle',
      'shape:polygon',
      'custom-shape',
    ]);

    const steps = [...flyoutStates, flyoutStates[0]];

    for (let index = 0; index < steps.length - 1; index += 1) {
      const from = steps[index];
      const to = steps[index + 1];
      const label = `${describeState(from)} -> ${describeState(to)}`;
      const view = renderShortcuts(from.toolName, from.figure ?? undefined);

      pressU(true);

      expect(goToToolMock.mock.calls[0]?.[0], label).toBe(to.figure ? 'shape' : to.toolName);
      expect((patchToolArgsMock.mock.calls[0]?.[1] as { figure?: string } | undefined)?.figure, label).toBe(
        to.figure ?? undefined
      );
      if (to.figure) {
        expect(goToToolMock.mock.invocationCallOrder[0], label).toBeLessThan(
          patchToolArgsMock.mock.invocationCallOrder[0]
        );
      }
      view.dispose();
    }
  });

  it('Shift+U wraps from Custom Shape onto the Rectangle, which closes the group', () => {
    const view = renderShortcuts('custom-shape');

    pressU(true);

    expect(goToToolMock.mock.calls).toEqual([['shape']]);
    expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'rectangle' }]]);
    view.dispose();
  });

  it('Shift+U reaches the custom-shape tool after Polygon', () => {
    const view = renderShortcuts('shape', 'polygon');

    pressU(true);

    expect(goToToolMock).toHaveBeenCalledWith('custom-shape');
    expect(patchToolArgsMock).not.toHaveBeenCalled();
    view.dispose();
  });

  it('Shift+U falls back to Rectangle from a figure outside the group', () => {
    // The `indexOf() === -1` branch is reachable only from a stored value the group does not
    // list — a legacy `circle` or `square` is the shape that reaches it — and `-1 + 1 === 0` puts
    // it on the head of the group. That is the FALLBACK, and it is not how the Custom Shape tool
    // is positioned: the tool is a member of the group, so it must not take this branch.
    const view = renderShortcuts('shape', 'circle');

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
      if (patched) expect(FIGURE_TYPE_VALUES).toContain(patched.figure);
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

    it('advances Line to Triangle, so the figure the flyout lists third is reachable', () => {
      const view = renderAt({ toolName: 'shape', figure: 'line' });

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'triangle' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.unmount();
    });

    it('advances Triangle to Polygon instead of restarting at Rectangle', () => {
      // The two figures `orderedFigures` used to omit both indexed to -1, and
      // (-1 + 1) % 4 === 0 is the rectangle — a restart, not a freeze.
      const view = renderAt({ toolName: 'shape', figure: 'triangle' });

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'polygon' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.unmount();
    });

    it('hands off to the custom-shape tool from Polygon without patching figure args', () => {
      const view = renderAt({ toolName: 'shape', figure: 'polygon' });

      pressU(true);

      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(goToToolMock.mock.calls).toEqual([['custom-shape']]);
      view.unmount();
    });

    it('wraps onto Rectangle from the custom-shape tool, which closes the six-entry group', () => {
      // The Custom Shape tool is the group's LAST entry, so its position has to come from what
      // it is. Deriving it from `indexOf()` instead — it is not a FigureType, so that is -1 — gave
      // it the rectangle's index, and the cycle then closed over five entries with the Rectangle
      // unreachable by Shift+U from any press.
      const view = renderAt({ toolName: 'custom-shape', figure: null });

      pressU(true);

      expect(patchToolArgsMock.mock.calls).toEqual([['shape', { figure: 'rectangle' }]]);
      expect(goToToolMock.mock.calls).toEqual([['shape']]);
      view.unmount();
    });

    it.each(['brush', 'crop', 'text'] as const)(
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
      {
        figure: 'oval' as const,
        expected: ['shape:line', 'shape:triangle', 'shape:polygon', 'custom-shape', 'shape:rectangle', 'shape:oval'],
      },
      {
        figure: 'line' as const,
        expected: ['shape:triangle', 'shape:polygon', 'custom-shape', 'shape:rectangle', 'shape:oval', 'shape:line'],
      },
    ])('returns to $figure after a full six-press walk of the closed group', ({ figure, expected }) => {
      const view = renderAt({ toolName: 'shape', figure });
      const start = { toolName: 'shape' as ToolName, figure };
      const visited: string[] = [];
      let state: CycleState = start;

      for (let press = 0; press < 6; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual(expected);
      expect(describeState(state)).toBe(describeState(start));
      view.unmount();
    });

    it('returns to the custom-shape tool after a full six-press walk of the closed group', () => {
      const view = renderAt({ toolName: 'custom-shape', figure: null });
      const visited: string[] = [];
      let state: CycleState = { toolName: 'custom-shape', figure: null };

      for (let press = 0; press < 6; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual([
        'shape:rectangle',
        'shape:oval',
        'shape:line',
        'shape:triangle',
        'shape:polygon',
        'custom-shape',
      ]);
      expect(describeState(state)).toBe('custom-shape');
      view.unmount();
    });

    it('re-enters Rectangle from Custom Shape, so ten presses cover the group twice', () => {
      // The title is the defect this pins: while the Custom Shape tool resolved to -1 the cycle
      // closed over five entries and the rectangle never came back, so `visited` never held it.
      const view = renderAt({ toolName: 'shape', figure: 'rectangle' });
      const visited: string[] = [];
      let state: CycleState = { toolName: 'shape', figure: 'rectangle' };

      for (let press = 0; press < 10; press += 1) {
        rerenderAt(view, state);
        state = stepWithShiftU(state);
        visited.push(describeState(state));
      }

      expect(visited).toEqual([
        'shape:oval',
        'shape:line',
        'shape:triangle',
        'shape:polygon',
        'custom-shape',
        'shape:rectangle',
        'shape:oval',
        'shape:line',
        'shape:triangle',
        'shape:polygon',
      ]);
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

      // Every figure the group holds, and that is only true because the group CLOSES: the
      // Custom Shape tool's press wraps onto the rectangle, which is how the head of the group
      // is ever a result rather than only a starting point.
      expect(new Set(seenFigures)).toEqual(
        new Set(flyoutStates.filter((entry) => entry.figure).map((entry) => entry.figure))
      );
    });
  });
});
