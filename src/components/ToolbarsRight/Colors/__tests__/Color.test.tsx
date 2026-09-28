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
const mockMergeAllLayers = vi.hoisted(() => vi.fn());
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

const historyState = vi.hoisted(() => ({ canUndo: false, isToolDirty: false }));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{}],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
    mergeAllLayers: mockMergeAllLayers,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
    isToolDirty: historyState.isToolDirty,
    resetToLastSavedArgs: mockResetToLastSavedArgs,
  }),
}));

vi.mock('../../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({
    canUndo: () => historyState.canUndo,
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

describe('Color toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { grayscale: 0, sepia: 0, saturation: 100, toolName: 'color' as const });
    Object.assign(historyState, { canUndo: false, isToolDirty: false });
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
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

  it('resets the tool args from the default Reset button when the tool is dirty', () => {
    historyState.isToolDirty = true;
    render(<Color />);

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    expect(resetButton).toBeEnabled();

    fireEvent.click(resetButton);

    expect(mockResetToLastSavedArgs).toHaveBeenCalledTimes(1);
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('undoes history from the default Reset button when the tool is clean', () => {
    historyState.canUndo = true;
    render(<Color />);

    const resetButton = screen.getByRole('button', { name: 'Reset' });
    expect(resetButton).toBeEnabled();

    fireEvent.click(resetButton);

    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
  });
});
