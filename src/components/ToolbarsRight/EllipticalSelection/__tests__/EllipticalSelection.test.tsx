import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EllipticalSelection from '../EllipticalSelection.tsx';
import {
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
} from '../../../../tools/ellipticalSelection.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { Selection } from '../../../../contexts/general-types.ts';
import type { EllipticalSelectionToolArgs } from '../../../../tools/ellipticalSelection.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the conditional fields
 * mount and unmount from the published style rather than from a module variable; a bare spy
 * would leave the bar on the style the drag started on. Real `useState` (rather than assigning
 * a module variable) is what makes the repaint observable, because the repo compiles with
 * `babel-plugin-react-compiler`, which memoizes `<EllipticalSelection />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const clearSelectionsMock = vi.hoisted(() => vi.fn());

/** The three selection-state fields the Copy/Paste/Clear row reads. */
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
        resetToLastSavedArgs: () => {},
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

const ELLIPSE_SELECTION: Selection = {
  id: 'selection-ellipse-1',
  geometry: 'polygon',
  sourceTool: 'magic-wand',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 8, y: 12, width: 24, height: 32 },
  points: [
    { x: 8, y: 12 },
    { x: 32, y: 12 },
    { x: 32, y: 44 },
  ],
};

const getStyle = () => screen.getByLabelText('Style') as HTMLSelectElement;
const getRatio = () => screen.getByLabelText('Ratio') as HTMLInputElement;
const getWidth = () => screen.getByLabelText('Width') as HTMLInputElement;
const getHeight = () => screen.getByLabelText('Height') as HTMLInputElement;
const getCopy = () => screen.getByRole('button', { name: 'Copy' });
const getPaste = () => screen.getByRole('button', { name: 'Paste' });
const getClear = () => screen.getByRole('button', { name: 'Clear' });

/**
 * The label text of every numeric field currently on screen, in DOM order.
 *
 * Read off the DOM rather than off the component, because "a field the style does not use" is
 * exactly a statement about which labels are present. The `<select>` lives INSIDE the Style
 * label, so a naive label sweep would pick up its option text too; going through the number
 * inputs and their `label[for]` avoids that.
 */
const numericLabels = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]')).map(
    (input) => document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ?? ''
  );

/** The seeded marquee defaults: normal, ratio 1, 100 x 100. */
function resetToolArgs(overrides: Partial<EllipticalSelectionToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings['elliptical-selection']),
    ...overrides,
  } satisfies EllipticalSelectionToolArgs;
  return toolState.initial as EllipticalSelectionToolArgs;
}

function resetSelectionState(overrides: Partial<typeof selectionState> = {}) {
  Object.assign(selectionState, { activeSelection: null, hasSelectionClipboard: false, ...overrides });
}

const lastPublished = () => toolState.initial as EllipticalSelectionToolArgs;

describe('EllipticalSelection toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    resetSelectionState();
    mockPatchToolArgs.mockClear();
    mockSetToolArgs.mockClear();
    copyActiveSelectionMock.mockClear();
    pasteSelectionClipboardMock.mockClear();
    clearSelectionsMock.mockClear();
  });

  afterEach(() => {
    resetToolArgs();
    resetSelectionState();
  });

  it('exposes exactly the three marquee styles, in DOM order', () => {
    render(<EllipticalSelection />);

    // `normal` constrains nothing, `fixed-ratio` locks the drag to the ratio and `fixed-size`
    // to the two extents. The dropdown is the only place the choice is made, so its option
    // list IS the style contract.
    const options = Array.from(getStyle().options, (option) => [option.value, option.textContent]);

    expect(options).toEqual(MARQUEE_STYLES.map((entry) => [entry.value, entry.label]));
    expect(options.map(([value]) => value)).toEqual(['normal', 'fixed-ratio', 'fixed-size']);
    expect(getStyle()).toHaveValue('normal');
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'quick-selection' as EllipticalSelectionToolArgs['toolName'] });
    const { container } = render(<EllipticalSelection />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('conditional fields', () => {
    it('shows no numeric field at all for a normal marquee', () => {
      render(<EllipticalSelection />);

      // `normal` has nothing to set, so there is no field to grey out. Rendering the three
      // numeric inputs disabled would claim a control the tool is not reading.
      expect(screen.queryByLabelText('Ratio')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Height')).not.toBeInTheDocument();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('shows only the ratio for a fixed-ratio marquee', () => {
      resetToolArgs({ style: 'fixed-ratio' });
      render(<EllipticalSelection />);

      expect(getRatio()).toBeInTheDocument();
      expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Height')).not.toBeInTheDocument();
    });

    it('shows both extents and no ratio for a fixed-size marquee', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      expect(getWidth()).toBeInTheDocument();
      expect(getHeight()).toBeInTheDocument();
      expect(screen.queryByLabelText('Ratio')).not.toBeInTheDocument();
    });

    it.each([
      ['fixed-ratio', ['Ratio']],
      ['fixed-size', ['Width', 'Height']],
      ['normal', []],
    ] as const)('shows exactly the numeric fields the %s style uses', (style, expected) => {
      resetToolArgs({ style });
      render(<EllipticalSelection />);

      expect(numericLabels(), style).toEqual([...expected]);
    });

    it('swaps the fields as the style select changes, from the published args', () => {
      render(<EllipticalSelection />);
      expect(screen.queryByLabelText('Ratio')).not.toBeInTheDocument();

      fireEvent.change(getStyle(), { target: { value: 'fixed-ratio' } });

      // The state publish is what makes the field appear: a spy that only recorded the call
      // would leave the bar on `normal` and the assertion above would still pass forever.
      expect(screen.getByLabelText('Ratio')).toBeInTheDocument();
      expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();

      fireEvent.change(getStyle(), { target: { value: 'fixed-size' } });

      expect(screen.getByLabelText('Width')).toBeInTheDocument();
      expect(screen.getByLabelText('Height')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ratio')).not.toBeInTheDocument();

      fireEvent.change(getStyle(), { target: { value: 'normal' } });

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
  });

  describe('numeric field bounds', () => {
    it('takes the ratio bounds from the tool module', () => {
      resetToolArgs({ style: 'fixed-ratio' });
      render(<EllipticalSelection />);

      // Photoshop's marquee Ratio field spans 1:20 to 20:1, and the step is the 0.05 the
      // `resolveEllipseRect` constraint is expressed in.
      expect(getRatio()).toHaveAttribute('min', String(MARQUEE_RATIO_MIN));
      expect(getRatio()).toHaveAttribute('max', String(MARQUEE_RATIO_MAX));
      expect(getRatio()).toHaveAttribute('step', String(MARQUEE_RATIO_STEP));
      expect(getRatio()).toHaveValue(1);
    });

    it('takes the extent bounds from the tool module', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      for (const field of [getWidth(), getHeight()]) {
        expect(field).toHaveAttribute('min', String(MARQUEE_SIZE_MIN));
        expect(field).toHaveAttribute('max', String(MARQUEE_SIZE_MAX));
        expect(field).toHaveAttribute('step', String(MARQUEE_SIZE_STEP));
        expect(field).toHaveValue(100);
      }
    });
  });

  describe('write path', () => {
    it('writes the ratio on its own field', () => {
      resetToolArgs({ style: 'fixed-ratio' });
      render(<EllipticalSelection />);

      fireEvent.change(getRatio(), { target: { value: '1.5' } });

      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('elliptical-selection', { fixedRatio: 1.5 });
      expect(getRatio()).toHaveValue(1.5);
    });

    it('writes width and height on their own fields', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      fireEvent.change(getWidth(), { target: { value: '200' } });
      expect(mockPatchToolArgs).toHaveBeenLastCalledWith('elliptical-selection', { fixedWidth: 200 });

      fireEvent.change(getHeight(), { target: { value: '150' } });
      expect(mockPatchToolArgs).toHaveBeenLastCalledWith('elliptical-selection', { fixedHeight: 150 });
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
    });

    it('keeps the three numeric values in the args across a style change', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      fireEvent.change(getWidth(), { target: { value: '240' } });
      fireEvent.change(getStyle(), { target: { value: 'fixed-ratio' } });
      expect(getRatio()).toHaveValue(1);

      fireEvent.change(getStyle(), { target: { value: 'fixed-size' } });

      // The bar only edits the value whose field is on screen; the other two must survive a
      // round trip through the style dropdown, because switching to Ratio and back is a normal
      // way to set all three.
      expect(getWidth()).toHaveValue(240);
      expect(getHeight()).toHaveValue(100);
      expect(lastPublished().fixedRatio).toBe(1);
    });

    it('refuses to write an incomplete number rather than storing a zero constraint', () => {
      resetToolArgs({ style: 'fixed-ratio' });
      render(<EllipticalSelection />);

      // A half-typed number reaches the handler as `0` or `''`, and a locked ratio of zero is
      // not a constraint at all: `resolveEllipseRect` would silently fall back to a free drag
      // while the field kept claiming a ratio.
      for (const value of ['0', '']) {
        fireEvent.change(getRatio(), { target: { value } });
        expect(mockPatchToolArgs, value).not.toHaveBeenCalled();
      }
      expect(getRatio()).toHaveValue(1);
    });

    it('ignores a style the args type cannot hold', () => {
      render(<EllipticalSelection />);

      // `isMarqueeStyle` is the guard, so a value outside the union can never reach the args
      // where every branch would fall through to the `normal` behaviour.
      fireEvent.change(getStyle(), { target: { value: 'fixed-angle' } });

      expect(mockPatchToolArgs).not.toHaveBeenCalled();
      expect(getStyle()).toHaveValue('normal');
    });

    it('never routes a field through setToolArgs, so no control can replace the args object', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      fireEvent.change(getStyle(), { target: { value: 'fixed-ratio' } });
      fireEvent.change(getRatio(), { target: { value: '2' } });

      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
    });
  });

  describe('hint text', () => {
    it('describes a free drag for a normal marquee', () => {
      render(<EllipticalSelection />);

      expect(
        screen.getByText('Drag to draw an ellipse. Hold Shift for a circle, Alt to draw from the centre.')
      ).toBeInTheDocument();
    });

    it('names the locked ratio for a fixed-ratio marquee', () => {
      resetToolArgs({ style: 'fixed-ratio', fixedRatio: 1.5 });
      render(<EllipticalSelection />);

      expect(
        screen.getByText('Drag at 1.5:1. Hold Shift for a circle, Alt to draw from the centre.')
      ).toBeInTheDocument();
    });

    it('names the locked extents for a fixed-size marquee', () => {
      resetToolArgs({ style: 'fixed-size', fixedWidth: 240.4, fixedHeight: 100.6 });
      render(<EllipticalSelection />);

      // `Math.round` on both: the extent is a whole pixel, and showing "240.4 x 100.6" would
      // describe a size the click cannot produce.
      expect(screen.getByText('Click to place a 240 x 101 ellipse.')).toBeInTheDocument();
    });
  });

  describe('selection actions', () => {
    it('disables Copy and Clear until there is an active selection', () => {
      render(<EllipticalSelection />);

      expect(getCopy()).toBeDisabled();
      expect(getClear()).toBeDisabled();
      expect(getPaste()).toBeDisabled();
    });

    it('enables Paste on a clipboard alone, with no active selection', () => {
      resetSelectionState({ hasSelectionClipboard: true });
      render(<EllipticalSelection />);

      // Copy and Clear are about the CURRENT selection; Paste is about the clipboard. They are
      // gated on different state and must not be gated on the same thing.
      expect(getPaste()).toBeEnabled();
      expect(getCopy()).toBeDisabled();
      expect(getClear()).toBeDisabled();
    });

    it('copies the active selection and clears the selections through their own hooks', () => {
      resetSelectionState({ activeSelection: ELLIPSE_SELECTION, hasSelectionClipboard: true });
      render(<EllipticalSelection />);

      fireEvent.click(getCopy());
      fireEvent.click(getPaste());
      fireEvent.click(getClear());

      expect(copyActiveSelectionMock).toHaveBeenCalledExactlyOnceWith(ELLIPSE_SELECTION);
      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
      expect(clearSelectionsMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard navigation', () => {
    it('keeps the style select focusable across arrow keys', () => {
      render(<EllipticalSelection />);

      const style = getStyle();
      style.focus();
      expect(style).toHaveFocus();

      fireEvent.keyDown(style, { key: 'ArrowDown' });
      fireEvent.keyDown(style, { key: 'ArrowUp' });

      expect(style).toHaveFocus();
    });

    it('keeps every visible control reachable in tab order', () => {
      resetToolArgs({ style: 'fixed-size' });
      render(<EllipticalSelection />);

      for (const control of [getStyle(), getWidth(), getHeight(), getCopy(), getPaste(), getClear()]) {
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
