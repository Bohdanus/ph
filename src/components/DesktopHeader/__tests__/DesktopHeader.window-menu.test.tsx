import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import DesktopHeader from '../DesktopHeader.tsx';
import { PanelLayoutProvider } from '../../../contexts/PanelLayout.tsx';

/**
 * The `Window ▸ Workspace` submenu, which exists for one command.
 *
 * "Select Window > Workspace > Reset Essentials to return to the default layout."
 * (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html)
 *
 * A dock whose panels, order, width and side all survive a reload needs the documented way back
 * from a layout the user cannot live with — a dock dragged to 40px on a trackpad, a rail thrown
 * across the window. Without it, `localStorage` is a one-way door: the only recovery is clearing
 * site data, which also takes the theme with it.
 *
 * The menu is in `Window` rather than `Edit` or a tool menu because that is where Photoshop keeps
 * every panel command, and a clone that files it elsewhere is a clone whose muscle memory is
 * wrong. It is one level deeper than it used to be here for the same reason: Adobe puts the
 * workspace commands inside `Workspace`, and a command floating on its own where Adobe puts two
 * levels of submenu above it teaches the wrong place to look.
 *
 * Every case below opens THREE things, and the middle one is the point — a two-click version of
 * this suite would pass unchanged against a `Window` menu with no `Workspace` submenu at all.
 */

/** `Window`, then `Workspace`, which is where Adobe keeps it. */
function openWorkspace() {
  act(() => {
    fireEvent.click(screen.getByTestId('header-window-menu-button'));
  });
  act(() => {
    fireEvent.click(screen.getByTestId('window-menu-workspace-button'));
  });
}

const { resetWorkspace } = vi.hoisted(() => ({ resetWorkspace: vi.fn() }));

vi.mock('../../../contexts/PanelLayout.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/PanelLayout.tsx')>()),
  usePanelLayout: () => ({ resetWorkspace }),
}));

const useStore = vi.hoisted(() => vi.fn());
vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore }));

vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => ({ commitDirtyTool: vi.fn() }) }));
vi.mock('../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({ canUndo: vi.fn(() => false), undo: vi.fn(), canRedo: vi.fn(() => false), redo: vi.fn() }),
}));
vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({
    goToTool: vi.fn(),
    setBlankImage: vi.fn(),
    setImageFromUpload: vi.fn(),
    handleImageSave: vi.fn(),
  }),
}));
vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({
    openNewImageDialog: vi.fn(),
    openLoadImageDialog: vi.fn(),
    openSaveImageDialog: vi.fn(),
  }),
}));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ patchToolArgs: vi.fn() }),
}));
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../../../contexts/RightPanelVisibility.tsx', () => ({
  useRightPanelVisibility: () => ({ isCollapsible: false, isOpen: true, toggle: vi.fn() }),
}));

const wrapper = ({ children }: { children: ReactNode }) => <PanelLayoutProvider>{children}</PanelLayoutProvider>;

describe('DesktopHeader Window menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([
      {
        canvasRef: { current: null },
        currentArgs: { current: { toolName: 'draw' } },
        fileName: 'x',
        hasUnsavedChanges: false,
        totalSize: { width: 1, height: 1 },
        documentFrame: { x: 0, y: 0, width: 1, height: 1 },
        hasImage: true,
        toolName: 'draw',
      },
      vi.fn(),
    ]);
  });

  it('exists, next to the other top-level menus', () => {
    render(<DesktopHeader />, { wrapper });

    const windowMenu = screen.getByTestId('header-window-menu-button');
    // In the same `<ul>` as File, Edit and Image, not nested inside one of them.
    expect(windowMenu.parentElement?.tagName).toBe('LI');
    expect(windowMenu.parentElement?.parentElement).toBe(
      screen.getByTestId('header-file-menu-button').parentElement?.parentElement
    );
  });

  it('keeps its command behind the Workspace submenu, and the command hidden until then', () => {
    render(<DesktopHeader />, { wrapper });

    act(() => {
      fireEvent.click(screen.getByTestId('header-window-menu-button'));
    });
    // `Window` opens, and `Reset Essentials` is NOT on it. This is the half a two-click suite
    // cannot see: the command being reachable is not the claim, its DEPTH is.
    expect(screen.getByTestId('header-window-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('window-menu-workspace-reset-essentials-button')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('window-menu-workspace-button'));
    });
    expect(screen.getByTestId('window-menu-workspace-reset-essentials-button')).toBeInTheDocument();
  });

  it('reports its expanded state to a screen reader', () => {
    render(<DesktopHeader />, { wrapper });

    act(() => {
      fireEvent.click(screen.getByTestId('header-window-menu-button'));
    });
    const parent = screen.getByTestId('window-menu-workspace-button');
    expect(parent).toHaveAttribute('aria-haspopup', 'true');
    expect(parent).toHaveAttribute('aria-expanded', 'false');

    act(() => {
      fireEvent.click(parent);
    });
    expect(parent).toHaveAttribute('aria-expanded', 'true');
  });

  it('resets the workspace and closes the menu', () => {
    render(<DesktopHeader />, { wrapper });

    openWorkspace();
    act(() => {
      fireEvent.click(screen.getByTestId('window-menu-workspace-reset-essentials-button'));
    });

    expect(resetWorkspace).toHaveBeenCalledTimes(1);
    // Left open, the menu would sit over a layout the user can no longer undo, which is the
    // opposite of what they just asked for.
    expect(screen.queryByTestId('window-menu-workspace-reset-essentials-button')).toBeNull();
    expect(screen.queryByTestId('header-window-menu')).toBeNull();
  });

  it('closes on a mousedown outside it, like every other menu', () => {
    render(<DesktopHeader />, { wrapper });

    openWorkspace();
    expect(screen.getByTestId('window-menu-workspace-reset-essentials-button')).toBeInTheDocument();

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByTestId('window-menu-workspace-reset-essentials-button')).toBeNull();
  });

  it('keeps one menu open at a time', () => {
    render(<DesktopHeader />, { wrapper });

    act(() => {
      fireEvent.click(screen.getByTestId('header-window-menu-button'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('header-file-menu-button'));
    });

    // A second menu opening beside the first is the same defect the existing menu-lifecycle
    // tests guard for the other nine, and the new submenu has to not be the exception.
    expect(screen.queryByTestId('header-window-menu')).toBeNull();
  });
});
