import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('slider publishing', () => {
    let frames: FrameRequestCallback[];
    let rafSpy: ReturnType<typeof vi.spyOn>;

    const flushFrames = () => {
      act(() => {
        frames.splice(0, frames.length).forEach((frame) => frame(0));
      });
    };

    beforeEach(() => {
      frames = [];
      rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    });

    afterEach(() => {
      rafSpy.mockRestore();
    });

    const changeBrightness = (value: string) =>
      fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value } });
    const changeContrast = (value: string) =>
      fireEvent.change(screen.getByLabelText(/Contrast/), { target: { value } });

    it('exposes both sliders over the full -100..100 range with no step', () => {
      render(<Levels />);

      const brightness = screen.getByLabelText(/Brightness/) as HTMLInputElement;
      const contrast = screen.getByLabelText(/Contrast/) as HTMLInputElement;

      expect(brightness).toHaveAttribute('type', 'range');
      expect(brightness).toHaveAttribute('min', '-100');
      expect(brightness).toHaveAttribute('max', '100');
      expect(contrast).toHaveAttribute('min', '-100');
      expect(contrast).toHaveAttribute('max', '100');
    });

    it('publishes a contrast change as the exact layer preview and tool args payload', () => {
      render(<Levels />);

      changeContrast('-40');
      expect(mockTempUpdateLayer).not.toHaveBeenCalled();

      flushFrames();

      const expected = { toolName: 'levels', brightness: 50, contrast: -40 };
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expected);
      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({ id: 'layer-1', toolArgs: expected });
    });

    it('preserves the contrast value across a brightness change', () => {
      resetToolArgs({ brightness: 10, contrast: -25 });
      render(<Levels />);

      changeBrightness('20');
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ toolName: 'levels', brightness: 20, contrast: -25 });
    });

    it('accepts both range boundaries on both sliders', () => {
      render(<Levels />);

      changeBrightness('-100');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: -100, contrast: 50 });

      changeBrightness('100');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 100, contrast: 50 });

      // `toolArgs` is only republished through the mocked store, so a contrast change still
      // spreads the brightness the component last rendered with.
      changeContrast('-100');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 50, contrast: -100 });

      changeContrast('100');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 50, contrast: 100 });
      expect(mockSetToolArgs).toHaveBeenCalledTimes(4);
    });

    it('schedules a fresh frame once the previous one has been flushed', () => {
      render(<Levels />);

      changeBrightness('1');
      expect(frames).toHaveLength(1);
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

      changeBrightness('2');
      expect(frames).toHaveLength(1);
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 2, contrast: 50 });
      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(2);
    });

    it('drops a change made after the frame ran but before the state settled without publishing twice', () => {
      render(<Levels />);

      changeBrightness('30');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

      // The slider is still controlled by the unmoved `toolArgs`, so the second change is read
      // from the original args and both payloads carry the same contrast.
      changeBrightness('40');
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
      expect(mockSetToolArgs.mock.calls.map(([payload]) => payload)).toEqual([
        { toolName: 'levels', brightness: 30, contrast: 50 },
        { toolName: 'levels', brightness: 40, contrast: 50 },
      ]);
    });

    it('publishes both slider changes that land in the same animation frame', () => {
      render(<Levels />);

      changeBrightness('-15');
      changeContrast('80');
      flushFrames();

      const expected = { toolName: 'levels', brightness: -15, contrast: 80 };
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expected);
      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({ id: 'layer-1', toolArgs: expected });
    });

    it('skips publishing entirely when no layer is active (Levels.tsx:23)', () => {
      setActiveLayerId(null);
      render(<Levels />);

      changeContrast('15');
      flushFrames();

      expect(mockTempUpdateLayer).not.toHaveBeenCalled();
      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });

    it('re-arms a frame on the next change after discarding a change made with no active layer', () => {
      setActiveLayerId(null);
      const { rerender } = render(<Levels />);

      changeContrast('15');
      flushFrames();
      expect(mockTempUpdateLayer).not.toHaveBeenCalled();
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      setActiveLayerId('layer-1');
      rerender(<Levels />);
      changeContrast('15');
      expect(frames).toHaveLength(1);
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ toolName: 'levels', brightness: 50, contrast: 15 });
      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({
        id: 'layer-1',
        toolArgs: { toolName: 'levels', brightness: 50, contrast: 15 },
      });
    });
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
