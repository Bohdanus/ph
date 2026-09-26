import { describe, expect, it, vi } from 'vitest';
import Menu from '../Menu.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: vi.fn() }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: vi.fn() }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: vi.fn(),
}));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({ useCurrentTool: vi.fn() }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: vi.fn() }));
vi.mock('../DesktopHeader/DesktopHeader.tsx', () => ({ default: vi.fn(() => <div data-testid="desktop-header" />) }));
vi.mock('../ToolbarHorizontal/ToolbarHorizontal.tsx', () => ({
  default: vi.fn(() => <div data-testid="toolbar-horizontal" />),
}));
vi.mock('../HistoryControls/HistoryControls.tsx', () => ({
  default: vi.fn(() => <div data-testid="history-controls" />),
}));

describe('Menu', () => {
  it('exports a component', () => {
    expect(typeof Menu).toBe('function');
  });
});
