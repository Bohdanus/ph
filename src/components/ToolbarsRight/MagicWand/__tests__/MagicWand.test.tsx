import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MagicWand from '../MagicWand.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: null,
      canvasRef: { current: document.createElement('canvas') },
      selections: [],
    },
    dispatchMock,
  ],
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

describe('MagicWand toolbar', () => {
  beforeEach(() => {
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
});
