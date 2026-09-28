import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider, useKeyDownShortcut } from '../../../hooks/useKeyboardEvents.tsx';
import SaveDialog from '../SaveDialog.tsx';

afterEach(cleanup);

describe('SaveDialog asynchronous save', () => {
  it.each(['image/png', 'psd'])('waits for %s saving and leaves closure to the caller', async (format) => {
    let finish!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'export' } });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: format } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'export', format });
    expect(onClose).not.toHaveBeenCalled();

    const saving = screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    const close = screen.getByTestId('save-dialog-close-button') as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    fireEvent.click(saving);
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.click(screen.getByTestId('save-dialog-backdrop'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      finish();
    });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes JPEG quality and sends the selected value with the save request', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    expect(screen.getByRole('option', { name: 'BMP' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GIF (static)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AVIF' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ICO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SVG (flattened)' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'image/jpeg' } });
    });
    const quality = screen.getByLabelText('JPEG quality') as HTMLInputElement;
    expect(quality.value).toBe('0.92');
    await act(async () => {
      fireEvent.change(quality, { target: { value: '0.35' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'design', format: 'image/jpeg', quality: 0.35 });
  });
});

const filenameInput = () => screen.getByLabelText('Filename') as HTMLInputElement;
const formatSelect = () => screen.getByLabelText('Format') as HTMLSelectElement;
const saveButton = () => screen.getByRole('button', { name: /^(Save|Saving\.\.\.)$/ }) as HTMLButtonElement;

describe('SaveDialog filename handling', () => {
  it('seeds the filename field with the proposed name', () => {
    render(<SaveDialog proposedName="holiday (copy)" onSave={vi.fn()} onClose={vi.fn()} />);

    expect(filenameInput().value).toBe('holiday (copy)');
  });

  it('keeps the save button disabled while the filename is empty', () => {
    render(<SaveDialog proposedName="" onSave={vi.fn()} onClose={vi.fn()} />);

    expect(saveButton().disabled).toBe(true);
  });

  it.each(['', '   ', '\t'])('keeps the save button disabled for the blank name %j', (name) => {
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(filenameInput(), { target: { value: name } });

    expect(saveButton().disabled).toBe(true);
  });

  it('re-enables the save button as soon as a non-blank name is typed', () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(filenameInput(), { target: { value: '  ' } });
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(filenameInput(), { target: { value: 'final' } });
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'final', format: 'image/png' });
  });

  it('does not save a whitespace-only name even when the click is forced', () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(filenameInput(), { target: { value: '  ' } });
    fireEvent.click(saveButton());

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('SaveDialog format options', () => {
  it('defaults to PNG and lists every supported format plus PSD', () => {
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={vi.fn()} />);

    expect(formatSelect().value).toBe('image/png');
    expect(Array.from(formatSelect().options).map((option) => option.value)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/tiff',
      'image/bmp',
      'image/gif',
      'image/avif',
      'image/x-icon',
      'image/svg+xml',
      'psd',
    ]);
  });

  it('shows the PSD caveat only while the PSD format is selected', () => {
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByText(/Preserves raster layers/)).toBeNull();

    fireEvent.change(formatSelect(), { target: { value: 'psd' } });
    expect(screen.getByText(/Preserves raster layers/)).toBeInTheDocument();

    fireEvent.change(formatSelect(), { target: { value: 'image/webp' } });
    expect(screen.queryByText(/Preserves raster layers/)).toBeNull();
  });

  it('hides the JPEG quality slider for every non-JPEG format', () => {
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByLabelText('JPEG quality')).toBeNull();

    fireEvent.change(formatSelect(), { target: { value: 'image/jpeg' } });
    expect(screen.getByLabelText('JPEG quality')).toBeInTheDocument();

    fireEvent.change(formatSelect(), { target: { value: 'psd' } });
    expect(screen.queryByLabelText('JPEG quality')).toBeNull();
  });

  it('omits the quality field for non-JPEG formats even after the slider was used', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={vi.fn()} />);

    fireEvent.change(formatSelect(), { target: { value: 'image/jpeg' } });
    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.1' } });
    fireEvent.change(formatSelect(), { target: { value: 'image/tiff' } });

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'design', format: 'image/tiff' });
  });
});

describe('SaveDialog cancel and close paths', () => {
  it('closes through the Cancel button', () => {
    const onClose = vi.fn();
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes through the header close button', () => {
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('save-dialog-close-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked before a save starts', () => {
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('save-dialog-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SaveDialog failure handling', () => {
  // The `catch` in `SaveDialog.handleSave` owns the user-visible failure: the
  // `finally` alone only re-enables the controls, so without it a rejected
  // `onSave` reached the void as an unhandled rejection and the user was told
  // nothing. The production caller (useFile.handleImageSave) catches its own
  // failures, alerts, and resolves, so the contract under test here is the
  // component boundary a rejecting caller crosses.
  it('restores the controls when onSave resolves', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'design', format: 'image/png' });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves closure to the caller after a successful save', async () => {
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={() => Promise.resolve()} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(saveButton());
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-dialog')).toBeInTheDocument();
  });
});

/**
 * The app tsconfig intentionally ships without `@types/node`, so the Node-level
 * rejection hook is reached through `globalThis` with a local structural type,
 * the same shape `src/contexts/__tests__/unhandled-rejections.test.ts` uses.
 */
type RejectionHook = {
  listeners(event: 'unhandledRejection'): Array<(...args: never[]) => void>;
  removeAllListeners(event: 'unhandledRejection'): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  removeListener(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
};

const rejectionHook = (globalThis as Record<string, unknown>).process as RejectionHook;

describe('SaveDialog rejected save', () => {
  let rejections: unknown[];
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  /**
   * Node emits `unhandledRejection` on `process`, not on `window`, and Vitest
   * installs its own listener that turns any such event into a file-level error.
   * The runner's listeners are lifted for the duration of each test and restored
   * afterwards, so a leaked rejection is asserted here instead of aborting the
   * file. `onNodeRejection` is always installed, which is also what keeps Node
   * from crashing on the rejected promise.
   */
  let runnerListeners: Array<(...args: never[]) => void>;
  let onNodeRejection: (reason: unknown) => void;

  beforeEach(() => {
    rejections = [];
    runnerListeners = rejectionHook.listeners('unhandledRejection');
    rejectionHook.removeAllListeners('unhandledRejection');
    onNodeRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    rejectionHook.on('unhandledRejection', onNodeRejection);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rejectionHook.removeListener('unhandledRejection', onNodeRejection);
    for (const listener of runnerListeners) {
      rejectionHook.on('unhandledRejection', listener as (reason: unknown) => void);
    }
    alertSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  /**
   * Node reports an unhandled rejection at the microtask checkpoint after the
   * rejecting tick, so one macrotask boundary is not enough; drain several
   * deterministically instead of polling with a timeout.
   */
  const drain = async () => {
    for (let tick = 0; tick < 4; tick += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  it('surfaces a rejected save to the user instead of dropping it into an unhandled rejection', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(() => Promise.reject(new Error('Encoding failed')));
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await drain();

    expect(rejections).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Failed to save file:', expect.any(Error));
    expect(alertSpy).toHaveBeenCalledExactlyOnceWith('Failed to save file: Encoding failed');
  });

  it('still restores the controls and leaves the dialog open after a rejected save', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(() => Promise.reject('PSD encoder exploded'));
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await drain();

    // A non-Error rejection reason is stringified, matching useFile.tsx:132.
    expect(alertSpy).toHaveBeenCalledExactlyOnceWith('Failed to save file: PSD encoder exploded');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('save-dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows no failure feedback when the save resolves', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await drain();

    expect(alertSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(rejections).toEqual([]);
  });
});

const FOCUSABLE = 'select, input, textarea, button, [tabindex]:not([tabindex="-1"])';

function dialogFocusables() {
  return Array.from(screen.getByTestId('save-dialog').querySelectorAll<HTMLElement>(FOCUSABLE));
}

const closeButton = () => screen.getByTestId('save-dialog-close-button') as HTMLButtonElement;
const cancelButton = () => screen.getByTestId('save-dialog-cancel-button') as HTMLButtonElement;
const submitButton = () => screen.getByTestId('save-dialog-submit-button') as HTMLButtonElement;
const jpegQuality = () => screen.getByTestId('save-dialog-jpeg-quality') as HTMLInputElement;

function renderDialog({ proposedName = 'design' }: { proposedName?: string } = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn(() => Promise.resolve());
  const view = render(<SaveDialog proposedName={proposedName} onSave={onSave} onClose={onClose} />);
  return { onClose, onSave, ...view };
}

const UndoProbe = ({ onKeyDown }: { onKeyDown: () => void }) => {
  useKeyDownShortcut({ key: 'z', mod: true, preventDefault: true, onKeyDown });
  return null;
};

function SaveDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="file-save-trigger" onClick={() => setOpen(true)}>
        Save As
      </button>
      {open && (
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

describe('SaveDialog focus ownership', () => {
  it('focuses the filename input on mount, because the close button would leave the shortcut layer live', () => {
    renderDialog();

    expect(document.activeElement).toBe(filenameInput());
    // The first focusable in document order is the header close button, so the naive
    // "focus the first control" selector lands on a button, which is not text-like and
    // therefore re-opens the shortcut hole the focus move was meant to close.
    expect(dialogFocusables()[0]).toBe(closeButton());
  });

  it('keeps the close button first and the submit button last in the focus order', () => {
    renderDialog();

    expect(dialogFocusables().map((element) => element.getAttribute('data-testid'))).toEqual([
      'save-dialog-close-button',
      'save-dialog-filename-input',
      'save-dialog-format-select',
      'save-dialog-cancel-button',
      'save-dialog-submit-button',
    ]);
  });

  it('wraps Tab from the last control back to the first', () => {
    renderDialog();
    const focusables = dialogFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    renderDialog();
    const focusables = dialogFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('leaves a Tab in the middle of the order to the browser', () => {
    renderDialog();
    const middle = dialogFocusables()[1];
    expect(middle).toBe(filenameInput());

    middle.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    middle.dispatchEvent(tab);

    // jsdom never moves focus on Tab by itself, so an unchanged activeElement is what
    // proves the dialog declined to intercept rather than what proves focus stayed.
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);
  });

  it('closes on Escape without letting the keydown reach document', () => {
    const { onClose } = renderDialog();
    const documentListener = vi.fn();
    document.addEventListener('keydown', documentListener);

    try {
      fireEvent.keyDown(filenameInput(), { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', documentListener);
    }

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('does not preventDefault Escape, so nothing else is starved of the key', () => {
    renderDialog();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    filenameInput().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('restores focus to the element that opened it once it closes', () => {
    render(<SaveDialogHarness />);
    const trigger = screen.getByTestId('file-save-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(filenameInput());

    fireEvent.click(cancelButton());

    expect(document.activeElement).toBe(trigger);
  });

  it('never lets the app shortcut layer fire from a text-like control inside the dialog', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(filenameInput(), { key: 'z', metaKey: true });
    fireEvent.keyDown(formatSelect(), { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();

    // A range input is not text-like, so isEditableTarget would let this one through
    // and the dialog's own stopPropagation is the only thing that can stop it. Without
    // the control above, the two text-like assertions would pass on isEditableTarget
    // alone and would prove nothing about the dialog owning its keyboard.
    act(() => {
      fireEvent.change(formatSelect(), { target: { value: 'image/jpeg' } });
    });
    fireEvent.keyDown(jpegQuality(), { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('never lets the app shortcut layer fire from a button inside the dialog either', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(closeButton(), { key: 'z', metaKey: true });
    fireEvent.keyDown(cancelButton(), { key: 'z', metaKey: true });
    fireEvent.keyDown(submitButton(), { key: 'z', metaKey: true });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('still delivers the app shortcut layer from outside the dialog, so the probe is not vacuous', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <UndoProbe onKeyDown={onKeyDown} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(screen.getByTestId('outside-control'), { key: 'z', metaKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('recovers the focus a click on its own non-interactive text drops on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('save-dialog');
    formatSelect().focus();
    expect(document.activeElement).toBe(formatSelect());

    // Clicking the "Save File As..." title focuses nothing, so the browser blurs the
    // control and leaves focus on <body> with a null relatedTarget and no focusin.
    (document.activeElement as HTMLElement).blur();

    expect(document.activeElement).not.toBe(document.body);
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(formatSelect());
  });

  it('recovers the mount focus rather than the first control when focus is dropped on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('save-dialog');
    expect(document.activeElement).toBe(filenameInput());

    (document.activeElement as HTMLElement).blur();

    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(filenameInput());
    expect(document.activeElement).not.toBe(closeButton());
  });

  it('keeps Tab and the app shortcut layer inside the panel after focus is driven outside it', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <UndoProbe onKeyDown={onKeyDown} />
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </KeyboardEventsProvider>
    );
    const panel = screen.getByTestId('save-dialog');

    (document.activeElement as HTMLElement).blur();
    expect(panel.contains(document.activeElement)).toBe(true);

    const focusables = dialogFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('refuses the tab and the shortcut layer when the focused control is removed and no focus event fires', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </KeyboardEventsProvider>
    );
    const panel = screen.getByTestId('save-dialog');

    // A re-render can unmount the focused control, which drops focus on <body> without
    // dispatching focusout or focusin, so no focus containment guard can see it coming.
    expect(document.activeElement).toBe(filenameInput());
    (document.activeElement as HTMLElement).remove();
    expect(document.activeElement).toBe(document.body);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('brings focus back when a tab arrives at the panel itself while focus is on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('save-dialog');

    expect(document.activeElement).toBe(filenameInput());
    (document.activeElement as HTMLElement).remove();
    expect(document.activeElement).toBe(document.body);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('takes focus back when something outside the dialog focuses itself', () => {
    render(
      <>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </>
    );
    const panel = screen.getByTestId('save-dialog');

    screen.getByTestId('outside-control').focus();

    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('stays contained after the format select is replaced by the JPEG quality slider', () => {
    render(
      <>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <SaveDialog proposedName="design" onSave={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />
      </>
    );
    const panel = screen.getByTestId('save-dialog');

    act(() => {
      fireEvent.change(formatSelect(), { target: { value: 'image/jpeg' } });
    });
    jpegQuality().focus();
    expect(document.activeElement).toBe(jpegQuality());

    // The focus order grew a control in the middle, so both wrap points have to be
    // recomputed from the live DOM rather than read once at mount.
    const focusables = dialogFocusables();
    expect(focusables).toContain(jpegQuality());
    expect(focusables[0]).toBe(closeButton());
    const last = focusables[focusables.length - 1];
    expect(last).toBe(submitButton());

    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);

    screen.getByTestId('outside-control').focus();

    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('recovers focus to a control that accepts it while the Save controls are disabled', async () => {
    let finish!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(
      <>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <SaveDialog proposedName="design" onSave={onSave} onClose={vi.fn()} />
      </>
    );
    const panel = screen.getByTestId('save-dialog');

    submitButton().focus();
    expect(document.activeElement).toBe(submitButton());

    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(closeButton().disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);

    // The control the user was on is now disabled, and so is the first focusable, so
    // both the restore candidate and the head of the walk refuse focus. A recovery that
    // focused the first candidate and returned unconditionally would strand the dialog
    // on a control that cannot be typed into or activated; this one has to walk on to
    // the filename. jsdom never blurs a control a render just disabled, so the recovery
    // is driven from outside instead of by the blur the browser would perform.
    screen.getByTestId('outside-control').focus();

    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(filenameInput());
    expect(document.activeElement).not.toBe(submitButton());

    await act(async () => {
      finish();
    });
  });

  it('wraps Shift+Tab to a control that accepts focus, not to a disabled Save', () => {
    // The regression: the wrap endpoints came from the unfiltered focusable list, so the
    // last one was the Save button. With the filename blank the Save button is disabled,
    // and `focus()` on a disabled control is a no-op — so Shift+Tab from the close button
    // ate the keystroke AND left focus where it was. Forward Tab then had a different
    // failure: the default was not prevented, the browser left the panel, and the
    // containment arm pulled straight back. The user could not reach the filename field,
    // the format select or Cancel by keyboard at all. Only Escape and the close button
    // worked, and this dialog used to have no trap at all.
    renderDialog({ proposedName: '' });

    expect(submitButton().disabled).toBe(true);

    closeButton().focus();
    fireEvent.keyDown(closeButton(), { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(cancelButton());
    expect(document.activeElement).not.toBe(submitButton());
  });

  it('wraps Tab forward from the last enabled control to the first', () => {
    renderDialog({ proposedName: '' });

    expect(submitButton().disabled).toBe(true);

    // Cancel is now the last control that can take focus, because Save is off.
    cancelButton().focus();
    fireEvent.keyDown(cancelButton(), { key: 'Tab' });

    expect(document.activeElement).toBe(closeButton());
  });

  it('is announced as a modal dialog labelled by its title', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Save File As...');
  });
});
