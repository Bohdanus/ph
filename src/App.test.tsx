import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { setViewportWidth } from './test/setup.ts';

const setBlankImage = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({
  canvasRef: { current: null },
  containerRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  hasImage: false,
  hasUnsavedChanges: false,
  currentArgs: { current: {} },
  layers: {},
  toolName: 'reposition',
  totalSize: { width: 800, height: 600 },
}));

const useStoreMock = vi.hoisted(() => vi.fn());

vi.mock('./components/Menu/Menu', () => ({ default: () => <div>Menu</div> }));
vi.mock('./components/Footer/Footer', () => ({ default: () => <div>Footer</div> }));
vi.mock('./components/SidebarLeft/SidebarLeft', () => ({ default: () => <div>SidebarLeft</div> }));
vi.mock('./components/SidebarRight/SidebarRight', () => ({ default: () => <div>SidebarRight</div> }));
vi.mock('./components/Main/Main.tsx', () => ({ default: () => <div>Main</div> }));
// Reports the props it was handed, so the surface flags `AppContainer` owns are observable
// without mounting the real mobile tree.
vi.mock('./components/Mobile/MobileShell.tsx', () => ({
  MobileShell: ({
    isToolSheetOpen,
    onToggleToolSheet,
    isLayersOpen,
    onToggleLayers,
  }: {
    isToolSheetOpen?: boolean;
    onToggleToolSheet: () => void;
    isLayersOpen?: boolean;
    onToggleLayers: () => void;
  }) => (
    <div
      data-testid="mobile-shell-props"
      data-tool-sheet={String(Boolean(isToolSheetOpen))}
      data-layers={String(Boolean(isLayersOpen))}
    >
      MobileShell
      <button type="button" onClick={onToggleToolSheet}>
        Tool options
      </button>
      <button type="button" onClick={onToggleLayers}>
        Layers
      </button>
    </div>
  ),
}));
vi.mock('./components/Common/AppKeyboardShortcuts.tsx', () => ({ AppKeyboardShortcuts: () => <div>Shortcuts</div> }));
vi.mock('./contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('./contexts/StoreContext.tsx', () => ({
  StoreProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useStore: () => useStoreMock(),
}));
vi.mock('./contexts/useCurrentTool.tsx', () => ({
  CurrentToolProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./contexts/useFile.tsx', () => ({
  FileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./hooks/useKeyboardEvents.tsx', () => ({
  KeyboardEventsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./hooks/useApp.ts', () => ({
  useApp: () => ({ setBlankImage }),
}));

describe('App', () => {
  beforeEach(() => {
    setBlankImage.mockClear();
    dispatch.mockClear();
    useStoreMock.mockClear();
    storeState.hasImage = false;
    useStoreMock.mockImplementation(() => [storeState, dispatch]);
    localStorage.clear();
    setViewportWidth(1280, 800);
  });

  afterEach(() => {
    setViewportWidth(1280, 800);
  });

  it('starts with a default blank image and skips the landing screen', async () => {
    render(<App />);

    await waitFor(() => {
      expect(setBlankImage).toHaveBeenCalledWith({
        color: '#ffffff',
        opacity: 1,
        size: { width: 800, height: 600 },
        isBedrock: true,
      });
    });
  });

  it('never starts a blank image when a document is already open', async () => {
    storeState.hasImage = true;
    render(<App />);

    await waitFor(() => {
      expect(useStoreMock).toHaveBeenCalled();
    });

    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('starts the blank image exactly once even when the tree re-renders', async () => {
    const { rerender } = render(<App />);

    await waitFor(() => {
      expect(setBlankImage).toHaveBeenCalledTimes(1);
    });

    rerender(<App />);
    rerender(<App />);

    await waitFor(() => {
      expect(useStoreMock.mock.calls.length).toBeGreaterThan(1);
    });
    expect(setBlankImage).toHaveBeenCalledTimes(1);
  });

  it('does not start a second blank image after the store reports an image', async () => {
    const { rerender } = render(<App />);
    await waitFor(() => {
      expect(setBlankImage).toHaveBeenCalledTimes(1);
    });

    storeState.hasImage = true;
    rerender(<App />);

    expect(setBlankImage).toHaveBeenCalledTimes(1);
  });

  it('composes every application region exactly once', () => {
    render(<App />);

    for (const region of ['Menu', 'Footer', 'SidebarLeft', 'SidebarRight', 'Main', 'Shortcuts']) {
      expect(screen.getByText(region)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Main')).toHaveLength(1);
  });

  it('reads the store as a [state, dispatch] tuple', () => {
    render(<App />);

    const [state, storeDispatch] = useStoreMock.mock.results[0].value as [typeof storeState, typeof dispatch];
    expect(state).toBe(storeState);
    expect(storeDispatch).toBe(dispatch);
  });

  it('does not create a blank image after unmount', async () => {
    const { unmount } = render(<App />);
    await waitFor(() => {
      expect(setBlankImage).toHaveBeenCalledTimes(1);
    });

    unmount();
    storeState.hasImage = false;
    useStoreMock.mockImplementation(() => [storeState, dispatch]);

    expect(setBlankImage).toHaveBeenCalledTimes(1);
  });
});

/**
 * The desktop-first contract.
 *
 * Everything above pins the blank-image lifecycle. These pin the shell's shape, because
 * that is what a mobile addition can break without any test noticing: presence assertions
 * pass for a region that moved, and a JS breakpoint is a silent remount of the canvas.
 */
describe('App shell layout', () => {
  beforeEach(() => {
    setViewportWidth(1280, 800);
    storeState.hasImage = true;
    useStoreMock.mockImplementation(() => [storeState, dispatch]);
    localStorage.clear();
  });

  it('keeps the desktop regions in their original DOM order', () => {
    const { container } = render(<App />);

    // Grid areas place these visually, so the order is free — but it is the order keyboard
    // focus follows, and it is what a careless edit to this JSX silently reorders. The
    // mobile shell is appended last, so desktop focus order is unchanged.
    //
    // Each region's LABEL, not its whole `textContent`: the `MobileShell` mock carries
    // toggle buttons beside its label, so the aggregate text is not the region name.
    const grid = container.firstElementChild as HTMLElement;
    const regions = Array.from(grid.children).map((child) => child.firstChild?.textContent);

    expect(regions).toEqual(['Shortcuts', 'Menu', 'SidebarLeft', 'Main', 'SidebarRight', 'Footer', 'MobileShell']);
  });

  it('preserves the desktop grid template and adds the tablet column rule', () => {
    const { container } = render(<App />);

    const classes = (container.firstElementChild as HTMLElement).className;

    // The desktop areas are load-bearing: five regions are assigned to `header`, `toolbar`,
    // `left`, `main`, `right` and `footer`, and a dropped area string silently leaves
    // children auto-placed.
    expect(classes).toContain(
      "[grid-template-areas:'header_header_header''toolbar_toolbar_toolbar''left_main_right''footer_footer_footer']"
    );
    expect(classes).toContain('grid-rows-[auto_auto_1fr_auto]');
    // BOTH side tracks are `auto`, at every width. The dock's width is the user's to choose,
    // and the tablet collapse reclaims it by rendering `display: none` — which contributes
    // nothing to an `auto` track and a full 250px of nothing to a fixed one. The former
    // `max-lg:grid-cols-[auto_1fr_auto]` is therefore gone: a single `auto` template at
    // every breakpoint is the same behaviour with one rule instead of two, and the paired
    // assertion below is what it depends on.
    expect(classes).toContain('grid-cols-[auto_1fr_auto]');
    expect(classes).not.toContain('250px');
    // Below the mobile boundary the shell is header / main / bottom.
    expect(classes).toContain("max-md:[grid-template-areas:'header''main''bottom']");
    expect(classes).toContain('max-md:grid-rows-[auto_1fr_auto]');
  });

  // The companion fact — the 250px lives on the dock ELEMENT, not on a track — is asserted in
  // `SidebarRight.test.tsx`, because this file mocks `SidebarRight` out entirely and there is
  // no element here to measure.

  it('mounts the mobile shell on desktop too, so the breakpoint crossing is a CSS flip', () => {
    render(<App />);

    // If this were conditional on a media query, crossing 768px would unmount and rebuild
    // the canvas. Mounting both and hiding with `md:hidden` keeps the crossing free of
    // React work, which is how it worked before the mobile shell existed.
    expect(screen.getByText('MobileShell')).toBeInTheDocument();
  });

  it('does not remount the canvas when the viewport crosses the mobile boundary', () => {
    render(<App />);
    const before = screen.getByText('Main');

    // `useStore` is a hook of the store tree, so its call count is a lower bound on the
    // renders that reached it. The node-identity checks below are only worth anything if a
    // crossing RE-RENDERS: identity is trivially preserved when nothing happened at all,
    // so a `setViewportWidth` that stopped delivering its `change` event, or a shell
    // that stopped subscribing, would leave all five of these assertions green while
    // the boundary stopped doing anything.
    const renders = () => useStoreMock.mock.calls.length;

    const step = (width: number, rerendered: boolean) => {
      const beforeCrossing = renders();
      act(() => {
        setViewportWidth(width);
      });
      expect({ width, rerendered: renders() > beforeCrossing }).toEqual({ width, rerendered });
      // Whatever the render count did, the canvas is the same DOM node throughout.
      expect(screen.getByText('Main')).toBe(before);
    };

    step(500, true);
    step(1600, true);

    // Also through the tablet band, in both directions. 900 is deliberately INERT, but
    // not because nothing happens there: `RightPanelVisibilityProvider` is not mocked
    // and subscribes to `TABLET_MEDIA_QUERY`, so crossing into the band re-renders it.
    // What costs nothing is the canvas tree — `<AppContainer />` is the SAME element
    // reference across the crossing (App.tsx:145), so React reconciles the provider's
    // children without rendering them, and `useStore` is not reached again.
    //
    // Asserted, because it is what makes the four steps above mean "the boundary was
    // crossed" rather than "the helper re-renders", and because a provider that stopped
    // bailing out — or a context consumer added below it — would add a render to every
    // width change, which is the cost the unconditional mount exists to avoid.
    step(900, false);
    step(500, true);
    step(1280, true);
  });

  it('renders the same region set at every width, because hiding is not unmounting', () => {
    for (const width of [360, 767, 768, 900, 1023, 1024, 1600]) {
      setViewportWidth(width);

      const view = render(<App />);
      for (const region of ['Menu', 'Footer', 'SidebarLeft', 'SidebarRight', 'Main', 'MobileShell']) {
        expect({ width, region, present: screen.queryByText(region) !== null }).toEqual({
          width,
          region,
          present: true,
        });
      }
      view.unmount();
    }
  });
});

/**
 * Crossing the mobile boundary must not leave mobile UI rendered on the desktop path.
 *
 * Both trees are mounted and `md:hidden` decides which shows, so the crossing costs no React
 * work — but `display: none` hides without unmounting. A surface left open on a phone
 * therefore stayed mounted on desktop, and `MobileToolSheet` held a second live instance of
 * the active tool's options panel next to the one `ToolbarHorizontal` owns: duplicate
 * `id="text-input"`, duplicate `id="font-family-select"`, duplicate window Escape listeners.
 *
 * `MobileShell` is mocked here, so the assertions are on the flags this component owns.
 */
describe('App mobile surface reset', () => {
  beforeEach(() => {
    setViewportWidth(500, 800);
    storeState.hasImage = true;
    useStoreMock.mockImplementation(() => [storeState, dispatch]);
    localStorage.clear();
  });

  afterEach(() => setViewportWidth(1280, 800));

  const openMobileSurfaces = async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Tool options' }));
    return user;
  };

  it('closes the tool sheet and the layers drawer when the viewport widens', async () => {
    await openMobileSurfaces();
    await userEvent.click(screen.getByRole('button', { name: 'Layers' }));
    expect(screen.getByTestId('mobile-shell-props')).toHaveAttribute('data-layers', 'true');

    // The real `MobileShell` is what exposes these ids, so this pair is asserted through the
    // mock's contract: the props it received must go back to closed.
    const shell = () => screen.getByTestId('mobile-shell-props');
    expect(shell()).toHaveAttribute('data-tool-sheet', 'true');

    act(() => {
      setViewportWidth(1280);
    });

    expect(shell()).toHaveAttribute('data-tool-sheet', 'false');
    expect(shell()).toHaveAttribute('data-layers', 'false');
  });

  it('leaves the surfaces closed when the crossing happens with them already closed', () => {
    render(<App />);

    act(() => {
      setViewportWidth(1280);
    });

    const shell = screen.getByTestId('mobile-shell-props');
    expect(shell).toHaveAttribute('data-tool-sheet', 'false');
    expect(shell).toHaveAttribute('data-layers', 'false');
  });
});
