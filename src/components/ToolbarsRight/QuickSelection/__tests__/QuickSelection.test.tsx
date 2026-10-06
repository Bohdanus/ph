import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickSelection from '../QuickSelection.tsx';
import {
  QUICK_SELECTION_MODES,
  QUICK_SELECTION_SIZE_MAX,
  QUICK_SELECTION_SIZE_MIN,
  QUICK_SELECTION_TOLERANCE_MAX,
  QUICK_SELECTION_TOLERANCE_MIN,
} from '../../../../tools/quickSelection.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { Selection } from '../../../../contexts/general-types.ts';
import type { QuickSelectionToolArgs } from '../../../../tools/quickSelection.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * slider thumbs repaint from it; a bare spy never does. Real `useState` (rather than assigning
 * a module variable) is what makes the repaint observable here, because the repo compiles with
 * `babel-plugin-react-compiler`, which memoizes `<QuickSelection />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const clearSelectionsMock = vi.hoisted(() => vi.fn());

/** The three selection-state fields the Copy/Paste/Deselect row reads. */
const selectionState = vi.hoisted((): { activeSelection: Selection | null; hasSelectionClipboard: boolean } => ({
  activeSelection: null,
  hasSelectionClipboard: false,
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState<Record<string, unknown>>(toolState.initial as Record<string, unknown>);
      const publish = (next: unknown) => {
        toolState.initial = next;
        setArgs(next as Record<string, unknown>);
      };

      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          mockSetToolArgs(next);
          publish(next);
        },
        getToolArgs: (toolName: string) => (toolArgs?.toolName === toolName ? toolArgs : null),
        patchToolArgs: (toolName: string, patch: Record<string, unknown>) => {
          mockPatchToolArgs(toolName, patch);
          publish({ ...(toolState.initial as Record<string, unknown>), ...patch, toolName });
        },
        isToolDirty: false,
      };
    },
  };
});

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: selectionState.activeSelection,
    copyActiveSelection: copyActiveSelectionMock,
    hasSelectionClipboard: selectionState.hasSelectionClipboard,
    pasteSelectionClipboard: pasteSelectionClipboardMock,
  }),
}));

vi.mock('../../../../contexts/useSelectionHistory.ts', () => ({
  useSelectionHistory: () => ({ clearSelections: clearSelectionsMock }),
}));

const REGION_SELECTION: Selection = {
  id: 'selection-region-1',
  geometry: 'polygon',
  sourceTool: 'magic-wand',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 5, y: 9, width: 40, height: 30 },
  points: [
    { x: 5, y: 9 },
    { x: 45, y: 9 },
    { x: 45, y: 39 },
  ],
};

/** Stand in for a `requestAnimationFrame` the test can flush on demand. */
const rafCallbacks: FrameRequestCallback[] = [];

const flushRaf = () => {
  act(() => {
    rafCallbacks.splice(0, rafCallbacks.length).forEach((callback) => callback(0));
  });
};

const getSize = () => screen.getByLabelText('Size') as HTMLInputElement;
const getTolerance = () => screen.getByLabelText('Tolerance') as HTMLInputElement;
const getMode = () => screen.getByLabelText('Mode') as HTMLSelectElement;
const getCopy = () => screen.getByRole('button', { name: 'Copy' });
const getPaste = () => screen.getByRole('button', { name: 'Paste' });
const getClear = () => screen.getByRole('button', { name: 'Deselect' });

/** The visible caption of the control, label text plus live readout. */
const caption = (slider: HTMLElement) => slider.parentElement?.textContent ?? '';

/** The seeded quick-selection defaults: size 40, tolerance 30, add, alpha 1. */
function resetToolArgs(overrides: Partial<QuickSelectionToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings['quick-selection']),
    ...overrides,
  } satisfies QuickSelectionToolArgs;
  return toolState.initial as QuickSelectionToolArgs;
}

function resetSelectionState(overrides: Partial<typeof selectionState> = {}) {
  Object.assign(selectionState, { activeSelection: null, hasSelectionClipboard: false, ...overrides });
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, unknown>;
const lastPublished = () => toolState.initial as QuickSelectionToolArgs;

describe('QuickSelection toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    resetSelectionState();
    mockPatchToolArgs.mockClear();
    mockSetToolArgs.mockClear();
    copyActiveSelectionMock.mockClear();
    // The real hook returns `true` on success (`useSelectionClipboard.ts:61`), and the component
    // now READS that boolean. Left at the `undefined` a bare `vi.fn()` returns, a click here
    // would look exactly like a refused copy, so the default has to be the success value —
    // otherwise every test that copies without asking for a return value reports a failure
    // that never happened.
    copyActiveSelectionMock.mockReturnValue(true);
    pasteSelectionClipboardMock.mockClear();
    clearSelectionsMock.mockClear();
    rafCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    resetToolArgs();
    resetSelectionState();
    rafCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('renders exactly the three controls the quick-selection args expose', () => {
    render(<QuickSelection />);

    // `QuickSelectionToolArgs` is `{ size, tolerance, mode, alpha }`. `alpha` is the region
    // grow's own blend, not a user setting. Sample All Layers is absent because the stroke
    // reads the document's composite canvas and a control that could not change what it reads
    // would be a lie about the tool.
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders the seeded default on every control', () => {
    render(<QuickSelection />);

    // `defaultSettings['quick-selection']` is size 40, tolerance 30, mode add.
    expect(getSize()).toHaveValue('40');
    expect(getTolerance()).toHaveValue('30');
    expect(getMode()).toHaveValue('add');
    expect(caption(getSize())).toBe('Size40px');
    expect(caption(getTolerance())).toBe('Tolerance30%');
  });

  it('exposes exactly the two region modes the args union can hold, in DOM order', () => {
    render(<QuickSelection />);

    const options = Array.from(getMode().options, (option) => [option.value, option.textContent]);

    expect(options).toEqual(QUICK_SELECTION_MODES.map((entry) => [entry.value, entry.label]));
    expect(options.map(([value]) => value)).toEqual(['add', 'subtract']);
  });

  it('takes the slider bounds from the tool module rather than its own numbers', () => {
    render(<QuickSelection />);

    // The size is a brush DIAMETER in the tool's own range, not `BRUSH_SIZE_MAX`: the quick
    // selection re-seeds a fill at every dab, so its ceiling is a separate constant.
    expect(getSize()).toHaveAttribute('min', String(QUICK_SELECTION_SIZE_MIN));
    expect(getSize()).toHaveAttribute('max', String(QUICK_SELECTION_SIZE_MAX));
    expect(getSize()).toHaveAttribute('step', '1');
    expect(getTolerance()).toHaveAttribute('min', String(QUICK_SELECTION_TOLERANCE_MIN));
    expect(getTolerance()).toHaveAttribute('max', String(QUICK_SELECTION_TOLERANCE_MAX));
    expect(getTolerance()).toHaveAttribute('step', '1');
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'elliptical-selection' as QuickSelectionToolArgs['toolName'] });
    const { container } = render(<QuickSelection />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('write path', () => {
    it('publishes the size as a plain number with no scale conversion', () => {
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '120' } });
      flushRaf();

      // `size` is a tip diameter in pixels on both sides, so there is nothing to divide: the
      // opposite of the bucket's Opacity and the eraser's, which is why both shapes are pinned.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('quick-selection', { size: 120 });
      expect(lastPatch()).toEqual({ size: 120 });
      expect(getSize()).toHaveValue('120');
      expect(caption(getSize())).toBe('Size120px');
    });

    it('publishes the tolerance as a percentage with no scale conversion', () => {
      render(<QuickSelection />);

      fireEvent.change(getTolerance(), { target: { value: '50' } });
      flushRaf();

      // `floodFill` takes `{ tolerance }` and compares it against a per-channel distance, so
      // the slider percentage IS the arg.
      expect(lastPatch()).toEqual({ tolerance: 50 });
      expect(caption(getTolerance())).toBe('Tolerance50%');
    });

    it('accepts both boundaries on both sliders', () => {
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '1' } });
      flushRaf();
      expect(lastPatch()).toEqual({ size: 1 });

      fireEvent.change(getSize(), { target: { value: '500' } });
      flushRaf();
      expect(lastPatch()).toEqual({ size: 500 });

      fireEvent.change(getTolerance(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch()).toEqual({ tolerance: 0 });

      fireEvent.change(getTolerance(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch()).toEqual({ tolerance: 100 });
    });

    it('merges a burst of writes into one patch so both sliders dragged in a frame land', () => {
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '8' } });
      fireEvent.change(getSize(), { target: { value: '9' } });
      fireEvent.change(getTolerance(), { target: { value: '42' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      // The pending patch is MERGED rather than replaced because both sliders are live at
      // once, and merging is what lets two writes in the same frame both survive.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('quick-selection', {
        size: 9,
        tolerance: 42,
      });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '10' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getSize(), { target: { value: '11' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch()).toEqual({ size: 11 });
    });

    it('leaves the other fields untouched when one control moves', () => {
      resetToolArgs();
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '64' } });
      flushRaf();

      expect(lastPublished()).toEqual({
        toolName: 'quick-selection',
        size: 64,
        tolerance: 30,
        mode: 'add',
        alpha: 1,
      });
    });

    it('never routes a slider through setToolArgs, so no control can replace the args object', () => {
      render(<QuickSelection />);

      fireEvent.change(getSize(), { target: { value: '20' } });
      fireEvent.change(getTolerance(), { target: { value: '40' } });
      flushRaf();

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('mode select', () => {
    it('writes the chosen mode through patchToolArgs without a frame', () => {
      render(<QuickSelection />);

      fireEvent.change(getMode(), { target: { value: 'subtract' } });

      // A dropdown fires once per choice rather than once per frame, so a frame of delay
      // would make the readout lag the click.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('quick-selection', { mode: 'subtract' });
      expect(rafCallbacks).toHaveLength(0);
      expect(getMode()).toHaveValue('subtract');
    });

    it('ignores a mode the args type cannot hold', () => {
      render(<QuickSelection />);

      // `isQuickSelectionMode` is the guard, so a value outside the union cannot reach the
      // args where the grow and the subtract would have to be told apart.
      fireEvent.change(getMode(), { target: { value: 'intersect' } });

      expect(mockPatchToolArgs).not.toHaveBeenCalled();
      expect(getMode()).toHaveValue('add');
    });
  });

  describe('hint text', () => {
    it('describes a growing stroke for the add mode', () => {
      render(<QuickSelection />);

      expect(screen.getByText('Drag over an object to grow the selection along the stroke.')).toBeInTheDocument();
    });

    it('describes a shrinking stroke for the subtract mode', () => {
      render(<QuickSelection />);

      fireEvent.change(getMode(), { target: { value: 'subtract' } });

      // The hint is derived from the PUBLISHED mode, so a spy that did not publish would leave
      // the add-mode text on screen and this assertion could never fail.
      expect(screen.getByText('Drag over what to remove from the selection.')).toBeInTheDocument();
    });

    it('promises no canvas gesture the tool area does not read', () => {
      // Adobe's Alt-drag resizes the brush tip and Shift-drag constrains it to a circle. Neither
      // is implemented here, and a modifier named on screen that does nothing is a defect of its
      // own: a user who presses Alt expects the tip to change and cannot tell it did not.
      render(<QuickSelection />);

      const hint = screen.getByText(/^Drag over/);
      expect(hint.textContent).not.toMatch(/Shift|Alt|Option|\bdrag on the canvas\b/i);
    });
  });

  describe('selection actions', () => {
    it('disables Copy and Deselect until there is an active selection', () => {
      render(<QuickSelection />);

      expect(getCopy()).toBeDisabled();
      expect(getClear()).toBeDisabled();
      expect(getPaste()).toBeDisabled();
    });

    it('enables Paste on a clipboard alone, with no active selection', () => {
      resetSelectionState({ hasSelectionClipboard: true });
      render(<QuickSelection />);

      // Copy and Deselect are about the CURRENT selection; Paste is about the clipboard. They are
      // gated on different state and must not be gated on the same thing.
      expect(getPaste()).toBeEnabled();
      expect(getCopy()).toBeDisabled();
      expect(getClear()).toBeDisabled();
    });

    it('copies the active selection and clears the selections through their own hooks', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // `restoreMocks` is off, and the only global `afterEach` is `cleanup()` plus
      // `useRealTimers()`, so a red assertion here used to leave `console.error` mocked for every
      // test after it in the file.
      try {
        resetSelectionState({ activeSelection: REGION_SELECTION, hasSelectionClipboard: true });
        render(<QuickSelection />);

        fireEvent.click(getCopy());
        fireEvent.click(getPaste());
        fireEvent.click(getClear());

        expect(copyActiveSelectionMock).toHaveBeenCalledExactlyOnceWith(REGION_SELECTION);
        expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
        expect(clearSelectionsMock).toHaveBeenCalledTimes(1);
        // A copy that succeeded reports nothing, so a bar that logged on the happy path would be
        // indistinguishable from one that only learned to log at all.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('reports a copy that returns false, which is not the throwing path', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Same reason as the test above: the restore has to run whatever the assertions do.
      try {
        resetSelectionState({ activeSelection: REGION_SELECTION, hasSelectionClipboard: true });
        // A REFUSAL, not a throw: `copySelection` returns `false` when there is no snapshot to
        // take (`useSelectionClipboard.ts:46`) and never reaches a `catch`, so the only way out of
        // the silent path is the component reading the boolean itself. The `if (!activeSelection)`
        // guard above it is why this case — and only this case — is reportable from here: nothing
        // selected is not a copy failure, and the button is disabled for it anyway.
        copyActiveSelectionMock.mockReturnValueOnce(false);
        render(<QuickSelection />);

        fireEvent.click(getCopy());

        expect(errorSpy).toHaveBeenCalledWith('Failed to copy quick selection');
        // The refusal still reached the clipboard hook; only the outcome went unreported.
        expect(copyActiveSelectionMock).toHaveBeenCalledExactlyOnceWith(REGION_SELECTION);
      } finally {
        copyActiveSelectionMock.mockReset();
        errorSpy.mockRestore();
      }
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<QuickSelection />);

      for (const name of ['Size', 'Tolerance', 'Mode']) {
        expect(screen.getByLabelText(name), name).toBeInTheDocument();
      }

      fireEvent.change(getSize(), { target: { value: '41' } });
      flushRaf();

      expect(screen.getByLabelText('Size')).toBeInTheDocument();
    });

    it('keeps the mode select focusable across arrow keys', () => {
      render(<QuickSelection />);

      const mode = getMode();
      mode.focus();
      expect(mode).toHaveFocus();

      fireEvent.keyDown(mode, { key: 'ArrowDown' });
      fireEvent.keyDown(mode, { key: 'ArrowUp' });

      expect(mode).toHaveFocus();
    });

    it('keeps every visible control reachable in tab order', () => {
      render(<QuickSelection />);

      for (const control of [getSize(), getTolerance(), getMode(), getCopy(), getPaste(), getClear()]) {
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
