import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Selection } from '../../../../contexts/general-types.ts';
import MagicWand from '../MagicWand.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());

const toolArgs = vi.hoisted(() => ({ smoothing: 1.5, tolerance: 28, toolName: 'magic-wand' }));

/** `getToolArgs` returns `null` when the tool is not the active one (MagicWand.tsx:16-17). */
const toolArgsAvailable = vi.hoisted(() => ({ current: true }));

const patchToolArgsMock = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Partial<typeof toolArgs>) => {
    Object.assign(toolArgs, patch);
  })
);

const clipboardState = vi.hoisted((): { activeSelection: Selection | null; hasSelectionClipboard: boolean } => ({
  activeSelection: null,
  hasSelectionClipboard: false,
}));

const POLYGON_SELECTION: Selection = {
  id: 'selection-polygon-1',
  geometry: 'polygon',
  sourceTool: 'magic-wand',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 4, y: 8, width: 16, height: 24 },
  points: [
    { x: 4, y: 8 },
    { x: 20, y: 8 },
    { x: 20, y: 32 },
  ],
  metadata: {
    magicWand: {
      tolerance: 28,
      smoothing: 1.5,
      selectedPixelCount: 321,
      boundaryPointCount: 3,
      seed: { x: 4, y: 8 },
      sampleColor: { r: 10, g: 20, b: 30, a: 255 },
    },
  },
};

const storeState = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  canvasRef: { current: document.createElement('canvas') },
  selections: [],
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, dispatchMock],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => (toolArgsAvailable.current ? { ...toolArgs } : null),
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: clipboardState.activeSelection,
    copyActiveSelection: copyActiveSelectionMock,
    hasActiveSelection: !!clipboardState.activeSelection,
    hasSelectionClipboard: clipboardState.hasSelectionClipboard,
    pasteSelectionClipboard: pasteSelectionClipboardMock,
  }),
}));

function resetStoreState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    activeSelectionId: null,
    canvasRef: { current: document.createElement('canvas') },
    selections: [],
    ...overrides,
  });
}

function resetToolArgs() {
  toolArgs.smoothing = 1.5;
  toolArgs.tolerance = 28;
  toolArgs.toolName = 'magic-wand';
}

function setClipboardState(overrides: Partial<typeof clipboardState> = {}) {
  Object.assign(clipboardState, { activeSelection: null, hasSelectionClipboard: false, ...overrides });
}

function withActivePolygonSelection() {
  setClipboardState({ activeSelection: POLYGON_SELECTION, hasSelectionClipboard: true });
}

describe('MagicWand toolbar', () => {
  beforeEach(() => {
    resetStoreState();
    resetToolArgs();
    setClipboardState();
    toolArgsAvailable.current = true;
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
    copyActiveSelectionMock.mockClear();
    pasteSelectionClipboardMock.mockClear();
  });

  it('updates tolerance and smoothing settings', () => {
    render(<MagicWand />);

    fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '44' } });
    fireEvent.change(screen.getByLabelText(/Smooth/), { target: { value: '3' } });

    expect(patchToolArgsMock).toHaveBeenCalledWith('magic-wand', { tolerance: 44 });
    expect(patchToolArgsMock).toHaveBeenCalledWith('magic-wand', { smoothing: 3 });
  });

  it('renders when activeSelectionId is set', () => {
    resetStoreState({ activeSelectionId: 'selection-1' });
    render(<MagicWand />);

    expect(screen.getByLabelText(/Tolerance/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Smooth/)).toBeInTheDocument();
  });

  it('renders when selections array is empty', () => {
    resetStoreState({ selections: [] });
    render(<MagicWand />);

    expect(screen.getByLabelText(/Tolerance/)).toBeInTheDocument();
  });

  it('sliders reflect current tool args values', () => {
    render(<MagicWand />);

    expect(screen.getByLabelText(/Tolerance/)).toHaveValue('28');
    expect(screen.getByLabelText(/Smooth/)).toHaveValue('1.5');
  });

  describe('tool args availability', () => {
    it('renders nothing when the magic wand is not the active tool', () => {
      toolArgsAvailable.current = false;
      const { container } = render(<MagicWand />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByLabelText(/Tolerance/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
    });

    it('renders the toolbar again as soon as the tool args come back', () => {
      toolArgsAvailable.current = false;
      const { container, rerender } = render(<MagicWand />);
      expect(container).toBeEmptyDOMElement();

      toolArgsAvailable.current = true;
      rerender(<MagicWand />);

      expect(screen.getByLabelText(/Tolerance/)).toBeInTheDocument();
    });
  });

  describe('slider bounds', () => {
    it('exposes the documented tolerance and smoothing ranges', () => {
      render(<MagicWand />);

      const tolerance = screen.getByLabelText(/Tolerance/) as HTMLInputElement;
      expect(tolerance).toHaveAttribute('min', '0');
      expect(tolerance).toHaveAttribute('max', '100');
      expect(tolerance).toHaveAttribute('step', '1');

      const smoothing = screen.getByLabelText(/Smooth/) as HTMLInputElement;
      expect(smoothing).toHaveAttribute('min', '0');
      expect(smoothing).toHaveAttribute('max', '8');
      expect(smoothing).toHaveAttribute('step', '0.5');
    });

    it('accepts both range boundaries on both sliders', () => {
      render(<MagicWand />);

      fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '0' } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { tolerance: 0 });

      fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '100' } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { tolerance: 100 });

      fireEvent.change(screen.getByLabelText(/Smooth/), { target: { value: '0' } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { smoothing: 0 });

      fireEvent.change(screen.getByLabelText(/Smooth/), { target: { value: '8' } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { smoothing: 8 });
    });

    it('patches only the changed setting so the other one is preserved', () => {
      render(<MagicWand />);

      fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText(/Smooth/), { target: { value: '2' } });

      expect(patchToolArgsMock.mock.calls).toEqual([
        ['magic-wand', { tolerance: 50 }],
        ['magic-wand', { smoothing: 2 }],
      ]);
    });
  });

  describe('selection clipboard', () => {
    const RECT_SELECTION: Selection = { ...POLYGON_SELECTION, id: 'selection-rect-1', geometry: 'rectangle' };

    it('treats a rectangular selection as no magic wand selection', () => {
      setClipboardState({ activeSelection: RECT_SELECTION, hasSelectionClipboard: true });
      render(<MagicWand />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeEnabled();
    });

    it('copies the active polygon selection and never alerts on success', async () => {
      withActivePolygonSelection();
      render(<MagicWand />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => {
        expect(copyActiveSelectionMock).toHaveBeenCalledWith(POLYGON_SELECTION);
      });
    });

    it('logs and alerts when copying throws, then restores the button', async () => {
      const failure = new Error('clipboard exploded');
      // `mockImplementationOnce` so the throwing behaviour cannot leak into later tests:
      // `beforeEach` only calls `mockClear()`, which does not reset implementations.
      copyActiveSelectionMock.mockImplementationOnce(() => {
        throw failure;
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      withActivePolygonSelection();

      try {
        render(<MagicWand />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(alertSpy).toHaveBeenCalledWith('Failed to copy magic wand selection');
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error copying magic wand selection:', failure);

        // `finally { setIsCopying(false) }` (MagicWand.tsx:39-41) is the only thing keeping the
        // label from being stranded on 'Copying...'.
        const copyButton = screen.getByRole('button', { name: 'Copy' });
        expect(copyButton).toHaveTextContent('Copy');
        expect(copyButton).toBeEnabled();
      } finally {
        consoleErrorSpy.mockRestore();
        alertSpy.mockRestore();
      }
    });

    it('clears the selections through the explicit clear action', () => {
      withActivePolygonSelection();
      render(<MagicWand />);

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith({ type: 'CLEAR_SELECTIONS' });
      expect(pasteSelectionClipboardMock).not.toHaveBeenCalled();
    });
  });

  describe('selected pixel readout', () => {
    it('reports the selected pixel count with locale grouping', () => {
      withActivePolygonSelection();
      render(<MagicWand />);

      expect(screen.getByText('321 pixels selected')).toBeInTheDocument();
      expect(screen.queryByText(/Increase tolerance/)).toBeNull();
    });

    it('falls back to the tolerance hint when no count is reported', () => {
      const withoutMetadata = { ...POLYGON_SELECTION, metadata: undefined } as Selection;
      setClipboardState({ activeSelection: withoutMetadata, hasSelectionClipboard: true });
      render(<MagicWand />);

      expect(screen.getByText(/Increase tolerance for broader regions\./)).toBeInTheDocument();
    });

    it('falls back to the tolerance hint for a zero pixel count', () => {
      const zeroCount = {
        ...POLYGON_SELECTION,
        metadata: { magicWand: { ...POLYGON_SELECTION.metadata!.magicWand, selectedPixelCount: 0 } },
      } as Selection;
      setClipboardState({ activeSelection: zeroCount, hasSelectionClipboard: true });
      render(<MagicWand />);

      expect(screen.getByText(/Increase tolerance for broader regions\./)).toBeInTheDocument();
    });

    it('always explains how the tool is used', () => {
      render(<MagicWand />);

      expect(screen.getByText('Click a color area to select connected similar pixels.')).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', async () => {
      const user = userEvent.setup();
      withActivePolygonSelection();
      render(<MagicWand />);

      const toleranceSlider = screen.getByLabelText(/Tolerance/);
      const smoothingSlider = screen.getByLabelText(/Smooth/);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      expect(copyButton).not.toBeDisabled();
      expect(pasteButton).not.toBeDisabled();
      expect(clearButton).not.toBeDisabled();

      toleranceSlider.focus();
      expect(toleranceSlider).toHaveFocus();

      await user.tab();
      expect(smoothingSlider).toHaveFocus();

      await user.tab();
      expect(copyButton).toHaveFocus();

      await user.tab();
      expect(pasteButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);

      await user.tab({ shift: true });
      expect(clearButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(pasteButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(copyButton).toHaveFocus();
    });

    it('skips disabled action buttons when tabbing', async () => {
      const user = userEvent.setup();
      render(<MagicWand />);

      const toleranceSlider = screen.getByLabelText(/Tolerance/);
      const smoothingSlider = screen.getByLabelText(/Smooth/);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      expect(copyButton).toBeDisabled();
      expect(pasteButton).toBeDisabled();
      expect(clearButton).toBeDisabled();

      copyButton.focus();
      expect(copyButton).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);

      toleranceSlider.focus();
      expect(toleranceSlider).toHaveFocus();

      await user.tab();
      expect(smoothingSlider).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);
    });

    it('allows arrow key navigation on tolerance slider', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<MagicWand />);
      const toleranceSlider = screen.getByLabelText(/Tolerance/) as HTMLInputElement;

      toleranceSlider.focus();
      expect(toleranceSlider).toHaveFocus();

      const initialTolerance = Number(toleranceSlider.value);
      const keydownSpy = vi.fn();
      toleranceSlider.addEventListener('keydown', keydownSpy);

      await user.keyboard('{ArrowRight}');
      expect((keydownSpy.mock.calls[0][0] as KeyboardEvent).key).toBe('ArrowRight');
      expect(toleranceSlider).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      expect((keydownSpy.mock.calls[1][0] as KeyboardEvent).key).toBe('ArrowLeft');
      expect(toleranceSlider).toHaveFocus();

      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(toleranceSlider).toHaveValue(String(initialTolerance));

      fireEvent.change(toleranceSlider, { target: { value: String(initialTolerance + 1) } });
      expect(patchToolArgsMock).toHaveBeenCalledWith('magic-wand', { tolerance: initialTolerance + 1 });

      rerender(<MagicWand />);
      expect(toleranceSlider).toHaveValue(String(initialTolerance + 1));

      fireEvent.change(toleranceSlider, { target: { value: String(initialTolerance) } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { tolerance: initialTolerance });

      rerender(<MagicWand />);
      expect(toleranceSlider).toHaveValue(String(initialTolerance));
    });

    it('allows arrow key navigation on smoothing slider', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<MagicWand />);
      const smoothingSlider = screen.getByLabelText(/Smooth/) as HTMLInputElement;

      smoothingSlider.focus();
      expect(smoothingSlider).toHaveFocus();

      const initialSmoothing = Number(smoothingSlider.value);
      const keydownSpy = vi.fn();
      smoothingSlider.addEventListener('keydown', keydownSpy);

      await user.keyboard('{ArrowUp}');
      expect((keydownSpy.mock.calls[0][0] as KeyboardEvent).key).toBe('ArrowUp');
      expect(smoothingSlider).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect((keydownSpy.mock.calls[1][0] as KeyboardEvent).key).toBe('ArrowDown');
      expect(smoothingSlider).toHaveFocus();

      expect(patchToolArgsMock).not.toHaveBeenCalled();
      expect(smoothingSlider).toHaveValue(String(initialSmoothing));

      const steppedSmoothing = initialSmoothing + Number(smoothingSlider.step);
      fireEvent.change(smoothingSlider, { target: { value: String(steppedSmoothing) } });
      expect(patchToolArgsMock).toHaveBeenCalledWith('magic-wand', { smoothing: steppedSmoothing });

      rerender(<MagicWand />);
      expect(smoothingSlider).toHaveValue(String(steppedSmoothing));

      fireEvent.change(smoothingSlider, { target: { value: String(initialSmoothing) } });
      expect(patchToolArgsMock).toHaveBeenLastCalledWith('magic-wand', { smoothing: initialSmoothing });

      rerender(<MagicWand />);
      expect(smoothingSlider).toHaveValue(String(initialSmoothing));
    });

    it('allows enter/space to trigger copy, paste, and clear buttons', async () => {
      const user = userEvent.setup();
      withActivePolygonSelection();
      render(<MagicWand />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      copyButton.focus();
      expect(copyButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(copyActiveSelectionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'selection-polygon-1' }));
      expect(pasteSelectionClipboardMock).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalled();

      pasteButton.focus();
      expect(pasteButton).toHaveFocus();
      await user.keyboard(' ');

      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);

      clearButton.focus();
      expect(clearButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<MagicWand />);
      const toleranceSlider = screen.getByLabelText(/Tolerance/);

      toleranceSlider.focus();
      fireEvent.keyDown(toleranceSlider, { key: 'Escape' });
      expect(toleranceSlider).toHaveFocus();
    });
  });
});
