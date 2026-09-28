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

  it('offers Photoshop three Sample Size options in Photoshop order', () => {
    render(<Eyedropper />);
    const options = [...screen.getByLabelText('Sample Size').querySelectorAll('option')];

    expect(options.map((option) => option.textContent)).toEqual(['Point Sample', '3 by 3 Average', '5 by 5 Average']);
    expect(options.map((option) => option.value)).toEqual(['1', '3', '5']);
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

  it('renders Sample All Layers disabled and unchecked, and writes nothing', () => {
    render(<Eyedropper />);
    const allLayers = screen.getByLabelText('Sample All Layers') as HTMLInputElement;

    // It needs a composite read of every visible layer, and the tool area only has the active
    // layer's pixels — so it must read as unavailable rather than as a switch that does nothing.
    expect(allLayers).toBeDisabled();
    expect(allLayers).not.toBeChecked();

    fireEvent.click(allLayers);

    expect(allLayers).not.toBeChecked();
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });
});
