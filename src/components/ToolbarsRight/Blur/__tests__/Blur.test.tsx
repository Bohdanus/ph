import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Blur from '../Blur.tsx';

const toolArgs = vi.hoisted(() => ({ radius: 4, toolName: 'blur' as const }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

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
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

vi.mock('../../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({
    canUndo: () => true,
    undo: mockUndo,
  }),
}));

const rafCallbacks: FrameRequestCallback[] = [];
const rafIds: number[] = [];

const flushRaf = () => {
  act(() => {
    const queued = rafCallbacks.splice(0, rafCallbacks.length);
    queued.forEach((callback) => callback(0));
  });
};

const getRadiusSlider = () => screen.getByRole('slider', { name: /Blur Radius/ }) as HTMLInputElement;

const changeRadius = (value: string) => {
  fireEvent.change(getRadiusSlider(), { target: { value } });
};

const seedLivePreview = (layerId: string | null = store.activeLayerId) => {
  store.previewLayers.current = layerId ? { [layerId]: { layer: {} } } : {};
};

const getDiscardButton = () => screen.getByRole('button', { name: 'Undo Blur' });

describe('Blur toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { radius: 4, toolName: 'blur' as const });
    store.activeLayerId = 'layer-1';
    store.previewLayers.current = {};
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
    mockCancelLayerPreview.mockClear();
    mockUndo.mockClear();
    rafCallbacks.length = 0;
    rafIds.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      rafIds.push(rafIds.length + 1);
      return rafIds.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const index = rafIds.indexOf(id);
      if (index !== -1) {
        rafIds.splice(index, 1);
        rafCallbacks.splice(index, 1);
      }
    });
    // Make cancelLayerPreview actually clear the preview
    mockCancelLayerPreview.mockImplementation(() => {
      if (store.activeLayerId) {
        delete store.previewLayers.current[store.activeLayerId];
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the radius slider with the toolArgs range and current value', () => {
    render(<Blur />);

    const slider = getRadiusSlider();
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveValue('4');
    expect(screen.getByText('4px')).toBeInTheDocument();
  });

  it('publishes the radius delta to both the layer preview and the tool args on the next frame', () => {
    render(<Blur />);

    changeRadius('17');

    expect(mockTempUpdateLayer).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();

    flushRaf();

    expect(mockTempUpdateLayer).toHaveBeenCalledWith({ toolArgs: { radius: 17, toolName: 'blur' } });
    expect(mockSetToolArgs).toHaveBeenCalledWith({ radius: 17, toolName: 'blur' });
  });

  it('coalesces a burst of slider changes into a single store update carrying the last value', () => {
    render(<Blur />);

    changeRadius('5');
    changeRadius('6');
    changeRadius('7');

    expect(rafCallbacks).toHaveLength(1);

    flushRaf();

    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledWith({ radius: 7, toolName: 'blur' });
    expect(mockTempUpdateLayer).toHaveBeenCalledTimes(1);
  });

  it('accepts the range boundaries and converts them to numbers', () => {
    render(<Blur />);

    changeRadius('0');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({ radius: 0, toolName: 'blur' });

    changeRadius('100');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({ radius: 100, toolName: 'blur' });
  });

  it('schedules a new frame after the previous one has been flushed', () => {
    render(<Blur />);

    changeRadius('9');
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

    changeRadius('10');
    expect(rafCallbacks).toHaveLength(1);
    flushRaf();
    expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({ radius: 10, toolName: 'blur' });
  });

  it('offers the discard only while a live preview exists', () => {
    seedLivePreview();
    render(<Blur />);
    expect(getDiscardButton()).toBeEnabled();
  });

  it('leaves the discard disabled once the adjustment is committed', () => {
    Object.assign(toolArgs, { radius: 20, toolName: 'blur' as const });
    render(<Blur />);

    const button = getDiscardButton();
    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(mockCancelLayerPreview).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it.each([
    ['there is no active layer', null],
    ['the active layer has no preview of its own', 'layer-2'],
  ])('leaves the discard disabled when %s', (_case, activeLayerId) => {
    store.activeLayerId = activeLayerId;
    seedLivePreview('layer-1');
    render(<Blur />);

    expect(getDiscardButton()).toBeDisabled();
  });

  it('clears the preview and writes the default radius without touching history', () => {
    Object.assign(toolArgs, { radius: 37, toolName: 'blur' as const });
    seedLivePreview();
    render(<Blur />);

    fireEvent.click(getDiscardButton());

    expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ radius: 0, toolName: 'blur' });
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('drops a slider change still queued on the animation frame when the discard is clicked', () => {
    seedLivePreview();
    render(<Blur />);

    changeRadius('17');
    expect(rafCallbacks).toHaveLength(1);

    fireEvent.click(getDiscardButton());
    flushRaf();

    expect(mockTempUpdateLayer).not.toHaveBeenCalled();
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ radius: 0, toolName: 'blur' });
  });

  // === NEW TESTS FOR MISSING COVERAGE ===

  it('re-reads preview map on render after state updates', () => {
    const { rerender } = render(<Blur />);
    expect(getDiscardButton()).toBeDisabled();

    seedLivePreview();
    rerender(<Blur />);
    expect(getDiscardButton()).toBeEnabled();

    store.previewLayers.current = {};
    rerender(<Blur />);
    expect(getDiscardButton()).toBeDisabled();
  });

  it('handles discard clicks - preview cleared after first click', () => {
    seedLivePreview();
    const { rerender } = render(<Blur />);

    fireEvent.click(getDiscardButton());
    expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

    // Re-render to reflect cleared preview
    rerender(<Blur />);

    // Second click should be disabled
    expect(getDiscardButton()).toBeDisabled();
    fireEvent.click(getDiscardButton());
    expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
  });

  it('does not call cancelLayerPreview when discard is clicked but no preview exists', () => {
    render(<Blur />);

    fireEvent.click(getDiscardButton());

    expect(mockCancelLayerPreview).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();
  });

  it('handles tool args change without re-render', () => {
    seedLivePreview();
    const { rerender } = render(<Blur />);

    Object.assign(toolArgs, { radius: 50 });
    rerender(<Blur />);

    expect(getDiscardButton()).toBeEnabled();
    expect(getRadiusSlider()).toHaveValue('50');
  });

  it('handles active layer change correctly', () => {
    seedLivePreview();
    const { rerender } = render(<Blur />);
    expect(getDiscardButton()).toBeEnabled();

    store.activeLayerId = 'layer-2';
    store.previewLayers.current = { 'layer-1': { layer: {} } };
    rerender(<Blur />);

    expect(getDiscardButton()).toBeDisabled();
  });
});
