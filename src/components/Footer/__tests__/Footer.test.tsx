import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../contexts/StoreContext.tsx';
import Footer from '../Footer.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      hasImage: true,
      totalSize: { width: 800, height: 600 },
    },
  ],
}));

describe('Footer', () => {
  it('renders dimensions when an image is loaded', () => {
    render(<Footer />);

    expect(screen.getByText(/Dimensions:/)).toBeTruthy();
    expect(screen.getByText(/800 × 600 px/)).toBeTruthy();
  });
});
