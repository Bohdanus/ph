import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RedEye from '../RedEye.tsx';

const { patchToolArgsMock, toolArgsMock } = vi.hoisted(() => ({
  patchToolArgsMock: vi.fn(),
  toolArgsMock: { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50, point: null },
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolArgsMock, patchToolArgs: patchToolArgsMock }),
}));

describe('RedEye options bar', () => {
  beforeEach(() => {
    patchToolArgsMock.mockClear();
    toolArgsMock.pupilSize = 50;
    toolArgsMock.darkenAmount = 50;
  });

  it('renders and updates the two correction controls', () => {
    render(<RedEye />);

    const pupilSize = screen.getByRole('slider', { name: 'Pupil Size' });
    const darkenAmount = screen.getByRole('slider', { name: 'Darken Amount' });

    expect(pupilSize).toHaveAttribute('min', '0');
    expect(pupilSize).toHaveAttribute('max', '100');
    expect(darkenAmount).toHaveAttribute('min', '0');
    expect(darkenAmount).toHaveAttribute('max', '100');

    fireEvent.change(pupilSize, { target: { value: '72' } });
    fireEvent.change(darkenAmount, { target: { value: '35' } });

    expect(patchToolArgsMock).toHaveBeenNthCalledWith(1, 'red-eye', { pupilSize: 72 });
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(2, 'red-eye', { darkenAmount: 35 });
  });

  it.each([
    [0, 0],
    [0, 50],
    [0, 100],
    [50, 0],
    [50, 50],
    [50, 100],
    [100, 0],
    [100, 50],
    [100, 100],
  ])('updates sliders with boundary values pupilSize=%i, darkenAmount=%i', (pupilSize, darkenAmount) => {
    toolArgsMock.pupilSize = 25;
    toolArgsMock.darkenAmount = 75;
    render(<RedEye />);

    const pupilSizeSlider = screen.getByRole('slider', { name: 'Pupil Size' });
    const darkenAmountSlider = screen.getByRole('slider', { name: 'Darken Amount' });

    fireEvent.change(pupilSizeSlider, { target: { value: String(pupilSize) } });
    fireEvent.change(darkenAmountSlider, { target: { value: String(darkenAmount) } });

    expect(patchToolArgsMock).toHaveBeenNthCalledWith(1, 'red-eye', { pupilSize });
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(2, 'red-eye', { darkenAmount });
  });

  it('reflects pre-existing toolArgs values in the slider DOM', () => {
    toolArgsMock.pupilSize = 80;
    toolArgsMock.darkenAmount = 20;

    render(<RedEye />);

    const pupilSize = screen.getByRole('slider', { name: 'Pupil Size' });
    const darkenAmount = screen.getByRole('slider', { name: 'Darken Amount' });

    expect(pupilSize).toHaveValue('80');
    expect(darkenAmount).toHaveValue('20');
  });

  it('does not call patchToolArgs when slider value is unchanged (React controlled input behavior)', () => {
    render(<RedEye />);

    const pupilSize = screen.getByRole('slider', { name: 'Pupil Size' });

    fireEvent.change(pupilSize, { target: { value: '50' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });
});
