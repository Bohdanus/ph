import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarRight from '../SidebarRight.tsx';
import { PanelLayoutProvider } from '../../../contexts/PanelLayout.tsx';
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

/**
 * Renders the dock inside a real `PanelLayoutProvider`, optionally seeded from a stored record.
 *
 * Without a provider the context hands out the opening layout and no-op setters (see
 * `PanelLayout.tsx`), so a gesture in an unwrapped render would move nothing and prove nothing.
 * The seed goes through `localStorage` rather than through props because that is the only way a
 * stored layout reaches a fresh mount, and it is the path a reload takes.
 */
const renderWithLayout = (children: ReactNode, stored: Record<string, unknown> = {}) => {
  localStorage.setItem(
    'panelLayout',
    JSON.stringify({
      dockWidth: 250,
      splitRatio: 0.2,
      panelOrder: ['history', 'layers'],
      rolledUp: { history: false, layers: false },
      dockOnLeft: false,
      ...stored,
    })
  );
  return render(<PanelLayoutProvider>{children}</PanelLayoutProvider>);
};

/**
 * jsdom lays nothing out, so the dock reports 0px tall and the document 0px wide. Two gestures
 * genuinely need those numbers — the reorder threshold is the column's middle, and the re-dock
 * zone is a fraction of the viewport — and both are right to refuse on a zero measurement. The
 * numbers are stubbed rather than the branches weakened, which is the same split AGENTS.md
 * draws for `AnchoredOverlay`: geometry by stub, arithmetic pinned here.
 */
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

  it('gives the History and Layers groups complementary shares of the column', () => {
    seed();
    const { container } = render(<SidebarRight />);

    // 0.2 / 0.8 is the `h-[20%]` / `h-[80%]` these two sections used to carry, expressed as
    // flex shares of the column instead. The equivalence is the point: `flex: 0.2 1 0%` over
    // two zero-basis siblings splits free space 20/80, which is exactly what the percentages
    // did, at every column height. A pixel height would have been the tempting rewrite and
    // would have silently rescaled the default with the viewport.
    const [top, bottom] = ['history', 'layers'].map((id) =>
      container.querySelector<HTMLElement>(`[data-testid="panel-group-${id}"]`)
    );
    expect(top?.style.flex).toBe('0.2 1 0%');
    expect(bottom?.style.flex).toBe('0.8 1 0%');
  });

  it('puts the resize divider between the two groups, on the canvas-side edge of the column', () => {
    seed();
    const { container } = render(<SidebarRight />);

    // Both are the two gestures that make the column a dock rather than a fixed panel: the
    // column's own edge, and the boundary between the two groups. "When you drag these icons,
    // all groups that share the divider are resized."
    // Neither handle is focusable or announced. A focusable `role="separator"` is the window
    // splitter widget and must carry `aria-valuenow`/`valuemin`/`valuemax` and answer arrow
    // keys; these carried none and had no key handler, so `tabIndex={0}` was a focus stop that
    // did nothing. Asserting the ABSENCE is the assertion — a `tabIndex` or a `role` reappearing
    // here means a control has been re-promised to keyboard users without being re-implemented.
    const edge = container.querySelector('[data-testid="dock-resize-handle"]');
    const splitter = container.querySelector('[data-testid="dock-splitter"]');
    for (const handle of [edge, splitter]) {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
      expect(handle).not.toHaveAttribute('tabindex');
      expect(handle).not.toHaveAttribute('role');
      expect(handle).not.toHaveAttribute('aria-valuenow');
    }

    // The edge handle is half outside the column, because that is the only place the pointer
    // is unambiguously on the divider. It is a child of the aside, whose `overflow` had to
    // stop being `hidden` for that to be visible at all.
    const aside = container.querySelector('aside')!;
    expect(edge?.parentElement).toBe(aside);
    // On the LEFT of a dock in the right column, because that is the side the canvas is on.
    // A handle on the outer edge is against the window border: unreachable, and it reads as a
    // resize grip for nothing.
    expect(edge).toHaveClass('left-0', 'border-l-2');
    expect(edge).not.toHaveClass('right-0');
    // WITHIN the aside's box, not straddling its edge. An earlier version of this asserted
    // `overflow: hidden` on the aside was what the rule depended on, on the stated basis that
    // the handle sat at `left: -4px`; no rule ever did that, and `e2e/panel-workspace.spec.ts`
    // measures the handle 1px inside the 1px border. The measurement is the assertion, and it
    // is a browser one because jsdom gives every box a zero width.
    expect(edge).not.toHaveClass('-left-4', '-ml-4', '-translate-x-1/2');
    // And the clipping that IS needed is on the inner column, not the aside.
    expect(aside.className).not.toContain('overflow-hidden');
    expect(aside.querySelector(':scope > .overflow-hidden')).not.toBeNull();
  });

  it('drags the tab to reorder, and draws the drop target before the release', async () => {
    seed();
    const restoreLayout = withLayout();
    try {
      const { container } = renderWithLayout(<SidebarRight />);

      const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
      // "Drag a panel on to a blue zone to dock it" / "Release the tab when a blue highlight
      // appears" — the affordance is shown DURING the drag, never after it.
      // Started well inside the viewport: from the left edge the same gesture would be a
      // re-dock instead, and the vertical drag would be measured against nothing.
      fireEvent.pointerDown(historyTab, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 100 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 500 });

      // Past the column's middle, so the tab would land second.
      const line = container.querySelector('[data-testid="panel-drop-line"]');
      expect(line).toBeInTheDocument();
      expect(line).toHaveClass('bottom-0');

      fireEvent.pointerUp(document, { pointerId: 1 });
      expect(screen.getAllByText(/^(History|Layers)$/).map((n) => n.textContent)).toEqual(['Layers', 'History']);
    } finally {
      restoreLayout();
    }
  });

  it('cancels a tab drag on Escape and leaves the order alone', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
    const restoreLayout = withLayout();
    try {
      fireEvent.pointerDown(historyTab, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 100 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 500 });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(screen.getAllByText(/^(History|Layers)$/).map((n) => n.textContent)).toEqual(['History', 'Layers']);
    } finally {
      restoreLayout();
    }
  });

  it('drags a tab at the opposite workspace edge to move the whole dock', () => {
    seed();
    const restoreLayout = withLayout();
    try {
      const { container } = renderWithLayout(<SidebarRight />);

      const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
      // The document is 1024px wide in jsdom, so 25% of it is 256. Past that is the drop zone
      // "To create a dock, move panels to the right edge of the workspace until a drop zone
      // appears."
      fireEvent.pointerDown(historyTab, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 100 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 100 });

      expect(container.querySelector('[data-testid="dock-edge-line"]')).toHaveClass('left-0');
      // The reorder indicator is suppressed while the dock is being thrown at the other edge:
      // showing both would be a lie about what the release will do.
      expect(container.querySelector('[data-testid="panel-drop-line"]')).toBeNull();

      fireEvent.pointerUp(document, { pointerId: 1 });

      const aside = container.querySelector('aside')!;
      expect(aside).toHaveClass('[grid-area:left]');
      expect(aside).toHaveClass('border-r');
    } finally {
      restoreLayout();
    }
  });

  it('opens at 250px, on the element rather than on a track', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    // The half of `App.tsx`'s `auto`-track rule this component is the other half of. If this
    // number were a class here instead of an inline width, the tablet collapse — which is a
    // `display: none` item — would stop reclaiming the column.
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.style.width).toBe('250px');
    expect(aside.className).not.toContain('250');
  });

  it('resizes the column from its canvas-side edge, and narrows towards the canvas', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const edge = container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;
    // The dock is to the canvas's right, so dragging the divider LEFT widens it.
    fireEvent.pointerDown(edge, { button: 0, buttons: 1, pointerId: 1, clientX: 774, clientY: 300 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 674, clientY: 300 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('350px');
  });

  it("moves the divider to the dock's other side once the dock is on the left edge", () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />, { dockOnLeft: true });

    // The one rule, twice: the handle is always on the canvas side, so it mirrors when the
    // dock does. Pinning only the default leaves the mirrored case to be discovered in a
    // browser, which is where it was.
    const edge = container.querySelector('[data-testid="dock-resize-handle"]');
    expect(edge).toHaveClass('right-0', 'border-r-2');
    expect(edge).not.toHaveClass('left-0');
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

      // The handle is rendered on the collapsed strip too, so it is hittable. Measured from the
      // REMEMBERED width, one pixel of movement would have opened a 250px dock — a 211px jump
      // that also overwrote the width the user had chosen.
      fireEvent.pointerDown(edge(), { button: 0, buttons: 1, pointerId: 1, clientX: collapsedAt, clientY: 400 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: collapsedAt - 20, clientY: 400 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      // 40 on screen, 20 dragged left. Anything near 250 is the bug.
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

      // A cancel restores the STARTING value, and the starting value here is a collapsed 40px
      // dock. Restoring the remembered 250 instead would have expanded it — the one thing a
      // cancel must not do.
      expect(dock().style.width).toBe('40px');
    } finally {
      restoreLayout();
    }
  });

  it('reverses the drag direction once the dock is on the left edge', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />, { dockOnLeft: true });

    const edge = container.querySelector('[data-testid="dock-resize-handle"]') as HTMLElement;
    // The divider is on the dock's other side now, so the same gesture widens in the other
    // direction. Without the sign flip, dragging right would narrow a dock on the left edge,
    // which is backwards.
    fireEvent.pointerDown(edge, { button: 0, buttons: 1, pointerId: 1, clientX: 250, clientY: 300 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 350, clientY: 300 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('350px');
  });

  it('resizes both groups when the shared divider is dragged', () => {
    seed();
    const restoreLayout = withLayout({ dockHeight: 600 });
    try {
      const { container } = renderWithLayout(<SidebarRight />);
      const shares = () =>
        ['history', 'layers'].map((id) => {
          const group = container.querySelector<HTMLElement>(`[data-testid="panel-group-${id}"]`)!;
          // The first number of the `flex` shorthand is the grow factor, which IS the share
          // of the column's free space. Reading it back is the assertion; an earlier version
          // asserted `!Number.isNaN(parseFloat(style.flex))`, which is true of every string
          // `flex` can hold and of a divider drag that did nothing at all.
          return Number.parseFloat(group.style.flex);
        });

      const before = shares();

      // UP by 100px of a 600px column, which is a sixth of the column: the top panel's share
      // rises by exactly that and the bottom one's falls by the same amount, because they
      // share one divider. "All groups that share the divider are resized."
      const splitter = container.querySelector('[data-testid="dock-splitter"]') as HTMLElement;
      fireEvent.pointerDown(splitter, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 300 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 200 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      const after = shares();
      expect(after[0] - before[0]).toBeCloseTo(1 / 6, 2);
      expect(after[1] - before[1]).toBeCloseTo(-1 / 6, 2);
      // Complementary, so the column is never over- or under-filled by the pair.
      expect(after[0] + after[1]).toBeCloseTo(1, 10);
    } finally {
      restoreLayout();
    }
  });

  it('refuses to divide a column that measures zero', () => {
    seed();
    // A column that measures nothing, which is both jsdom's default and what a dock does in the
    // frame between being hidden and being laid out. Dividing by it writes Infinity, and
    // Infinity through a clamp is a share no drag can reach back from — so the guard has to be
    // the early return rather than the arithmetic below it.
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

    // "To show only the icons, adjust the dock width until the labels disappear."
    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.style.width).toBe('40px');
    expect(container.querySelector('[data-testid="dock-icon-strip"]')).toBeInTheDocument();
    expect(screen.queryByText('History')).toBeNull();

    // An icon strip with no way out is a one-way trip, so the double-arrow comes with it, under
    // a DIFFERENT testid from the header's. They are mutually exclusive renders today, and a
    // shared one would silently turn the first of the pair into a strict-mode violation the
    // moment anything ever renders both.
    fireEvent.click(container.querySelector('[data-testid="dock-icon-strip"] [data-testid="dock-icon-expand"]')!);
    expect(aside.style.width).toBe('250px');
  });

  it('expands one panel from the icon strip and keeps the other rolled up', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    fireEvent.click(container.querySelector('[data-testid="dock-collapse-toggle"]')!);
    // "Select a single panel icon to expand only that panel."
    fireEvent.click(container.querySelector('[data-testid="dock-icon-layers"]')!);

    // The one that was selected is the one that came back, at the full dock width, with the
    // other group left as a bare tab bar — which is the whole of what "only that panel" means.
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('250px');
    const layers = container.querySelector('[data-testid="panel-group-layers"]') as HTMLElement;
    const history = container.querySelector('[data-testid="panel-group-history"]') as HTMLElement;
    expect(layers.style.flex).toBe('0.8 1 0%');
    expect(history.style.flex).toBe('0 0 auto');
    // The rolled-up group has its tab and nothing else — the assertion that is actually about
    // the roll-up, since its heading is meant to still be there.
    expect(history.querySelector('.overflow-y-auto')).toBeNull();
    expect(layers.querySelector('.overflow-y-auto')).not.toBeNull();
  });

  it('rolls a group up to its tab bar on a double-click, and back down', () => {
    seed();
    const { container } = renderWithLayout(<SidebarRight />);

    const historyTab = container.querySelector('[data-testid="panel-header-history"]') as HTMLElement;
    // "To collapse a panel group so that only the dock header bar and tabs are visible,
    // double-click a panel tab or panel title bar. Double-click again to restore it."
    fireEvent.doubleClick(historyTab);

    const group = container.querySelector('[data-testid="panel-group-history"]') as HTMLElement;
    expect(group.style.flex).toBe('0 0 auto');
    expect(historyTab).toHaveAttribute('aria-expanded', 'false');
    // The tab is the only thing left of it. Its HEADING is meant to still be there — a
    // roll-up leaves the tab bar, not an empty box — so the assertion is about the body.
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
});
