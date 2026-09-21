import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
