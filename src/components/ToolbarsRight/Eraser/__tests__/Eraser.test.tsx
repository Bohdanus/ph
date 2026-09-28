import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Eraser, { ERASER_SIZE_MAX, ERASER_SIZE_MIN } from '../Eraser.tsx';

const toolArgs = vi.hoisted(() => ({
  alpha: 1,
  color: '#000000',
  lineWidth: 40,
  mode: 'pencil',
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
  toolArgs.mode = 'pencil';
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

  it('offers the three Photoshop modes, with Brush unselectable', () => {
    render(<Eraser />);
    const options = [...screen.getByLabelText('Mode').querySelectorAll('option')];

    expect(options.map((option) => option.textContent)).toEqual(['Brush', 'Pencil', 'Block']);
    // `disabled` on the option itself, not a filtered-out list: the bar is Photoshop-shaped, and an
    // e2e assertion can prove the mode is not offered as though it worked.
    expect(options[0]).toBeDisabled();
    expect(options[1]).toBeEnabled();
    expect(options[2]).toBeEnabled();
  });

  it('never renders Brush as the current mode, because EraserMode excludes it', () => {
    render(<Eraser />);
    const select = screen.getByLabelText('Mode') as HTMLSelectElement;

    expect(select.value).toBe('pencil');
    // A user cannot pick it; only a script assigning `.value` could, and the union makes that a
    // type error at the patch site rather than a silently stored mode.
    expect([...select.options].filter((option) => !option.disabled).map((option) => option.value)).toEqual([
      'pencil',
      'block',
    ]);
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
