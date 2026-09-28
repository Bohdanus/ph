import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Color from '../Color.tsx';

const toolArgs = vi.hoisted(() => ({
  grayscale: 0,
  sepia: 0,
  saturation: 100,
  toolName: 'color' as const,
}));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockMergeAllLayers = vi.hoisted(() => vi.fn());
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

// The discard is gated on a live preview for the active layer, so the store's
// preview map has to be part of the mock. `commitDirtyTool` clears this map and
// bakes the adjustment into the layer plus a `TOOL_ACTION` entry; the map is only
// non-empty while an adjustment is still uncommitted.
const store = vi.hoisted(() => ({
  activeLayerId: 'layer-1' as string | null,
  previewLayers: { current: {} as Record<string, unknown> },
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ activeLayerId: store.activeLayerId, previewLayers: store.previewLayers }],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
    cancelLayerPreview: mockCancelLayerPreview,
    mergeAllLayers: mockMergeAllLayers,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
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

const rafCallbacks: FrameRequestCallback[] = [];

const flushRaf = () => {
  act(() => {
    const queued = rafCallbacks.splice(0, rafCallbacks.length);
    queued.forEach((callback) => callback(0));
  });
};

const getSlider = (name: RegExp) => screen.getByRole('slider', { name }) as HTMLInputElement;

const changeSlider = (name: RegExp, value: string) => {
  fireEvent.change(getSlider(name), { target: { value } });
};

/** Stand in for a preview `tempUpdateLayer` has published and nothing has committed yet. */
const seedLivePreview = (layerId: string | null = store.activeLayerId) => {
  store.previewLayers.current = layerId ? { [layerId]: { layer: {} } } : {};
};

const getResetButton = () => screen.getByRole('button', { name: 'Reset' });

describe('Color toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { grayscale: 0, sepia: 0, saturation: 100, toolName: 'color' as const });
    store.activeLayerId = 'layer-1';
    store.previewLayers.current = {};
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
    mockCancelLayerPreview.mockClear();
    mockMergeAllLayers.mockClear();
    mockResetToLastSavedArgs.mockClear();
    mockUndo.mockClear();
    rafCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders three independent percentage sliders bound to the current tool args', () => {
    render(<Color />);

    const grayscale = getSlider(/Grayscale/);
    const sepia = getSlider(/Sepia/);
    const saturation = getSlider(/Saturation/);

    expect(grayscale).toHaveAttribute('type', 'range');
    expect(grayscale).toHaveAttribute('min', '0');
    expect(grayscale).toHaveAttribute('max', '100');
    expect(grayscale).toHaveValue('0');

    expect(sepia).toHaveValue('0');
    expect(saturation).toHaveValue('100');

    // Saturation is bipolar because the filter contract maps a signed percentage onto a
    // CSS amount: -100% has to be reachable, or the slider could never desaturate.
    expect(saturation).toHaveAttribute('type', 'range');
    expect(saturation).toHaveAttribute('min', '-100');
    expect(saturation).toHaveAttribute('max', '100');

    // Grayscale and Sepia are both 0, so the "0%" readout appears twice.
    expect(screen.getAllByText('0%')).toHaveLength(2);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('publishes a negative saturation, so the desaturate end of the slider is reachable', () => {
    render(<Color />);

    changeSlider(/Saturation/, '-100');
    flushRaf();

    expect(mockSetToolArgs).toHaveBeenCalledWith({
      grayscale: 0,
      sepia: 0,
      saturation: -100,
      toolName: 'color',
    });
  });

  it('commits only the changed field and preserves the other two tool args', () => {
    render(<Color />);

    changeSlider(/Grayscale/, '40');
    flushRaf();

    expect(mockSetToolArgs).toHaveBeenCalledWith({
      grayscale: 40,
      sepia: 0,
      saturation: 100,
      toolName: 'color',
    });
    expect(mockTempUpdateLayer).toHaveBeenCalledWith({
      toolArgs: { grayscale: 40, sepia: 0, saturation: 100, toolName: 'color' },
    });
  });

  it('commits sepia without dropping the current grayscale value', () => {
    Object.assign(toolArgs, { grayscale: 25, sepia: 0, saturation: 100 });
    render(<Color />);

    changeSlider(/Sepia/, '80');
    flushRaf();

    expect(mockSetToolArgs).toHaveBeenCalledWith({
      grayscale: 25,
      sepia: 80,
      saturation: 100,
      toolName: 'color',
    });
  });

  it('commits saturation without dropping the current grayscale and sepia values', () => {
    Object.assign(toolArgs, { grayscale: 10, sepia: 20, saturation: 100 });
    render(<Color />);

    changeSlider(/Saturation/, '0');
    flushRaf();

    expect(mockSetToolArgs).toHaveBeenCalledWith({
      grayscale: 10,
      sepia: 20,
      saturation: 0,
      toolName: 'color',
    });
  });

  it('coalesces a burst of changes across different sliders into one frame', () => {
    render(<Color />);

    changeSlider(/Grayscale/, '10');
    changeSlider(/Sepia/, '20');
    changeSlider(/Saturation/, '30');

    expect(rafCallbacks).toHaveLength(1);

    flushRaf();

    // Only the last pending payload is published. Each handler spreads the args captured by
    // its own render closure, so edits made within the same animation frame are lost: this
    // documents the current lost-update behaviour (see FINDINGS) rather than a merge.
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledWith({
      grayscale: 0,
      sepia: 0,
      saturation: 30,
      toolName: 'color',
    });
  });

  it('drops the earlier in-frame edit when two different sliders move before the frame runs', () => {
    render(<Color />);

    changeSlider(/Grayscale/, '10');
    changeSlider(/Sepia/, '20');
    flushRaf();

    // The grayscale edit never reaches the store: the pending payload was replaced wholesale.
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledWith(
      expect.objectContaining({ grayscale: 0, sepia: 20, toolName: 'color' })
    );
  });

  it('accepts the range boundaries for every slider', () => {
    render(<Color />);

    changeSlider(/Grayscale/, '100');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ grayscale: 100, toolName: 'color' }));

    changeSlider(/Sepia/, '0');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ sepia: 0, toolName: 'color' }));

    changeSlider(/Saturation/, '100');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ saturation: 100, toolName: 'color' }));
  });

  it('merges every layer from the merge button', () => {
    render(<Color />);

    fireEvent.click(screen.getByRole('button', { name: 'Merge all' }));

    expect(mockMergeAllLayers).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).not.toHaveBeenCalled();
  });

  it('ignores a second merge click while the first merge is still pending', async () => {
    let releaseMerge: (() => void) | undefined;
    mockMergeAllLayers.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseMerge = () => resolve(null);
      })
    );
    render(<Color />);

    const mergeButton = screen.getByRole('button', { name: 'Merge all' });
    fireEvent.click(mergeButton);
    fireEvent.click(mergeButton);

    // Every `mergeAllLayers` call commits the dirty tool and appends its own history
    // entry, so the overlap is the defect — not a cosmetic double click.
    expect(mockMergeAllLayers).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseMerge?.();
    });
  });

  it('reports a failed merge instead of leaking an unhandled rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockMergeAllLayers.mockRejectedValueOnce(new Error('merge failed'));

    try {
      render(<Color />);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Merge all' }));
      });

      expect(errorSpy).toHaveBeenCalledWith('Failed to merge all layers', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('offers the Reset discard only while a live preview exists, because that preview is the only thing it can remove', () => {
    // The panel reads exactly one thing to arm the button: the store's preview map
    // for the active layer. History state is fixed here (`canUndo()` is `true`),
    // so nothing else this render can see is what the gate turns on.
    seedLivePreview();
    render(<Color />);

    expect(getResetButton()).toBeEnabled();
  });

  it('leaves Reset disabled once the adjustment is committed, rather than claiming a reset it cannot perform', () => {
    // `commitDirtyTool` runs on tool switch, on export and in this panel's own
    // "Merge all": it empties the preview map and bakes the adjustment into a real
    // layer plus a `TOOL_ACTION` entry. The panel can no longer cancel what is not
    // a preview.
    Object.assign(toolArgs, { grayscale: 60, sepia: 20, saturation: 40, toolName: 'color' as const });
    render(<Color />);

    const button = getResetButton();
    expect(button).toBeDisabled();

    fireEvent.click(button);

    // The lie this pins: an always-enabled button reset all three sliders to 0 here
    // while the canvas kept the committed adjustment.
    expect(mockCancelLayerPreview).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it.each([
    ['there is no active layer', null],
    ['the active layer has no preview of its own', 'layer-2'],
  ])('leaves Reset disabled when %s, so a preview on another layer cannot arm it', (_case, activeLayerId) => {
    // `cancelLayerPreview()` only ever cancels the active layer's entry, so a preview
    // belonging to any other layer leaves the click with nothing to remove.
    store.activeLayerId = activeLayerId;
    seedLivePreview('layer-1');
    render(<Color />);

    expect(getResetButton()).toBeDisabled();
  });

  it('clears the preview and writes the default colour args without touching history', () => {
    Object.assign(toolArgs, { grayscale: 60, sepia: 20, saturation: 40, toolName: 'color' as const });
    seedLivePreview();
    render(<Color />);

    fireEvent.click(getResetButton());

    expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
    // The baseline is `defaultSettings.color`, not the value the user just dragged to.
    // A `resetToLastSavedArgs` reset would publish those three values here.
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
      grayscale: 0,
      sepia: 0,
      saturation: 0,
      toolName: 'color',
    });
    expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
    // The click removes an uncommitted preview. A committed adjustment is a
    // document operation, and `undo()` — which the panel does not call — is the
    // route out of one, so a fall-through to document-level undo stays pinned here.
    expect(mockUndo).not.toHaveBeenCalled();
  });
});
