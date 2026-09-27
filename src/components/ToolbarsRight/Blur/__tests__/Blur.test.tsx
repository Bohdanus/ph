import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Blur from '../Blur.tsx';

const toolArgs = vi.hoisted(() => ({ radius: 4, toolName: 'blur' as const }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

const toolState = vi.hoisted(() => ({ isToolDirty: false }));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{}],
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
    isToolDirty: toolState.isToolDirty,
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

const getRadiusSlider = () => screen.getByRole('slider', { name: /Blur Radius/ }) as HTMLInputElement;

const changeRadius = (value: string) => {
  fireEvent.change(getRadiusSlider(), { target: { value } });
};

describe('Blur toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { radius: 4, toolName: 'blur' as const });
    toolState.isToolDirty = false;
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
    mockCancelLayerPreview.mockClear();
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

    // Throttled: nothing reaches the store before the animation frame runs.
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

  it('offers the discard regardless of history, because discarding is not a history operation', () => {
    render(<Blur />);

    expect(screen.getByRole('button', { name: 'Undo Blur' })).toBeEnabled();
  });

  it.each([false, true])(
    'clears the preview and writes the default radius without touching history (isToolDirty=%s)',
    (isToolDirty) => {
      toolState.isToolDirty = isToolDirty;
      Object.assign(toolArgs, { radius: 37, toolName: 'blur' as const });
      render(<Blur />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo Blur' }));

      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      // The baseline is `defaultSettings.blur`, not the value the user just dragged to.
      // A `resetToLastSavedArgs` reset would publish 37 here and leave the slider lying.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ radius: 0, toolName: 'blur' });
      expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
      expect(mockUndo).not.toHaveBeenCalled();
    }
  );

  it('drops a slider change still queued on the animation frame when the discard is clicked', () => {
    render(<Blur />);

    changeRadius('17');
    expect(rafCallbacks).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Undo Blur' }));
    flushRaf();

    // Only the discard reaches the store: the stale frame must not re-apply the radius.
    expect(mockTempUpdateLayer).not.toHaveBeenCalled();
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ radius: 0, toolName: 'blur' });
  });
});
