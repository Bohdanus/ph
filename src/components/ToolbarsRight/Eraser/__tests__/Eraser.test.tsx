import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Eraser, { ERASER_SIZE_MAX, ERASER_SIZE_MIN } from '../Eraser.tsx';
import { ERASER_HARDNESS_MAX, ERASER_HARDNESS_MIN } from '../../../../tools/eraser.ts';
import { BRUSH_SPACING_MAX, BRUSH_SPACING_MIN } from '../../../../util/brush-engine.ts';

/**
 * Mirrors the shipped defaults in `src/tools/settings.ts`, spelled out because `vi.hoisted` runs
 * before any import is initialized. `eraser.brush.test.ts` is what asserts the values themselves,
 * against `defaultSettings` rather than against this copy.
 */
const toolArgs = vi.hoisted(() => ({
  alpha: 1,
  color: '#000000',
  lineWidth: 40,
  mode: 'brush',
  hardness: 50,
  spacing: 25,
  points: [] as unknown[],
}));

/** `getToolArgs` returns `null` when the tool is not the active one (Eraser.tsx:24-25). */
const toolArgsAvailable = vi.hoisted(() => ({ current: true }));

const patchToolArgsMock = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Record<string, unknown>) => {
    Object.assign(toolArgs, patch);
  })
);

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => (toolArgsAvailable.current ? { ...toolArgs, toolName: 'eraser' } : null),
    patchToolArgs: patchToolArgsMock,
  }),
}));

const resetToolArgs = () => {
  toolArgs.alpha = 1;
  toolArgs.color = '#000000';
  toolArgs.lineWidth = 40;
  toolArgs.mode = 'brush';
  toolArgs.hardness = 50;
  toolArgs.spacing = 25;
  toolArgs.points = [];
};

describe('Eraser toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    toolArgsAvailable.current = true;
    patchToolArgsMock.mockClear();
  });

  it('renders nothing when the eraser is not the active tool', () => {
    toolArgsAvailable.current = false;
    const { container } = render(<Eraser />);

    expect(container).toBeEmptyDOMElement();
  });

  it('patches Size and Opacity, never the whole args object', () => {
    render(<Eraser />);

    fireEvent.change(screen.getByLabelText(/Size/), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/Opacity/), { target: { value: '40' } });

    expect(patchToolArgsMock.mock.calls).toEqual([
      ['eraser', { lineWidth: 120 }],
      ['eraser', { alpha: 0.4 }],
    ]);
  });

  it('labels the controls the way the e2e locators read them', () => {
    render(<Eraser />);

    expect(screen.getByLabelText('Size 40px')).toBeInTheDocument();
    expect(screen.getByLabelText('Opacity 100%')).toBeInTheDocument();
    expect(screen.getByLabelText('Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Flow 100%')).toBeInTheDocument();
  });

  it('caps Size at the size the padded stroke canvas can afford', () => {
    render(<Eraser />);
    const size = screen.getByLabelText(/Size/) as HTMLInputElement;

    expect(size).toHaveAttribute('min', String(ERASER_SIZE_MIN));
    expect(size).toHaveAttribute('max', String(ERASER_SIZE_MAX));
    expect(size).toHaveAttribute('max', '500');
    expect(size).toHaveAttribute('step', '1');
  });

  it('offers the three Photoshop modes, all of them selectable', () => {
    render(<Eraser />);
    const options = [...screen.getByLabelText('Mode').querySelectorAll('option')];

    expect(options.map((option) => option.textContent)).toEqual(['Brush', 'Pencil', 'Block']);
    // No `disabled` anywhere: the Brush option used to carry it because a soft tip needed a
    // stamped-dab engine this renderer did not have. It has one now (`src/tools/eraser.ts`), and a
    // rendered-disabled option is a mode the bar advertises and refuses.
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it('opens on Brush, so the first stroke already has a soft edge', () => {
    render(<Eraser />);
    const select = screen.getByLabelText('Mode') as HTMLSelectElement;

    expect(select.value).toBe('brush');
  });

  it('switches to Pencil', () => {
    render(<Eraser />);

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'pencil' } });

    expect(patchToolArgsMock).toHaveBeenCalledWith('eraser', { mode: 'pencil' });
  });

  it('patches Hardness and Spacing in Brush mode, on Photoshop’s ranges', () => {
    render(<Eraser />);
    const hardness = screen.getByLabelText(/Hardness/) as HTMLInputElement;
    const spacing = screen.getByLabelText(/Spacing/) as HTMLInputElement;

    expect(hardness).toHaveAttribute('min', String(ERASER_HARDNESS_MIN));
    expect(hardness).toHaveAttribute('max', String(ERASER_HARDNESS_MAX));
    expect(spacing).toHaveAttribute('min', String(BRUSH_SPACING_MIN));
    expect(spacing).toHaveAttribute('max', String(BRUSH_SPACING_MAX));

    fireEvent.change(hardness, { target: { value: '25' } });
    fireEvent.change(spacing, { target: { value: '60' } });

    expect(patchToolArgsMock.mock.calls).toEqual([
      ['eraser', { hardness: 25 }],
      ['eraser', { spacing: 60 }],
    ]);
  });

  it('withholds Hardness and Spacing in the hard modes, because they are properties of a stamped tip', () => {
    const { rerender } = render(<Eraser />);
    expect(screen.getByLabelText(/Hardness/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Spacing/)).toBeInTheDocument();

    toolArgs.mode = 'pencil';
    rerender(<Eraser />);

    expect(screen.queryByLabelText(/Hardness/)).toBeNull();
    expect(screen.queryByLabelText(/Spacing/)).toBeNull();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
  });

  it('switches to Block mode', () => {
    render(<Eraser />);

    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'block' } });

    expect(patchToolArgsMock).toHaveBeenCalledWith('eraser', { mode: 'block' });
  });

  it('hides the Opacity control in Block mode, because Adobe removes it', () => {
    const { rerender } = render(<Eraser />);
    expect(screen.getByLabelText(/Opacity/)).toBeInTheDocument();

    toolArgs.mode = 'block';
    rerender(<Eraser />);

    expect(screen.queryByLabelText(/Opacity/)).toBeNull();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
  });

  it('shows the Opacity control again on the way back to Pencil', () => {
    const { rerender } = render(<Eraser />);
    toolArgs.mode = 'block';
    rerender(<Eraser />);
    expect(screen.queryByLabelText(/Opacity/)).toBeNull();

    toolArgs.mode = 'pencil';
    rerender(<Eraser />);

    expect(screen.getByLabelText('Opacity 100%')).toBeInTheDocument();
  });

  it('renders Flow disabled, with Photoshop label and range, and writes nothing', () => {
    render(<Eraser />);
    const flow = screen.getByLabelText(/Flow/) as HTMLInputElement;

    expect(flow).toBeDisabled();
    expect(flow).toHaveAttribute('min', '1');
    expect(flow).toHaveAttribute('max', '100');
    expect(flow).toHaveAttribute('step', '1');
    expect(flow).toHaveValue('100');

    fireEvent.change(flow, { target: { value: '50' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('does not render an Erase-to-History control, which has no history source here', () => {
    render(<Eraser />);

    expect(screen.queryByLabelText(/Erase to History/i)).toBeNull();
  });
});
