import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Transform from '../Transform.tsx';

const toolArgs = vi.hoisted(() => ({
  toolName: 'transform',
  rotate: 0,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 100,
  resizeY: 100,
}));

const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...overrides,
  });
}

describe('Transform toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    mockTempUpdateLayer.mockClear();
    mockSetToolArgs.mockClear();
  });

  it('renders rotate buttons and sliders', () => {
    render(<Transform />);

    expect(screen.getByTitle('Rotate 90° Left')).toBeTruthy();
    expect(screen.getByTitle('Rotate 180°')).toBeTruthy();
    expect(screen.getByTitle('Rotate 90° Right')).toBeTruthy();
    expect(screen.getByText('Skew X')).toBeTruthy();
    expect(screen.getByText('Skew Y')).toBeTruthy();
    expect(screen.getByText('Trapezoid')).toBeTruthy();
    expect(screen.getByText('Resize X')).toBeTruthy();
    expect(screen.getByText('Resize Y')).toBeTruthy();
  });

  it('has mirror toggle buttons', () => {
    render(<Transform />);

    expect(screen.getByTitle('Mirror Horizontal')).toBeTruthy();
    expect(screen.getByTitle('Mirror Vertical')).toBeTruthy();
  });

  it('has Reset All button', () => {
    render(<Transform />);

    expect(screen.getByText('Reset All')).toBeTruthy();
  });

  it('rotate buttons are clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByTitle('Rotate 90° Left'));
    fireEvent.click(screen.getByTitle('Rotate 180°'));
    fireEvent.click(screen.getByTitle('Rotate 90° Right'));
  });

  it('mirror buttons are clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByTitle('Mirror Horizontal'));
    fireEvent.click(screen.getByTitle('Mirror Vertical'));
  });

  it('Reset All button is clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByText('Reset All'));
  });
});
