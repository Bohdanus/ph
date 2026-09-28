import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MagicEraser from '../MagicEraser.tsx';
import { FILL_TOLERANCE_MAX } from '../../../../tools/fill.ts';

const toolArgs = vi.hoisted(() => ({ alpha: 1, color: '#000000', contiguous: true, tolerance: 32 }));

/** `getToolArgs` returns `null` when the tool is not the active one (MagicEraser.tsx). */
const toolArgsAvailable = vi.hoisted(() => ({ current: true }));

const patchToolArgsMock = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Record<string, unknown>) => {
    Object.assign(toolArgs, patch);
  })
);

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => (toolArgsAvailable.current ? { ...toolArgs, toolName: 'magic-eraser' } : null),
    patchToolArgs: patchToolArgsMock,
  }),
}));

beforeEach(() => {
  toolArgs.alpha = 1;
  toolArgs.color = '#000000';
  toolArgs.contiguous = true;
  toolArgs.tolerance = 32;
  toolArgsAvailable.current = true;
  patchToolArgsMock.mockClear();
});

describe('Magic Eraser toolbar', () => {
  it('renders nothing when the magic eraser is not the active tool', () => {
    toolArgsAvailable.current = false;
    const { container } = render(<MagicEraser />);

    expect(container).toBeEmptyDOMElement();
  });

  it('scales Tolerance on the 0-255 Adobe scale, not the Magic Wand 0-100', () => {
    render(<MagicEraser />);
    const tolerance = screen.getByLabelText(/Tolerance/) as HTMLInputElement;

    expect(FILL_TOLERANCE_MAX).toBe(255);
    expect(tolerance).toHaveAttribute('min', '0');
    expect(tolerance).toHaveAttribute('max', '255');
    expect(tolerance).toHaveAttribute('step', '1');
    expect(tolerance).toHaveValue('32');
  });

  it('keeps its own scale when the sibling Magic Wand is on 0-100', () => {
    // The two scales are deliberately different, so the pin is that they did not converge.
    render(<MagicEraser />);
    const tolerance = screen.getByLabelText(/Tolerance/) as HTMLInputElement;
    const magicWandTolerance = document.createElement('input');
    magicWandTolerance.max = '100';

    expect(tolerance.max).not.toBe(magicWandTolerance.max);
  });

  it('patches Tolerance, Contiguous and Opacity, never the whole args object', () => {
    render(<MagicEraser />);

    fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '200' } });
    fireEvent.click(screen.getByLabelText('Contiguous'));
    fireEvent.change(screen.getByLabelText(/Opacity/), { target: { value: '30' } });

    expect(patchToolArgsMock.mock.calls).toEqual([
      ['magic-eraser', { tolerance: 200 }],
      ['magic-eraser', { contiguous: false }],
      ['magic-eraser', { alpha: 0.3 }],
    ]);
  });

  it('labels the controls the way the e2e locators read them', () => {
    render(<MagicEraser />);

    expect(screen.getByLabelText('Tolerance 32')).toBeInTheDocument();
    expect(screen.getByLabelText('Opacity 100%')).toBeInTheDocument();
    expect(screen.getByLabelText('Contiguous')).toBeInTheDocument();
    expect(screen.getByLabelText('Anti-aliased')).toBeInTheDocument();
  });

  it('reads the label values from the args, not from a local copy', () => {
    toolArgs.tolerance = 255;
    toolArgs.alpha = 0.25;
    render(<MagicEraser />);

    expect(screen.getByLabelText('Tolerance 255')).toBeInTheDocument();
    expect(screen.getByLabelText('Opacity 25%')).toBeInTheDocument();
  });

  it('renders Anti-aliased disabled, with Photoshop label and checked state, and writes nothing', () => {
    render(<MagicEraser />);
    const antiAliased = screen.getByLabelText('Anti-aliased') as HTMLInputElement;

    expect(antiAliased).toBeDisabled();
    expect(antiAliased).toHaveAttribute('type', 'checkbox');
    expect(antiAliased).toBeChecked();

    fireEvent.click(antiAliased);

    expect(antiAliased).toBeChecked();
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('does not render an Erase-to-History control, which has no history source here', () => {
    render(<MagicEraser />);

    expect(screen.queryByLabelText(/Erase to History/i)).toBeNull();
  });
});
