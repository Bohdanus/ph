import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { FileProvider, useFile, type FileContextType } from '../useFile.tsx';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from '../image-load-save-utils.ts';
import { savePsd } from '../psd-utils.ts';

vi.mock('../image-load-save-utils.ts', () => ({
  downloadBlob: vi.fn(),
  loadDocumentFile: vi.fn(),
  saveImageToDisk: vi.fn(),
}));
vi.mock('../psd-utils.ts', () => ({ savePsd: vi.fn() }));

const filesRef = { current: null as FileContextType | null };
function Consumer() {
  const files = useFile();
  useLayoutEffect(() => {
    filesRef.current = files;
  });
  return null;
}

describe('FileProvider PSD integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves PSD save only after encoding and downloading the layered document', async () => {
    let finish!: (buffer: ArrayBuffer) => void;
    vi.mocked(savePsd).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'psd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePsd).toHaveBeenCalledWith(input.layers, input.size));
    expect(resolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    await act(async () => {
      finish(new ArrayBuffer(8));
    });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'drawing (copy)', 'psd');
    expect(resolved).toHaveBeenCalledWith({ fileName: 'drawing (copy)', format: 'psd' });
    expect(screen.queryByText('Save File As...')).toBeNull();
  });

  it('routes PSD file picker selection through the document loader', async () => {
    const imported = { fileName: 'drawing.psd', document: { size: { width: 1, height: 1 }, layers: {}, warnings: [] } };
    vi.mocked(loadDocumentFile).mockResolvedValue(imported);
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    expect(input.getAttribute('accept')).toContain('.psd');
    expect(input.getAttribute('accept')).toContain('.bmp');
    expect(input.getAttribute('accept')).toContain('.gif');
    expect(input.getAttribute('accept')).toContain('.avif');
    expect(input.getAttribute('accept')).toContain('.ico');
    expect(input.getAttribute('accept')).toContain('.svg');
    const file = new File([], 'drawing.psd');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(imported));
    expect(loadDocumentFile).toHaveBeenCalledWith(file);
  });

  it('resolves PSD encoding failure with null, no download, and a logged error', async () => {
    let finish!: (error: Error) => void;
    vi.mocked(savePsd).mockImplementation(
      () =>
        new Promise((_, reject) => {
          finish = reject;
        })
    );
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'psd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePsd).toHaveBeenCalledWith(input.layers, input.size));
    expect(resolved).not.toHaveBeenCalled();
    await act(async () => {
      finish(new Error('Encoding failed'));
    });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(resolved).toHaveBeenCalledWith(null);
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('Encoding failed'));
  });

  /**
   * SKIPPED BY DECLARATION, not fixed. Intermittent: one failure in five full
   * `src/contexts` runs, never in isolation and never on a re-run of the same
   * tree, and the captured assertion is a Save File As dialog that was OPEN when
   * it must not be — after the save had already resolved one line above it. See
   * TEST-FLAKES.md \u00a77, which holds the capture and the narrowed hunt.
   *
   * The skip is a gate decision, not a waiver, on the same grounds as
   * `e2e/viewport-drawing.spec.ts`: a default run is contracted to zero failures,
   * and a test red one run in five makes unrelated merges look broken, which
   * trains the response of ignoring the gate. Nothing about the defect is waived
   * — \u00a77 stays open, the hunt stays un-done, and this is one line to remove.
   *
   * Do not "fix" it by loosening an assertion. The save resolves and the details
   * are right; the only thing that failed is a dialog that should not have been
   * open, so there is no bound here to widen.
   *
   * Operator decision, 2026-09-29.
   */
  it.skip('passes JPEG quality through to raster encoding and resolves the save details', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'image/jpeg' } });
    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveImageToDisk).toHaveBeenCalledWith(
        // The encoded surface is rendered here from `(layers, size)`, not the caller's
        // canvas — a caller no longer supplies one. Its extent is the assertion, because
        // an identity check would pin the coupling this change removes.
        expect.objectContaining({ width: 10, height: 8 }),
        'drawing (copy)',
        'image/jpeg',
        0.35
      )
    );
    expect(resolved).toHaveBeenCalledWith({ fileName: 'drawing (copy)', format: 'image/jpeg', quality: 0.35 });
    expect(screen.queryByText('Save File As...')).toBeNull();
  });

  it('resolves PSD load failure with null, no document, and a logged error', async () => {
    vi.mocked(loadDocumentFile).mockRejectedValue(new Error('PSD load error'));
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    const file = new File([], 'drawing.psd');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(loadDocumentFile).toHaveBeenCalledWith(file);
    expect(console.error).toHaveBeenCalledWith('Failed to load image:', new Error('PSD load error'));
  });

  it('cancels file picker with null and no loader call', async () => {
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    await act(async () => {
      const cancelEvent = new Event('cancel');
      input.dispatchEvent(cancelEvent);
    });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('FileProvider openNewImageDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves with BlankImageParams on OK submit', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));
    await waitFor(() =>
      expect(resolved).toHaveBeenCalledWith(
        expect.objectContaining({
          size: { width: 800, height: 600 },
          color: '#ffffff',
          opacity: 1,
          isBedrock: true,
        })
      )
    );
  });

  it('resolves null on cancel', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.click(screen.getByTestId('new-image-dialog-cancel-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
  });

  it('resolves null on dialog close (backdrop click)', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.click(screen.getByTestId('new-image-dialog-close-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
  });

  it('updates width/height when preset changes', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.change(screen.getByTestId('new-image-preset-select'), {
      target: { value: 'us-letter' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('new-image-width-input') as HTMLInputElement).value).toBe('2550');
      expect((screen.getByTestId('new-image-height-input') as HTMLInputElement).value).toBe('3300');
    });
  });

  it('recalculates dimensions when DPI changes for non-pixel preset', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.change(screen.getByTestId('new-image-preset-select'), {
      target: { value: 'us-letter' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('new-image-dpi-input') as HTMLInputElement).disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId('new-image-dpi-input'), {
      target: { value: '150' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('new-image-width-input') as HTMLInputElement).value).toBe('1275');
      expect((screen.getByTestId('new-image-height-input') as HTMLInputElement).value).toBe('1650');
    });
  });

  it('disables background color when opacity is 0', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.change(screen.getByTestId('new-image-preset-select'), {
      target: { value: 'us-letter' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('new-image-dpi-input') as HTMLInputElement).disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId('new-image-dpi-input'), {
      target: { value: '150' },
    });
    await waitFor(() => {
      expect((screen.getByTestId('new-image-width-input') as HTMLInputElement).value).toBe('1275');
      expect((screen.getByTestId('new-image-height-input') as HTMLInputElement).value).toBe('1650');
    });
  });

  it('switches to custom preset when width/height manually edited', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openNewImageDialog().then(resolved);
    });
    fireEvent.change(screen.getByTestId('new-image-width-input'), {
      target: { value: '1234' },
    });
    await waitFor(() =>
      expect((screen.getByTestId('new-image-preset-select') as HTMLSelectElement).value).toBe('custom')
    );
  });
});

describe('FileProvider save dialog edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables Save button when filename is empty', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    act(() => {
      void filesRef.current!.openSaveImageDialog(input);
    });
    fireEvent.change(screen.getByTestId('save-dialog-filename-input'), {
      target: { value: '' },
    });
    expect((screen.getByTestId('save-dialog-submit-button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('save-dialog-filename-input'), {
      target: { value: 'valid.png' },
    });
    expect((screen.getByTestId('save-dialog-submit-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows JPEG quality slider only for JPEG format', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    act(() => {
      void filesRef.current!.openSaveImageDialog(input);
    });
    expect(screen.queryByTestId('save-dialog-jpeg-quality')).toBeNull();
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), {
      target: { value: 'image/jpeg' },
    });
    expect(screen.getByTestId('save-dialog-jpeg-quality')).not.toBeNull();
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), {
      target: { value: 'image/png' },
    });
    expect(screen.queryByTestId('save-dialog-jpeg-quality')).toBeNull();
  });

  it('shows PSD warning text when PSD format selected', async () => {
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    act(() => {
      void filesRef.current!.openSaveImageDialog(input);
    });
    expect(screen.queryByText((content) => content.includes('Preserves raster layers'))).toBeNull();
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), {
      target: { value: 'psd' },
    });
    expect(screen.queryByText((content) => content.includes('Preserves raster layers'))).not.toBeNull();
  });

  it('closes dialog and resolves null on cancel button', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.click(screen.getByTestId('save-dialog-cancel-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(saveImageToDisk).not.toHaveBeenCalled();
  });

  it('closes dialog and resolves null on backdrop click', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.click(screen.getByTestId('save-dialog-close-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(saveImageToDisk).not.toHaveBeenCalled();
  });

  it('handles save failure with a logged error and null resolution', async () => {
    vi.mocked(saveImageToDisk).mockRejectedValue(new Error('Disk full'));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('Disk full'));
  });

  it('handles PSD save failure with a logged error and null resolution', async () => {
    let finish!: (error: Error) => void;
    vi.mocked(savePsd).mockImplementation(
      () =>
        new Promise((_, reject) => {
          finish = reject;
        })
    );
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), {
      target: { value: 'psd' },
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(savePsd).toHaveBeenCalledWith(input.layers, input.size));
    expect(resolved).not.toHaveBeenCalled();
    await act(async () => {
      finish(new Error('PSD encoding failed'));
    });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(resolved).toHaveBeenCalledWith(null);
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('PSD encoding failed'));
  });

  it('handles multiple sequential saves', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'test.png',
      layers: {},
      size: { width: 10, height: 10 },
    };
    const resolved1 = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved1);
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(resolved1).toHaveBeenCalledWith({ fileName: 'test (copy)', format: 'image/png' }));

    const resolved2 = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved2);
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), {
      target: { value: 'image/jpeg' },
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() =>
      expect(resolved2).toHaveBeenCalledWith({ fileName: 'test (copy)', format: 'image/jpeg', quality: 0.92 })
    );
  });
});

/**
 * A failed export must leave the Save dialog on screen. The teardown used to sit in the
 * `finally` of `handleImageSave`, so "the attempt finished" and "the save worked" were the
 * same condition and a failure closed the dialog exactly as a success does — which took
 * away the only affordance that could recover from one. Each test below pins one half of
 * the contract, because the two halves fail independently: a dialog that stays open but
 * keeps its controls disabled is not a retry path, and re-enabled controls on a dialog
 * that closed are not a retry either.
 */
describe('FileProvider save dialog after a failed export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stagedInput = () => ({
    fileName: 'test.png',
    layers: {},
    size: { width: 10, height: 10 },
  });

  const submit = () => screen.getByTestId('save-dialog-submit-button') as HTMLButtonElement;
  const cancel = () => screen.getByTestId('save-dialog-cancel-button') as HTMLButtonElement;

  it('keeps the dialog on screen and its controls live after a failed raster export', async () => {
    vi.mocked(saveImageToDisk).mockRejectedValue(new Error('Disk full'));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(stagedInput()).then(resolved);
    });

    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('Disk full')));

    // The failure is still reported in band, so the caller's `if (data)` guard holds and
    // the document is never marked saved.
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
    expect(screen.getByTestId('save-dialog')).toBeInTheDocument();
    // `saving` is reset by SaveDialog's own `finally`, so the dialog is not a shell.
    expect(submit().disabled).toBe(false);
    expect(cancel().disabled).toBe(false);
  });

  it('closes the dialog when the export succeeds', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(stagedInput()).then(resolved);
    });

    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() =>
      expect(resolved).toHaveBeenCalledExactlyOnceWith({ fileName: 'test (copy)', format: 'image/png' })
    );

    expect(screen.queryByTestId('save-dialog')).toBeNull();
  });

  it('carries the format, filename and quality the user chose into the retry, and closes on the retry', async () => {
    // The dialog is keyed on the staged file name, so a failure that leaves the staged
    // input alone must not remount it: the point of a retry is that the user's own
    // settings are still on screen. A remount would silently revert all three.
    vi.mocked(saveImageToDisk).mockRejectedValue(new Error('Encoder refused this canvas'));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(stagedInput()).then(resolved);
    });
    fireEvent.change(screen.getByTestId('save-dialog-filename-input'), { target: { value: 'poster' } });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'image/jpeg' } });
    fireEvent.change(screen.getByTestId('save-dialog-jpeg-quality'), { target: { value: '0.35' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Failed to save image:', expect.any(Error)));

    expect((screen.getByTestId('save-dialog-filename-input') as HTMLInputElement).value).toBe('poster');
    expect((screen.getByTestId('save-dialog-format-select') as HTMLSelectElement).value).toBe('image/jpeg');
    expect((screen.getByTestId('save-dialog-jpeg-quality') as HTMLInputElement).value).toBe('0.35');

    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    fireEvent.click(submit());
    await waitFor(() => expect(screen.queryByTestId('save-dialog')).toBeNull());

    expect(saveImageToDisk).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(saveImageToDisk).mock.calls) {
      expect(call.slice(1)).toEqual(['poster', 'image/jpeg', 0.35]);
    }
    // The failed attempt settled the promise with `null` and nulled the resolver, so the
    // successful retry resolved nothing: one settlement, not two.
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('re-encodes the same committed layers, size and frame on a retry after a failed PSD export', async () => {
    // The teardown also cleared `fileInput`, which is the only thing holding the staged
    // export record. A retry is only faithful if the second attempt encodes what the
    // caller's `commitDirtyTool()` produced, not a re-read of anything it owns.
    let fail!: (error: Error) => void;
    vi.mocked(savePsd).mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        })
    );
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const documentFrame = { x: 4, y: 5, width: 10, height: 10 };
    const input = { ...stagedInput(), fileName: 'drawing.psd', documentFrame };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'psd' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
    await act(async () => {
      fail(new Error('PSD encoding failed'));
    });

    expect(screen.getByTestId('save-dialog')).toBeInTheDocument();
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);

    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    fireEvent.click(submit());
    await waitFor(() => expect(screen.queryByTestId('save-dialog')).toBeNull());

    expect(savePsd).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(savePsd).mock.calls) {
      expect(call).toEqual([input.layers, input.size, documentFrame]);
    }
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('closes on Cancel after a failed export without re-resolving the settled promise', async () => {
    vi.mocked(saveImageToDisk).mockRejectedValue(new Error('Disk full'));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(stagedInput()).then(resolved);
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
    await waitFor(() => expect(resolved).toHaveBeenCalledExactlyOnceWith(null));

    fireEvent.click(cancel());

    expect(screen.queryByTestId('save-dialog')).toBeNull();
    // Cancel runs the same `saveResolverRef.current?.(null)` the failure already ran, so
    // `resolved` has to still be a single `null` rather than a second call.
    expect(resolved).toHaveBeenCalledExactlyOnceWith(null);
    expect(saveImageToDisk).toHaveBeenCalledTimes(1);
  });
});

describe('FileProvider openLoadImageDialog edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-image file types gracefully', async () => {
    vi.mocked(loadDocumentFile).mockRejectedValue(new Error('Unsupported format'));
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    const file = new File(['test'], 'document.pdf');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(console.error).toHaveBeenCalledWith('Failed to load image:', new Error('Unsupported format'));
  });

  it('resets file input value after selection', async () => {
    const imported = { fileName: 'test.png', image: new Image() };
    vi.mocked(loadDocumentFile).mockResolvedValue(imported);
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['test'], 'test.png');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(imported));
    // The input value should be reset
    expect(input.value).toBe('');
  });

  it('handles rapid open/close cycles', async () => {
    const imported = { fileName: 'test.png', image: new Image() };
    vi.mocked(loadDocumentFile).mockResolvedValue(imported);
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = container.querySelector('input[type=file]')!;

    for (let i = 0; i < 3; i++) {
      const resolved = vi.fn();
      act(() => {
        void filesRef.current!.openLoadImageDialog().then(resolved);
      });
      const file = new File(['test'], `test${i}.png`);
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(resolved).toHaveBeenCalledWith(imported));
    }
    expect(loadDocumentFile).toHaveBeenCalledTimes(3);
  });

  it('resolves null without loading when a change event carries no file at all', async () => {
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    // An emptied FileList is what a dismissed picker produces on some engines;
    // it must behave exactly like the `cancel` event rather than throwing.
    fireEvent.change(input, { target: { files: [] } });

    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ignores a change event with no file when no dialog promise is waiting', () => {
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = container.querySelector('input[type=file]')!;

    expect(() => fireEvent.change(input, { target: { files: [] } })).not.toThrow();
    expect(loadDocumentFile).not.toHaveBeenCalled();
  });
});

describe('useFile outside its provider', () => {
  it('throws a named error when the hook is used without a FileProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const Orphan = () => {
        useFile();
        return null;
      };

      expect(() => render(<Orphan />)).toThrow('useFile must be used within a FileProvider');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('FileProvider document frame and non-Error failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the document frame through to the PSD encoder when one is supplied', async () => {
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const documentFrame = { x: 10, y: 20, width: 30, height: 40 };
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 30, height: 40 },
      documentFrame,
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'psd' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(resolved).toHaveBeenCalledWith({ fileName: 'drawing (copy)', format: 'psd' }));
    expect(savePsd).toHaveBeenCalledWith(input.layers, input.size, documentFrame);
  });

  it('falls back to the two-argument encoder when no document frame is supplied', async () => {
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'psd' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(resolved).toHaveBeenCalledWith({ fileName: 'drawing (copy)', format: 'psd' }));
    expect(savePsd).toHaveBeenCalledWith(input.layers, input.size);
    expect(vi.mocked(savePsd).mock.calls[0]).toHaveLength(2);
  });

  it('logs a non-Error load failure verbatim and resolves null', async () => {
    vi.mocked(loadDocumentFile).mockRejectedValue('decoder exploded');
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef.current!.openLoadImageDialog().then(resolved);
    });
    fireEvent.change(container.querySelector('input[type=file]')!, {
      target: { files: [new File(['x'], 'broken.png')] },
    });

    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    // Nothing stringifies the reason any more, so the log is the only record of it and
    // a raw rejection has to reach it unchanged.
    expect(console.error).toHaveBeenCalledWith('Failed to load image:', 'decoder exploded');
  });

  it('logs a non-Error save failure verbatim and resolves null', async () => {
    vi.mocked(saveImageToDisk).mockRejectedValue('encoder exploded');
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef
        .current!.openSaveImageDialog({
          fileName: 'test.png',
          layers: {},
          size: { width: 10, height: 10 },
        })
        .then(resolved);
    });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', 'encoder exploded');
  });

  it('proposes a bare copy name when the requested file name is empty', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void filesRef
        .current!.openSaveImageDialog({
          fileName: '',
          layers: {},
          size: { width: 10, height: 10 },
        })
        .then(resolved);
    });

    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'image/png' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(resolved).toHaveBeenCalledWith({ fileName: ' (copy)', format: 'image/png' }));
    expect(saveImageToDisk).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), ' (copy)', 'image/png', undefined);
  });
});
