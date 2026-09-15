import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeatherMagneticLasso from '../FeatherMagneticLasso.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: null,
      canvasRef: { current: document.createElement('canvas') },
      selections: [],
      totalSize: { width: 800, height: 600 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => ({
      antiAlias: true,
      edgeContrast: 30,
      featherRadius: 12,
      frequency: 40,
      magneticWidth: 18,
      previewFeather: true,
      smoothing: 1.5,
      snapStrength: 0.85,
      toolName: 'feather-magnetic-lasso',
    }),
    patchToolArgs: patchToolArgsMock,
  }),
}));

describe('FeatherMagneticLasso toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
  });

  it('shows settings information in a portal tooltip when the info button is hovered', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    const tooltip = await screen.findByRole('tooltip');

    expect(tooltip.textContent).toContain('Feather Magnetic Lasso settings');
    expect(tooltip.textContent).toContain('Feather');
    expect(tooltip.textContent).toContain('Width');
    expect(tooltip.textContent).toContain('Preview feather');
    expect(document.body.contains(tooltip)).toBe(true);
  });

  it('pins settings information when the info button is clicked', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.click(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toContain('copy output uses a feathered alpha mask');
    });
  });
});
