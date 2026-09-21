import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const setBlankImage = vi.fn();
const useStoreMock = vi.fn(() => [
  {
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
  },
  vi.fn(),
]);

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
    useStoreMock.mockClear();
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
});
