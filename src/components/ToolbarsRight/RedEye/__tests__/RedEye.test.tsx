import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RedEye from '../RedEye.tsx';

const { patchToolArgsMock, toolArgsMock } = vi.hoisted(() => ({
  patchToolArgsMock: vi.fn(),
  toolArgsMock: { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50, point: null },
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolArgsMock, patchToolArgs: patchToolArgsMock }),
}));

describe('RedEye options bar', () => {
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
});
