import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import Levels from '../Levels.tsx';

const toolArgs = vi.hoisted(() => ({
  toolName: 'levels',
  brightness: 50,
  contrast: 50,
}));

const activeLayerId = vi.hoisted(() => ({ current: 'layer-1' as string | null }));

const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockIsToolDirty = vi.hoisted(() => ({ current: true }));
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockCanUndo = vi.hoisted(() => vi.fn(() => false));
const mockUndo = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
    isToolDirty: mockIsToolDirty.current,
    resetToLastSavedArgs: mockResetToLastSavedArgs,
  }),
}));

vi.mock('../../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({
    canUndo: mockCanUndo,
    undo: mockUndo,
  }),
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeLayerId: activeLayerId.current,
    },
  ],
}));

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'levels',
    brightness: 50,
    contrast: 50,
    ...overrides,
  });
}

function setActiveLayerId(id: string | null) {
  activeLayerId.current = id;
}

describe('Levels toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    mockTempUpdateLayer.mockClear();
    mockSetToolArgs.mockClear();
    mockResetToLastSavedArgs.mockClear();
    mockCanUndo.mockClear();
    mockCanUndo.mockReturnValue(false);
    mockUndo.mockClear();
    mockIsToolDirty.current = true;
    setActiveLayerId('layer-1');
  });

  it('renders brightness and contrast sliders', () => {
    render(<Levels />);

    expect(screen.getByLabelText(/Brightness/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contrast/)).toBeInTheDocument();
  });

  it('renders UndoButton', () => {
    render(<Levels />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('undoes the last history step instead of resetting when the tool has no unsaved changes', async () => {
    mockIsToolDirty.current = false;
    mockCanUndo.mockReturnValue(true);
    const user = userEvent.setup();
    render(<Levels />);

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('disables the Reset button without history and without unsaved changes', () => {
    mockIsToolDirty.current = false;
    render(<Levels />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('does not call tempUpdateLayer when activeLayerId is null', () => {
    setActiveLayerId(null);
    render(<Levels />);

    fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value: '75' } });

    expect(mockTempUpdateLayer).not.toHaveBeenCalled();
  });

  it('coalesces slider changes into a single layer update on the next animation frame', () => {
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });

    try {
      render(<Levels />);

      act(() => {
        fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value: '25' } });
      });
      act(() => {
        fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value: '60' } });
      });

      expect(frames).toHaveLength(1);
      expect(mockTempUpdateLayer).not.toHaveBeenCalled();
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      act(() => {
        frames.forEach((frame) => frame(0));
      });

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(1);
      expect(mockTempUpdateLayer).toHaveBeenCalledWith({
        id: 'layer-1',
        toolArgs: { toolName: 'levels', brightness: 60, contrast: 50 },
      });
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledWith({ toolName: 'levels', brightness: 60, contrast: 50 });
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('brightness slider reflects current value', () => {
    resetToolArgs({ brightness: -30 });
    render(<Levels />);

    const slider = screen.getByLabelText(/Brightness/) as HTMLInputElement;
    expect(slider.value).toBe('-30');
  });

  it('contrast slider reflects current value', () => {
    resetToolArgs({ contrast: 80 });
    render(<Levels />);

    const slider = screen.getByLabelText(/Contrast/) as HTMLInputElement;
    expect(slider.value).toBe('80');
  });

  describe('keyboard navigation', () => {
    it('all focusable elements are reachable and in correct tab order', () => {
      render(<Levels />);

      const brightnessSlider = screen.getByLabelText(/Brightness/);
      const contrastSlider = screen.getByLabelText(/Contrast/);
      const resetButton = screen.getByRole('button', { name: 'Reset' });

      expect(brightnessSlider).toBeInTheDocument();
      expect(contrastSlider).toBeInTheDocument();
      expect(resetButton).toBeInTheDocument();

      expect(brightnessSlider.tabIndex).toBeGreaterThanOrEqual(0);
      expect(contrastSlider.tabIndex).toBeGreaterThanOrEqual(0);
      expect(resetButton.tabIndex).toBeGreaterThanOrEqual(0);
    });

    it('allows arrow key navigation on brightness slider', () => {
      render(<Levels />);
      const brightnessSlider = screen.getByLabelText(/Brightness/);

      brightnessSlider.focus();
      expect(brightnessSlider).toHaveFocus();

      fireEvent.keyDown(brightnessSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(brightnessSlider, { key: 'ArrowLeft' });
      expect(brightnessSlider).toHaveFocus();
    });

    it('allows arrow key navigation on contrast slider', () => {
      render(<Levels />);
      const contrastSlider = screen.getByLabelText(/Contrast/);

      contrastSlider.focus();
      expect(contrastSlider).toHaveFocus();

      fireEvent.keyDown(contrastSlider, { key: 'ArrowUp' });
      fireEvent.keyDown(contrastSlider, { key: 'ArrowDown' });
      expect(contrastSlider).toHaveFocus();
    });

    it('allows enter to trigger reset button when enabled', () => {
      mockIsToolDirty.current = true;
      render(<Levels />);
      const resetButton = screen.getByRole('button', { name: 'Reset' });

      expect(resetButton).not.toBeDisabled();

      resetButton.focus();
      fireEvent.click(resetButton);

      expect(mockResetToLastSavedArgs).toHaveBeenCalled();
    });

    it('reaches the sliders and the reset button by tabbing in DOM order', async () => {
      const user = userEvent.setup();
      render(<Levels />);

      const brightnessSlider = screen.getByLabelText(/Brightness/);
      const contrastSlider = screen.getByLabelText(/Contrast/);
      const resetButton = screen.getByRole('button', { name: 'Reset' });

      await user.tab();
      expect(brightnessSlider).toHaveFocus();

      await user.tab();
      expect(contrastSlider).toHaveFocus();

      await user.tab();
      expect(resetButton).toHaveFocus();
    });

    it('resets to the last saved args when the focused reset button is activated with Enter', async () => {
      const user = userEvent.setup();
      render(<Levels />);

      const resetButton = screen.getByRole('button', { name: 'Reset' });
      await user.tab();
      await user.tab();
      await user.tab();
      expect(resetButton).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(mockResetToLastSavedArgs).toHaveBeenCalledTimes(1);
      expect(mockUndo).not.toHaveBeenCalled();
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<Levels />);
      const brightnessSlider = screen.getByLabelText(/Brightness/);

      brightnessSlider.focus();
      fireEvent.keyDown(brightnessSlider, { key: 'Escape' });
      expect(brightnessSlider).toHaveFocus();
    });
  });
});
