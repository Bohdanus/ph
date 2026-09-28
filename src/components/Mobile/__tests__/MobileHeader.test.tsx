import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileHeader } from '../MobileHeader.tsx';

const undoMock = vi.hoisted(() => vi.fn());
const redoMock = vi.hoisted(() => vi.fn());
const canUndoMock = vi.hoisted(() => vi.fn(() => true));
const canRedoMock = vi.hoisted(() => vi.fn(() => true));
const openSaveImageDialogMock = vi.hoisted(() => vi.fn());
const handleImageSaveMock = vi.hoisted(() => vi.fn());
const commitDirtyToolMock = vi.hoisted(() => vi.fn(() => ({})));
const resetToLastSavedArgsMock = vi.hoisted(() => vi.fn());

const dispatchMock = vi.hoisted(() => vi.fn());
const storeStateMock = vi.hoisted(() => ({
  fileName: 'test-photo.jpg',
  hasImage: true,
  layers: { layer1: { id: 'layer1' }, layer2: { id: 'layer2' } } as Record<string, { id: string }>,
  totalSize: { width: 800, height: 600 },
  canvasRef: { current: null as HTMLCanvasElement | null },
  documentFrame: null as unknown,
  toolName: 'draw',
}));

/**
 * Mutable per test, unlike the old mock's hardcoded `isToolDirty: false`. That
 * hardcoding left the one behaviour that separates the mobile undo button from the
 * desktop rule untested: an uncommitted tool edit is not on the timeline, so
 * `undo()` would step past it instead of reverting it.
 */
const currentToolMock = vi.hoisted(() => ({ isToolDirty: false }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

vi.mock('../../../contexts/useHistory.ts', () => ({
  useHistory: () => ({
    undo: undoMock,
    redo: redoMock,
    canUndo: canUndoMock,
    canRedo: canRedoMock,
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    isToolDirty: currentToolMock.isToolDirty,
    resetToLastSavedArgs: resetToLastSavedArgsMock,
  }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({ openSaveImageDialog: openSaveImageDialogMock }),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ handleImageSave: handleImageSaveMock }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ commitDirtyTool: commitDirtyToolMock }),
}));

const renderHeader = (props: Partial<React.ComponentProps<typeof MobileHeader>> = {}) =>
  render(<MobileHeader onToggleLayers={vi.fn()} isLayersOpen={false} onOpenMenu={vi.fn()} {...props} />);

describe('MobileHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canUndoMock.mockReturnValue(true);
    canRedoMock.mockReturnValue(true);
    commitDirtyToolMock.mockReturnValue({});
    currentToolMock.isToolDirty = false;
    storeStateMock.fileName = 'test-photo.jpg';
    storeStateMock.hasImage = true;
    storeStateMock.canvasRef.current = document.createElement('canvas');
  });

  it('shows the document name and the quick actions', () => {
    renderHeader();

    expect(screen.getByText('test-photo.jpg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle layers panel' })).toBeInTheDocument();
  });

  it('falls back to Untitled with no document', () => {
    storeStateMock.fileName = '';
    renderHeader();

    expect(screen.getByText('Untitled')).toBeInTheDocument();
  });

  it('undoes the timeline when the current tool is clean', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undoMock).toHaveBeenCalledTimes(1);
    expect(resetToLastSavedArgsMock).not.toHaveBeenCalled();
  });

  // Two tests deleted, not rewritten. They set `isToolDirty` true and asserted that
  // the mobile Undo reverted the tool's args instead of stepping the timeline, and
  // that the button stayed enabled on an empty timeline for a "dirty" tool. The flag
  // has no writer — nothing ever dispatched it true — so both cases describe a
  // state the product could never reach, and they drove a mock flag rather than any
  // production path. The capability they were after (a way out of an uncommitted tool
  // edit) is not implemented anywhere, on mobile or desktop, and pretending otherwise
  // here is what let the flag survive this long. It is a real gap, recorded as such
  // rather than pinned by a test that cannot fail in the app.

  it('redoes the timeline', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(redoMock).toHaveBeenCalledTimes(1);
  });

  it('opens the navigation drawer from the header, which declares the dialog it controls', async () => {
    const user = userEvent.setup();
    const onOpenMenu = vi.fn();
    renderHeader({ onOpenMenu });

    const menu = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(menu).toHaveAttribute('aria-haspopup', 'dialog');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveAttribute('aria-controls', 'mobile-menu-panel');

    await user.click(menu);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('reports the menu as expanded once it is open', () => {
    renderHeader({ isMenuOpen: true });

    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('toggles the layers drawer from the header, which declares the dialog it controls', async () => {
    const user = userEvent.setup();
    const onToggleLayers = vi.fn();
    renderHeader({ onToggleLayers });

    const layers = screen.getByRole('button', { name: 'Toggle layers panel' });
    expect(layers).toHaveAttribute('aria-haspopup', 'dialog');
    expect(layers).toHaveAttribute('aria-expanded', 'false');
    expect(layers).toHaveAttribute('aria-controls', 'mobile-layers-panel');

    await user.click(layers);
    expect(onToggleLayers).toHaveBeenCalledTimes(1);
  });

  it('reports the layers drawer as expanded', () => {
    renderHeader({ isLayersOpen: true });

    expect(screen.getByRole('button', { name: 'Toggle layers panel' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('commits the dirty tool before opening the save dialog, so the export carries it', async () => {
    const user = userEvent.setup();
    commitDirtyToolMock.mockReturnValue({ committed: 'layer' });
    openSaveImageDialogMock.mockResolvedValue({ fileName: 'out.png' });
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Export image' }));

    expect(commitDirtyToolMock).toHaveBeenCalledTimes(1);
    expect(openSaveImageDialogMock).toHaveBeenCalledTimes(1);
    expect(commitDirtyToolMock.mock.invocationCallOrder[0]).toBeLessThan(
      openSaveImageDialogMock.mock.invocationCallOrder[0]
    );
    expect(openSaveImageDialogMock.mock.calls[0][0].layers).toEqual({ committed: 'layer' });
  });

  it('does nothing on export without a document', async () => {
    const user = userEvent.setup();
    storeStateMock.hasImage = false;
    renderHeader();

    const exportButton = screen.getByRole('button', { name: 'Export image' });
    expect(exportButton).toBeDisabled();
    await user.click(exportButton);
    expect(openSaveImageDialogMock).not.toHaveBeenCalled();
  });

  it('keeps every control at least 44px on both axes', () => {
    renderHeader();

    for (const control of screen.getAllByRole('button')) {
      expect(control.className).toMatch(/min-h-11/);
    }
    for (const name of ['Open navigation menu', 'Undo', 'Redo', 'Toggle layers panel']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/min-w-11/);
    }
  });
});
