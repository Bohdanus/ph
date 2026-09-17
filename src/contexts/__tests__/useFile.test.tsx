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
      canvas: document.createElement('canvas'),
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
      void filesRef.current!.openSaveImageDialog(input).then(resolved);
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
      void filesRef.current!.openLoadImageDialog().then(resolved);
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
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
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
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
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
      canvas: document.createElement('canvas'),
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
      canvas: document.createElement('canvas'),
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
      canvas: document.createElement('canvas'),
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
      canvas: document.createElement('canvas'),
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
      canvas: document.createElement('canvas'),
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

  it('handles save failure with alert and null resolution', async () => {
    vi.mocked(saveImageToDisk).mockRejectedValue(new Error('Disk full'));
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      canvas: document.createElement('canvas'),
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
    expect(window.alert).toHaveBeenCalledWith('Failed to save file: Disk full');
    expect(console.error).toHaveBeenCalledWith('Failed to save image:', new Error('Disk full'));
  });

  it('handles PSD save failure with alert and null resolution', async () => {
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
    expect(window.alert).toHaveBeenCalledWith('Failed to save file: PSD encoding failed');
  });

  it('handles multiple sequential saves', async () => {
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    render(
      <FileProvider>
        <Consumer />
      </FileProvider>
    );
    const input = {
      canvas: document.createElement('canvas'),
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
    expect(window.alert).toHaveBeenCalledWith('Failed to open file: Unsupported format');
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
});
