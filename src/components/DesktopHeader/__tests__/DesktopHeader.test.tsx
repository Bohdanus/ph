import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopHeader from '../DesktopHeader.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useApp } from '../../../hooks/useApp.ts';
import { useFile } from '../../../contexts/useFile.tsx';
import { useHistory } from '../../../contexts/useHistory.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';

const storeState = {
  canvasRef: { current: null },
  currentArgs: { current: { toolName: 'draw' } },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw',
};

const history = {
  canUndo: vi.fn(),
  undo: vi.fn(),
  canRedo: vi.fn(),
  redo: vi.fn(),
};

const app = {
  goToTool: vi.fn(),
  setBlankImage: vi.fn(),
  setImageFromUpload: vi.fn(),
  handleImageSave: vi.fn(),
};

const file = {
  openNewImageDialog: vi.fn(),
  openLoadImageDialog: vi.fn(),
  openSaveImageDialog: vi.fn(),
};

const layers = {
  commitDirtyTool: vi.fn(),
};

const currentTool = {
  isToolDirty: false,
  resetToLastSavedArgs: vi.fn(),
};

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => app }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => file }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => layers }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({ useCurrentTool: () => currentTool }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => [{ theme: 'light', toggleTheme: vi.fn() }],
}));

describe('DesktopHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.hasUnsavedChanges = false;
    history.canUndo.mockReturnValue(false);
    history.canRedo.mockReturnValue(false);
  });

  it('renders File and Edit menu buttons', () => {
    render(<DesktopHeader />);

    expect(screen.getByRole('button', { name: 'File' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('toggles the file menu open and closed', () => {
    render(<DesktopHeader />);

    const fileButton = screen.getByRole('button', { name: 'File' });

    fireEvent.click(fileButton);
    expect(screen.getByTestId('header-file-new-button')).toBeTruthy();

    fireEvent.click(fileButton);
    expect(screen.queryByTestId('header-file-new-button')).toBeFalsy();
  });

  it('toggles the edit menu open and closed', () => {
    render(<DesktopHeader />);

    const editButton = screen.getByRole('button', { name: 'Edit' });

    fireEvent.click(editButton);
    expect(screen.getByTestId('edit-menu-colors-button')).toBeTruthy();

    fireEvent.click(editButton);
    expect(screen.queryByTestId('edit-menu-colors-button')).toBeFalsy();
  });

  it('goes to the correct tool when edit menu items are clicked', () => {
    render(<DesktopHeader />);

    const editButton = screen.getByRole('button', { name: 'Edit' });

    fireEvent.click(editButton);
    fireEvent.click(screen.getByTestId('edit-menu-colors-button'));
    expect(app.goToTool).toHaveBeenCalledWith('color');

    vi.clearAllMocks();
    storeState.hasUnsavedChanges = false;

    fireEvent.click(editButton);
    fireEvent.click(screen.getByTestId('edit-menu-blur-button'));
    expect(app.goToTool).toHaveBeenCalledWith('blur');
  });

  it('renders theme toggle button', () => {
    render(<DesktopHeader />);

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeTruthy();
  });

  it('opens the new file dialog when File > New is clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    file.openNewImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    const fileButton = screen.getByRole('button', { name: 'File' });
    fireEvent.click(fileButton);
    fireEvent.click(screen.getByTestId('header-file-new-button'));

    expect(file.openNewImageDialog).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('opens the load file dialog when File > Open is clicked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    file.openLoadImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    const fileButton = screen.getByRole('button', { name: 'File' });
    fireEvent.click(fileButton);
    fireEvent.click(screen.getByTestId('header-file-open-button'));

    expect(file.openLoadImageDialog).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('shows Confirm dialog when opening file with unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    file.openLoadImageDialog.mockResolvedValue(undefined);

    render(<DesktopHeader />);

    const fileButton = screen.getByRole('button', { name: 'File' });
    fireEvent.click(fileButton);
    fireEvent.click(screen.getByTestId('header-file-open-button'));

    expect(window.confirm).toHaveBeenCalled();
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
