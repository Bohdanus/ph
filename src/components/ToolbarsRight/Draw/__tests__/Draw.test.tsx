import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Draw from '../Draw.tsx';

const storeState = vi.hoisted(() => ({
  color: '#000000',
  containerRef: { current: null },
  totalSize: { width: 800, height: 600 },
}));

const toolArgs = vi.hoisted(() => ({
  toolName: 'draw',
  penType: 'pen' as 'pen' | 'pen-dashed' | 'spray',
  lineWidth: 5,
  alpha: 1,
  color: '#000000',
  lineDash: null as number[] | null,
}));

const mockSetToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
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

function resetState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    color: '#000000',
    containerRef: { current: null },
    totalSize: { width: 800, height: 600 },
    ...overrides,
  });
}

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'draw',
    penType: 'pen' as 'pen' | 'pen-dashed' | 'spray',
    lineWidth: 5,
    alpha: 1,
    color: '#000000',
    lineDash: null,
    ...overrides,
  });
}

describe('Draw toolbar', () => {
  beforeEach(() => {
    resetState();
    resetToolArgs();
    mockSetToolArgs.mockClear();
  });

  it('renders pen type selector and size slider', () => {
    render(<Draw />);

    expect(screen.getByLabelText('Pen Type')).toBeTruthy();
    expect(screen.getByLabelText(/Size/)).toBeTruthy();
    expect(screen.getByLabelText(/Opacity/)).toBeTruthy();
  });

  it('renders dash/gap controls when pen-dashed is selected', () => {
    resetToolArgs({ penType: 'pen-dashed', lineDash: [10, 5] });
    render(<Draw />);

    expect(screen.getByLabelText(/Dash/)).toBeTruthy();
    expect(screen.getByLabelText(/Gap/)).toBeTruthy();
  });

  it('does not render dash/gap controls when pen is selected', () => {
    resetToolArgs({ penType: 'pen' });
    render(<Draw />);

    expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Gap/)).not.toBeInTheDocument();
  });

  it('does not render dash/gap controls when spray is selected', () => {
    resetToolArgs({ penType: 'spray' });
    render(<Draw />);

    expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Gap/)).not.toBeInTheDocument();
  });
});
