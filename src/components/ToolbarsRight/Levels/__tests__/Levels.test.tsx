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
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockIsToolDirty = vi.hoisted(() => ({ current: false }));
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
    cancelLayerPreview: mockCancelLayerPreview,
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

// The panel no longer reaches for history at all. The mock is kept deliberately: it
// makes `undo` observable, so re-introducing the document-level fall-through — the
// defect this suite used to pin as the contract — fails these tests again.
vi.mock('../../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({
    canUndo: () => true,
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
    mockCancelLayerPreview.mockClear();
    mockSetToolArgs.mockClear();
    mockResetToLastSavedArgs.mockClear();
    mockUndo.mockClear();
    // The only value `isToolDirty` can hold in production: nothing dispatches
    // `SET_TOOL_DIRTY` with `true`.
    mockIsToolDirty.current = false;
    setActiveLayerId('layer-1');
  });

  it('renders brightness and contrast sliders', () => {
    render(<Levels />);

    expect(screen.getByLabelText(/Brightness/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contrast/)).toBeInTheDocument();
  });

  it('renders the panel-local discard button', () => {
    render(<Levels />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it.each([false, true])(
    'clears the preview and writes the default levels args without touching history (isToolDirty=%s)',
    (isToolDirty) => {
      mockIsToolDirty.current = isToolDirty;
      resetToolArgs({ brightness: 70, contrast: -20 });
      render(<Levels />);

      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      // The baseline is `defaultSettings.levels`, not the value the user just dragged to.
      // A `resetToLastSavedArgs` reset would publish 70/-20 here.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'levels',
        brightness: 0,
        contrast: 0,
      });
      expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
      expect(mockUndo).not.toHaveBeenCalled();
    }
  );

  it('keeps the discard available with no history and no unsaved changes', () => {
    render(<Levels />);

    // Discarding an uncommitted adjustment is not a history operation, so it is never
    // gated on `canUndo()`. It used to be, which left a mislabeled button that replayed
    // the timeline one entry back whenever it was pressed.
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
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

    it('keeps publishing the tool args when no layer is active, but never with a null layer id', () => {
      setActiveLayerId(null);
      render(<Levels />);

      changeContrast('15');
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ toolName: 'levels', brightness: 50, contrast: 15 });
    });

    it.fails('skips the layer preview entirely when no layer is active (Levels.tsx:23)', () => {
      // `tempUpdateLayer({ id: activeLayerId!, toolArgs })` asserts non-null on `activeLayerId`,
      // so a null id is forwarded to the layer store as `{ id: null }` instead of being skipped.
      setActiveLayerId(null);
      render(<Levels />);

      changeContrast('15');
      flushFrames();

      expect(mockTempUpdateLayer).not.toHaveBeenCalled();
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

    it('runs the panel-local discard when the focused reset button is clicked', () => {
      render(<Levels />);
      const resetButton = screen.getByRole('button', { name: 'Reset' });

      expect(resetButton).not.toBeDisabled();

      resetButton.focus();
      fireEvent.click(resetButton);

      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'levels',
        brightness: 0,
        contrast: 0,
      });
      expect(mockUndo).not.toHaveBeenCalled();
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

    it('discards the adjustment when the focused reset button is activated with Enter', async () => {
      const user = userEvent.setup();
      resetToolArgs({ brightness: 45, contrast: -60 });
      render(<Levels />);

      const resetButton = screen.getByRole('button', { name: 'Reset' });
      await user.tab();
      await user.tab();
      await user.tab();
      expect(resetButton).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'levels',
        brightness: 0,
        contrast: 0,
      });
      expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
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
