import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Transform from '../Transform.tsx';

const toolArgs = {
  toolName: 'transform',
  rotate: 0,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 100,
  resizeY: 100,
};

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: vi.fn(),
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: vi.fn(),
  }),
}));

describe('Transform toolbar', () => {
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
});
