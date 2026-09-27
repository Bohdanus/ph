import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  // SaveDialog.tsx:20-24 re-enables the controls from a `finally` block but has
  // no `catch`, so a rejected onSave would surface as an unhandled rejection in
  // Vitest. The production caller (useFile.handleImageSave) already swallows its
  // own failures and resolves, so the observable contract here is the `finally`.
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
