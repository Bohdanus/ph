import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Footer from '../Footer.tsx';

const store = vi.hoisted(() => ({
  state: {
    hasImage: true,
    totalSize: { width: 800, height: 600 },
  },
}));

const dispatch = vi.hoisted(() => vi.fn());

const defaultState = { hasImage: true, totalSize: { width: 800, height: 600 } };

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [store.state, dispatch],
}));

describe('Footer', () => {
  beforeEach(() => {
    store.state = { ...defaultState, totalSize: { ...defaultState.totalSize } };
  });

  it('renders dimensions when an image is loaded', () => {
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).not.toBeNull();
    expect(screen.getByText(/800 × 600 px/)).toBeInTheDocument();
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

  it('always renders the copyright line', () => {
    store.state = { hasImage: false, totalSize: { width: 0, height: 0 } };
    render(<Footer />);

    expect(screen.getByText('© 2025 Photo App')).toBeInTheDocument();
  });

  it('renders the exact dimension sentence for a loaded image', () => {
    store.state = { hasImage: true, totalSize: { width: 1920, height: 1080 } };
    render(<Footer />);

    expect(screen.getByText('Dimensions: 1920 × 1080 px')).toBeInTheDocument();
  });

  it('renders a single 1x1 canvas', () => {
    store.state = { hasImage: true, totalSize: { width: 1, height: 1 } };
    render(<Footer />);

    expect(screen.getByText('Dimensions: 1 × 1 px')).toBeInTheDocument();
  });

  it.each([
    [-1, 600],
    [800, -1],
    [-1, -1],
  ])('hides negative dimensions %i x %i', (width, height) => {
    store.state = { hasImage: true, totalSize: { width, height } };
    render(<Footer />);

    expect(screen.queryByText(/Dimensions:/)).toBeNull();
  });

  it('exposes a contentinfo landmark for the footer', () => {
    render(<Footer />);

    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('contains no interactive controls', () => {
    render(<Footer />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
