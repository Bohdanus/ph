import { useEffect, useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Shape from '../Shape.tsx';
import { isFigureType, type FigureType } from '../../../../tools/shape.ts';
import { savedArgsPerFigure } from '../../../../tools/settings.ts';

const containerRef = { current: null as HTMLDivElement | null };
const storeState = {
  containerRef,
  color: '#000000',
  backgroundColor: '#ffffff',
  totalSize: { width: 800, height: 600 },
};

const FIGURE_TYPE_VALUES = Object.keys(savedArgsPerFigure) as FigureType[];

type Figure = 'rectangle' | 'oval' | 'triangle' | 'polygon' | 'line';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

/** The margin inset the component must reserve around the previewed shape. */
const expectedMargin = (lineWidth: number, brushScale: number) => (2.5 + Math.sqrt(lineWidth)) / brushScale;

const baseToolArgs = {
  toolName: 'shape' as const,
  figure: 'rectangle' as Figure,
  alpha: 1,
  color: '#000000',
  backgroundColor: '#ffffff',
  hasFill: false,
  lineWidth: 5,
  lineDash: null as null | number[],
};

const setToolArgsMock = vi.fn();
const shapeCreatorMock = vi.fn();
const shapeSizeMock = vi.fn();
const pointerScale = vi.hoisted(() => ({ value: 1 }));

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

vi.mock('../../../../tools/shape.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../../tools/shape.ts')>('../../../../tools/shape.ts');
  return {
    ...actual,
    shape: (...args: Parameters<typeof actual.shape>) => {
      shapeSizeMock(args[0]);
      const creator = actual.shape(...args);
      return (previewArgs: Parameters<typeof creator>[0]) => {
        shapeCreatorMock(previewArgs);
        return creator(previewArgs);
      };
    },
  };
});

vi.mock('../../../../hooks/usePointerPosition.ts', () => ({
  // `onResize` is invoked once per scale so `brushScale` is non-zero and the
  // preview effect actually runs; changing `pointerScale.value` and forcing a
  // re-render notifies the component about the new zoom level.
  usePointerPosition: ({ onResize }: { onResize?: (arg: { scale: number }) => void }) => {
    const notifiedScale = useRef<number | null>(null);
    useEffect(() => {
      if (notifiedScale.current === pointerScale.value) return;
      notifiedScale.current = pointerScale.value;
      onResize?.({ scale: pointerScale.value });
    });
    return {
      isPointerDownValid: vi.fn(() => false),
      isPointerMoveValid: vi.fn(() => false),
      isPointerUpValid: vi.fn(() => false),
      getLocalCoords: vi.fn(() => ({ x: 0, y: 0 })),
      isMouseDown: { current: false },
    };
  },
}));

function lastCallArgs(mock: ReturnType<typeof vi.fn>) {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

function lastPreviewGeometry() {
  const previewArgs = lastCallArgs(shapeCreatorMock) as unknown as {
    figure: Figure;
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  return { figure: previewArgs.figure, start: previewArgs.start, end: previewArgs.end };
}

function lastPreviewSize() {
  return lastCallArgs(shapeSizeMock) as unknown as { size: { width: number; height: number } };
}

const PRISTINE_SAVED_ARGS_PER_FIGURE = structuredClone(savedArgsPerFigure);

describe('Shape toolbar', () => {
  beforeEach(() => {
    Object.assign(savedArgsPerFigure, structuredClone(PRISTINE_SAVED_ARGS_PER_FIGURE));
    setToolArgsMock.mockClear();
    shapeCreatorMock.mockClear();
    shapeSizeMock.mockClear();
    pointerScale.value = 1;
    baseToolArgs.figure = 'rectangle';
    baseToolArgs.lineWidth = 5;
  });

  afterEach(() => {
    // `vi.restoreAllMocks()` is intentionally not used here: it would also undo
    // the global HTMLCanvasElement.prototype.getContext spy installed by
    // src/test/setup.ts, which the shape preview needs in order to draw.
    Object.assign(savedArgsPerFigure, structuredClone(PRISTINE_SAVED_ARGS_PER_FIGURE));
    // `baseToolArgs` is a module-level object the mocked `useCurrentTool` spreads into
    // `useState` on every mount, so restoring it HERE — not on the line after the
    // assertion in the test that mutates it — is what makes a red assertion unable to
    // seed every later render with the wrong tool. It is a plain object, not a mock, so
    // neither `clearMocks` nor `restoreAllMocks` touches it.
    baseToolArgs.figure = 'rectangle';
    baseToolArgs.lineWidth = 5;
    (baseToolArgs as { toolName: string }).toolName = 'shape';
    storeState.color = '#000000';
    storeState.backgroundColor = '#ffffff';
    pointerScale.value = 1;
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
    const figureLabels: Record<Figure, string> = {
      rectangle: 'Rectangle Tool',
      oval: 'Ellipse Tool',
      line: 'Line Tool',
      triangle: 'Triangle Tool',
      polygon: 'Polygon Tool',
    };

    for (const [figure, label] of Object.entries(figureLabels) as [Figure, string][]) {
      baseToolArgs.figure = figure;
      const view = render(<Shape />);
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('never labels a figure as a dedicated Circle or Square tool', () => {
    for (const figure of ['rectangle', 'oval', 'line', 'triangle', 'polygon'] as Figure[]) {
      baseToolArgs.figure = figure;
      const view = render(<Shape />);
      expect(screen.queryByText('Circle Tool'), figure).toBeNull();
      expect(screen.queryByText('Square Tool'), figure).toBeNull();
      view.unmount();
    }
  });

  it('previews the unconstrained base shape for Rectangle and Ellipse', () => {
    const geometries: Partial<Record<Figure, { width: number; height: number }>> = {};

    for (const figure of ['rectangle', 'oval'] as Figure[]) {
      baseToolArgs.figure = figure;
      shapeCreatorMock.mockClear();
      const view = render(<Shape />);

      const previewArgs = lastCallArgs(shapeCreatorMock) as unknown as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      geometries[figure] = {
        width: previewArgs.end.x - previewArgs.start.x,
        height: previewArgs.end.y - previewArgs.start.y,
      };
      view.unmount();
    }

    // The 96x48 preview box is wider than tall, so neither figure may be
    // square-clamped: that would imply a dedicated Circle or Square tool.
    expect(geometries.rectangle!.width).toBeGreaterThan(geometries.rectangle!.height);
    expect(geometries.oval!.width).toBe(geometries.rectangle!.width);
    expect(geometries.oval!.height).toBe(geometries.rectangle!.height);
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

  it('swaps the checkerboard backdrop so the outline stays visible on either colour', () => {
    const dark = render(<Shape />);
    // `isLightColor('#000000')` is false, so the light backdrop is used.
    expect((document.querySelector('canvas') as HTMLCanvasElement).parentElement).toHaveClass('chessboard-light');
    dark.unmount();

    storeState.color = '#ffffff';
    render(<Shape />);
    // A near-white outline would be invisible on the light backdrop.
    expect((document.querySelector('canvas') as HTMLCanvasElement).parentElement).toHaveClass('chessboard-dark');
  });

  describe('preview geometry', () => {
    it('derives the runtime figure set from the narrowed FigureType union', () => {
      expect([...FIGURE_TYPE_VALUES].sort()).toEqual(['line', 'oval', 'polygon', 'rectangle', 'triangle']);
      for (const figure of FIGURE_TYPE_VALUES) expect(isFigureType(figure)).toBe(true);
    });

    it('feeds the shape processor the same full-box start and end for every figure', () => {
      const geometries: string[] = [];

      for (const figure of FIGURE_TYPE_VALUES) {
        baseToolArgs.figure = figure;
        const view = render(<Shape />);

        const margin = expectedMargin(baseToolArgs.lineWidth, pointerScale.value);
        const { start, end, figure: previewed } = lastPreviewGeometry();

        expect(previewed, figure).toBe(figure);
        expect(start, figure).toEqual({ x: margin, y: margin });
        expect(end, figure).toEqual({
          x: PREVIEW_WIDTH / pointerScale.value - margin,
          y: PREVIEW_HEIGHT / pointerScale.value - margin,
        });
        geometries.push(`${start.x},${start.y},${end.x},${end.y}`);
        view.unmount();
      }

      // The preview no longer varies by figure: no square/circle clamping.
      expect(new Set(geometries).size).toBe(1);
    });

    it('never produces a square preview box for any figure', () => {
      for (const figure of FIGURE_TYPE_VALUES) {
        baseToolArgs.figure = figure;
        const view = render(<Shape />);

        const { start, end } = lastPreviewGeometry();
        expect(end.x - start.x, figure).toBeGreaterThan(end.y - start.y);
        view.unmount();
      }
    });

    it('passes the scaled preview size to the shape processor', () => {
      baseToolArgs.figure = 'oval';
      render(<Shape />);

      expect(lastPreviewSize()).toEqual({
        size: { width: PREVIEW_WIDTH / pointerScale.value, height: PREVIEW_HEIGHT / pointerScale.value },
      });
    });

    it('re-renders the preview with the new margin when lineWidth changes', () => {
      render(<Shape />);
      const initial = lastPreviewGeometry();
      const initialCalls = shapeCreatorMock.mock.calls.length;

      expect(initial.start.x).toBeCloseTo(expectedMargin(5, 1), 10);

      fireEvent.change(screen.getByRole('slider', { name: /Thickness/ }), { target: { value: '25' } });

      expect(shapeCreatorMock.mock.calls.length).toBeGreaterThan(initialCalls);
      const updated = lastPreviewGeometry();
      const margin = expectedMargin(25, 1);
      expect(updated.start).toEqual({ x: margin, y: margin });
      expect(updated.end).toEqual({ x: PREVIEW_WIDTH - margin, y: PREVIEW_HEIGHT - margin });
      expect(updated.start.x).toBeGreaterThan(initial.start.x);
      expect(updated.start.x).not.toBeCloseTo(initial.start.x, 10);
    });

    it('re-renders the preview with a rescaled box when brushScale changes', () => {
      render(<Shape />);
      const initial = lastPreviewGeometry();
      expect(lastPreviewSize().size).toEqual({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });

      pointerScale.value = 2;
      fireEvent.change(screen.getByRole('slider', { name: /Thickness/ }), { target: { value: '25' } });

      const margin = expectedMargin(25, 2);
      expect(lastPreviewSize().size).toEqual({ width: PREVIEW_WIDTH / 2, height: PREVIEW_HEIGHT / 2 });

      const rescaled = lastPreviewGeometry();
      expect(rescaled.start).toEqual({ x: margin, y: margin });
      expect(rescaled.end).toEqual({ x: PREVIEW_WIDTH / 2 - margin, y: PREVIEW_HEIGHT / 2 - margin });
      expect(rescaled.start.x).not.toBeCloseTo(initial.start.x, 10);
      // The stroke inset still scales with the zoom level.
      expect(rescaled.start.x).toBeCloseTo(3.75, 10);
    });

    it('keeps the preview geometry stable while nothing changes', () => {
      baseToolArgs.figure = 'polygon';
      const view = render(<Shape />);
      const callsAfterMount = shapeCreatorMock.mock.calls.length;

      view.rerender(<Shape />);

      expect(shapeCreatorMock).toHaveBeenCalledTimes(callsAfterMount);
      expect(lastPreviewGeometry().start).toEqual({ x: expectedMargin(5, 1), y: expectedMargin(5, 1) });
      view.unmount();
    });
  });

  describe('figure labels', () => {
    const labels: Record<Figure, string> = {
      rectangle: 'Rectangle Tool',
      oval: 'Ellipse Tool',
      triangle: 'Triangle Tool',
      polygon: 'Polygon Tool',
      line: 'Line Tool',
    };

    it('labels every figure of the narrowed union with its own display name', () => {
      const rendered: string[] = [];

      for (const figure of FIGURE_TYPE_VALUES) {
        baseToolArgs.figure = figure;
        const view = render(<Shape />);

        const label = screen.getByText(labels[figure]);
        expect(label.textContent, figure).toBe(labels[figure]);
        expect(label, figure).toBeInTheDocument();
        expect(screen.queryByText('Circle Tool'), figure).toBeNull();
        expect(screen.queryByText('Square Tool'), figure).toBeNull();
        rendered.push(label.textContent as string);
        view.unmount();
      }

      expect(new Set(rendered)).toEqual(new Set(Object.values(labels)));
      expect(rendered).not.toContain('Circle Tool');
      expect(rendered).not.toContain('Square Tool');
    });

    it('falls back to the rectangle label for an unrecognized figure', () => {
      baseToolArgs.figure = 'circle' as Figure;
      const view = render(<Shape />);

      expect(screen.getByText('Rectangle Tool')).toBeInTheDocument();
      expect(screen.queryByText('Circle Tool')).toBeNull();
      view.unmount();
    });
  });

  describe('colour synchronisation', () => {
    it('adopts the store stroke and background colours when they diverge', () => {
      storeState.color = '#ff0000';
      storeState.backgroundColor = '#00ff00';
      render(<Shape />);

      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ color: '#ff0000', backgroundColor: '#00ff00' });
    });

    it('adopts a stroke colour change without waiting for the background colour', () => {
      storeState.color = '#0000ff';
      render(<Shape />);

      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ color: '#0000ff', backgroundColor: '#ffffff' });
    });

    it('does not publish anything when the tool args already match the store colours', () => {
      render(<Shape />);

      expect(setToolArgsMock).not.toHaveBeenCalled();
    });

    it('does not publish anything for args that belong to a different tool (Shape.tsx:32)', () => {
      (baseToolArgs as { toolName: string }).toolName = 'draw';
      storeState.color = '#ff0000';
      // No inline restore: `afterEach` puts `toolName` back, so this test cannot leave
      // the module-scoped args naming another tool for the line-cap suite below.
      const view = render(<Shape />);

      // The guard is the `args.toolName !== 'shape'` half: a shape toolbar mounted with another
      // tool's args must not overwrite them with the store colours.
      expect(setToolArgsMock).not.toHaveBeenCalled();
      view.unmount();
    });
  });

  describe('line cap', () => {
    beforeEach(() => {
      baseToolArgs.figure = 'line';
    });

    it('offers the three caps for a line figure only', () => {
      const view = render(<Shape />);

      const cap = screen.getByRole('combobox', { name: 'Line cap' }) as HTMLSelectElement;
      expect(Array.from(cap.options, (option) => option.value)).toEqual(['butt', 'round', 'square']);
      // `lineCap` is absent from the args, so the destructuring default applies.
      expect(cap).toHaveValue('butt');
      view.unmount();

      baseToolArgs.figure = 'rectangle';
      const rectangle = render(<Shape />);
      expect(screen.queryByRole('combobox', { name: 'Line cap' })).toBeNull();
      expect(screen.getByRole('slider', { name: 'Radius' })).toBeInTheDocument();
      rectangle.unmount();
    });

    it('publishes the chosen cap and remembers it for the line figure (Shape.tsx:94-95)', () => {
      render(<Shape />);

      fireEvent.change(screen.getByRole('combobox', { name: 'Line cap' }), { target: { value: 'round' } });

      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ lineCap: 'round' });
      expect(savedArgsPerFigure.line).toMatchObject({ lineCap: 'round' });
    });

    it('leaves the radius control out of a line figure', () => {
      render(<Shape />);

      expect(screen.queryByRole('slider', { name: 'Radius' })).toBeNull();
    });
  });

  describe('polygon sides', () => {
    beforeEach(() => {
      baseToolArgs.figure = 'polygon';
    });

    afterEach(() => {
      baseToolArgs.figure = 'rectangle';
    });

    it('offers Sides on a polygon figure only, seeded at 5', () => {
      const view = render(<Shape />);

      const sides = screen.getByRole('spinbutton', { name: 'Sides' }) as HTMLInputElement;
      // `sides` is absent from these args, so this is the destructuring default
      // rather than a value the fixture happened to carry.
      expect(sides).toHaveValue(5);
      // The attributes are not decoration: they are what bounds the field, and
      // they must say Adobe's 3, not 0 or 1.
      expect(sides).toHaveAttribute('min', '3');
      expect(sides).toHaveAttribute('max', '100');
      expect(sides).toHaveAttribute('step', '1');
      view.unmount();

      baseToolArgs.figure = 'triangle';
      const triangle = render(<Shape />);
      expect(screen.queryByRole('spinbutton', { name: 'Sides' })).toBeNull();
      triangle.unmount();

      baseToolArgs.figure = 'polygon';
      const again = render(<Shape />);
      expect(screen.getByRole('spinbutton', { name: 'Sides' })).toBeInTheDocument();
      again.unmount();
    });

    /**
     * The field COMMITS, it does not stream. Three tests below used to assert the
     * opposite — that a typed `1` immediately stored 3 — and that is exactly what
     * made the control unable to do the one thing it exists for. They are rewritten
     * here against what is now true, not deleted.
     */
    /**
     * DIGIT BY DIGIT, which is the whole point.
     *
     * A single `fireEvent.change(input, {value: '12'})` hands the control a
     * finished '12' in one go and cannot reproduce per-keystroke corruption: it is
     * a paste, not a typist. The bug lived between two keystrokes, so this walks
     * them the way a hand does — set '1', let React repaint, then set '12'.
     */
    const typeSidesDigitByDigit = (input: HTMLElement, digits: string) => {
      for (let length = 1; length <= digits.length; length += 1) {
        fireEvent.change(input, { target: { value: digits.slice(0, length) } });
      }
    };

    /** A finished value in one event: a paste, or an assistive technology's fill. */
    const pasteSides = (input: HTMLElement, value: string) => {
      fireEvent.change(input, { target: { value } });
    };

    it('accepts a two-digit count, which clamping on every keystroke made unreachable', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' });

      // `12` and `10` are the counts the old handler could never produce: it stored
      // 3 on the `1`, repainted the field as 3, and the `2` landed in a field
      // showing 3, yielding 32. Both are ordinary values for this tool.
      typeSidesDigitByDigit(input, '12');
      expect(input).toHaveValue(12);
      fireEvent.blur(input);
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 12 });

      typeSidesDigitByDigit(input, '10');
      expect(input).toHaveValue(10);
      fireEvent.blur(input);
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 10 });

      // And `1x` counts, because the field working only for values that were
      // already valid on the first keystroke would be no field at all.
      typeSidesDigitByDigit(input, '42');
      fireEvent.blur(input);
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 42 });

      // A pasted count commits the same way, which is the path a single `change`
      // event actually models.
      pasteSides(input, '7');
      fireEvent.blur(input);
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 7 });
    });

    it('keeps the draft in the field while it is typed, and stores nothing until commit', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' }) as HTMLInputElement;

      pasteSides(input, '9');
      // The field shows the USER's text, not the stored count: this is the whole
      // mechanism, and a control that repaints mid-keystroke cannot be typed into.
      expect(input).toHaveValue(9);
      // Nothing dispatched yet. A draft is not a tool argument.
      expect(lastCallArgs(setToolArgsMock)).not.toMatchObject({ sides: 9 });

      fireEvent.blur(input);
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 9 });
      // The persistence half is the one a reviewer cannot see from the render:
      // `handleChange` writes an EXPLICIT key list, so a `sides` missing from it
      // renders correctly and then evaporates on the next figure switch.
      expect(savedArgsPerFigure.polygon).toMatchObject({ sides: 9 });
    });

    it('commits on Enter, because blur alone is not reachable by keyboard alone', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' });

      pasteSides(input, '8');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 8 });
      expect(savedArgsPerFigure.polygon).toMatchObject({ sides: 8 });
    });

    it('abandons the draft on Escape, leaving the stored count untouched', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' }) as HTMLInputElement;

      pasteSides(input, '77');
      fireEvent.keyDown(input, { key: 'Escape' });
      // No dispatch, and the field is back to showing the stored 5 rather than the
      // abandoned draft.
      expect(lastCallArgs(setToolArgsMock)).not.toMatchObject({ sides: 77 });
      expect(input).toHaveValue(5);
      expect(savedArgsPerFigure.polygon).not.toMatchObject({ sides: 77 });
    });

    it('stores the floor rather than the typed value when the count is below it', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' });

      pasteSides(input, '1');
      fireEvent.blur(input);

      // Normalized at COMMIT, not per keystroke, so the store never holds a value
      // the renderer would have to defend against a second time.
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 3 });
      expect(savedArgsPerFigure.polygon).toMatchObject({ sides: 3 });
    });

    it('commits the ceiling rather than the typed value when the count is above it', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' });

      pasteSides(input, '4000');
      fireEvent.blur(input);

      // `min`/`max` do not do this. They are constraint-validation metadata: the
      // browser marks a `type="number"` out of range invalid and dispatches
      // `onChange` anyway, so the normalizer at commit is the only bound.
      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 100 });
    });

    it('falls back to 5 when the field is emptied, not to a zero-sided polygon', () => {
      render(<Shape />);
      const input = screen.getByRole('spinbutton', { name: 'Sides' });

      // An emptied number input reports '', and Number('') is 0 — which floors to 3
      // and would silently turn a pentagon into a triangle on commit.
      pasteSides(input, '');
      fireEvent.blur(input);

      expect(lastCallArgs(setToolArgsMock)).toMatchObject({ sides: 5 });
    });
  });
});
