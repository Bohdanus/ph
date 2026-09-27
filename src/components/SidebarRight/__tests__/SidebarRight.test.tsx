import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarRight from '../SidebarRight.tsx';
import { createMockStoreState, type MockStoreState } from '@/__tests__/fixtures/store.ts';
import type { ToolName } from '@/contexts/tool-types.ts';

/**
 * `SidebarRight` is a pure gate around its two tabs: it reads `hasImage`/`toolName` from
 * the store and either renders the History + Layers stack or a collapsed spacer. The
 * store boundary is mocked (including `useLayers`/`useHistory`, so no real editor hook
 * runs) and every assertion is about what the panel does or does not render.
 */
const { useStore, storeDispatch, layerActions, historyActions } = vi.hoisted(() => {
  const dispatchSpy = vi.fn();
  const layerActionMocks = {
    toggleVisibility: vi.fn(),
    removeLayer: vi.fn(),
    moveLayerAfter: vi.fn(),
    setActiveLayer: vi.fn(),
    updateLayer: vi.fn(),
  };
  const historyActionMocks = { resetHistoryTo: vi.fn(), toggleDisabled: vi.fn() };
  return {
    useStore: vi.fn(),
    storeDispatch: dispatchSpy,
    layerActions: layerActionMocks,
    historyActions: historyActionMocks,
  };
});

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore,
}));

vi.mock('@/contexts/useLayer.ts', () => ({ useLayers: () => layerActions }));

vi.mock('@/contexts/useHistory.ts', () => ({
  useHistory: () => historyActions,
  getHistoryItemTitle: (item: { actionName: string }) => item.actionName,
}));

/**
 * The store types `toolName` as `ToolName`, but the panel's guard is a plain
 * falsy check, so an empty string is exactly the state under test.
 */
const NO_TOOL = '' as ToolName;

function seed(overrides: Partial<MockStoreState> = {}) {
  useStore.mockReturnValue([createMockStoreState({ hasImage: true, toolName: 'draw', ...overrides }), storeDispatch]);
}

describe('SidebarRight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders History and Layers tabs when image and tool are active', () => {
    seed();
    render(<SidebarRight />);

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
    expect(screen.getByText('No layers yet.')).toBeInTheDocument();
  });

  it('does not render the tabs when there is no image', () => {
    seed();
    const { rerender } = render(<SidebarRight />);
    expect(screen.getByText('History')).toBeInTheDocument();

    seed({ hasImage: false });
    rerender(<SidebarRight />);

    expect(screen.queryByText('History')).toBeNull();
    expect(screen.queryByText('Layers')).toBeNull();
    expect(screen.queryByText('No history yet.')).toBeNull();
    expect(screen.queryByText('No layers yet.')).toBeNull();
  });

  it('does not render the tabs when toolName is empty', () => {
    seed();
    const { rerender } = render(<SidebarRight />);
    expect(screen.getByText('History')).toBeInTheDocument();

    seed({ toolName: NO_TOOL });
    rerender(<SidebarRight />);

    expect(screen.queryByText('History')).toBeNull();
    expect(screen.queryByText('Layers')).toBeNull();
  });

  it('keeps the panel mounted as a collapsed spacer when the tabs are hidden', () => {
    seed({ hasImage: false });
    const { container } = render(<SidebarRight />);

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveClass('max-md:hidden');
    // the spacer keeps the grid slot but drops the full-panel layout classes
    expect(aside).not.toHaveClass('flex', 'flex-col', 'overflow-hidden');
    expect(container.querySelectorAll('ul')).toHaveLength(0);
  });

  it('lays out History above Layers inside the right grid area', () => {
    seed();
    const { container } = render(<SidebarRight />);

    const aside = container.querySelector('aside')!;
    expect(aside).toHaveClass('[grid-area:right]');

    const headings = screen.getAllByText(/^(History|Layers)$/).map((node) => node.textContent);
    expect(headings).toEqual(['History', 'Layers']);
  });

  it('gives the History and Layers sections complementary heights', () => {
    seed();
    const { container } = render(<SidebarRight />);

    const [historySection, layersSection] = Array.from(container.querySelectorAll('aside > div'));
    expect(historySection).toHaveClass('h-[20%]');
    expect(layersSection).toHaveClass('h-[80%]');
  });

  it('shows the panel once both an image and a tool become available again', () => {
    seed({ hasImage: false, toolName: NO_TOOL });
    const { rerender } = render(<SidebarRight />);
    expect(screen.queryByText('Layers')).toBeNull();

    seed({ hasImage: true, toolName: 'draw' });
    rerender(<SidebarRight />);

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Layers')).toBeInTheDocument();
  });

  it('does not dispatch anything just by mounting the panel', () => {
    seed();
    render(<SidebarRight />);

    expect(storeDispatch).not.toHaveBeenCalled();
  });
});
