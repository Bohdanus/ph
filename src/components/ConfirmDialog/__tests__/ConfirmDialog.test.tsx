import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../ConfirmDialog.tsx';

const setup = (overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Open Image"
      message="Discard unsaved changes and open another file?"
      confirmLabel="Discard"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { onConfirm, onCancel };
};

describe('ConfirmDialog', () => {
  it('is one modal dialog, labelled by its title and described by its message', () => {
    setup();
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAttribute('aria-modal', 'true');
    expect(dialogs[0]).toHaveAccessibleName('Open Image');
    expect(dialogs[0]).toHaveAccessibleDescription('Discard unsaved changes and open another file?');
  });

  it('routes every answer through the two callbacks, with Cancel as the default', () => {
    const { onConfirm, onCancel } = setup();
    expect(screen.getByTestId('confirm-dialog-confirm-button')).toHaveTextContent('Discard');
    expect(screen.getByTestId('confirm-dialog-cancel-button')).toHaveTextContent('Cancel');

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('treats Escape, the close button and the backdrop as Cancel', () => {
    const { onConfirm, onCancel } = setup();
    const dialog = screen.getByTestId('confirm-dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('confirm-dialog-close-button'));
    fireEvent.click(dialog.firstElementChild as Element);

    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('owns the keyboard while it is up, so a shortcut cannot reach the document behind it', () => {
    setup();
    // `useDialogFocusContainment` suppresses document-level keydowns while a dialog is
    // mounted, and this component mounts one wherever a replacement is about to happen.
    // Without it, Cmd+Z or a tool hotkey would fire against the document being discarded.
    const dialog = screen.getByTestId('confirm-dialog');
    const seen: KeyboardEvent[] = [];
    document.addEventListener('keydown', (event) => seen.push(event));
    fireEvent.keyDown(dialog, { key: 'z', metaKey: true });
    document.removeEventListener('keydown', (event) => seen.push(event));
    expect(seen).toHaveLength(0);
  });
});
