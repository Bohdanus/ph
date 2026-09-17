import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Draw from '../Draw.tsx';

const storeState = {
  color: '#000000',
  containerRef: { current: null },
  totalSize: { width: 800, height: 600 },
};

const toolArgs = {
  toolName: 'draw',
  penType: 'pen',
  lineWidth: 5,
  alpha: 1,
  color: '#000000',
  lineDash: null,
};

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: vi.fn(),
  }),
}));

vi.mock('../../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn(() => false),
    isPointerMoveValid: vi.fn(() => false),
    isPointerUpValid: vi.fn(() => false),
    getLocalCoords: vi.fn(() => ({ x: 0, y: 0 })),
    isMouseDown: { current: false },
  }),
}));

describe('Draw toolbar', () => {
  it('renders pen type selector and size slider', () => {
    render(<Draw />);

    expect(screen.getByLabelText('Pen Type')).toBeTruthy();
    expect(screen.getByLabelText(/Size/)).toBeTruthy();
    expect(screen.getByLabelText(/Opacity/)).toBeTruthy();
  });
});
