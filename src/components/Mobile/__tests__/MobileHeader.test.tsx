import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileHeader } from '../MobileHeader.tsx';
import { claimDocumentGesture, isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const undoMock = vi.hoisted(() => vi.fn());
const redoMock = vi.hoisted(() => vi.fn());
const canUndoMock = vi.hoisted(() => vi.fn(() => true));
const canRedoMock = vi.hoisted(() => vi.fn(() => true));
const openSaveImageDialogMock = vi.hoisted(() => vi.fn());
const handleImageSaveMock = vi.hoisted(() => vi.fn());
const commitDirtyToolMock = vi.hoisted(() => vi.fn(() => ({})));

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
    // The gesture slot is module-level and outlives every mount, so a leaked
    // claim would refuse every later click in this file. Cleared on the way in
    // AND on the way out.
    resetDocumentGestures();
  });

  afterEach(() => {
    resetDocumentGestures();
    vi.restoreAllMocks();
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

  it('opens the navigation drawer from the header, and names the dialog only while it exists', async () => {
    const user = userEvent.setup();
    const onOpenMenu = vi.fn();
    renderHeader({ onOpenMenu });

    const menu = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(menu).toHaveAttribute('aria-haspopup', 'dialog');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    // Closed, the drawer is not in the tree (`MobileMenuDrawer` returns null), so the reference
    // would name nothing. `aria-expanded="false"` with no `aria-controls` is the honest pair.
    expect(menu).not.toHaveAttribute('aria-controls');

    await user.click(menu);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('reports the menu as expanded once it is open, and only then names the dialog', () => {
    renderHeader({ isMenuOpen: true });

    const menu = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(menu).toHaveAttribute('aria-controls', 'mobile-menu-panel');
  });

  it('toggles the layers drawer from the header, and names the dialog only while it exists', async () => {
    const user = userEvent.setup();
    const onToggleLayers = vi.fn();
    renderHeader({ onToggleLayers });

    const layers = screen.getByRole('button', { name: 'Toggle layers panel' });
    expect(layers).toHaveAttribute('aria-haspopup', 'dialog');
    expect(layers).toHaveAttribute('aria-expanded', 'false');
    // Closed, `MobileLayersDrawer` returns null, so the reference would name nothing.
    expect(layers).not.toHaveAttribute('aria-controls');

    await user.click(layers);
    expect(onToggleLayers).toHaveBeenCalledTimes(1);
  });

  it('reports the layers drawer as expanded, and only then names the dialog', () => {
    renderHeader({ isLayersOpen: true });

    const layers = screen.getByRole('button', { name: 'Toggle layers panel' });
    expect(layers).toHaveAttribute('aria-expanded', 'true');
    expect(layers).toHaveAttribute('aria-controls', 'mobile-layers-panel');
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

  it('logs the rejection with the encoder detail and saves nothing', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    openSaveImageDialogMock.mockRejectedValue(new Error('encoder died'));
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Export image' }));

    // The Error is the second argument, not an interpolation, so the stack reaches the console.
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to save image:', expect.any(Error));
    expect(handleImageSaveMock).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    openSaveImageDialogMock.mockRejectedValue('disk offline');
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Export image' }));

    // Stringified, a reason object arrived as `Failed to save image: [object Object]` and the
    // reason was gone. The exact raw value is asserted here, so it fails against that.
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to save image:', 'disk offline');
    expect(handleImageSaveMock).not.toHaveBeenCalled();
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

  /**
   * The mobile header's Undo and Redo are the desktop `HistoryControls` buttons
   * in a different shell, and they were uncovered by the keyboard's
   * document-gesture gate for the same reason. Inside a gesture's window the
   * replay is destructive: `undo`/`redo` replays `selections` from the SAME
   * `history` array, so `history.length` never moves and the pending commit's
   * `entries.slice(0, cursor + 1)` truncates the redo tail with no other
   * symptom. On a touch screen a second finger tapping Undo mid-drag is a
   * two-line repro, so this shell is the more exposed of the two.
   */
  describe('document gesture gate', () => {
    it('refuses undo while a document gesture is open, because the release-time commit would truncate the redo tail', () => {
      renderHeader();
      claimDocumentGesture('layer-transform', 1);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      // Enabled, so the refusal is the handler's and not the `disabled`
      // attribute's — the attribute is read at render time, and the claim
      // above is made after it.
      expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
      expect(undoMock).not.toHaveBeenCalled();
    });

    it('refuses redo while a document gesture is open, for the same reason', () => {
      renderHeader();
      claimDocumentGesture('rectangular-selection', 2);

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

      expect(screen.getByRole('button', { name: 'Redo' })).not.toBeDisabled();
      expect(redoMock).not.toHaveBeenCalled();
    });

    it('undoes again once resetDocumentGestures drops the claim, so the gate is a window and not a latch', () => {
      renderHeader();

      claimDocumentGesture('brush-stroke', 3);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(undoMock).not.toHaveBeenCalled();

      resetDocumentGestures();
      expect(isDocumentGestureOpen()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      expect(undoMock).toHaveBeenCalledTimes(1);
    });
  });
});
