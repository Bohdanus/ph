import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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
