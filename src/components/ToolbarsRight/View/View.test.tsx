import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Hand } from './View.tsx';

const store = vi.hoisted(() => ({
  setViewState: vi.fn(),
  containerRef: {
    current: {
      getBoundingClientRect: () => ({ width: 400, height: 300 }),
    },
  },
  totalSize: { width: 800, height: 600 },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store],
}));

describe('view toolbar', () => {
  it('sets the displayed document scale to one image pixel per CSS pixel at 100%', () => {
    render(<Hand />);

    fireEvent.click(screen.getByRole('button', { name: '100%' }));

    expect(store.setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: 2,
      fitScaleCompensation: 1,
      rotation: 0,
    });
  });
});
