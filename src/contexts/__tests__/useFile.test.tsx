import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FileProvider, useFile, type FileContextType } from '../useFile.tsx';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from '../image-load-save-utils.ts';
import { savePsd } from '../psd-utils.ts';

vi.mock('../image-load-save-utils.ts', () => ({
  downloadBlob: vi.fn(),
  loadDocumentFile: vi.fn(),
  saveImageToDisk: vi.fn(),
}));
vi.mock('../psd-utils.ts', () => ({ savePsd: vi.fn() }));

let files: FileContextType;
function Consumer() {
  files = useFile();
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
      canvas: document.createElement('canvas'),
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void files.openSaveImageDialog(input).then(resolved);
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
      void files.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    expect(input.getAttribute('accept')).toContain('.psd');
    const file = new File([], 'drawing.psd');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(imported));
    expect(loadDocumentFile).toHaveBeenCalledWith(file);
  });

  it('resolves PSD encoding failure with null, no download, and alert', async () => {
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
      canvas: document.createElement('canvas'),
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void files.openSaveImageDialog(input).then(resolved);
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
    expect(window.alert).toHaveBeenCalledWith('Failed to save file: Encoding failed');
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('Encoding failed'));
  });

  it('passes JPEG quality through to raster encoding and resolves the save details', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      canvas: document.createElement('canvas'),
      fileName: 'drawing.psd',
      layers: {},
      size: { width: 10, height: 8 },
    };
    const resolved = vi.fn();
    act(() => {
      void files.openSaveImageDialog(input).then(resolved);
    });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'image/jpeg' } });
    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '0.35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saveImageToDisk).toHaveBeenCalledWith(input.canvas, 'drawing (copy)', 'image/jpeg', 0.35)
    );
    expect(resolved).toHaveBeenCalledWith({ fileName: 'drawing (copy)', format: 'image/jpeg', quality: 0.35 });
    expect(screen.queryByText('Save File As...')).toBeNull();
  });

  it('resolves PSD load failure with null, no document, and alert', async () => {
    vi.mocked(loadDocumentFile).mockRejectedValue(new Error('PSD load error'));
    const { container } = render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const resolved = vi.fn();
    act(() => {
      void files.openLoadImageDialog().then(resolved);
    });
    const input = container.querySelector('input[type=file]')!;
    const file = new File([], 'drawing.psd');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(null));
    expect(loadDocumentFile).toHaveBeenCalledWith(file);
    expect(window.alert).toHaveBeenCalledWith('Failed to open file: PSD load error');
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
      void files.openLoadImageDialog().then(resolved);
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
