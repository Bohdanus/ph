import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Shape from '../Shape.tsx';

const containerRef = { current: null as HTMLDivElement | null };
const storeState = {
  containerRef,
  color: '#000000',
  backgroundColor: '#ffffff',
  totalSize: { width: 800, height: 600 },
};

const baseToolArgs = {
  toolName: 'shape' as const,
  figure: 'rectangle' as 'rectangle' | 'oval' | 'circle' | 'square' | 'line',
  alpha: 1,
  color: '#000000',
  backgroundColor: '#ffffff',
  hasFill: false,
  lineWidth: 5,
  lineDash: null,
};

const setToolArgsMock = vi.fn();

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => {
    const [toolArgs, setToolArgs] = useState<typeof baseToolArgs>({ ...baseToolArgs });
    return {
      toolArgs,
      setToolArgs: (...args: unknown[]) => {
        const newArgs = args[0] as Partial<typeof baseToolArgs>;
        setToolArgs({ ...toolArgs, ...newArgs });
        return setToolArgsMock(...args);
      },
    };
  },
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

function lastCallArgs(mock: ReturnType<typeof vi.fn>) {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

describe('Shape toolbar', () => {
  beforeEach(() => {
    setToolArgsMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Photoshop-style tool mode choices', () => {
    render(<Shape />);

    const mode = screen.getByRole('combobox', { name: 'Tool mode' }) as HTMLSelectElement;
    expect(mode).toHaveValue('shape');
    expect(screen.getByRole('option', { name: 'Path' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pixels' })).toBeInTheDocument();
  });

  it('changes the tool mode', () => {
    render(<Shape />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Tool mode' }), { target: { value: 'path' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ toolMode: 'path' });
  });

  it('renders shape figure label', () => {
    render(<Shape />);

    expect(screen.getByText('Rectangle Tool')).toBeInTheDocument();
  });

  it('shows correct label for each figure type', () => {
    const figureLabels: Record<string, string> = {
      rectangle: 'Rectangle Tool',
      oval: 'Ellipse Tool',
      circle: 'Circle Tool',
      square: 'Square Tool',
      line: 'Line Tool',
    };

    for (const [figure, label] of Object.entries(figureLabels)) {
      baseToolArgs.figure = figure as 'rectangle' | 'oval' | 'circle' | 'square' | 'line';
      render(<Shape />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    baseToolArgs.figure = 'rectangle';
  });

  it('adjusts line width via thickness slider', () => {
    render(<Shape />);

    const thicknessSlider = screen.getByRole('slider', { name: /Thickness/ }) as HTMLInputElement;
    expect(thicknessSlider).toHaveValue('5');
    expect(screen.getByText('5px')).toBeInTheDocument();

    fireEvent.change(thicknessSlider, { target: { value: '25' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineWidth: 25 });
    expect(thicknessSlider).toHaveValue('25');
    expect(screen.getByText('25px')).toBeInTheDocument();
  });

  it('toggles fill on and off', () => {
    render(<Shape />);

    const fillCheckbox = screen.getByRole('checkbox', { name: /Filled/ }) as HTMLInputElement;
    expect(fillCheckbox).not.toBeChecked();

    fireEvent.click(fillCheckbox);

    const checkedFill = screen.getByRole('checkbox', { name: /Filled/ }) as HTMLInputElement;
    expect(checkedFill).toBeChecked();
    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ hasFill: true });
  });

  it('exposes rectangle corner radius', () => {
    render(<Shape />);

    const radius = screen.getByRole('slider', { name: 'Radius' }) as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '24' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ cornerRadius: 24 });
  });

  it('shows dash and gap sliders when dashed is enabled', () => {
    render(<Shape />);

    expect(document.getElementById('dash-slider')).toBeNull();
    expect(document.getElementById('gap-slider')).toBeNull();

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);

    expect(document.getElementById('dash-slider')).not.toBeNull();
    expect(document.getElementById('gap-slider')).not.toBeNull();
    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [10, 10] });
  });

  it('hides dash and gap sliders when dashed is disabled', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);
    expect(document.getElementById('dash-slider')).not.toBeNull();

    const dashedCheckboxAgain = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckboxAgain);
    expect(document.getElementById('dash-slider')).toBeNull();
    expect(document.getElementById('gap-slider')).toBeNull();
  });

  it('adjusts dash value', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);

    const dashSlider = screen.getByRole('slider', { name: /Dash/ }) as HTMLInputElement;
    expect(dashSlider).toHaveValue('10');

    fireEvent.change(dashSlider, { target: { value: '20' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [20, 10] });
    expect(dashSlider).toHaveValue('20');
    expect(screen.getByText('20px')).toBeInTheDocument();
  });

  it('adjusts gap value', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);

    const gapSlider = screen.getByRole('slider', { name: /Gap/ }) as HTMLInputElement;
    expect(gapSlider).toHaveValue('10');

    fireEvent.change(gapSlider, { target: { value: '15' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [10, 15] });
    expect(gapSlider).toHaveValue('15');
    expect(screen.getByText('15px')).toBeInTheDocument();
  });

  it('adjusts opacity via alpha slider', () => {
    render(<Shape />);

    const alphaSlider = screen.getByRole('slider', { name: /Opacity/ }) as HTMLInputElement;
    expect(alphaSlider).toHaveValue('1');
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.change(alphaSlider, { target: { value: '0.5' } });

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ alpha: 0.5 });
    expect(alphaSlider).toHaveValue('0.5');
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders preview canvas with correct dimensions', () => {
    render(<Shape />);

    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(96);
    expect(canvas?.height).toBe(48);
  });
});
