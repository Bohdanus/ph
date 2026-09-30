import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Eyedropper from '../Eyedropper.tsx';

const toolArgs = vi.hoisted(() => ({ sampleAllLayers: false, sampleSize: 1 }));

/** `getToolArgs` returns `null` when the tool is not the active one (Eyedropper.tsx:14-15). */
const toolArgsAvailable = vi.hoisted(() => ({ current: true }));

const patchToolArgsMock = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Record<string, unknown>) => {
    Object.assign(toolArgs, patch);
  })
);

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => (toolArgsAvailable.current ? { ...toolArgs, toolName: 'eyedropper' } : null),
    patchToolArgs: patchToolArgsMock,
  }),
}));

beforeEach(() => {
  toolArgs.sampleAllLayers = false;
  toolArgs.sampleSize = 1;
  toolArgsAvailable.current = true;
  patchToolArgsMock.mockClear();
});

describe('Eyedropper toolbar', () => {
  it('renders nothing when the eyedropper is not the active tool', () => {
    toolArgsAvailable.current = false;
    const { container } = render(<Eyedropper />);

    expect(container).toBeEmptyDOMElement();
  });

  it('offers Photoshop all seven Sample Size options in Photoshop order', () => {
    render(<Eyedropper />);
    const options = [...screen.getByLabelText('Sample Size').querySelectorAll('option')];

    expect(options.map((option) => option.textContent)).toEqual([
      'Point Sample',
      '3 by 3 Average',
      '5 by 5 Average',
      '11 by 11 Average',
      '31 by 31 Average',
      '51 by 51 Average',
      '101 by 101 Average',
    ]);
    expect(options.map((option) => option.value)).toEqual(['1', '3', '5', '11', '31', '51', '101']);
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it('seeds Photoshop default of a point sample', () => {
    render(<Eyedropper />);

    expect(screen.getByLabelText('Sample Size')).toHaveValue('1');
  });

  it('patches Sample Size as a number, never the raw string', () => {
    render(<Eyedropper />);

    fireEvent.change(screen.getByLabelText('Sample Size'), { target: { value: '5' } });

    expect(patchToolArgsMock.mock.calls).toEqual([['eyedropper', { sampleSize: 5 }]]);
  });

  it('reads the selected size from the args, not from a local copy', () => {
    toolArgs.sampleSize = 3;
    render(<Eyedropper />);

    expect(screen.getByLabelText('Sample Size')).toHaveValue('3');
  });

  it('renders no Sample All Layers control at all, disabled or otherwise', () => {
    render(<Eyedropper />);

    // The checkbox used to sit on the bar permanently `disabled` and unchecked. It needs a
    // composite read of every visible layer and the tool area only has the composited canvas, so
    // it was a promise the app could not keep on screen: a box that reads as a switch and cannot be
    // used is worse than an absent one, because the absent one is honest about the gap.
    expect(screen.queryByLabelText('Sample All Layers')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/All Layers/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('patches every Sample Size the seven-entry union holds, as a number', () => {
    render(<Eyedropper />);

    for (const sampleSize of [1, 3, 5, 11, 31, 51, 101]) {
      fireEvent.change(screen.getByLabelText('Sample Size'), { target: { value: String(sampleSize) } });
    }

    expect(patchToolArgsMock.mock.calls).toEqual(
      [1, 3, 5, 11, 31, 51, 101].map((sampleSize) => ['eyedropper', { sampleSize }])
    );
  });
});
