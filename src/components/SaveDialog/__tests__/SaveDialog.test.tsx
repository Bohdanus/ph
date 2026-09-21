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

  it('exposes JPEG quality and sends the selected value with the save request', () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);

    expect(screen.getByRole('option', { name: 'BMP' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'GIF (static)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AVIF' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'ICO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SVG (flattened)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'image/jpeg' } });
    const quality = screen.getByLabelText('JPEG quality') as HTMLInputElement;
    expect(quality.value).toBe('0.92');
    fireEvent.change(quality, { target: { value: '0.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'design', format: 'image/jpeg', quality: 0.35 });
  });
});
