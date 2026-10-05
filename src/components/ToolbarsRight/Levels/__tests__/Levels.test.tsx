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

// The discard is gated on a live preview for the active layer. `commitDirtyTool`
// empties this map and bakes the adjustment into the layer plus a `TOOL_ACTION`
// entry, so it is only non-empty while an adjustment is still uncommitted.
const previewLayers = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
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
      previewLayers,
    },
  ],
}));

/** Stand in for a preview `tempUpdateLayer` has published and nothing has committed yet. */
function seedLivePreview(layerId: string | null = activeLayerId.current) {
  previewLayers.current = layerId ? { [layerId]: { layer: {} } } : {};
}

const getResetButton = () => screen.getByRole('button', { name: 'Reset' });

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
    mockUndo.mockClear();
    setActiveLayerId('layer-1');
    previewLayers.current = {};
  });

  it('renders brightness and contrast sliders', () => {
    render(<Levels />);

    expect(screen.getByLabelText(/Brightness/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contrast/)).toBeInTheDocument();
  });

  it('offers the panel-local discard only while a live preview exists, because that preview is the only thing it can remove', () => {
    // The panel reads exactly one thing to arm the button: the store's preview map
    // for the active layer. History state is fixed here (`canUndo()` is `true`),
    // so nothing else this render can see is what the gate turns on.
    seedLivePreview();
    render(<Levels />);

    expect(getResetButton()).toBeEnabled();
  });

  it('clears the preview and writes the default levels args without touching history', () => {
    resetToolArgs({ brightness: 70, contrast: -20 });
    seedLivePreview();
    render(<Levels />);

    fireEvent.click(getResetButton());

    expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
    // The baseline is `defaultSettings.levels`, not the value the user just dragged to.
    // A baseline read from the stored settings would publish 70/-20 here: the slider
    // write overwrites that copy on the same tick.
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
      toolName: 'levels',
      brightness: 0,
      contrast: 0,
    });
    // The click removes an uncommitted preview. A committed adjustment is a
    // document operation, and `undo()` — which the panel does not call — is the
    // route out of one, so a fall-through to document-level undo stays pinned here.
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('leaves the discard disabled once the adjustment is committed, rather than claiming a reset it cannot perform', () => {
    // `commitDirtyTool` runs on tool switch, on export and in `mergeAllLayers`: it
    // empties the preview map and bakes the adjustment into a real layer plus a
    // `TOOL_ACTION` entry. The panel can no longer cancel what is not a preview.
    resetToolArgs({ brightness: 70, contrast: -20 });
    render(<Levels />);

    const button = getResetButton();
    expect(button).toBeDisabled();

    fireEvent.click(button);

    // The lie this pins: an always-enabled button reset both sliders to 0 here while
    // the canvas kept the committed adjustment.
    expect(mockCancelLayerPreview).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it.each([
    ['there is no active layer', null],
    ['the active layer has no preview of its own', 'layer-2'],
  ])(
    'leaves the discard disabled when %s, so a preview on another layer cannot arm it',
    (_case, activeLayerIdValue) => {
      // `cancelLayerPreview()` only ever cancels the active layer's entry, so a preview
      // belonging to any other layer leaves the click with nothing to remove.
      setActiveLayerId(activeLayerIdValue);
      seedLivePreview('layer-1');
      render(<Levels />);

      expect(getResetButton()).toBeDisabled();
    }
  );

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

    it('exposes both sliders over Adobe\u2019s documented travels with no step', () => {
      render(<Levels />);

      const brightness = screen.getByLabelText(/Brightness/) as HTMLInputElement;
      const contrast = screen.getByLabelText(/Contrast/) as HTMLInputElement;

      expect(brightness).toHaveAttribute('type', 'range');
      // Adobe: "Values can range from ‑150 to +150 for Brightness, ‑50 to +100 for Contrast."
      // The attributes are read off the panel rather than off the module, because the panel
      // deriving them from `BRIGHTNESS_SLIDER_RANGE` is the claim — a hard-coded `-100..100`
      // here would leave the curve and the slider describing different travels.
      expect(brightness).toHaveAttribute('min', '-150');
      expect(brightness).toHaveAttribute('max', '150');
      expect(contrast).toHaveAttribute('min', '-50');
      expect(contrast).toHaveAttribute('max', '100');
      // Asymmetric on purpose: these are not the same control at two sign conventions, and a
      // symmetric Contrast range is the mistake this asserts against.
      expect(brightness.getAttribute('min')).not.toBe(contrast.getAttribute('min'));
      expect(brightness.getAttribute('max')).not.toBe(contrast.getAttribute('max'));
      // The "no step" half of this test's name, which used to be claimed and never asserted.
      // A default `step="1"` would still leave every other assertion in this file green, because
      // none of them changes a slider to an off-integer — but `Levels.tsx` carries no `step` at
      // all, and the levels grid is dragged continuously, so a step would make every fraction of
      // a stop between the two ends unreachable. `not.toHaveAttribute` rather than an exact
      // `step` string because an explicit `step="1"` is the same pixel grid as the HTML default
      // and must not be mistaken for a defect.
      expect(brightness).not.toHaveAttribute('step');
      expect(contrast).not.toHaveAttribute('step');
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

      // Each slider's own endpoints, and they differ: Brightness reaches ‑150 and +150 while
      // Contrast reaches ‑50 and +100, so a test that published one pair to both sliders
      // would be asserting a range neither control has.
      changeBrightness('-150');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: -150, contrast: 50 });

      changeBrightness('150');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 150, contrast: 50 });

      // `toolArgs` is only republished through the mocked store, so a contrast change still
      // spreads the brightness the component last rendered with.
      changeContrast('-50');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 50, contrast: -50 });

      changeContrast('100');
      flushFrames();
      expect(mockSetToolArgs).toHaveBeenLastCalledWith({ toolName: 'levels', brightness: 50, contrast: 100 });
      expect(mockSetToolArgs).toHaveBeenCalledTimes(4);
    });

    it('clamps a value outside a slider\u2019s travel to that slider\u2019s own bound', () => {
      // The browser owns this: a `range` input cannot hold a value outside its `min`/`max`, so
      // `-100` on Contrast (reachable under the previous ‑100..100 travel) lands on ‑50 rather
      // than publishing a number the panel could not show. Without it the thumb pins at its
      // minimum while the label above it reads the raw value.
      render(<Levels />);

      changeContrast('-100');
      flushFrames();

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ toolName: 'levels', brightness: 50, contrast: -50 });
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

    it('skips publishing entirely when no layer is active (Levels.tsx — `throttledOnChange`', () => {
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
      seedLivePreview();
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
      seedLivePreview();
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
      seedLivePreview();
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
      seedLivePreview();
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
