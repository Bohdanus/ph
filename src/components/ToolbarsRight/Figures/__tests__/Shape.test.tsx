import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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
  toolName: 'shape',
  figure: 'rectangle' as 'rectangle' | 'oval' | 'circle' | 'square' | 'line',
  alpha: 1,
  color: '#000000',
  backgroundColor: '#ffffff',
  hasFill: false,
  lineWidth: 5,
  lineDash: null,
};

const toolArgsMutable: typeof baseToolArgs = { ...baseToolArgs };
const setToolArgsMock = vi.fn();

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsMutable,
    setToolArgs: (...args: unknown[]) => {
      const newArgs = args[0] as typeof baseToolArgs;
      if (newArgs) {
        Object.assign(toolArgsMutable, newArgs);
      }
      return setToolArgsMock(...args);
    },
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

function lastCallArgs(mock: ReturnType<typeof vi.fn>) {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

describe('Shape toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgsMutable, baseToolArgs);
    setToolArgsMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render a Figure select', () => {
    render(<Shape />);

    const selects = screen.queryByRole('combobox');
    expect(selects).not.toBeInTheDocument();
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
      toolArgsMutable.figure = figure as 'rectangle' | 'oval' | 'circle' | 'square' | 'line';
      render(<Shape />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('adjusts line width via thickness slider', () => {
    render(<Shape />);

    const thicknessSlider = screen.getByRole('slider', { name: /Thickness/ }) as HTMLInputElement;
    expect(thicknessSlider).toHaveValue('5');
    expect(screen.getByText('5px')).toBeInTheDocument();

    fireEvent.change(thicknessSlider, { target: { value: '25' } });
    cleanup();
    render(<Shape />);

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineWidth: 25 });
    const updatedSlider = screen.getByRole('slider', { name: /Thickness/ }) as HTMLInputElement;
    expect(updatedSlider).toHaveValue('25');
    expect(screen.getByText('25px')).toBeInTheDocument();
  });

  it('toggles fill on and off', () => {
    render(<Shape />);

    const fillCheckbox = screen.getByRole('checkbox', { name: /Filled/ }) as HTMLInputElement;
    expect(fillCheckbox).not.toBeChecked();

    fireEvent.click(fillCheckbox);
    cleanup();
    render(<Shape />);

    const checkedFill = screen.getByRole('checkbox', { name: /Filled/ }) as HTMLInputElement;
    expect(checkedFill).toBeChecked();
    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ hasFill: true });
  });

  it('shows dash and gap sliders when dashed is enabled', () => {
    render(<Shape />);

    expect(document.getElementById('dash-slider')).toBeNull();
    expect(document.getElementById('gap-slider')).toBeNull();

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);
    cleanup();
    render(<Shape />);

    expect(document.getElementById('dash-slider')).not.toBeNull();
    expect(document.getElementById('gap-slider')).not.toBeNull();
    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [10, 10] });
  });

  it('hides dash and gap sliders when dashed is disabled', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);
    cleanup();
    render(<Shape />);
    expect(document.getElementById('dash-slider')).not.toBeNull();

    const dashedCheckboxAgain = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckboxAgain);
    cleanup();
    render(<Shape />);
    expect(document.getElementById('dash-slider')).toBeNull();
    expect(document.getElementById('gap-slider')).toBeNull();
  });

  it('adjusts dash value', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);
    cleanup();
    render(<Shape />);

    const dashSlider = screen.getByRole('slider', { name: /Dash/ }) as HTMLInputElement;
    expect(dashSlider).toHaveValue('10');

    fireEvent.change(dashSlider, { target: { value: '20' } });
    cleanup();
    render(<Shape />);

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [20, 10] });
    const updatedDash = screen.getByRole('slider', { name: /Dash/ }) as HTMLInputElement;
    expect(updatedDash).toHaveValue('20');
    expect(screen.getByText('20px')).toBeInTheDocument();
  });

  it('adjusts gap value', () => {
    render(<Shape />);

    const dashedCheckbox = screen.getByRole('checkbox', { name: /Dashed/ }) as HTMLInputElement;
    fireEvent.click(dashedCheckbox);
    cleanup();
    render(<Shape />);

    const gapSlider = screen.getByRole('slider', { name: /Gap/ }) as HTMLInputElement;
    expect(gapSlider).toHaveValue('10');

    fireEvent.change(gapSlider, { target: { value: '15' } });
    cleanup();
    render(<Shape />);

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineDash: [10, 15] });
    const updatedGap = screen.getByRole('slider', { name: /Gap/ }) as HTMLInputElement;
    expect(updatedGap).toHaveValue('15');
    expect(screen.getByText('15px')).toBeInTheDocument();
  });

  it('adjusts opacity via alpha slider', () => {
    render(<Shape />);

    const alphaSlider = screen.getByRole('slider', { name: /Opacity/ }) as HTMLInputElement;
    expect(alphaSlider).toHaveValue('1');
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.change(alphaSlider, { target: { value: '0.5' } });
    cleanup();
    render(<Shape />);

    expect(lastCallArgs(setToolArgsMock)).toMatchObject({ alpha: 0.5 });
    const updatedAlpha = screen.getByRole('slider', { name: /Opacity/ }) as HTMLInputElement;
    expect(updatedAlpha).toHaveValue('0.5');
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
