import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopHeader from '../DesktopHeader.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

const storeState = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw' as ToolName,
}));

const dispatch = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({
  goToTool: vi.fn(),
  setBlankImage: vi.fn(),
  setImageFromUpload: vi.fn(),
  handleImageSave: vi.fn(),
}));
const file = vi.hoisted(() => ({
  openNewImageDialog: vi.fn(),
  openLoadImageDialog: vi.fn(),
  openSaveImageDialog: vi.fn(),
}));
const layers = vi.hoisted(() => ({ commitDirtyTool: vi.fn() }));
const history = vi.hoisted(() => ({
  canUndo: vi.fn(() => false),
  undo: vi.fn(),
  canRedo: vi.fn(() => false),
  redo: vi.fn(),
}));
const currentTool = vi.hoisted(() => ({
  isToolDirty: false,
  patchToolArgs: vi.fn(),
}));
const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark', toggleTheme: vi.fn() }));

/** Which band the header should believe it is in. */
const panel = vi.hoisted(() => ({ isCollapsible: false, isOpen: true }));
const togglePanel = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, dispatch] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => app }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => file }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => layers }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({ useCurrentTool: () => currentTool }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({ useTheme: () => themeState }));
// The band is controlled directly here, so the header's behaviour in the tablet band can be
// asserted without rendering the whole shell.
vi.mock('../../../contexts/RightPanelVisibility.tsx', () => ({
  useRightPanelVisibility: () => ({
    isCollapsible: panel.isCollapsible,
    isOpen: panel.isOpen,
    toggle: togglePanel,
  }),
}));

const toggleButton = () => screen.queryByTestId('right-panel-toggle');

describe('DesktopHeader tablet layers-panel toggle', () => {
  beforeEach(() => {
    Object.assign(panel, { isCollapsible: false, isOpen: true });
    togglePanel.mockClear();
  });

  it('renders no toggle on desktop, so desktop gains no control and no layout shift', () => {
    render(<DesktopHeader />);

    expect(toggleButton()).toBeNull();
  });

  it('offers a collapsed-state toggle in the tablet band', () => {
    Object.assign(panel, { isCollapsible: true, isOpen: false });
    render(<DesktopHeader />);

    const button = toggleButton();
    expect(button).not.toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'right-panel');
    expect(button).toHaveAccessibleName('Show layers panel');
    // The header is `max-md:hidden`, so the button is visible in exactly the tablet band.
    expect(button).toHaveClass('lg:hidden');
  });

  it('reports the open state and names the action it will take', () => {
    Object.assign(panel, { isCollapsible: true, isOpen: true });
    render(<DesktopHeader />);

    const button = toggleButton()!;
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Hide layers panel');
  });

  it('drives the shared toggle rather than owning its own panel state', () => {
    Object.assign(panel, { isCollapsible: true, isOpen: false });
    render(<DesktopHeader />);

    act(() => {
      fireEvent.click(toggleButton()!);
    });

    expect(togglePanel).toHaveBeenCalledTimes(1);
  });

  it('is reachable by keyboard, since the panel cannot be taken away by click alone', () => {
    Object.assign(panel, { isCollapsible: true, isOpen: false });
    render(<DesktopHeader />);

    const button = toggleButton() as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    // A native button with a click handler is operable by Enter and Space without extra
    // key handling, which a div with onClick would not be.
    fireEvent.click(button, { detail: 0 });
    expect(togglePanel).toHaveBeenCalledTimes(1);
  });
});
