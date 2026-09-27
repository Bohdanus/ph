import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
