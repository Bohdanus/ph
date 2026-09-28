import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileMenuDrawer } from '../MobileMenuDrawer.tsx';

const openNewImageDialogMock = vi.hoisted(() => vi.fn());
const openLoadImageDialogMock = vi.hoisted(() => vi.fn());
const openSaveImageDialogMock = vi.hoisted(() => vi.fn());
const setBlankImageMock = vi.hoisted(() => vi.fn());
const setImageFromUploadMock = vi.hoisted(() => vi.fn());
const handleImageSaveMock = vi.hoisted(() => vi.fn());
const commitDirtyToolMock = vi.hoisted(() => vi.fn(() => ({})));
const dispatchMock = vi.hoisted(() => vi.fn());

const storeStateMock = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: {} as Record<string, unknown> },
  fileName: 'photo.jpg',
  totalSize: { width: 800, height: 600 },
  hasImage: true,
  hasUnsavedChanges: false,
  documentFrame: null as unknown,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({
    setBlankImage: setBlankImageMock,
    setImageFromUpload: setImageFromUploadMock,
    handleImageSave: handleImageSaveMock,
  }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({
    openNewImageDialog: openNewImageDialogMock,
    openLoadImageDialog: openLoadImageDialogMock,
    openSaveImageDialog: openSaveImageDialogMock,
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ commitDirtyTool: commitDirtyToolMock }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

const Harness = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open menu
      </button>
      <MobileMenuDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};

describe('MobileMenuDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateMock.hasUnsavedChanges = false;
    storeStateMock.currentArgs.current = {};
    storeStateMock.hasImage = true;
    storeStateMock.canvasRef.current = document.createElement('canvas');
    commitDirtyToolMock.mockReturnValue({});
    openNewImageDialogMock.mockResolvedValue({ color: '#fff', opacity: 1, size: { width: 4, height: 4 } });
    openLoadImageDialogMock.mockResolvedValue({ fileName: 'loaded.png' });
    openSaveImageDialogMock.mockResolvedValue({ fileName: 'out.png' });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('New', () => {
    it('opens the new-document dialog on a clean document', async () => {
      const user = userEvent.setup();
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      expect(window.confirm).not.toHaveBeenCalled();
      expect(openNewImageDialogMock).toHaveBeenCalledTimes(1);
      expect(setBlankImageMock).toHaveBeenCalledTimes(1);
    });

    it('refuses and opens nothing when there are unsaved changes and the user declines', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes and start a new image?');
      expect(openNewImageDialogMock).not.toHaveBeenCalled();
      expect(setBlankImageMock).not.toHaveBeenCalled();
    });

    it('proceeds when the user accepts the discard', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      expect(openNewImageDialogMock).toHaveBeenCalledTimes(1);
      expect(setBlankImageMock).toHaveBeenCalledTimes(1);
    });

    it('guards on an unplaced text layer, which has not reached hasUnsavedChanges yet', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = false;
      storeStateMock.currentArgs.current = {
        toolName: 'text',
        text: 'hello',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      };
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      expect(window.confirm).toHaveBeenCalled();
      expect(openNewImageDialogMock).not.toHaveBeenCalled();
    });
  });

  describe('Open', () => {
    it('opens the file dialog on a clean document', async () => {
      const user = userEvent.setup();
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(window.confirm).not.toHaveBeenCalled();
      expect(openLoadImageDialogMock).toHaveBeenCalledTimes(1);
      expect(setImageFromUploadMock).toHaveBeenCalledTimes(1);
    });

    it('refuses and opens nothing when there are unsaved changes and the user declines', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes and open another file?');
      expect(openLoadImageDialogMock).not.toHaveBeenCalled();
      expect(setImageFromUploadMock).not.toHaveBeenCalled();
    });

    it('proceeds when the user accepts the discard', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(openLoadImageDialogMock).toHaveBeenCalledTimes(1);
      expect(setImageFromUploadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Export', () => {
    it('commits the dirty tool before opening the save dialog, and carries the committed layers', async () => {
      const user = userEvent.setup();
      commitDirtyToolMock.mockReturnValue({ committed: 'layer' });
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /Export \/ Save Image/ }));

      expect(commitDirtyToolMock).toHaveBeenCalledTimes(1);
      expect(openSaveImageDialogMock).toHaveBeenCalledTimes(1);
      expect(commitDirtyToolMock.mock.invocationCallOrder[0]).toBeLessThan(
        openSaveImageDialogMock.mock.invocationCallOrder[0]
      );
      expect(openSaveImageDialogMock.mock.calls[0][0].layers).toEqual({ committed: 'layer' });
      expect(handleImageSaveMock).toHaveBeenCalledWith({ fileName: 'out.png' });
    });

    it('is disabled with no document', () => {
      storeStateMock.hasImage = false;
      render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

      expect(screen.getByRole('button', { name: /Export \/ Save Image/ })).toBeDisabled();
    });
  });

  it('renders nothing while closed, which is what keeps it out of the tab order', () => {
    const { container } = render(<MobileMenuDrawer isOpen={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Mobile Navigation Menu' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus into the panel on open and restores it to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    const panel = document.getElementById('mobile-menu-panel')!;
    expect(panel).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(panel);

    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const panel = document.getElementById('mobile-menu-panel')!;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes from the backdrop and the close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MobileMenuDrawer isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('dialog').firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps every control at least 44px on both axes', () => {
    render(<MobileMenuDrawer isOpen={true} onClose={vi.fn()} />);

    for (const control of screen.getAllByRole('button')) {
      expect(control.className).toMatch(/min-h-11/);
    }
  });
});
