import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../../contexts/general-types.ts';
import Lasso from '../Lasso.tsx';

type LassoArgs = {
  toolName: 'polygonal-lasso';
  fill: boolean;
  lineWidth: number;
  alpha: number;
  color: string;
};

const storeState = vi.hoisted(() => ({ color: '#000000' }));

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real `setToolArgs`
 * publishes a new args object back into React state, so the readouts repaint; a bare spy never
 * does. Real `useState` (rather than assigning a module variable and forcing a parent re-render)
 * is what makes the repaint observable at all here: the repo compiles with
 * `babel-plugin-react-compiler`, which memoizes `<Lasso />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState(toolState.initial);
      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          mockSetToolArgs(next);
          toolState.initial = next;
          setArgs(next);
        },
      };
    },
  };
});

const clipboardState = vi.hoisted(() => ({
  activeSelection: null as Selection | null,
  hasSelectionClipboard: false,
}));

const clipboardMocks = vi.hoisted(() => ({
  copyActiveSelection: vi.fn(() => true),
  pasteSelectionClipboard: vi.fn(),
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: clipboardState.activeSelection,
    copyActiveSelection: clipboardMocks.copyActiveSelection,
    hasSelectionClipboard: clipboardState.hasSelectionClipboard,
    pasteSelectionClipboard: clipboardMocks.pasteSelectionClipboard,
  }),
}));

const POLYGON_SELECTION: Selection = {
  id: 'selection-polygon-1',
  geometry: 'polygon',
  sourceTool: 'polygonal-lasso',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 0, y: 0, width: 20, height: 20 },
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
  ],
};

const RECT_SELECTION: Selection = { ...POLYGON_SELECTION, id: 'selection-rect-1', geometry: 'rectangle' };

function resetToolArgs(overrides: Partial<LassoArgs> = {}) {
  toolState.initial = {
    toolName: 'polygonal-lasso',
    fill: false,
    lineWidth: 5,
    alpha: 1,
    color: storeState.color,
    ...overrides,
  };
  return toolState.initial as LassoArgs;
}

const currentArgs = () => toolState.initial as LassoArgs;
const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as LassoArgs;

const modeButton = () => screen.getByRole('button', { name: /^(Fill|Outline)$/ });
const copyButton = () => screen.getByRole('button', { name: /Copy/ });
const pasteButton = () => screen.getByRole('button', { name: 'Paste' });
const sizeSlider = () => screen.getByLabelText(/Size/) as HTMLInputElement;
const opacitySlider = () => screen.getByLabelText(/Opacity/) as HTMLInputElement;

describe('Lasso toolbar', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storeState.color = '#000000';
    resetToolArgs();
    clipboardState.activeSelection = null;
    clipboardState.hasSelectionClipboard = false;
    clipboardMocks.copyActiveSelection.mockReset();
    clipboardMocks.copyActiveSelection.mockReturnValue(true);
    clipboardMocks.pasteSelectionClipboard.mockClear();
    mockSetToolArgs.mockClear();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('renders the mode toggle, clipboard actions and the two sliders', () => {
    render(<Lasso />);

    expect(modeButton()).toHaveTextContent('Outline');
    expect(copyButton()).toBeInTheDocument();
    expect(pasteButton()).toBeInTheDocument();
    expect(sizeSlider()).toBeInTheDocument();
    expect(opacitySlider()).toBeInTheDocument();
  });

  it('documents the pointer interaction for the user', () => {
    render(<Lasso />);

    expect(screen.getByText('Click points • Right-click to finish')).toBeInTheDocument();
    expect(screen.getByText(/Double-click first point to close/)).toBeInTheDocument();
    expect(screen.getByText(/Backspace removes anchor/)).toBeInTheDocument();
  });

  describe('colour sync', () => {
    it('adopts the store colour when it diverges from the tool args colour (Lasso.tsx:16-19)', () => {
      storeState.color = '#ff0000';
      resetToolArgs({ color: '#000000' });
      render(<Lasso />);

      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ color: '#ff0000' }));
      expect(currentArgs().color).toBe('#ff0000');
    });

    it('does not publish anything when the tool args already match the store colour', () => {
      render(<Lasso />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('mode toggle', () => {
    it('flips the fill flag and repaints the label and the active styling', () => {
      render(<Lasso />);

      expect(modeButton().className).not.toContain('bg-blue-500');

      fireEvent.click(modeButton());

      expect(lastToolArgs().fill).toBe(true);
      expect(modeButton()).toHaveTextContent('Fill');
      expect(modeButton().className).toContain('bg-blue-500');
    });

    it('flips back to outline on a second activation', () => {
      render(<Lasso />);

      fireEvent.click(modeButton());
      fireEvent.click(modeButton());

      expect(lastToolArgs().fill).toBe(false);
      expect(modeButton()).toHaveTextContent('Outline');
      expect(modeButton().className).not.toContain('bg-blue-500');
    });

    it('starts filled when the tool args already request fill', () => {
      resetToolArgs({ fill: true });
      render(<Lasso />);

      expect(modeButton()).toHaveTextContent('Fill');
      expect(modeButton().className).toContain('bg-blue-500');
    });

    it('keeps the tool name pinned to polygonal-lasso on every change', () => {
      render(<Lasso />);

      fireEvent.click(modeButton());
      expect(lastToolArgs().toolName).toBe('polygonal-lasso');

      fireEvent.change(opacitySlider(), { target: { value: '0.5' } });
      expect(lastToolArgs().toolName).toBe('polygonal-lasso');
    });
  });

  describe('size slider', () => {
    it('is revealed in outline mode and hidden in fill mode (Lasso.tsx:105-125)', () => {
      const { rerender } = render(<Lasso />);
      expect(sizeSlider()).toBeInTheDocument();
      expect(screen.getByText('5px')).toBeInTheDocument();

      fireEvent.click(modeButton());
      rerender(<Lasso />);

      expect(screen.queryByLabelText(/Size/)).not.toBeInTheDocument();
      // Opacity is unrelated to fill and must stay visible.
      expect(opacitySlider()).toBeInTheDocument();
    });

    it('publishes the line width and repaints the readout', () => {
      render(<Lasso />);

      fireEvent.change(sizeSlider(), { target: { value: '40' } });

      expect(lastToolArgs().lineWidth).toBe(40);
      expect(sizeSlider()).toHaveValue('40');
      expect(screen.getByText('40px')).toBeInTheDocument();
    });

    it('carries alpha through a line width change untouched', () => {
      resetToolArgs({ alpha: 0.25 });
      render(<Lasso />);

      fireEvent.change(sizeSlider(), { target: { value: '12' } });

      expect(lastToolArgs().alpha).toBe(0.25);
      expect(screen.getByText('25%')).toBeInTheDocument();
    });
  });

  describe('opacity slider', () => {
    it('publishes the alpha and repaints the rounded percentage readout', () => {
      render(<Lasso />);

      fireEvent.change(opacitySlider(), { target: { value: '0.42' } });

      expect(lastToolArgs().alpha).toBe(0.42);
      expect(opacitySlider()).toHaveValue('0.42');
      expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('rounds the readout rather than showing the raw fraction', () => {
      resetToolArgs({ alpha: 0.456 });
      render(<Lasso />);

      expect(screen.getByText('46%')).toBeInTheDocument();
    });
  });

  describe('copy', () => {
    it('is disabled with an explanatory title when nothing is selected', () => {
      render(<Lasso />);

      expect(copyButton()).toBeDisabled();
      expect(copyButton()).toHaveAttribute('title', 'No active selection to copy');
      expect(copyButton().className).toContain('cursor-not-allowed');
    });

    it('is disabled for a rectangular selection, which is not a lasso selection', () => {
      clipboardState.activeSelection = RECT_SELECTION;
      render(<Lasso />);

      // `hasActiveSelection` excludes rectangles (Lasso.tsx:61) even though a selection exists.
      expect(copyButton()).toBeDisabled();
      expect(copyButton()).toHaveAttribute('title', 'No active selection to copy');
    });

    it('is enabled with a different title once a polygon selection is active', () => {
      clipboardState.activeSelection = POLYGON_SELECTION;
      render(<Lasso />);

      expect(copyButton()).not.toBeDisabled();
      expect(copyButton()).toHaveAttribute('title', 'Copy selection inside this app');
      expect(copyButton().className).not.toContain('cursor-not-allowed');
    });

    it('copies the active selection and never alerts on success', async () => {
      clipboardState.activeSelection = POLYGON_SELECTION;
      render(<Lasso />);

      fireEvent.click(copyButton());
      await Promise.resolve();

      expect(clipboardMocks.copyActiveSelection).toHaveBeenCalledWith(POLYGON_SELECTION);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('makes the "no active selection" alert unreachable from the UI', async () => {
      // `handleCopySelection` opens with `if (!activeSelection || geometry === 'rectangle')
      // { alert(...); return; }` (Lasso.tsx:39-42), but `disabled={!hasActiveSelection}` (Lasso.tsx:81)
      // already uses the same predicate, so a click can never reach the alert. Asserting the
      // disabled state is the reachable half of that guard; the alert is a defensive fallback
      // for a stale render and is deliberately not tested through the DOM.
      render(<Lasso />);

      const button = copyButton() as HTMLButtonElement;
      expect(button).toBeDisabled();
      expect(button.disabled).toBe(true);

      // Even a forced dispatch of a click on the disabled element must not run the handler.
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();

      expect(clipboardMocks.copyActiveSelection).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('alerts when the copy reports failure', async () => {
      clipboardState.activeSelection = POLYGON_SELECTION;
      clipboardMocks.copyActiveSelection.mockReturnValue(false);
      render(<Lasso />);

      fireEvent.click(copyButton());
      await Promise.resolve();

      expect(alertSpy).toHaveBeenCalledWith('Failed to copy selection');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('logs and alerts when the copy throws', async () => {
      const failure = new Error('clipboard exploded');
      clipboardState.activeSelection = POLYGON_SELECTION;
      clipboardMocks.copyActiveSelection.mockImplementation(() => {
        throw failure;
      });
      render(<Lasso />);

      fireEvent.click(copyButton());
      await Promise.resolve();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error copying selection:', failure);
      expect(alertSpy).toHaveBeenCalledWith('Failed to copy selection');
    });

    it('re-enables the button after a failed copy instead of staying stuck on Copying', async () => {
      clipboardState.activeSelection = POLYGON_SELECTION;
      clipboardMocks.copyActiveSelection.mockImplementation(() => {
        throw new Error('boom');
      });
      render(<Lasso />);

      fireEvent.click(copyButton());
      await Promise.resolve();

      // `finally { setIsCopying(false) }` (Lasso.tsx:51-53) is the only thing keeping the label
      // from being stranded on 'Copying...'.
      expect(copyButton()).toHaveTextContent('Copy');
      expect(copyButton()).not.toBeDisabled();
    });
  });

  describe('paste', () => {
    it('is disabled with an explanatory title when the in-app clipboard is empty', () => {
      render(<Lasso />);

      expect(pasteButton()).toBeDisabled();
      expect(pasteButton()).toHaveAttribute('title', 'No in-app copied selection to paste');
      expect(pasteButton().className).toContain('cursor-not-allowed');
    });

    it('is enabled and pastes once a selection has been copied', () => {
      clipboardState.hasSelectionClipboard = true;
      render(<Lasso />);

      expect(pasteButton()).not.toBeDisabled();
      expect(pasteButton()).toHaveAttribute('title', 'Paste copied selection as a new layer');

      fireEvent.click(pasteButton());

      expect(clipboardMocks.pasteSelectionClipboard).toHaveBeenCalledTimes(1);
    });

    it('does not require an active selection to paste', () => {
      // Pasting a previously copied selection is meaningful after the user has drawn a new one.
      clipboardState.hasSelectionClipboard = true;
      clipboardState.activeSelection = null;
      render(<Lasso />);

      expect(pasteButton()).not.toBeDisabled();
      fireEvent.click(pasteButton());

      expect(clipboardMocks.pasteSelectionClipboard).toHaveBeenCalledTimes(1);
    });
  });
});
