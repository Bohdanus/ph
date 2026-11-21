import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionPixelBudgetNotice } from '../SelectionPixelBudgetNotice.tsx';
import { MAX_RASTER_SELECTION_PIXELS } from '../../../util/selection-mask.ts';

const mockStore = vi.hoisted(() => ({
  totalSize: { width: 1, height: 1 } as { width: number | undefined; height: number | undefined } | undefined,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [mockStore, vi.fn()],
}));

describe('SelectionPixelBudgetNotice', () => {
  beforeEach(() => {
    mockStore.totalSize = { width: 1, height: 1 };
  });

  it.each([
    ['below the limit', MAX_RASTER_SELECTION_PIXELS - 1, 1],
    ['exactly at the limit', MAX_RASTER_SELECTION_PIXELS, 1],
  ])('renders nothing when the document is %s', (_label, width, height) => {
    mockStore.totalSize = { width, height };

    const { container } = render(<SelectionPixelBudgetNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the localized pixel counts in an accessible status when over the limit', () => {
    const width = MAX_RASTER_SELECTION_PIXELS + 1;
    const height = 1;
    mockStore.totalSize = { width, height };

    render(<SelectionPixelBudgetNotice />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice).toHaveTextContent(`above ${MAX_RASTER_SELECTION_PIXELS.toLocaleString()} pixels`);
    expect(notice).toHaveTextContent(`has ${(width * height).toLocaleString()} pixels`);
  });

  it.each([
    ['width', MAX_RASTER_SELECTION_PIXELS + 0.9, 1],
    ['height', 1, MAX_RASTER_SELECTION_PIXELS + 0.9],
  ])('floors fractional %s before comparing against the limit', (_label, width, height) => {
    mockStore.totalSize = { width, height };

    const { container } = render(<SelectionPixelBudgetNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('reports the floored pixel count when fractional dimensions remain over the limit', () => {
    mockStore.totalSize = { width: MAX_RASTER_SELECTION_PIXELS + 1.9, height: 1 };

    render(<SelectionPixelBudgetNotice />);

    expect(screen.getByRole('status')).toHaveTextContent(
      `has ${(MAX_RASTER_SELECTION_PIXELS + 1).toLocaleString()} pixels`
    );
  });

  it.each([
    ['zero width', 0, 8000],
    ['zero height', 8000, 0],
    ['negative width', -1, 8000],
    ['non-finite width', Number.POSITIVE_INFINITY, 8000],
    ['non-finite height', 8000, Number.POSITIVE_INFINITY],
    ['an unsafe pixel count', 100_000_000, 100_000_000],
  ])('renders nothing for %s', (_label, width, height) => {
    mockStore.totalSize = { width, height };

    const { container } = render(<SelectionPixelBudgetNotice />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when total size is missing', () => {
    mockStore.totalSize = undefined;

    const { container } = render(<SelectionPixelBudgetNotice />);

    expect(container).toBeEmptyDOMElement();
  });
});
