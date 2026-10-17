/**
 * Format detection and decode-failure coverage for `src/contexts/image-load-save-utils.ts`.
 *
 * The sibling `image-load-save-utils.test.ts` is Gold, so this file adds the detection table
 * that it does not spell out: the byte-signature arms of every `isXFile` probe, the AVIF brand
 * scan, the SVG header heuristics, and the three rejection paths of `loadImageFile`
 * (`Not an image file`, `Failed to read file`, `Failed to load image`). The codec modules are
 * mocked exactly as the gold file mocks them, so a routing assertion is about dispatch only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDocumentFile, loadImageFile } from '../image-load-save-utils.ts';

const { loadAvifFile, loadBmpFile, loadIcoFile, loadPsd, loadTiffFile } = vi.hoisted(() => ({
  loadAvifFile: vi.fn(),
  loadBmpFile: vi.fn(),
  loadIcoFile: vi.fn(),
  loadPsd: vi.fn(),
  loadTiffFile: vi.fn(),
}));

vi.mock('../psd-utils.ts', () => ({ loadPsd }));
vi.mock('../tiff-utils.ts', () => ({ loadTiffFile }));
vi.mock('../bmp-utils.ts', () => ({ loadBmpFile }));
vi.mock('../avif-utils.ts', () => ({ loadAvifFile }));
vi.mock('../ico-utils.ts', () => ({ loadIcoFile }));

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const gifHeader = (width: number, height: number) =>
  bytes(
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61,
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
    0,
    0,
    0
  );

type StubReader = {
  onload: ((event: { target: { result: string } }) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  readAsDataURL: (value: Blob) => void;
};

/**
 * Installs a `FileReader`/`Image` pair the test drives by hand, and reports the blob the
 * reader was handed plus the image element production code is waiting on.
 */
function installBrowserDecoders(dimensions: { width?: number; height?: number } = {}) {
  const state = {
    reader: undefined as StubReader | undefined,
    readerInput: undefined as Blob | undefined,
    image: undefined as HTMLImageElement | undefined,
    imageMode: 'load' as 'load' | 'error',
    readerMode: 'load' as 'load' | 'error',
  };
  vi.spyOn(globalThis, 'FileReader').mockImplementation(
    class {
      onload: StubReader['onload'] = null;
      onerror: StubReader['onerror'] = null;
      readAsDataURL = (value: Blob) => {
        state.readerInput = value;
        if (state.readerMode === 'error') this.onerror?.(new ErrorEvent('error'));
        else this.onload?.({ target: { result: `data:${value.type};base64,test` } });
      };
      constructor() {
        state.reader = this;
      }
    } as unknown as typeof FileReader
  );
  vi.spyOn(globalThis, 'Image').mockImplementation(function (this: HTMLImageElement) {
    this.onload = null;
    this.onerror = null;
    this.width = dimensions.width ?? 1;
    this.height = dimensions.height ?? 1;
    this.src = '';
    state.image = this;
    const settle = () =>
      state.imageMode === 'load' ? this.onload?.(new Event('load')) : this.onerror?.(new Event('error'));
    Object.defineProperty(this, 'src', {
      get: () => `data:${''}`,
      set: () => settle(),
      configurable: true,
    });
    return this;
  } as unknown as typeof Image);
  return state;
}

describe('format detection from byte signatures', () => {
  beforeEach(() => {
    loadAvifFile.mockReset();
    loadBmpFile.mockReset();
    loadIcoFile.mockReset();
    loadPsd.mockReset();
    loadTiffFile.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['little-endian BigTIFF', bytes(0x49, 0x49, 0x2b, 0x00)],
    ['little-endian TIFF', bytes(0x49, 0x49, 0x2a, 0x00)],
    ['big-endian TIFF', bytes(0x4d, 0x4d, 0x00, 0x2a)],
    ['big-endian BigTIFF', bytes(0x4d, 0x4d, 0x00, 0x2b)],
  ])('detects %s from its four magic bytes', async (_label, content) => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadTiffFile.mockResolvedValue(image);
    const file = new File([content], 'no-extension', { type: 'application/octet-stream' });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadTiffFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it.each([
    ['image/tif', 'image/tif'],
    ['image/x-tiff', 'image/x-tiff'],
    ['IMAGE/TIFF', 'image/tiff'],
  ])('routes the %s media type to the TIFF loader', async (_label, type) => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadTiffFile.mockResolvedValue(image);
    const file = new File(['not a signature'], 'no-extension', { type });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadTiffFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('detects a BMP from its "BM" magic bytes', async () => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadBmpFile.mockResolvedValue(image);
    const file = new File([ascii('BM        ')], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadBmpFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it.each([
    ['image/ico', 'image/ico'],
    ['image/x-icon', 'image/x-icon'],
    ['image/vnd.microsoft.icon', 'image/vnd.microsoft.icon'],
  ])('routes the %s media type to the ICO loader', async (_label, type) => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadIcoFile.mockResolvedValue(image);
    const file = new File(['not a signature'], 'no-extension', { type });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadIcoFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('detects an ICO from its count/type header', async () => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadIcoFile.mockResolvedValue(image);
    const file = new File([bytes(0, 0, 1, 0, 1, 0)], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadIcoFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  // The four bytes before `ftyp` are a box size the detector ignores; only the brand scan
  // from offset 8 onwards matters, so the size field is written as readable filler.
  it.each([
    ['a single-frame avif brand', 'xxxxftypavifavifmif1'],
    ['a sequence avif brand', 'xxxxftypavisavifmif1'],
    ['a later avif brand in the box', 'xxxxftypmif1avif'],
  ])('detects AVIF from %s', async (_label, content) => {
    const image = { width: 1, height: 1 } as HTMLImageElement;
    loadAvifFile.mockResolvedValue(image);
    const file = new File([ascii(content)], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).resolves.toEqual({ fileName: 'no-extension', image });
    expect(loadAvifFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('does not treat an unrelated ISO-BMFF file as AVIF', async () => {
    installBrowserDecoders();
    const file = new File([ascii('xxxxftypmif1heic')], 'no-extension', { type: '' });

    // No format claimed it, so the file falls through to the browser decoder, which refuses an
    // untyped file with an unknown extension rather than guessing.
    await expect(loadDocumentFile(file)).rejects.toThrow('Not an image file');

    expect(loadAvifFile).not.toHaveBeenCalled();
  });

  it('does not treat a truncated ftyp box as AVIF', async () => {
    installBrowserDecoders();
    const file = new File([bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70)], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).rejects.toThrow('Not an image file');

    expect(loadAvifFile).not.toHaveBeenCalled();
  });

  it.each([
    ['an uppercase extension', 'logo.SVG'],
    ['a mixed-case extension', 'logo.Svg'],
  ])('routes %s to the SVG decoder by name', async (_label, name) => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg/>'], name, { type: '' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: name });

    expect(decoders.readerInput?.type).toBe('image/svg+xml');
  });

  it('routes the image/svg+xml media type to the SVG decoder', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['not markup'], 'no-extension', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'no-extension' });

    expect(decoders.readerInput?.type).toBe('image/svg+xml');
  });

  it.each([
    ['a byte order mark and leading whitespace', '\uFEFF\n  <svg xmlns="x"></svg>'],
    ['an xml prologue ahead of the root element', '<?xml version="1.0"?>\n<svg xmlns="x"></svg>'],
    ['an uppercase root element', '<SVG xmlns="x"></SVG>'],
  ])('detects SVG content with %s', async (_label, content) => {
    const decoders = installBrowserDecoders();
    const file = new File([content], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'no-extension' });

    expect(decoders.readerInput?.type).toBe('image/svg+xml');
  });

  it('does not treat an xml document without an svg root as SVG', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<?xml version="1.0"?><html></html>'], 'no-extension', { type: '' });

    await expect(loadDocumentFile(file)).rejects.toThrow('Not an image file');

    expect(decoders.readerInput).toBeUndefined();
  });
});

describe('loadImageFile rejection paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows a GIF at the 100 MP document ceiling', async () => {
    const decoders = installBrowserDecoders();
    const file = new File([gifHeader(10_000, 10_000)], 'maximum.gif', { type: 'image/gif' });

    const result = await loadDocumentFile(file);

    expect(result).toMatchObject({ fileName: 'maximum.gif', image: decoders.image });
    expect(decoders.readerInput?.type).toBe('image/gif');
  });

  it('rejects an oversized GIF from its logical screen descriptor before creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const file = new File([gifHeader(10_001, 10_000)], 'oversized.gif', { type: 'image/gif' });

    await expect(loadDocumentFile(file)).rejects.toThrow(
      'GIF image is too large to open (10001×10000). Maximum is 100000000 pixels.'
    );
    expect(decoders.reader).toBeUndefined();
  });

  it.each([
    ['an untyped file with an unknown extension', new File(['data'], 'notes.bin', { type: '' })],
    ['a missing file', null as unknown as File],
  ])('rejects %s before touching FileReader', async (_label, file) => {
    const decoders = installBrowserDecoders();

    await expect(loadImageFile(file)).rejects.toThrow('Not an image file');

    expect(decoders.reader).toBeUndefined();
  });

  it('rejects when the file cannot be read', async () => {
    const decoders = installBrowserDecoders();
    decoders.readerMode = 'error';

    await expect(loadImageFile(new File(['data'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'Failed to read file'
    );
  });

  it('rejects when the browser cannot decode the bytes', async () => {
    const decoders = installBrowserDecoders();
    decoders.imageMode = 'error';

    await expect(loadImageFile(new File(['not a png'], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'Failed to load image'
    );
  });

  it('rejects a native-decoded image above the shared document pixel budget', async () => {
    const decoders = installBrowserDecoders({ width: 10_001, height: 10_000 });
    const file = new File(['data'], 'photo.svg', { type: 'image/svg+xml' });
    const pending = loadImageFile(file, 'image/svg+xml');

    await vi.waitFor(() => expect(decoders.image).not.toBeUndefined());
    decoders.image!.onload!.call(decoders.image!, new Event('load'));

    await expect(pending).rejects.toThrow('Image is too large to open (10001×10000). Maximum is 100000000 pixels.');
  });

  it('rejects a native-decoded image whose dimensions are unavailable', async () => {
    const decoders = installBrowserDecoders({ width: 0, height: 0 });
    const pending = loadImageFile(new File(['data'], 'photo.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(decoders.image).not.toBeUndefined());
    decoders.image!.onload!.call(decoders.image!, new Event('load'));

    await expect(pending).rejects.toThrow('Image has invalid dimensions to open');
  });

  it('rejects a corrupt document that reached the native decoder through loadDocumentFile', async () => {
    const decoders = installBrowserDecoders();
    decoders.imageMode = 'error';
    const file = new File(['not a png'], 'photo.png', { type: 'image/png' });

    await expect(loadDocumentFile(file)).rejects.toThrow('Failed to load image');
  });

  it.each(['photo.jpg', 'photo.jpeg', 'photo.webp', 'photo.avif', 'photo.svg', 'PHOTO.PNG'])(
    'accepts %s on its extension alone, with no media type',
    async (name) => {
      const decoders = installBrowserDecoders();
      const file = new File(['data'], name, { type: '' });

      const image = await loadImageFile(file);

      expect(image).toBe(decoders.image);
      // No detected MIME type means the file is handed to FileReader untouched.
      expect(decoders.readerInput).toBe(file);
    }
  );

  it('re-wraps the file with the detected media type before decoding', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['GIF89a'], 'renamed.bin', { type: '' });

    await loadImageFile(file, 'image/gif');

    expect(decoders.readerInput).not.toBe(file);
    expect(decoders.readerInput?.type).toBe('image/gif');
    expect(decoders.readerInput?.size).toBe(file.size);
  });
});
