import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Levels from '../Levels.tsx';

const toolArgs = vi.hoisted(() => ({
  toolName: 'levels',
  brightness: 50,
  contrast: 50,
}));

const activeLayerId = vi.hoisted(() => ({ current: 'layer-1' as string | null }));

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

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeLayerId: activeLayerId.current,
    },
  ],
}));

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'levels',
    brightness: 50,
    contrast: 50,
    ...overrides,
  });
}

function setActiveLayerId(id: string | null) {
  activeLayerId.current = id;
}

describe('Levels toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    mockTempUpdateLayer.mockClear();
    mockSetToolArgs.mockClear();
    setActiveLayerId('layer-1');
  });

  it('renders brightness and contrast sliders', () => {
    render(<Levels />);

    expect(screen.getByLabelText(/Brightness/)).toBeTruthy();
    expect(screen.getByLabelText(/Contrast/)).toBeTruthy();
  });

  it('renders UndoButton', () => {
    render(<Levels />);

    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });

  it('does not call tempUpdateLayer when activeLayerId is null', () => {
    setActiveLayerId(null);
    render(<Levels />);

    fireEvent.change(screen.getByLabelText(/Brightness/), { target: { value: '75' } });

    expect(mockTempUpdateLayer).not.toHaveBeenCalled();
  });

  it('brightness slider reflects current value', () => {
    resetToolArgs({ brightness: -30 });
    render(<Levels />);

    const slider = screen.getByLabelText(/Brightness/) as HTMLInputElement;
    expect(slider.value).toBe('-30');
  });

  it('contrast slider reflects current value', () => {
    resetToolArgs({ contrast: 80 });
    render(<Levels />);

    const slider = screen.getByLabelText(/Contrast/) as HTMLInputElement;
    expect(slider.value).toBe('80');
  });
});
