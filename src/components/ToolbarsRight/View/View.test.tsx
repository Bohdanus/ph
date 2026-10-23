import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Hand } from './View.tsx';

const setViewState = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ setViewState }],
}));

describe('view toolbar', () => {
  it('resets frame-change compensation when setting the view to 100%', () => {
    render(<Hand />);

    fireEvent.click(screen.getByRole('button', { name: '100%' }));

    expect(setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: 1,
      fitScaleCompensation: 1,
      rotation: 0,
    });
  });
});
