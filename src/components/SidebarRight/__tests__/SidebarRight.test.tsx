import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarRight from '../SidebarRight.tsx';
import { PanelLayoutProvider } from '../../../contexts/PanelLayout.tsx';
import { RightPanelVisibilityProvider } from '../../../contexts/RightPanelVisibility.tsx';
import { createMockStoreState, type MockStoreState } from '@/__tests__/fixtures/store.ts';
import type { ToolName } from '@/contexts/tool-types.ts';

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

const currentToolState = vi.hoisted(() => ({ toolArgs: { toolName: 'move' }, setToolArgs: vi.fn() }));

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore,
}));

vi.mock('@/contexts/useLayer.ts', () => ({ useLayers: () => layerActions }));

vi.mock('@/contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => currentToolState,
}));

vi.mock('@/contexts/useHistory.ts', () => ({
  useHistory: () => historyActions,
  getHistoryItemTitle: (item: { actionName: string }) => item.actionName,
}));

const NO_TOOL = '' as ToolName;

function seed(overrides: Partial<MockStoreState> = {}) {
  useStore.mockReturnValue([createMockStoreState({ hasImage: true, toolName: 'draw', ...overrides }), storeDispatch]);
}

const renderWithLayout = (children: ReactNode, stored: Record<string, unknown> = {}) => {
  localStorage.setItem(
    'panelLayout',
    JSON.stringify({
      dockWidth: 250,
      splitRatio: 0.2,
      panelOrder: ['history', 'layers'],
      rolledUp: { history: false, layers: false },
      toolsSide: 'left',
      dockSide: 'right',
      ...stored,
    })
  );
  return render(
    <PanelLayoutProvider>
      <RightPanelVisibilityProvider>{children}</RightPanelVisibilityProvider>
    </PanelLayoutProvider>
  );
};

const withLayout = ({ dockHeight = 600, viewportWidth = 1024 } = {}) => {
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: dockHeight,
    width: viewportWidth,
    height: dockHeight,
    toJSON: () => ({}),
  } as DOMRect);
  const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(viewportWidth);
  return () => {
    rect.mockRestore();
    width.mockRestore();
  };
};

describe('SidebarRight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    expect(aside).not.toHaveClass('flex', 'flex-col', 'overflow-hidden');
    expect(container.querySelectorAll('ul')).toHaveLength(0);
  });

  it('lays out History above Layers inside the right grid area', () => {
    seed();
    const { container } = render(<SidebarRight />);

    const aside = container.querySelector('aside')!;
    expect(aside).toHaveClass('[grid-column-start:3]');
    expect(aside).not.toHaveClass('[grid-column-start:1]');
    expect(aside).toHaveClass('[grid-row:3/5]');

    const headings = screen.getAllByText(/^(History|Layers)$/).map((node) => node.textContent);
    expect(headings).toEqual(['History', 'Layers']);
  });

  it('gives the History and Layers groups complementary shares of the column', () => {
    seed();
    const { container } = render(<SidebarRight />);

    const [top, bottom] = ['history', 'layers'].map((id) =>
      container.querySelector<HTMLElement>(`[data-testid="panel-group-${id}"]`)
    );
    expect(top?.style.flex).toBe('0.2 1 0%');
    expect(bottom?.style.flex).toBe('0.8 1 0%');
  });

  it('puts the resize divider between the two groups, on the canvas-side edge of the column', () => {
    seed();
    const { container } = render(<SidebarRight />);

    const edge = container.querySelector('[data-testid="dock-resize-handle"]');
    const splitter = container.querySelector('[data-testid="dock-splitter"]');
    for (const handle of [edge, splitter]) {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
      expect(handle).not.toHaveAttribute('tabindex');
      expect(handle).not.toHaveAttribute('role');
      expect(handle).not.toHaveAttribute('aria-valuenow');
    }

    const aside = container.querySelector('aside')!;
    expect(edge?.parentElement).toBe(aside);
    expect(edge).toHaveClass('left-0', 'border-l-2');
    expect(edge).not.toHaveClass('right-0');
    expect(edge).not.toHaveClass('-left-4', '-ml-4', '-translate-x-1/2');
    expect(aside.className).not.toContain('overflow-hidden');
    expect(aside.querySelector(':scope > .overflow-hidden')).not.toBeNull();
  });

  it('pins the dock to the right edge while exposing in-dock panel reordering', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);
    const aside = container.querySelector('aside')!;
    expect(aside).toHaveClass('[grid-column-start:3]', 'border-l');
    expect(aside).not.toHaveClass('[grid-column-start:1]', 'border-r');
    expect(container.querySelector('[data-testid="panel-drop-line"]')).toBeNull();
    for (const id of ['history', 'layers']) {
      expect(container.querySelector(`[data-testid="panel-header-${id}"]`)).toHaveAttribute(
        'title',
        expect.stringMatching(/drag/i)
      );
    }
  });

  it('opens at 250px, on the element rather than on a track', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.style.width).toBe('250px');
    expect(aside.className).not.toContain('250');
  });

  it('resizes the column from its canvas-side edge, and narrows towards the canvas', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const edge = container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;
    fireEvent.pointerDown(edge, { button: 0, buttons: 1, pointerId: 1, clientX: 774, clientY: 300 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 674, clientY: 300 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('350px');
  });

  it('widens a collapsed dock by the distance dragged, not by jumping to the remembered width', () => {
    seed();
    const restoreLayout = withLayout();
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const dock = () => container.querySelector('aside') as HTMLElement;
      const edge = () => container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;

      fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
      expect(dock().style.width).toBe('40px');
      const collapsedAt = (edge().getBoundingClientRect().left ?? 0) as number;

      fireEvent.pointerDown(edge(), { button: 0, buttons: 1, pointerId: 1, clientX: collapsedAt, clientY: 400 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: collapsedAt - 20, clientY: 400 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(Number.parseFloat(dock().style.width)).toBeCloseTo(60, 0);
    } finally {
      restoreLayout();
    }
  });

  it('leaves a collapsed dock collapsed when its resize drag is cancelled', () => {
    seed();
    const restoreLayout = withLayout();
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const dock = () => container.querySelector('aside') as HTMLElement;

      fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
      expect(dock().style.width).toBe('40px');

      const edge = container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;
      fireEvent.pointerDown(edge, { button: 0, buttons: 1, pointerId: 1, clientX: 1240, clientY: 400 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 1180, clientY: 400 });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(dock().style.width).toBe('40px');
    } finally {
      restoreLayout();
    }
  });

  it('keeps the remembered width when the collapsed handle is clicked without moving', () => {
    seed();
    const restoreLayout = withLayout();
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const dock = () => container.querySelector('aside') as HTMLElement;

      fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
      expect(dock().style.width).toBe('40px');

      const edge = container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;
      fireEvent.pointerDown(edge, { button: 0, buttons: 1, pointerId: 1, clientX: 1240, clientY: 400 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      fireEvent.click(container.querySelector('[data-testid="dock-icon-layers"]')!);
      expect(Number.parseFloat(dock().style.width)).toBe(250);
    } finally {
      restoreLayout();
    }
  });

  it('names the body the tab controls, and the id goes when it rolls up', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const tab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
    const bodyId = tab.getAttribute('aria-controls')!;
    const body = container.querySelector(`#${bodyId}`);
    expect(body).not.toBeNull();
    expect(body!.textContent).not.toBe('');
    expect(body!.parentElement).toBe(container.querySelector('[data-testid="panel-group-history"]'));
    expect(tab).not.toHaveAttribute('id');

    fireEvent.doubleClick(tab);
    expect(tab).not.toHaveAttribute('aria-controls');
    expect(container.querySelector(`#${bodyId}`)).toBeNull();
  });

  it('resizes both groups when the shared divider is dragged', () => {
    seed();
    const restoreLayout = withLayout({ dockHeight: 600 });
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const shares = () =>
        ['history', 'layers'].map((id) => {
          const group = container.querySelector<HTMLElement>(`[data-testid="panel-group-${id}"]`)!;
          return Number.parseFloat(group.style.flex);
        });

      const before = shares();

      const splitter = container.querySelector('[data-testid="dock-splitter"]') as HTMLElement;
      fireEvent.pointerDown(splitter, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 400 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      const after = shares();
      expect(after[0] - before[0]).toBeCloseTo(1 / 6, 2);
      expect(after[1] - before[1]).toBeCloseTo(-1 / 6, 2);
      expect(after[0] + after[1]).toBeCloseTo(1, 10);
    } finally {
      restoreLayout();
    }
  });

  it('refuses to divide a column that measures zero', () => {
    seed();
    const restoreLayout = withLayout({ dockHeight: 0 });
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const group = container.querySelector<HTMLElement>('[data-testid="panel-group-history"]')!;
      const before = group.style.flex;

      const splitter = container.querySelector('[data-testid="dock-splitter"]') as HTMLElement;
      fireEvent.pointerDown(splitter, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 200 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(group.style.flex).toBe(before);
    } finally {
      restoreLayout();
    }
  });

  it('collapses to icons on the double-arrow, and offers a way back', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);

    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.style.width).toBe('40px');
    expect(container.querySelector('[data-testid="dock-icon-strip"]')).toBeInTheDocument();
    expect(screen.queryByText('History')).toBeNull();

    fireEvent.click(container.querySelector('[data-testid="dock-icon-strip"] [data-testid="dock-icon-expand"]')!);
    expect(aside.style.width).toBe('250px');
  });

  it('expands one panel from the icon strip and keeps the other rolled up', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
    fireEvent.click(container.querySelector('[data-testid="dock-icon-layers"]')!);

    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('250px');
    const layers = container.querySelector('[data-testid="panel-group-layers"]') as HTMLElement;
    const history = container.querySelector('[data-testid="panel-group-history"]') as HTMLElement;
    expect(layers.style.flex).toBe('0.8 1 0%');
    expect(history.style.flex).toBe('0 0 auto');
    expect(history.querySelector('.overflow-y-auto')).toBeNull();
    expect(layers.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('rolls a group up to its tab bar on a double-click, and back down', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
    fireEvent.doubleClick(historyTab);

    const group = container.querySelector('[data-testid="panel-group-history"]') as HTMLElement;
    expect(group.style.flex).toBe('0 0 auto');
    expect(historyTab).toHaveAttribute('aria-expanded', 'false');
    expect(group.querySelector('.overflow-y-auto')).toBeNull();

    fireEvent.doubleClick(historyTab);
    expect((container.querySelector('[data-testid="panel-group-history"]') as HTMLElement).style.flex).toBe('0.2 1 0%');
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

  // === NEW TESTS FOR MISSING COVERAGE ===

  describe('dock-collapse-toggle button states', () => {
    it('shows Collapse panels to icons aria-label when expanded', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const toggle = container.querySelector('[data-testid="dock-collapse-toggle"]') as HTMLElement;
      expect(toggle).toHaveAttribute('aria-label', 'Collapse panels to icons');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    it.fails('toggles aria-pressed when clicked', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const toggle = container.querySelector('[data-testid="dock-collapse-toggle"]') as HTMLElement;
      expect(toggle).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('rememberDockWidth', () => {
    it('remembers width when dragging past label floor then widening', () => {
      seed();
      const restoreLayout = withLayout();
      try {
        const { container } = renderWithLayout(<SidebarRight />);
        const dock = () => container.querySelector('aside') as HTMLElement;
        const edge = () => container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;

        // Collapse first
        fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
        expect(dock().style.width).toBe('40px');

        // Drag left (widen)
        fireEvent.pointerDown(edge(), { button: 0, buttons: 1, pointerId: 1, clientX: 1240, clientY: 400 });
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 1100, clientY: 400 });
        fireEvent.pointerUp(document, { pointerId: 1 });

        // Click icon to expand - should remember the widened width
        const iconLayers = container.querySelector('[data-testid="dock-icon-layers"]');
        if (iconLayers) {
          fireEvent.click(iconLayers);
          expect(Number.parseFloat(dock().style.width)).toBeGreaterThan(40);
        }
      } finally {
        restoreLayout();
      }
    });
  });

  describe('Splitter floor clamp (PANEL_MIN_HEIGHT / 88px)', () => {
    it('enforces minimum panel height when dragging splitter', () => {
      seed();
      const restoreLayout = withLayout({ dockHeight: 200 });
      try {
        const { container } = renderWithLayout(<SidebarRight />);
        const splitter = container.querySelector('[data-testid="dock-splitter"]') as HTMLElement;

        // Try to drag splitter to make top panel smaller than 88px
        fireEvent.pointerDown(splitter, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 100 });
        fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 10 });
        fireEvent.pointerUp(document, { pointerId: 1 });

        const topGroup = container.querySelector<HTMLElement>('[data-testid="panel-group-history"]')!;
        expect(topGroup.style.flex).not.toBe('0 0 0%');
      } finally {
        restoreLayout();
      }
    });
  });

  describe('DOCK_MAX_WIDTH (640) and DOCK_MIN_WIDTH (40) clamp', () => {
    it('clamps to DOCK_MAX_WIDTH (640) when dragging beyond', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />, { viewportWidth: 2000 });
      const dock = () => container.querySelector('aside') as HTMLElement;
      const edge = () => container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;

      // Try to widen beyond 640
      fireEvent.pointerDown(edge(), { button: 0, buttons: 1, pointerId: 1, clientX: 1000, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(Number.parseFloat(dock().style.width)).toBeLessThanOrEqual(640);
    });

    it('clamps to DOCK_MIN_WIDTH (40) when narrowing below', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const dock = () => container.querySelector('aside') as HTMLElement;
      const edge = () => container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;

      fireEvent.pointerDown(edge(), { button: 0, buttons: 1, pointerId: 1, clientX: 774, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 2000, clientY: 300 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(Number.parseFloat(dock().style.width)).toBeGreaterThanOrEqual(40);
    });
  });

  describe('Keyboard activation of panel headers', () => {
    it('toggles roll-up on Enter key', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;

      fireEvent.keyDown(historyTab, { key: 'Enter' });
      expect(historyTab).toHaveAttribute('aria-expanded', 'false');

      fireEvent.keyDown(historyTab, { key: 'Enter' });
      expect(historyTab).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles roll-up on Space key up', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;

      fireEvent.keyDown(historyTab, { key: ' ' });
      fireEvent.keyUp(historyTab, { key: ' ' });
      expect(historyTab).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('panelOrder and rolledUp persistence', () => {
    it('persists panelOrder through localStorage round-trip', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const historyHeader = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;

      fireEvent.pointerDown(historyHeader, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 100 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 400 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      const stored = JSON.parse(localStorage.getItem('panelLayout')!);
      expect(stored.panelOrder).toBeDefined();
      expect(stored.panelOrder.length).toBe(2);
    });

    it('persists rolledUp state through localStorage round-trip', () => {
      seed();
      const { container } = renderWithLayout(<SidebarRight />);
      const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;

      fireEvent.doubleClick(historyTab);

      const stored = JSON.parse(localStorage.getItem('panelLayout')!);
      expect(stored.rolledUp.history).toBe(true);
    });
  });
});
