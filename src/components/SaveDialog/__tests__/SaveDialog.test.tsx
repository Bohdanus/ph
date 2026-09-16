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
    const { container } = render(<SaveDialog proposedName="design" onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'export' } });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: format } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ fileName: 'export', format });
    expect(onClose).not.toHaveBeenCalled();

    const saving = screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    const close = screen.getAllByRole('button')[0] as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    fireEvent.click(saving);
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.click(container.querySelector('.bg-opacity-25')!);
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
});
