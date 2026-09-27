import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Blur from '../Blur.tsx';

const toolArgs = vi.hoisted(() => ({ radius: 4, toolName: 'blur' as const }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockResetToLastSavedArgs = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());

const historyState = vi.hoisted(() => ({ canUndo: false, isToolDirty: false }));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{}],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
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

const getRadiusSlider = () => screen.getByRole('slider', { name: /Blur Radius/ }) as HTMLInputElement;

const changeRadius = (value: string) => {
  fireEvent.change(getRadiusSlider(), { target: { value } });
};

describe('Blur toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { radius: 4, toolName: 'blur' as const });
    Object.assign(historyState, { canUndo: false, isToolDirty: false });
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
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

  it('disables the undo button with no history and no dirty tool', () => {
    render(<Blur />);

    expect(screen.getByRole('button', { name: 'Undo Blur' })).toBeDisabled();
  });

  it('resets to the last saved args from the undo button when the tool is dirty', () => {
    historyState.isToolDirty = true;
    render(<Blur />);

    const undoButton = screen.getByRole('button', { name: 'Undo Blur' });
    expect(undoButton).toBeEnabled();

    fireEvent.click(undoButton);

    expect(mockResetToLastSavedArgs).toHaveBeenCalledTimes(1);
    expect(mockUndo).not.toHaveBeenCalled();
  });

  it('undoes the last history entry from the undo button when the tool is clean', () => {
    historyState.canUndo = true;
    render(<Blur />);

    const undoButton = screen.getByRole('button', { name: 'Undo Blur' });
    expect(undoButton).toBeEnabled();

    fireEvent.click(undoButton);

    expect(mockUndo).toHaveBeenCalledTimes(1);
    expect(mockResetToLastSavedArgs).not.toHaveBeenCalled();
  });
});
