import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SidebarRight from '../SidebarRight.tsx';

const { useStore } = vi.hoisted(() => ({
  useStore: vi.fn(),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore,
}));

const baseState = {
  hasImage: true,
  toolName: 'draw',
  history: [],
  historyIndex: 0,
  layers: {},
  activeLayerId: null,
};

describe('SidebarRight', () => {
  it('renders History and Layers tabs when image and tool are active', () => {
    useStore.mockReturnValue([baseState]);
    render(<SidebarRight />);

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
    expect(screen.getByText('No layers yet.')).toBeInTheDocument();
  });

  it('does not render the tabs when there is no image', () => {
    useStore.mockReturnValue([baseState]);
    const { rerender } = render(<SidebarRight />);
    expect(screen.getByText('History')).toBeInTheDocument();

    useStore.mockReturnValue([{ ...baseState, hasImage: false }]);
    rerender(<SidebarRight />);

    expect(screen.queryByText('History')).not.toBeInTheDocument();
    expect(screen.queryByText('Layers')).not.toBeInTheDocument();
    expect(screen.queryByText('No history yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No layers yet.')).not.toBeInTheDocument();
  });

  it('does not render the tabs when toolName is empty', () => {
    useStore.mockReturnValue([baseState]);
    const { rerender } = render(<SidebarRight />);
    expect(screen.getByText('History')).toBeInTheDocument();

    useStore.mockReturnValue([{ ...baseState, toolName: '' }]);
    rerender(<SidebarRight />);

    expect(screen.queryByText('History')).not.toBeInTheDocument();
    expect(screen.queryByText('Layers')).not.toBeInTheDocument();
  });
});
