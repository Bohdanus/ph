import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import MagicWand from '../MagicWand.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

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
    getToolArgs: () => ({
      smoothing: 1.5,
      tolerance: 28,
      toolName: 'magic-wand',
    }),
    patchToolArgs: patchToolArgsMock,
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

describe('MagicWand toolbar', () => {
  beforeEach(() => {
    resetStoreState();
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
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

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', () => {
      render(<MagicWand />);
      const user = userEvent.setup();

      const toleranceSlider = screen.getByLabelText(/Tolerance/);
      const smoothingSlider = screen.getByLabelText(/Smooth/);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      toleranceSlider.focus();
      expect(toleranceSlider).toHaveFocus();

      userEvent.tab();
      expect(smoothingSlider).toHaveFocus();

      userEvent.tab();
      expect(copyButton).toHaveFocus();

      userEvent.tab();
      expect(pasteButton).toHaveFocus();

      userEvent.tab();
      expect(clearButton).toHaveFocus();

      userEvent.tab({ shift: true });
      expect(pasteButton).toHaveFocus();
    });

    it('allows arrow key navigation on tolerance slider', () => {
      render(<MagicWand />);
      const toleranceSlider = screen.getByLabelText(/Tolerance/);

      toleranceSlider.focus();
      const initialTolerance = Number(toleranceSlider.value);
      fireEvent.keyDown(toleranceSlider, { key: 'ArrowRight' });
      expect(Number(toleranceSlider.value)).toBeGreaterThan(initialTolerance);

      fireEvent.keyDown(toleranceSlider, { key: 'ArrowLeft' });
      expect(Number(toleranceSlider.value)).toBe(initialTolerance);
    });

    it('allows arrow key navigation on smoothing slider', () => {
      render(<MagicWand />);
      const smoothingSlider = screen.getByLabelText(/Smooth/);

      smoothingSlider.focus();
      const initialSmoothing = Number(smoothingSlider.value);
      fireEvent.keyDown(smoothingSlider, { key: 'ArrowUp' });
      expect(Number(smoothingSlider.value)).toBeGreaterThan(initialSmoothing);

      fireEvent.keyDown(smoothingSlider, { key: 'ArrowDown' });
      expect(Number(smoothingSlider.value)).toBe(initialSmoothing);
    });

    it('allows enter/space to trigger copy, paste, and clear buttons', () => {
      render(<MagicWand />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: 'Enter' });

      pasteButton.focus();
      fireEvent.keyDown(pasteButton, { key: ' ' });

      clearButton.focus();
      fireEvent.keyDown(clearButton, { key: 'Enter' });

      expect(patchToolArgsMock).toHaveBeenCalled();
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
