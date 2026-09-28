import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('./components/Mobile/MobileShell.tsx', () => ({ MobileShell: () => <div>MobileShell</div> }));
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
    const grid = container.firstElementChild as HTMLElement;
    const regions = Array.from(grid.children).map((child) => child.textContent);

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
    expect(classes).toContain('grid-cols-[auto_1fr_250px]');
    // `max-lg:grid-cols-[auto_1fr_auto]` lets the layers column size to content, so the
    // tablet collapse reclaims the 250px instead of leaving an empty column.
    expect(classes).toContain('max-lg:grid-cols-[auto_1fr_auto]');
    // Below the mobile boundary the shell is header / main / bottom.
    expect(classes).toContain("max-md:[grid-template-areas:'header''main''bottom']");
    expect(classes).toContain('max-md:grid-rows-[auto_1fr_auto]');
  });

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

    setViewportWidth(500);
    expect(screen.getByText('Main')).toBe(before);

    setViewportWidth(1600);
    expect(screen.getByText('Main')).toBe(before);

    // Also through the tablet band, in both directions.
    setViewportWidth(900);
    expect(screen.getByText('Main')).toBe(before);
    setViewportWidth(500);
    expect(screen.getByText('Main')).toBe(before);
    setViewportWidth(1280);
    expect(screen.getByText('Main')).toBe(before);
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
