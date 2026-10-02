import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileMenuDrawer } from '../MobileMenuDrawer.tsx';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext.tsx';

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
  // A REF, like `currentArgs`: the provider reads `previewLayers.current` at the moment the
  // question is asked, and a plain object would make the whole tree see an in-flight preview
  // transaction — a prompt with no possible answer but "Discard".
  previewLayers: { current: {} as Record<string, unknown> },
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

/**
 * The provider is REAL, never mocked: it reads the `useStore` mock above and nothing else,
 * so `New` and `Open` below exercise the shipped guard and its shipped modal rather than a
 * hand-written stand-in for one. It renders no DOM of its own while no prompt is up, so a
 * closed drawer still leaves an empty container.
 */
const renderDrawer = (isOpen: boolean, onClose: () => void = vi.fn()) =>
  render(
    <UnsavedChangesProvider>
      <MobileMenuDrawer isOpen={isOpen} onClose={onClose} />
    </UnsavedChangesProvider>
  );

const Harness = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <UnsavedChangesProvider>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open menu
      </button>
      <MobileMenuDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </UnsavedChangesProvider>
  );
};

/**
 * `renderDrawer` is given an `onClose` spy that unmounts nothing, so it cannot show WHEN
 * the drawer closed. The stacked-`aria-modal` claim needs a drawer that really goes away,
 * and this is that drawer.
 */
const ClosingDrawer = () => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <UnsavedChangesProvider>
      <MobileMenuDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </UnsavedChangesProvider>
  );
};

const drawerDialog = () => screen.queryByRole('dialog', { name: 'Mobile Navigation Menu' });

describe('MobileMenuDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateMock.hasUnsavedChanges = false;
    storeStateMock.currentArgs.current = {};
    storeStateMock.previewLayers.current = {};
    storeStateMock.hasImage = true;
    storeStateMock.canvasRef.current = document.createElement('canvas');
    commitDirtyToolMock.mockReturnValue({});
    openNewImageDialogMock.mockResolvedValue({ color: '#fff', opacity: 1, size: { width: 4, height: 4 } });
    openLoadImageDialogMock.mockResolvedValue({ fileName: 'loaded.png' });
    openSaveImageDialogMock.mockResolvedValue({ fileName: 'out.png' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('New', () => {
    it('opens the new-document dialog on a clean document', async () => {
      const user = userEvent.setup();
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      // What `expect(window.confirm).not.toHaveBeenCalled()` used to claim — no prompt was put
      // in front of the user — is now claimed against the prompt itself: `confirmDiscard`
      // answers `true` outright when there is nothing to discard, so nothing is rendered.
      await waitFor(() => expect(openNewImageDialogMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(setBlankImageMock).toHaveBeenCalledTimes(1);
    });

    it('refuses and opens nothing when there are unsaved changes and the user declines', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      // The prompt is not there synchronously: the handler awaits `confirmDiscard`, which
      // renders the dialog and resolves from the answer.
      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
      // The copy is the one the native `confirm()` was given, verbatim, now in the app's own
      // modal — so this is the same claim about the same question, asked of a different widget.
      expect(screen.getByText('Discard unsaved changes and start a new image?')).toBeInTheDocument();
      // The drawer is closed BEFORE the guard runs — `onClose()` precedes
      // `confirmDiscard`, which is the ordering the desktop File menu uses and the one this
      // file already used for Export. It is what keeps a single `aria-modal` promise in the
      // tree: this drawer declares one and so does the prompt. `renderDrawer(true)` passes
      // a mock `onClose` that does not unmount anything, so the drawer element is still
      // here for the rest of the test; the ordering is asserted separately, in the two
      // "closes the drawer before it asks" rows below.

      await user.click(screen.getByTestId('confirm-dialog-cancel-button'));

      await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
      expect(openNewImageDialogMock).not.toHaveBeenCalled();
      expect(setBlankImageMock).not.toHaveBeenCalled();
    });

    it('proceeds when the user accepts the discard', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      const confirm = await screen.findByTestId('confirm-dialog-confirm-button');
      expect(confirm).toHaveTextContent('Discard');
      await user.click(confirm);

      await waitFor(() => expect(openNewImageDialogMock).toHaveBeenCalledTimes(1));
      expect(setBlankImageMock).toHaveBeenCalledTimes(1);
    });

    it('closes the drawer before it asks, so one aria-modal promise is ever in the tree', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      render(<ClosingDrawer />);

      await user.click(screen.getByRole('button', { name: /New Document/ }));
      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();

      // The ordering, not merely the fact of closing: this drawer declares
      // `aria-modal="true"` (`MobileMenuDrawer.tsx:86`) and so does the prompt, and two
      // modal promises at once tell assistive technology nothing about which is topmost.
      // `onClose()` therefore precedes `confirmDiscard`, which is the order the desktop
      // File menu uses and the order Export in this same file already used.
      expect(drawerDialog()).not.toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('guards on an unplaced text layer, which has not reached hasUnsavedChanges yet', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = false;
      storeStateMock.currentArgs.current = {
        toolName: 'text',
        text: 'hello',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      };
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      // `hasUnsavedChanges` is `false` for the whole of this gesture, and the prompt still
      // appears: the guard reads the live refs, so the typed-but-unplaced box is caught.
      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
      expect(openNewImageDialogMock).not.toHaveBeenCalled();
    });

    it('logs the rejection with the dialog detail and leaves the document alone', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openNewImageDialogMock.mockRejectedValue(new Error('dialog exploded'));
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      // The Error is the second argument, not an interpolation, so the stack reaches the console.
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to create document:', expect.any(Error));
      expect(setBlankImageMock).not.toHaveBeenCalled();
    });

    it('passes a non-Error rejection through to the console unchanged', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openNewImageDialogMock.mockRejectedValue('plain failure');
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /New Document/ }));

      // Stringified, a reason object became `[object Object]` and was lost. Asserting the exact
      // raw value fails against that and passes only against the two-argument call.
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to create document:', 'plain failure');
      expect(setBlankImageMock).not.toHaveBeenCalled();
    });
  });

  describe('Open', () => {
    it('opens the file dialog on a clean document', async () => {
      const user = userEvent.setup();
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      // Same claim as the `New` counterpart: no prompt appeared, and the picker opened anyway.
      await waitFor(() => expect(openLoadImageDialogMock).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      expect(setImageFromUploadMock).toHaveBeenCalledTimes(1);
    });

    it('refuses and opens nothing when there are unsaved changes and the user declines', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText('Discard unsaved changes and open another file?')).toBeInTheDocument();

      await user.click(screen.getByTestId('confirm-dialog-cancel-button'));

      await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
      expect(openLoadImageDialogMock).not.toHaveBeenCalled();
      expect(setImageFromUploadMock).not.toHaveBeenCalled();
    });

    it('proceeds when the user accepts the discard', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      const confirm = await screen.findByTestId('confirm-dialog-confirm-button');
      expect(confirm).toHaveTextContent('Discard');
      await user.click(confirm);

      await waitFor(() => expect(openLoadImageDialogMock).toHaveBeenCalledTimes(1));
      expect(setImageFromUploadMock).toHaveBeenCalledTimes(1);
    });

    it('closes the drawer before it asks, so one aria-modal promise is ever in the tree', async () => {
      const user = userEvent.setup();
      storeStateMock.hasUnsavedChanges = true;
      render(<ClosingDrawer />);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));
      expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();

      // The `New` counterpart's claim, asserted on the second surface rather than trusted
      // from the first: two `aria-modal="true"` elements at once is the ambiguity, and
      // `onClose()` has to run before the guard for there to be only one.
      expect(drawerDialog()).not.toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('logs the rejection with the picker detail and keeps the current document', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openLoadImageDialogMock.mockRejectedValue(new Error('read failed'));
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to open file:', expect.any(Error));
      expect(setImageFromUploadMock).not.toHaveBeenCalled();
    });

    it('passes a non-Error rejection through to the console unchanged', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openLoadImageDialogMock.mockRejectedValue({ code: 42 });
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Open Image/ }));

      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to open file:', { code: 42 });
      expect(setImageFromUploadMock).not.toHaveBeenCalled();
    });
  });

  describe('Export', () => {
    it('commits the dirty tool before opening the save dialog, and carries the committed layers', async () => {
      const user = userEvent.setup();
      commitDirtyToolMock.mockReturnValue({ committed: 'layer' });
      renderDrawer(true);

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
      renderDrawer(true);

      expect(screen.getByRole('button', { name: /Export \/ Save Image/ })).toBeDisabled();
    });

    it('logs the rejection with the encoder detail and saves nothing', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openSaveImageDialogMock.mockRejectedValue(new Error('encoder died'));
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Export \/ Save Image/ }));

      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to export image:', expect.any(Error));
      expect(handleImageSaveMock).not.toHaveBeenCalled();
    });

    it('logs when the commit throws before the save dialog opens', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      commitDirtyToolMock.mockImplementation(() => {
        throw new Error('commit failed');
      });
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Export \/ Save Image/ }));

      // Same log as the dialog rejection and the same two-argument shape: the commit runs inside
      // the same `try`, so a throw before the dialog opens is reported identically.
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to export image:', expect.any(Error));
      expect(openSaveImageDialogMock).not.toHaveBeenCalled();
    });

    it('passes a non-Error rejection through to the console unchanged', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      openSaveImageDialogMock.mockRejectedValue('disk offline');
      renderDrawer(true);

      await user.click(screen.getByRole('button', { name: /Export \/ Save Image/ }));

      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to export image:', 'disk offline');
      expect(handleImageSaveMock).not.toHaveBeenCalled();
    });
  });

  // The tests from here on drive the drawer itself, and the store is clean in every one of
  // them, so no discard prompt is in the tree: the role queries below see the drawer alone.
  it('renders nothing while closed, which is what keeps it out of the tab order', () => {
    const { container } = renderDrawer(false);

    // The provider contributes no element while no prompt is pending, so an empty container
    // is still a statement about the drawer.
    expect(container).toBeEmptyDOMElement();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Mobile Navigation Menu' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // Valid because no prompt is open: with one up it is the PROMPT that owns Escape, and
    // this query would be reading two dialogs rather than one.
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
    renderDrawer(true, onClose);

    // The backdrop is the drawer's own first child. Scoped to this dialog on purpose: with a
    // discard prompt open there are two, and the prompt's backdrop would answer this click.
    fireEvent.click(screen.getByRole('dialog', { name: 'Mobile Navigation Menu' }).firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps every control at least 44px on both axes', () => {
    renderDrawer(true);

    // The drawer's own controls only: a discard prompt's buttons carry no `min-h-11`, so this
    // is a claim about the drawer and holds because the store is clean here.
    for (const control of screen.getAllByRole('button')) {
      expect(control.className).toMatch(/min-h-11/);
    }
  });
});
