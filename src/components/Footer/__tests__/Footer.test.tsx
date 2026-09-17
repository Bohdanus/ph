import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Footer from '../Footer.tsx';

const store = vi.hoisted(() => ({
  state: {
    hasImage: true,
    totalSize: { width: 800, height: 600 },
  },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store.state],
}));

describe('Footer', () => {
  it('renders dimensions when an image is loaded', () => {
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).not.toBeNull();
    expect(screen.getByText(/800 × 600 px/)).toBeTruthy();
  });

  it('hides dimensions when no image is loaded', () => {
    store.state = { hasImage: false, totalSize: { width: 800, height: 600 } };
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).toBeNull();
  });

  it('hides dimensions when width is 0', () => {
    store.state = { hasImage: true, totalSize: { width: 0, height: 600 } };
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).toBeNull();
  });

  it('hides dimensions when height is 0', () => {
    store.state = { hasImage: true, totalSize: { width: 800, height: 0 } };
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).toBeNull();
  });
});
