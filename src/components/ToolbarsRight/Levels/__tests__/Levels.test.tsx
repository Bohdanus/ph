import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Levels from '../Levels.tsx';

const toolArgs = {
  toolName: 'levels',
  brightness: 50,
  contrast: 50,
};

const activeLayerId = 'layer-1';

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

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeLayerId,
    },
  ],
}));

describe('Levels toolbar', () => {
  it('renders brightness and contrast sliders', () => {
    render(<Levels />);

    expect(screen.getByLabelText(/Brightness/)).toBeTruthy();
    expect(screen.getByLabelText(/Contrast/)).toBeTruthy();
  });

  it('renders UndoButton', () => {
    render(<Levels />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });
});
