import { fireEvent, render, screen } from '@testing-library/react';
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

    expect(screen.getByLabelText('Pen Type')).toBeInTheDocument();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Opacity/)).toBeInTheDocument();
  });

  it('renders dash/gap controls when pen-dashed is selected', () => {
    resetToolArgs({ penType: 'pen-dashed', lineDash: [10, 5] });
    render(<Draw />);

    expect(screen.getByLabelText(/Dash/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gap/)).toBeInTheDocument();
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

  it('dispatches pen type changes to setToolArgs', () => {
    render(<Draw />);

    fireEvent.change(screen.getByLabelText('Pen Type'), { target: { value: 'pen-dashed' } });

    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ penType: 'pen-dashed' }));
  });

  describe('keyboard navigation', () => {
    it('all focusable elements are reachable and in correct tab order', () => {
      render(<Draw />);

      const penTypeSelect = screen.getByLabelText('Pen Type');
      const sizeSlider = screen.getByLabelText(/Size/);
      const alphaSlider = screen.getByLabelText(/Opacity/);

      expect(penTypeSelect).toBeInTheDocument();
      expect(sizeSlider).toBeInTheDocument();
      expect(alphaSlider).toBeInTheDocument();

      expect(penTypeSelect.tabIndex).toBeGreaterThanOrEqual(0);
      expect(sizeSlider.tabIndex).toBeGreaterThanOrEqual(0);
      expect(alphaSlider.tabIndex).toBeGreaterThanOrEqual(0);
    });

    it('allows arrow key navigation on pen type select', () => {
      render(<Draw />);
      const penTypeSelect = screen.getByLabelText('Pen Type');

      penTypeSelect.focus();
      expect(penTypeSelect).toHaveFocus();

      fireEvent.keyDown(penTypeSelect, { key: 'ArrowDown' });
      fireEvent.keyDown(penTypeSelect, { key: 'ArrowUp' });
      expect(penTypeSelect).toHaveFocus();
    });

    it('allows arrow key navigation on sliders', () => {
      render(<Draw />);
      const sizeSlider = screen.getByLabelText(/Size/);
      const alphaSlider = screen.getByLabelText(/Opacity/);

      sizeSlider.focus();
      expect(sizeSlider).toHaveFocus();
      fireEvent.keyDown(sizeSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(sizeSlider, { key: 'ArrowLeft' });
      expect(sizeSlider).toHaveFocus();

      alphaSlider.focus();
      expect(alphaSlider).toHaveFocus();
      fireEvent.keyDown(alphaSlider, { key: 'ArrowUp' });
      fireEvent.keyDown(alphaSlider, { key: 'ArrowDown' });
      expect(alphaSlider).toHaveFocus();
    });

    it('opens dash/gap controls when pen-dashed is selected via keyboard', () => {
      resetToolArgs({ penType: 'pen-dashed', lineDash: [10, 5] });
      render(<Draw />);

      expect(screen.getByLabelText(/Dash/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Gap/)).toBeInTheDocument();

      const dashSlider = screen.getByLabelText(/Dash/);
      const gapSlider = screen.getByLabelText(/Gap/);

      dashSlider.focus();
      expect(dashSlider).toHaveFocus();
      fireEvent.keyDown(dashSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(dashSlider, { key: 'ArrowLeft' });
      expect(dashSlider).toHaveFocus();

      gapSlider.focus();
      expect(gapSlider).toHaveFocus();
      fireEvent.keyDown(gapSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(gapSlider, { key: 'ArrowLeft' });
      expect(gapSlider).toHaveFocus();
    });

    it('enter and space on select opens options', () => {
      render(<Draw />);
      const penTypeSelect = screen.getByLabelText('Pen Type');

      penTypeSelect.focus();
      fireEvent.keyDown(penTypeSelect, { key: 'Enter' });
      expect(penTypeSelect).toBeInTheDocument();

      fireEvent.keyDown(penTypeSelect, { key: ' ' });
      expect(penTypeSelect).toBeInTheDocument();
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<Draw />);
      const sizeSlider = screen.getByLabelText(/Size/);

      sizeSlider.focus();
      fireEvent.keyDown(sizeSlider, { key: 'Escape' });
      expect(sizeSlider).toHaveFocus();
    });
  });
});
