import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, loadDocumentFile, saveImageToDisk } from '../image-load-save-utils.ts';

const {
  encodeAvif,
  encodeBmp,
  encodeGif,
  encodeIco,
  encodeSvg,
  encodeTiff,
  loadAvifFile,
  loadBmpFile,
  loadIcoFile,
  loadPsd,
  loadTiffFile,
} = vi.hoisted(() => ({
  encodeAvif: vi.fn(),
  encodeBmp: vi.fn(),
  encodeGif: vi.fn(),
  encodeIco: vi.fn(),
  encodeSvg: vi.fn(),
  encodeTiff: vi.fn(),
  loadAvifFile: vi.fn(),
  loadBmpFile: vi.fn(),
  loadIcoFile: vi.fn(),
  loadPsd: vi.fn(),
  loadTiffFile: vi.fn(),
}));
vi.mock('../psd-utils.ts', () => ({ loadPsd }));
vi.mock('../tiff-utils.ts', () => ({ encodeTiff, loadTiffFile }));
vi.mock('../bmp-utils.ts', () => ({ encodeBmp, loadBmpFile }));
vi.mock('../gif-utils.ts', () => ({ encodeGif }));
vi.mock('../avif-utils.ts', () => ({ encodeAvif, loadAvifFile }));
vi.mock('../ico-utils.ts', () => ({ encodeIco, loadIcoFile }));
vi.mock('../svg-utils.ts', () => ({ encodeSvg }));

describe('document file routing', () => {
  beforeEach(() => {
    encodeAvif.mockReset();
    encodeBmp.mockReset();
    encodeGif.mockReset();
    encodeIco.mockReset();
    encodeSvg.mockReset();
    encodeTiff.mockReset();
    loadAvifFile.mockReset();
    loadBmpFile.mockReset();
    loadIcoFile.mockReset();
    loadPsd.mockReset();
    loadTiffFile.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['design.PSD', '', 'not a signature'],
    ['renamed.bin', 'application/octet-stream', '8BPSremaining bytes'],
    ['document.bin', 'image/vnd.adobe.photoshop', 'not a signature'],
  ])('routes %s to the PSD loader', async (name, type, content) => {
    const file = new File([content], name, { type });
    const document = { size: { width: 10, height: 20 }, layers: {}, warnings: [] };
    loadPsd.mockResolvedValue(document);
    const reader = vi.fn();
    vi.stubGlobal('FileReader', reader);
    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: name, document });
    expect(loadPsd).toHaveBeenCalledExactlyOnceWith(await file.arrayBuffer());
    expect(reader).not.toHaveBeenCalled();
  });

  it('routes a raster through FileReader and waits for image decoding', async () => {
    const file = new File(['PNG data'], 'photo.png', { type: 'image/png' });
    const readAsDataURL = vi.fn();
    let reader!: { onload: (event: { target: { result: string } }) => void };
    let image!: { onload: () => void; src: string };
    vi.stubGlobal(
      'FileReader',
      class {
        onload = () => {};
        readAsDataURL = readAsDataURL;
        constructor() {
          reader = this;
        }
      }
    );
    vi.stubGlobal(
      'Image',
      class {
        onload = () => {};
        src = '';
        constructor() {
          image = this;
        }
      }
    );
    const loaded = vi.fn();
    const promise = loadDocumentFile(file).then((value) => {
      loaded(value);
      return value;
    });
    await vi.waitFor(() => expect(readAsDataURL).toHaveBeenCalledWith(file));
    reader.onload({ target: { result: 'data:image/png;base64,test' } });
    expect(image.src).toBe('data:image/png;base64,test');
    expect(loaded).not.toHaveBeenCalled();
    image.onload();
    await expect(promise).resolves.toEqual({ fileName: 'photo.png', image });
    expect(loadPsd).not.toHaveBeenCalled();
  });

  it.each([
    ['renamed.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif'],
    ['renamed.bin', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'],
  ])('loads signature-detected %s through the native image decoder', async (name, content, mimeType) => {
    const file = new File([content], name, { type: '' });
    let reader!: { onload: (event: { target: { result: string } }) => void; readAsDataURL: (value: Blob) => void };
    let readerInput!: Blob;
    let image!: { onload: () => void; src: string };
    vi.stubGlobal(
      'FileReader',
      class {
        onload = () => {};
        readAsDataURL(value: Blob) {
          readerInput = value;
        }
        constructor() {
          reader = this;
        }
      }
    );
    vi.stubGlobal(
      'Image',
      class {
        onload = () => {};
        src = '';
        constructor() {
          image = this;
        }
      }
    );

    const promise = loadDocumentFile(file);
    await vi.waitFor(() => expect(readerInput).toBeInstanceOf(Blob));
    expect(readerInput.type).toBe(mimeType);
    reader.onload({ target: { result: `data:${mimeType};base64,test` } });
    image.onload();
    await expect(promise).resolves.toEqual({ fileName: name, image });
  });

  it.each([
    ['photo.tiff', 'image/tiff', 'not a signature'],
    ['photo.tif', '', 'not a signature'],
    ['renamed.bin', 'application/octet-stream', new Uint8Array([0x49, 0x49, 0x2a, 0x00])],
  ])('routes %s to the TIFF loader', async (name, type, content) => {
    const file = new File([content], name, { type });
    const image = { width: 10, height: 20 } as HTMLImageElement;
    loadTiffFile.mockResolvedValue(image);
    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: name, image });
    expect(loadTiffFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(loadPsd).not.toHaveBeenCalled();
  });

  it.each([
    ['photo.bmp', 'image/bmp', 'not a signature', loadBmpFile],
    ['photo.avif', 'image/avif', 'not a signature', loadAvifFile],
    ['photo.ico', 'image/x-icon', 'not a signature', loadIcoFile],
  ])('routes %s to the appropriate image loader', async (name, type, content, loader) => {
    const file = new File([content], name, { type });
    const image = { width: 10, height: 20 } as HTMLImageElement;
    vi.mocked(loader).mockResolvedValue(image);
    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: name, image });
    expect(loader).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('propagates PSD decoding failures without falling back to raster', async () => {
    loadPsd.mockRejectedValue(new Error('Invalid PSD header'));
    const file = new File(['bad'], 'broken.psd');
    await expect(loadDocumentFile(file)).rejects.toThrow('Invalid PSD header');
  });
});

describe('document downloads', () => {
  let downloads: { name: string; href: string; attached: boolean }[];
  const createObjectURL = vi.fn(() => 'blob:export');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    downloads = [];
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, href: this.href, attached: this.isConnected });
    });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['image/png', 'image/jpeg', 'image/webp', 'png'])(
    'uses the correct MIME and extension for %s',
    async (format) => {
      const extension = format.replace('image/', '');
      const blob = new Blob(['raster'], { type: `image/${extension}` });
      const canvas = document.createElement('canvas');
      const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
        callback(blob);
      });
      await saveImageToDisk(canvas, 'design.PSD', format);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), `image/${extension}`);
      expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
      expect(downloads).toEqual([{ name: `design.${extension}`, href: 'blob:export', attached: true }]);
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:export');
    }
  );

  it('encodes TIFF pixels and downloads the result with a TIFF extension', async () => {
    const blob = new Blob(['tiff'], { type: 'image/tiff' });
    const canvas = document.createElement('canvas');
    encodeTiff.mockResolvedValue(blob);
    await saveImageToDisk(canvas, 'design.webp', 'image/tiff');
    expect(encodeTiff).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(downloads).toEqual([{ name: 'design.tiff', href: 'blob:export', attached: true }]);
  });

  it.each([
    ['image/bmp', encodeBmp, 'image/bmp', 'design.bmp'],
    ['image/gif', encodeGif, 'image/gif', 'design.gif'],
    ['image/avif', encodeAvif, 'image/avif', 'design.avif'],
    ['image/x-icon', encodeIco, 'image/x-icon', 'design.ico'],
    ['image/svg+xml', encodeSvg, 'image/svg+xml', 'design.svg'],
  ])('uses the %s encoder and output extension', async (format, encoder, mimeType, name) => {
    const blob = new Blob(['encoded'], { type: mimeType });
    const canvas = document.createElement('canvas');
    vi.mocked(encoder).mockReturnValue(blob);
    await saveImageToDisk(canvas, 'design.webp', format);
    expect(encoder).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(downloads[0].name).toBe(name);
  });

  it('passes JPEG quality to the canvas encoder', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
      callback(blob);
    });
    await saveImageToDisk(canvas, 'design', 'image/jpeg', 0.35);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.35);
    expect(downloads[0].name).toBe('design.jpeg');
  });

  it.each(['design.png', 'design.jpeg', 'design.jpg', 'design.webp', 'design.PSD', 'design'])(
    'downloads a PSD blob named %s without doubling extensions',
    (name) => {
      const blob = new Blob(['8BPS'], { type: 'image/vnd.adobe.photoshop' });
      downloadBlob(blob, name, 'psd');
      expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
      expect(blob.type).toBe('image/vnd.adobe.photoshop');
      expect(downloads[0].name).toBe('design.psd');
      expect(document.querySelector('a[download]')).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
    }
  );

  it('keeps a WebP filename correct when the format is provided as a MIME type', () => {
    const blob = new Blob(['webp'], { type: 'image/webp' });
    downloadBlob(blob, 'design.webp', 'image/webp');
    expect(downloads[0].name).toBe('design.webp');
  });

  it('rejects a failed canvas encoding without downloading', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => {
      callback(null);
    });
    await expect(saveImageToDisk(canvas, 'design', 'image/png')).rejects.toThrow('Failed to create blob');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });
});
