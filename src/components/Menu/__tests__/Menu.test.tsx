import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Menu from '../Menu.tsx';
import DesktopHeader from '../../DesktopHeader/DesktopHeader.tsx';
import ToolbarHorizontal from '../../ToolbarHorizontal/ToolbarHorizontal.tsx';

// Menu resolves both children as siblings under src/components, so the mock
// paths below are written relative to this test file, not to Menu.tsx.
vi.mock('../../DesktopHeader/DesktopHeader.tsx', () => ({
  default: vi.fn(() => <div data-testid="desktop-header" />),
}));
vi.mock('../../ToolbarHorizontal/ToolbarHorizontal.tsx', () => ({
  default: vi.fn(() => <div data-testid="toolbar-horizontal" />),
}));

describe('Menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a component', () => {
    expect(typeof Menu).toBe('function');
  });

  it('renders the desktop header above the horizontal toolbar', () => {
    const { container } = render(<Menu />);

    expect(screen.getByTestId('desktop-header')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-horizontal')).toBeInTheDocument();

    const children = Array.from(container.children).map((child) => child.getAttribute('data-testid'));
    expect(children).toEqual(['desktop-header', 'toolbar-horizontal']);
  });

  it('renders each of the two delegated children exactly once', () => {
    render(<Menu />);

    expect(screen.getAllByTestId('desktop-header')).toHaveLength(1);
    expect(screen.getAllByTestId('toolbar-horizontal')).toHaveLength(1);
  });

  it('delegates to the header and the toolbar instead of rendering history controls itself', () => {
    render(<Menu />);

    expect(DesktopHeader).toHaveBeenCalledTimes(1);
    expect(ToolbarHorizontal).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('history-controls')).toBeNull();
  });
});
