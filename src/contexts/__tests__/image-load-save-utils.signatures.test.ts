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
import { encodeSvg } from '../svg-utils.ts';

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
const pngCrc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngHeader = (width: number, height: number) => {
  const data = new Uint8Array(33);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(data.buffer);
  view.setUint32(8, 13, false);
  data.set(ascii('IHDR'), 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  data[24] = 8;
  data[25] = 6;
  view.setUint32(29, pngCrc32(data.subarray(12, 29)), false);
  return data;
};
const pngChunk = (type: string, data: Uint8Array) => {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk.set(ascii(type), 4);
  chunk.set(data, 8);
  view.setUint32(data.length + 8, pngCrc32(chunk.subarray(4, data.length + 8)), false);
  return chunk;
};
const concatenatePngChunks = (...chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
const pngFileBytes = (width: number, height: number, extraChunks: Uint8Array[] = []) =>
  concatenatePngChunks(
    pngHeader(width, height),
    ...extraChunks,
    pngChunk('IDAT', Uint8Array.of(0)),
    pngChunk('IEND', new Uint8Array())
  );
const concatenateBytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const uint16be = (value: number) => bytes((value >> 8) & 0xff, value & 0xff);
const uint16le = (value: number) => bytes(value & 0xff, (value >> 8) & 0xff);
const uint24le = (value: number) => bytes(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
const uint32le = (value: number) =>
  bytes(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
const jpegSegment = (marker: number, payload: Uint8Array) => {
  const length = payload.length + 2;
  return concatenateBytes(bytes(0xff, marker), uint16be(length), payload);
};
const jpegSofPayload = (width: number, height: number) =>
  bytes(8, ...uint16be(height), ...uint16be(width), 1, 1, 0x11, 0);
const jpegFileBytes = (width: number, height: number, sofMarker = 0xc0, segmentsBeforeSof: Uint8Array[] = []) =>
  concatenateBytes(
    bytes(0xff, 0xd8),
    ...segmentsBeforeSof,
    jpegSegment(sofMarker, jpegSofPayload(width, height)),
    bytes(0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9)
  );
const webpChunk = (fourCc: string, payload: Uint8Array) => {
  const size = payload.length;
  return concatenateBytes(ascii(fourCc), uint32le(size), payload, ...(size % 2 === 1 ? [bytes(0)] : []));
};
const webpFileBytes = (...chunks: Uint8Array[]) => {
  const body = concatenateBytes(ascii('WEBP'), ...chunks);
  return concatenateBytes(ascii('RIFF'), uint32le(body.length), body);
};
const webpVp8Payload = (width: number, height: number) =>
  bytes(0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, ...uint16le(width), ...uint16le(height));
const webpVp8lPayload = (width: number, height: number, alpha = false, version = 0) => {
  const dimensions = (width - 1) | ((height - 1) << 14) | (alpha ? 1 << 28 : 0) | (version << 29);
  return bytes(0x2f, ...uint32le(dimensions));
};
const webpVp8xPayload = (width: number, height: number, flags = 0) =>
  bytes(flags, 0, 0, 0, ...uint24le(width - 1), ...uint24le(height - 1));
const webpAnmfPayload = (x: number, y: number, width: number, height: number, ...chunks: Uint8Array[]) =>
  concatenateBytes(
    uint24le(x),
    uint24le(y),
    uint24le(width - 1),
    uint24le(height - 1),
    uint24le(0),
    bytes(0),
    ...chunks
  );
const pngDataUrl = (width: number, height: number, extraChunks: Uint8Array[] = []) =>
  `data:image/png;base64,${btoa(String.fromCharCode(...pngFileBytes(width, height, extraChunks)))}`;
const animatedPngDataUrl = (width: number, height: number) => {
  return pngDataUrl(width, height, [pngChunk('acTL', Uint8Array.of(2, 0, 0, 0, 0, 0, 0, 0))]);
};
const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const flattenedSvgFile = (width: number, height: number, dataUrl = tinyPngDataUrl, name = 'flat.svg') => {
  const canvas = { width, height, toDataURL: () => dataUrl } as unknown as HTMLCanvasElement;
  return new File([encodeSvg(canvas)], name, { type: 'image/svg+xml' });
};

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
    imageSrc: undefined as string | undefined,
    objectUrls: [] as Array<{ source: Blob | MediaSource; url: string }>,
    revokedObjectUrls: [] as string[],
    imageMode: 'load' as 'load' | 'error',
    readerMode: 'load' as 'load' | 'error',
  };
  vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation((source) => {
    const url = `blob:decoded-${state.objectUrls.length + 1}`;
    state.objectUrls.push({ source, url });
    return url;
  });
  vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation((url) => {
    state.revokedObjectUrls.push(url);
  });
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
      get: () => state.imageSrc ?? '',
      set: (value: string) => {
        state.imageSrc = value;
        settle();
      },
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
    const file = new File(['<svg/>'], 'no-extension', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'no-extension' });

    expect(decoders.readerInput?.type).toBe('image/svg+xml');
  });

  it.each([
    ['a byte order mark and leading whitespace', '\uFEFF\n  <svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    [
      'an xml prologue ahead of the root element',
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ],
    ['an uppercase root element', '<SVG xmlns="http://www.w3.org/2000/svg"></SVG>'],
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
    ['pixel dimensions', '<svg width="10001" height="10000"/>'],
    ['physical dimensions', '<svg width="105in" height="10000px"/>'],
    ['CSS dimensions', '<svg style="width:10001px;height:10000px"/>'],
    [
      'important CSS dimensions',
      '<svg width="1" height="1" style="width:10001px !important;height:10000px !important"/>',
    ],
    ['escaped important priority', '<svg style="width:10001px !\\69mportant;width:1px;height:10000px"/>'],
    [
      'escaped important priority with CRLF terminator',
      '<svg style="width:10001px !\\69&#13;&#10;mportant;width:1px;height:10000px"/>',
    ],
    ['last CSS declaration', '<svg style="width:1px;width:10001px;height:10000px"/>'],
    ['quoted semicolons in later declarations', '<svg style="width:10001px;height:10000px;--x:\';width:1px\'"/>'],
    ['comment-prefixed CSS dimensions', '<svg width="1" height="1" style="/*x*/width:10001px;height:10000px"/>'],
    ['escaped CSS property names', '<svg style="w\\69 dth:10001px;height:10000px"/>'],
    ['a parsererror child element', '<svg width="10001px" height="10000px"><parsererror/></svg>'],
  ])('rejects SVGs with oversized %s before creating a FileReader', async (_label, svg) => {
    const decoders = installBrowserDecoders();
    const file = new File([svg], 'oversized.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('uses the viewBox aspect ratio when checking one specified SVG dimension', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="20001" viewBox="0 0 2 1"/>'], 'oversized.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('refuses SVG stylesheet dimensions the preflight cannot resolve', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg><style>svg { width: 10001px; height: 10000px }</style></svg>'], 'sized.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('detects root sizing after a quoted closing brace in stylesheet content', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg><style>svg { --x: "}"; width:10001px; height:10000px }</style></svg>'], 'quoted.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('does not close a root style rule on a brace inside an unquoted CSS URL', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>svg { background-image:url(}); width:10001px; height:10000px }</style></svg>'],
      'url-brace.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('does not treat an escaped brace as a stylesheet block boundary', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>svg { --x: \\7d ; width:10001px; height:10000px }</style></svg>'],
      'escaped-brace.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('does not let escaped quotes hide inline root dimensions', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1" height="1" style="--x:prefix\\&quot;;width:10001px;height:10000px;--y:&quot;tail&quot;"/>'],
      'escaped-quote.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('recovers from invalid CSS strings at newlines before reading dimensions', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1" height="1" style="--x:&apos;open&#10;;width:10001px;height:10000px"/>'],
      'newline.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('keeps escaped CRLF continuations inside CSS strings', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1" height="1" style="--x:&quot;foo\\&#13;&#10;bar&quot;;width:10001px;height:10000px"/>'],
      'continuation.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('strips stylesheet comments after escaped quotes in selectors', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      [
        '<svg data-x="foo&quot;bar"><style>svg[data-x=foo\\"bar] { /*x*/ width:10001px; /*y*/ height:10000px }</style></svg>',
      ],
      'escaped-selector.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('does not let escaped quotes hide root stylesheet dimensions', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>svg { --x:prefix\\"; /*x*/ width:10001px; /*y*/ height:10000px }</style></svg>'],
      'escaped-quote.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('detects nested at-rule sizing on the SVG root', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>svg { @supports (display:block) { width:10001px; height:10000px } }</style></svg>'],
      'nested-rule.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('allows stylesheet dimensions scoped to non-root SVG elements', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg><style>rect { width: 100px; height: 50px }</style></svg>'], 'styled.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'styled.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows sizing rules inside an inactive stylesheet', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style media="not all">svg { width: 10001px; height: 10000px }</style></svg>'],
      'inactive.svg',
      {
        type: 'image/svg+xml',
      }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'inactive.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('ignores root sizing rules inside an always-inactive media group', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>@media not all { svg { width:10001px; height:10000px } }</style></svg>'],
      'inactive.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'inactive.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('refuses SVG imports of stylesheets with unresolved sizing rules', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg><style>@import url("external.css");</style></svg>'], 'sized.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('allows unrelated stylesheet properties without mistaking them for intrinsic sizing', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><style>rect { stroke-width: 2 } @media (min-width: 10px) { svg { fill: red } }</style></svg>'],
      'styled.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'styled.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows import text that appears only in a stylesheet string', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="64" height="64"><style>svg { --label: "@import" }</style></svg>'],
      'label.svg',
      {
        type: 'image/svg+xml',
      }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'label.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('refuses unrecognized explicit dimensions instead of substituting the default size', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="100000em" height="100000em"/>'], 'sized.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('unsupported intrinsic dimension');

    expect(decoders.reader).toBeUndefined();
  });

  it('refuses root minimum-size constraints before native decode', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1px" height="1px" style="min-width:10001px;min-height:10000px"/>'],
      'sized.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('unsupported CSS sizing');

    expect(decoders.reader).toBeUndefined();
  });

  it('does not strip comment-like text in inline CSS strings', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1px" height="1px" style="--x:&quot;/*&quot;;min-width:10001px;min-height:10000px"/>'],
      'sized.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('unsupported CSS sizing');

    expect(decoders.reader).toBeUndefined();
  });

  it('refuses stylesheet minimum-size constraints on the SVG root', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg width="1px" height="1px"><style>svg { min-width: 10001px; min-height: 10000px }</style></svg>'],
      'sized.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('recognizes oversized dimensions in a UTF-16LE SVG', async () => {
    const decoders = installBrowserDecoders();
    const markup = '<svg width="10001px" height="10000px"/>';
    const utf16Bytes = new Uint8Array(2 + markup.length * 2);
    utf16Bytes.set([0xff, 0xfe]);
    for (let index = 0; index < markup.length; index += 1) {
      utf16Bytes[2 + index * 2] = markup.charCodeAt(index);
    }
    const file = new File([utf16Bytes], 'oversized.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('preserves a MIME charset through the document loader', async () => {
    const decoders = installBrowserDecoders();
    const markup = '<svg id="é"><style>#é { width:10001px; height:10000px }</style></svg>';
    const windows1252Bytes = Uint8Array.from([...markup].map((character) => character.charCodeAt(0)));
    const file = new File([windows1252Bytes], 'encoded.svg', { type: 'image/svg+xml;charset=windows-1252' });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('gives a UTF-8 BOM precedence over a conflicting MIME charset', async () => {
    const decoders = installBrowserDecoders();
    const markup = '<svg id="é"><style>#é { width:10001px; height:10000px }</style></svg>';
    const content = new TextEncoder().encode(markup);
    const bomBytes = new Uint8Array(content.length + 3);
    bomBytes.set([0xef, 0xbb, 0xbf]);
    bomBytes.set(content, 3);
    const file = new File([bomBytes], 'bom.svg', { type: 'image/svg+xml;charset=windows-1252' });

    await expect(loadImageFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('uses the XML-declared encoding when matching root stylesheet selectors', async () => {
    const decoders = installBrowserDecoders();
    const markup =
      '<?xml version="1.0" encoding="windows-1252"?><svg id="é"><style>#é { width:10001px; height:10000px }</style></svg>';
    const declaredBytes = Uint8Array.from([...markup].map((character) => character.charCodeAt(0)));
    const file = new File([declaredBytes], 'encoded.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('finds XML-declared encodings after long legal declaration whitespace', async () => {
    const decoders = installBrowserDecoders();
    const markup = `<?xml version="1.0"${' '.repeat(2048)}encoding="windows-1252"?><svg id="é"><style>#é { width:10001px; height:10000px }</style></svg>`;
    const longDeclarationBytes = Uint8Array.from([...markup].map((character) => character.charCodeAt(0)));
    const file = new File([longDeclarationBytes], 'encoded.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('stylesheet sizing that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('detects a UTF-16BE SVG without a file type or extension', async () => {
    const decoders = installBrowserDecoders();
    const markup = '<svg width="10001px" height="10000px"/>';
    const utf16Bytes = new Uint8Array(markup.length * 2);
    for (let index = 0; index < markup.length; index += 1) {
      utf16Bytes[index * 2 + 1] = markup.charCodeAt(index);
    }
    const file = new File([utf16Bytes], 'oversized.bin', { type: '' });

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('preflights parameterized SVG MIME types, including after a long XML prologue', async () => {
    const decoders = installBrowserDecoders();
    const prologue = `<?xml version="1.0"?>\n<!--${'x'.repeat(128)}-->`;
    const file = new File([`${prologue}<svg width="10001px" height="10000px"/>`], 'oversized.bin', {
      type: 'image/svg+xml;charset=utf-8',
    });

    await expect(loadImageFile(file)).rejects.toThrow('SVG image is too large to open');
    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('detects an SVG with a long XML prologue even when the file type is misleading', async () => {
    const decoders = installBrowserDecoders();
    const prologue = `<?xml version="1.0"?>\n<!--${'x'.repeat(128)}-->`;
    const file = new File([`${prologue}<svg width="10001px" height="10000px"/>`], 'oversized.png', {
      type: 'image/png',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('allows root max-size constraints that can only shrink the decoded dimensions', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="64px" height="64px" style="max-width:64px;max-height:64px"/>'], 'small.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'small.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('refuses non-finite explicit dimensions before the native image decoder', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="1e999" height="10000px"/>'], 'overflow.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('invalid intrinsic dimension');

    expect(decoders.reader).toBeUndefined();
  });

  it('refuses oversized SVG source files before buffering or creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg/>'], 'large.svg', { type: 'image/svg+xml' });
    Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 + 1 });
    const arrayBuffer = vi.spyOn(file, 'arrayBuffer');

    await expect(loadImageFile(file)).rejects.toThrow('SVG source exceeds the 67108864 byte import limit');

    expect(decoders.reader).toBeUndefined();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('allows the exact SVG source-byte ceiling', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg/>'], 'at-limit.svg', { type: 'image/svg+xml' });
    Object.defineProperty(file, 'size', { value: 64 * 1024 * 1024 });

    const image = await loadImageFile(file);

    expect(image).toBe(decoders.image);
    expect(decoders.reader).toBeDefined();
  });

  it('imports an app-generated flattened SVG through its bounded PNG payload', async () => {
    const decoders = installBrowserDecoders();
    const file = flattenedSvgFile(1, 1);

    const result = await loadDocumentFile(file);
    expect(result).toMatchObject({ fileName: 'flat.svg', image: decoders.image });

    expect(decoders.readerInput?.type).toBe('image/png');
    expect(decoders.readerInput?.size).toBe(atob(tinyPngDataUrl.split(',')[1]).length);
  });

  it('uses the same bounded PNG path for direct SVG image loading', async () => {
    const decoders = installBrowserDecoders();
    const file = flattenedSvgFile(1, 1);

    const image = await loadImageFile(file, 'image/svg+xml');
    expect(image).toBe(decoders.image);

    expect(decoders.readerInput?.type).toBe('image/png');
  });

  it('rejects an oversized embedded PNG before creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const dataUrl = pngDataUrl(10_001, 10_000);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const atobSpy = vi.spyOn(globalThis, 'atob');
    const file = flattenedSvgFile(1, 1, dataUrl);

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG embedded PNG is too large to open');

    expect(atobSpy).toHaveBeenCalledTimes(1);
    expect(atobSpy).toHaveBeenCalledWith(base64.slice(0, 44));
    expect(decoders.reader).toBeUndefined();
    atobSpy.mockRestore();
  });

  it('allows an embedded PNG at the document pixel ceiling', async () => {
    const decoders = installBrowserDecoders();
    const file = flattenedSvgFile(10_000, 10_000, pngDataUrl(10_000, 10_000));

    const result = await loadDocumentFile(file);
    expect(result).toMatchObject({ fileName: 'flat.svg', image: decoders.image });

    expect(decoders.readerInput?.type).toBe('image/png');
  });

  it('rejects a directly opened oversized PNG before creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const file = new File([pngHeader(10_001, 10_000)], 'oversized.png', { type: 'image/png' });

    await expect(loadDocumentFile(file)).rejects.toThrow('PNG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('preflights PNG bytes even when the file type and extension are mislabeled', async () => {
    const decoders = installBrowserDecoders();
    const file = new File([pngFileBytes(10_001, 10_000)], 'oversized.jpg', { type: 'image/jpeg' });

    await expect(loadDocumentFile(file)).rejects.toThrow('PNG image is too large to open');

    expect(decoders.reader).toBeUndefined();
  });

  it('allows a directly opened PNG at the document pixel ceiling', async () => {
    const decoders = installBrowserDecoders();
    const file = new File([pngFileBytes(10_000, 10_000)], 'maximum.png', { type: 'image/png' });

    const result = await loadDocumentFile(file);
    expect(result).toMatchObject({ fileName: 'maximum.png', image: decoders.image });

    expect(decoders.readerInput?.type).toBe('image/png');
  });

  it('rejects APNG animation chunks before opening a standalone PNG', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      [pngFileBytes(1, 1, [pngChunk('acTL', Uint8Array.of(2, 0, 0, 0, 0, 0, 0, 0))])],
      'animated.png',
      { type: 'image/png' }
    );

    await expect(loadDocumentFile(file)).rejects.toThrow('Animated PNG images are not supported');

    expect(decoders.reader).toBeUndefined();
  });

  it('rejects a flattened SVG whose embedded PNG header fails its CRC', async () => {
    const decoders = installBrowserDecoders();
    const png = pngHeader(1, 1);
    png[32] ^= 1;
    const invalidDataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...png))}`;
    const file = flattenedSvgFile(1, 1, invalidDataUrl);

    await expect(loadDocumentFile(file)).rejects.toThrow('embedded resource that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('rejects APNG frames in the flattened SVG path before creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const file = flattenedSvgFile(1, 1, animatedPngDataUrl(1, 1));

    await expect(loadDocumentFile(file)).rejects.toThrow('complete, non-animated PNG');

    expect(decoders.reader).toBeUndefined();
  });

  it('rejects a flattened PNG wrapper when root and PNG dimensions disagree', async () => {
    const decoders = installBrowserDecoders();
    const file = flattenedSvgFile(2, 1, pngDataUrl(1, 1));

    await expect(loadDocumentFile(file)).rejects.toThrow('SVG flattened PNG dimensions do not match the SVG canvas');

    expect(decoders.reader).toBeUndefined();
  });

  it('rejects noncanonical PNG wrapper variants before creating a FileReader', async () => {
    const decoders = installBrowserDecoders();
    const svg = await encodeSvg({ width: 1, height: 1, toDataURL: () => tinyPngDataUrl } as HTMLCanvasElement).text();
    const variants = [
      svg.replace('<svg xmlns=', '<svg id="extra" xmlns='),
      svg.replace('<image href=', '<image opacity="1" href='),
      svg.replace('<image href=', '<title>extra</title><image href='),
      `<?xml version="1.0"?>${svg}`,
      `<!--extra-->${svg}`,
    ];

    for (const [index, malformedSvg] of variants.entries()) {
      const file = new File([malformedSvg], `almost-flat-${index}.svg`, { type: 'image/svg+xml' });
      await expect(loadDocumentFile(file)).rejects.toThrow();
      expect(decoders.reader).toBeUndefined();
    }
  });

  it.each([
    ['an embedded data image', '<svg><image href="data:image/png;base64,AA=="/></svg>'],
    ['an unsupported embedded JPEG', '<svg><image href="data:image/jpeg;base64,AA=="/></svg>'],
    ['a percent-encoded embedded PNG', '<svg><image href="data:image/png,%89PNG%0D%0A%1A%0A"/></svg>'],
    [
      'an embedded legacy data image',
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:image/png;base64,AA=="/></svg>',
    ],
    ['a fragment image recursion', '<svg><image href="#self"/></svg>'],
    ['an empty image href', '<svg><image href=""/></svg>'],
    [
      'a fragment legacy image recursion',
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="#self"/></svg>',
    ],
    ['a filter image resource', '<svg><filter id="f"><feImage href="data:image/png;base64,AA=="/></filter></svg>'],
    ['an external use resource', '<svg><use href="data:image/svg+xml,%3Csvg/%3E"/></svg>'],
    [
      'a foreign object',
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">text</div></foreignObject></svg>',
    ],
    ['a CSS data resource', '<svg><style>rect { filter: url(data:image/svg+xml,%3Csvg/%3E) }</style><rect/></svg>'],
    [
      'a CSS custom-property data resource consumed by a sink',
      '<svg><style>svg { --source: url(data:image/png;base64,AA==) } rect { background-image: var(--source) }</style><rect/></svg>',
    ],
    [
      'a custom-property string URL consumed by image-set',
      '<svg><style>svg { --source: "data:image/png;base64,AA==" }</style><rect style="background-image:image-set(var(--source) 1x)"/></svg>',
    ],
    [
      'a data URL in a custom-property fallback',
      '<svg><style>svg { --source: var(--missing, url(data:image/png;base64,AA==)) } rect { background-image: var(--source) }</style></svg>',
    ],
    [
      'a custom-property alias across style elements and inline CSS',
      '<svg><style>svg { --source: var(--payload) }</style><style>svg { --payload: url(data:image/png;base64,AA==) }</style><rect style="background-image:var(--source)"/></svg>',
    ],
    [
      'a custom-property alias referenced only by a nested fallback',
      '<svg><style>svg { --source: var(--missing, var(--payload)); --payload: url(data:image/png;base64,AA==) } rect { background-image: var(--source) }</style><rect/></svg>',
    ],
    [
      'an escaped custom-property name and var() function',
      '<svg><style>svg { --\\73 ource: url(data:image/png;base64,AA==) } rect { background-image: v\\61 r(--source) }</style><rect/></svg>',
    ],
    [
      'a custom-property URL used by an unknown CSS property',
      '<svg><style>svg { --source: url(data:image/png;base64,AA==) } rect { custom-resource: var(--source) }</style><rect/></svg>',
    ],
    [
      'a reachable custom-property cycle',
      '<svg><style>svg { --a: var(--b); --b: var(--a) } rect { background-image: var(--a) }</style><rect/></svg>',
    ],
    [
      'a custom-property flow from an inactive media rule',
      '<svg><style>@media not all { svg { --source: url(data:image/png;base64,AA==) } } rect { background-image: var(--source) }</style><rect/></svg>',
    ],
    [
      'a custom-property flow from a nested scope rule',
      '<svg><style>@scope (svg) { rect { --source: url(data:image/png;base64,AA==) } } rect { background-image: var(--source) }</style><rect/></svg>',
    ],
    [
      'an unclosed var() function in a resource-capable property',
      '<svg><rect style="background-image:var(--source"/></svg>',
    ],
    [
      'a CSS image-set data resource',
      '<svg><rect style="mask-image:image-set(\'data:image/png;base64,AA==\' 1x)"/></svg>',
    ],
    ['a CSS background fragment image resource', '<svg><rect style="background-image:url(#self)"/></svg>'],
    ['a CSS image-set fragment resource', '<svg><rect style="background-image:image-set(\'#self\' 1x)"/></svg>'],
    ['a CSS image() data resource', '<svg><rect style="mask-image:image(\'data:image/png;base64,AA==\')"/></svg>'],
    [
      'a CSS url() with an escaped LF data scheme',
      '<svg style="filter:url(\'da\\&#10;ta:image/svg+xml,%3Csvg/%3E\')"/>',
    ],
    [
      'a CSS url() with an escaped CRLF data scheme',
      '<svg style="filter:url(\'da\\&#13;&#10;ta:image/svg+xml,%3Csvg/%3E\')"/>',
    ],
    [
      'an image-set string with an escaped LF data scheme',
      '<svg><rect style="background-image:image-set(\'da\\&#10;ta:image/png;base64,AA==\' 1x)"/></svg>',
    ],
    ['an escaped CSS data resource', '<svg style="filter:url(\\64 ata:image/svg+xml,%3Csvg/%3E)"/>'],
    ['a CSS-comment-obfuscated data resource', '<svg style="filter:url(data/**/:image/svg+xml,%3Csvg/%3E)"/>'],
    ['a six-digit escaped CSS data resource', '<svg style="filter:\\75\\000072l(data:image/svg+xml,%3Csvg/%3E)"/>'],
    ['a presentation-attribute data resource', '<svg><rect fill="url(data:image/svg+xml,%3Csvg/%3E)"/></svg>'],
    ['an xml:base data resource', '<svg xml:base="data:image/png;base64,AA=="><use href="#local"/></svg>'],
    ['an href with a newline-obfuscated data scheme', '<svg><image href="da&#10;ta:image/png;base64,AA=="/></svg>'],
    [
      'an xml:base with a newline-obfuscated data scheme',
      '<svg xml:base="da&#10;ta:image/png;base64,AA=="><use href="#local"/></svg>',
    ],
    [
      'an animated fragment image recursion',
      '<svg><image><set attributeName="href" begin="0s" to="#self"/></image></svg>',
    ],
    [
      'an animated XLink alias resource',
      '<svg xmlns:p="http://www.w3.org/1999/xlink"><image><set attributeName="p:href" begin="0s" to="data:image/png;base64,AA=="/></image></svg>',
    ],
    [
      'a case-sensitive animated XLink alias resource',
      '<svg xmlns:P="http://www.w3.org/1999/xlink"><image><set attributeName="P:href" begin="0s" to="data:image/png;base64,AA=="/></image></svg>',
    ],
    [
      'an animated href on a fragment-targeted image',
      '<svg><image id="target"/><set href="#target" attributeName="href" begin="0s" to="#self"/></svg>',
    ],
    [
      'an animated image resource',
      '<svg><image width="1" height="1"><set attributeName="href" begin="0s" to="data:image/png;base64,AA=="/></image></svg>',
    ],
    [
      'an animated CSS resource',
      '<svg><animate attributeName="filter" to="url(data:image/svg+xml,%3Csvg/%3E)"/></svg>',
    ],
    [
      'a presentation-attribute custom-property flow',
      '<svg><style>svg { --source: url(data:image/png;base64,AA==) }</style><rect fill="var(--source)"/></svg>',
    ],
    [
      'an animated custom-property resource flow',
      '<svg><style>rect { background-image: var(--source) }</style><rect><animate attributeName="--source" to="url(data:image/png;base64,AA==)"/></rect></svg>',
    ],
    [
      'an animated unknown-property variable resource flow',
      '<svg><style>svg { --source: url(data:image/png;base64,AA==) }</style><animate attributeName="custom-resource" to="var(--source)"/></svg>',
    ],
    [
      'a data URL in a variable-backed font source',
      '<svg><style>@font-face { --font-source: url(data:font/woff2;base64,AA==); src: var(--font-source) }</style></svg>',
    ],
    [
      'a later data URL in a semicolon-separated SMIL values list',
      '<svg><pattern id="p"><set attributeName="href" values="#local;data:image/svg+xml,%3Csvg/%3E#other"/></pattern></svg>',
    ],
    [
      'an embedded HTML resource',
      '<svg><html:img xmlns:html="http://www.w3.org/1999/xhtml" src="data:image/png;base64,AA=="/></svg>',
    ],
  ])('rejects SVGs with %s before creating a FileReader', async (_label, svg) => {
    const decoders = installBrowserDecoders();
    const file = new File([svg], 'nested-resource.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('embedded resource that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it.each([
    [
      'an unused stylesheet property and alias',
      '<svg><style>svg { --unused: url(data:image/png;base64,AA==); --unused-string: "data:image/png;base64,AA=="; --alias: var(--unused) }</style><rect/></svg>',
    ],
    [
      'an unused inline property and alias',
      '<svg><rect style="--unused:url(data:image/png;base64,AA==);--unused-string:&quot;data:image/png;base64,AA==&quot;;--alias:var(--unused)"/></svg>',
    ],
    [
      'a data-bearing value used only by inert properties',
      '<svg><style>svg { --resource: url(data:image/png;base64,AA==); --alias: var(--resource) } rect { color: var(--alias); opacity: var(--alias); background-color: var(--alias); fill-opacity: var(--alias); fill-rule: var(--alias); stroke-width: var(--alias); stroke-dasharray: var(--alias); font-size: var(--alias); width: var(--alias); margin-left: var(--alias); display: var(--alias) }</style><rect/></svg>',
    ],
    [
      'unrelated quoted text that is not a data URL',
      '<svg><style>svg { --label: "label data:image/png;base64,AA=="; content: var(--label) }</style><rect/></svg>',
    ],
    [
      'a same-document paint-server URL flowing through a custom property',
      '<svg><defs><linearGradient id="g"/></defs><style>svg { --paint: url(#g) }</style><rect fill="var(--paint)"/></svg>',
    ],
    [
      'a same-document motion path URL flowing through a custom property',
      '<svg><path id="p" d="M0 0"/><style>svg { --path: url(#p) }</style><rect style="offset-path:var(--path)"/></svg>',
    ],
    [
      'case-sensitive custom-property names',
      '<svg><style>svg { --Source: url(data:image/png;base64,AA==) }</style><rect style="background-image:var(--source)"/></svg>',
    ],
  ])('allows %s', async (_label, svg) => {
    const decoders = installBrowserDecoders();
    const file = new File([svg], 'custom-properties.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'custom-properties.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it.each([
    ['background shorthand', 'background'],
    ['border-image source', 'border-image-source'],
    ['list-style shorthand', 'list-style'],
    ['cursor', 'cursor'],
    ['content', 'content'],
    ['mask shorthand', 'mask'],
    ['clip path', 'clip-path'],
    ['shape outside', 'shape-outside'],
    ['motion offset path', 'offset-path'],
    ['SVG fill paint server', 'fill'],
    ['SVG marker paint server', 'marker-start'],
    ['vendor mask alias', '-webkit-mask-image'],
    ['unknown resource property', 'custom-resource'],
  ])('treats %s as a CSS resource sink', async (_label, property) => {
    const decoders = installBrowserDecoders();
    const svg = `<svg><style>svg { --source: url(data:image/png;base64,AA==) } rect { ${property}: var(--source) }</style><rect/></svg>`;
    const file = new File([svg], 'resource-sink.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).rejects.toThrow('embedded resource that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('fails closed when CSS variable references exceed their bound', async () => {
    const decoders = installBrowserDecoders();
    const references = Array.from({ length: 50_001 }, () => 'var(--missing)').join(' ');
    const file = new File([`<svg><rect style="background-image:${references}"/></svg>`], 'complex-vars.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('embedded resource that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('fails closed when CSS analysis exceeds its node bound', async () => {
    const decoders = installBrowserDecoders();
    const declarations = Array.from({ length: 20_001 }, (_, index) => `--unused-${index}:red`).join(';');
    const file = new File([`<svg><style>svg { ${declarations} }</style></svg>`], 'complex-css.svg', {
      type: 'image/svg+xml',
    });

    await expect(loadDocumentFile(file)).rejects.toThrow('embedded resource that cannot be safely preflighted');

    expect(decoders.reader).toBeUndefined();
  });

  it('allows same-document SVG resource references', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      [
        '<svg><defs><linearGradient id="gradient"><stop offset="0"/></linearGradient><g id="mark"><rect width="1" height="1"/></g></defs><rect fill="url(#gradient)"/><use href="#mark"/></svg>',
      ],
      'fragments.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'fragments.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('scopes data xml:base rejection to the elements whose references it can resolve', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg"><g xml:base="data:image/png;base64,AA=="><rect width="1" height="1"/></g><rect fill="url(#gradient)"/></svg>',
      ],
      'scoped-base.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'scoped-base.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows non-resource SVG links', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg><a href="https://example.test"><rect width="1" height="1"/></a></svg>'],
      'linked.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'linked.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows external image references that secure SVG image mode blocks', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/image.png"/></svg>'],
      'secure-reference.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'secure-reference.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows namespace URLs and inert resource-named attributes', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:html="http://www.w3.org/1999/xhtml" xmlns:ext="https://example.test/ns" xml:base="https://example.test/base/"><style>@namespace svg url("http://www.w3.org/2000/svg");@namespace dataNs url("data:image/png;base64,AA==");</style><rect href="data:image/png;base64,AA==" ext:href="data:image/png;base64,AA==" src="label" data="note"/><a href="data:image/png;base64,AA=="><rect/></a><html:foreignObject><html:div>inert text</html:div></html:foreignObject></svg>',
      ],
      'inert.svg',
      { type: 'image/svg+xml' }
    );

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'inert.svg' });

    expect(decoders.reader).toBeDefined();
  });

  it('allows an SVG at the shared document pixel ceiling', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="10000px" height="10000px"/>'], 'maximum.svg', {
      type: 'image/svg+xml',
    });

    const result = await loadDocumentFile(file);

    expect(result).toMatchObject({ fileName: 'maximum.svg', image: decoders.image });
    expect(decoders.readerInput?.type).toBe('image/svg+xml');
  });

  it('converts quarter-millimeter SVG dimensions', async () => {
    const decoders = installBrowserDecoders();
    const file = new File(['<svg width="40Q" height="40q"/>'], 'q-unit.svg', { type: 'image/svg+xml' });

    await expect(loadDocumentFile(file)).resolves.toMatchObject({ fileName: 'q-unit.svg' });

    expect(decoders.reader).toBeDefined();
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

    await expect(loadImageFile(new File([pngFileBytes(1, 1)], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'Failed to read file'
    );
  });

  it('rejects when the browser cannot decode the bytes', async () => {
    const decoders = installBrowserDecoders();
    decoders.imageMode = 'error';

    await expect(loadImageFile(new File([pngFileBytes(1, 1)], 'photo.png', { type: 'image/png' }))).rejects.toThrow(
      'Failed to load image'
    );
  });

  it('rejects a native-decoded image above the shared document pixel budget', async () => {
    const decoders = installBrowserDecoders({ width: 10_001, height: 10_000 });
    const file = new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' });
    const pending = loadImageFile(file, 'image/svg+xml');
    const rejection = pending.catch((error: unknown) => error);

    await vi.waitFor(() => expect(decoders.image).not.toBeUndefined());
    decoders.image!.onload!.call(decoders.image!, new Event('load'));

    await expect(rejection).resolves.toMatchObject({
      message: 'Image is too large to open (10001×10000). Maximum is 100000000 pixels.',
    });
  });

  it('rejects a native-decoded image whose dimensions are unavailable', async () => {
    const decoders = installBrowserDecoders({ width: 0, height: 0 });
    const pending = loadImageFile(new File([pngFileBytes(1, 1)], 'photo.png', { type: 'image/png' }));
    const rejection = pending.catch((error: unknown) => error);

    await vi.waitFor(() => expect(decoders.image).not.toBeUndefined());
    decoders.image!.onload!.call(decoders.image!, new Event('load'));

    await expect(rejection).resolves.toMatchObject({ message: 'Image has invalid dimensions to open' });
  });

  it('rejects a corrupt document that reached the native decoder through loadDocumentFile', async () => {
    const decoders = installBrowserDecoders();
    decoders.imageMode = 'error';
    const file = new File([pngFileBytes(1, 1)], 'photo.png', { type: 'image/png' });

    await expect(loadDocumentFile(file)).rejects.toThrow('Failed to load image');
  });

  describe('pre-decode JPEG and WebP limits', () => {
    it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc9, 0xca, 0xcb])(
      'uses dimensions from the JPEG SOF marker 0x%s without restricting decoder process support',
      async (sofMarker) => {
        const decoders = installBrowserDecoders();
        const file = new File([jpegFileBytes(1, 1, sofMarker)], 'photo.jpg', { type: 'image/jpeg' });

        await loadDocumentFile(file);

        expect(decoders.reader).toBeUndefined();
        expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
        expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
      }
    );

    it.each([0xc5, 0xc6, 0xc7, 0xcd, 0xce, 0xcf])(
      'rejects differential JPEG SOF marker 0x%s before native decode',
      async (sofMarker) => {
        const decoders = installBrowserDecoders();
        const file = new File([jpegFileBytes(1, 1, sofMarker)], 'hierarchical.jpg', { type: 'image/jpeg' });

        await expect(loadDocumentFile(file)).rejects.toThrow(/differential.*safely preflighted/i);

        expect(decoders.reader).toBeUndefined();
        expect(decoders.image).toBeUndefined();
        expect(decoders.objectUrls).toHaveLength(0);
      }
    );

    it('rejects hierarchical JPEG before native decode', async () => {
      const decoders = installBrowserDecoders();
      const dhp = jpegSegment(0xde, jpegSofPayload(10_000, 10_000));
      const file = new File([jpegFileBytes(1, 1, 0xc0, [dhp])], 'hierarchy.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/hierarchical.*safely preflighted/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects an oversized JPEG SOF before constructing a decoder', async () => {
      const decoders = installBrowserDecoders();
      const file = new File([jpegFileBytes(10_001, 10_000)], 'oversized.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('accepts a JPEG at the pixel ceiling through a Blob URL', async () => {
      const decoders = installBrowserDecoders({ width: 10_000, height: 10_000 });
      const file = new File([jpegFileBytes(10_000, 10_000, 0xc2)], 'maximum.jpg', { type: 'image/jpeg' });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'maximum.jpg', image: decoders.image });
      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
      expect(decoders.imageSrc).toBe('blob:decoded-1');
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('ignores marker-like SOF bytes inside a JPEG metadata segment', async () => {
      const decoders = installBrowserDecoders({ width: 1, height: 1 });
      const fakeOversizedSof = jpegSegment(0xc0, jpegSofPayload(10_001, 10_000));
      const appSegment = jpegSegment(0xe1, fakeOversizedSof);
      const file = new File([jpegFileBytes(1, 1, 0xc0, [appSegment])], 'metadata.jpg', { type: 'image/jpeg' });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'metadata.jpg', image: decoders.image });

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
    });

    it('rejects a zero-height JPEG frame before native decode because DNL is not preflighted', async () => {
      const decoders = installBrowserDecoders();
      const file = new File([jpegFileBytes(1, 0)], 'deferred-height.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/height|dimension/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('accepts repeated JPEG marker-fill bytes before a length-delimited marker', async () => {
      const decoders = installBrowserDecoders();
      const jpeg = concatenateBytes(bytes(0xff, 0xd8, 0xff, 0xff, 0xe0, 0x00, 0x02), jpegFileBytes(1, 1).subarray(2));
      const file = new File([jpeg], 'filled-marker.jpg', { type: 'image/jpeg' });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'filled-marker.jpg', image: decoders.image });

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
    });

    it.each([
      ['marker length below two bytes', bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0xff, 0xda, 0x00, 0x02)],
      ['SOS before any frame header', bytes(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9)],
      ['stuffed zero at a marker boundary', bytes(0xff, 0xd8, 0xff, 0x00, 0xff, 0xda, 0x00, 0x02)],
    ])('rejects JPEG with %s before decoder creation', async (_reason, contents) => {
      const decoders = installBrowserDecoders();
      const file = new File([contents], 'malformed.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/JPEG|image/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects a stuffed zero at a marker boundary even when a valid SOF follows', async () => {
      const decoders = installBrowserDecoders();
      const jpeg = concatenateBytes(
        bytes(0xff, 0xd8, 0xff, 0x00),
        jpegSegment(0xc0, jpegSofPayload(1, 1)),
        bytes(0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9)
      );
      const file = new File([jpeg], 'stuffed-boundary.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/stuffed zero at a marker boundary/i);
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects a DNL marker after the first JPEG scan before native decode', async () => {
      const decoders = installBrowserDecoders();
      const base = jpegFileBytes(1, 1);
      const dnl = jpegSegment(0xdc, uint16be(10_000));
      const jpeg = concatenateBytes(base.subarray(0, base.length - 2), dnl, bytes(0xff, 0xd9));
      const file = new File([jpeg], 'dnl-redefinition.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/DNL dimensions.*safely preflighted/i);
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('bounds JPEG marker-only runs before a frame header', async () => {
      const decoders = installBrowserDecoders();
      const markers = new Uint8Array(65_537 * 2);
      for (let offset = 0; offset < markers.length; offset += 2) {
        markers[offset] = 0xff;
        markers[offset + 1] = 0xd0;
      }
      const file = new File([concatenateBytes(bytes(0xff, 0xd8), markers)], 'marker-run.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/excessive number of markers/i);

      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('accepts a simple VP8 WebP at the pixel ceiling through a Blob URL', async () => {
      const decoders = installBrowserDecoders({ width: 10_000, height: 10_000 });
      const file = new File([webpFileBytes(webpChunk('VP8 ', webpVp8Payload(10_000, 10_000)))], 'photo.webp', {
        type: 'image/webp',
      });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'photo.webp', image: decoders.image });
      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
      expect(decoders.imageSrc).toBe('blob:decoded-1');
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('accepts a simple VP8L WebP at the pixel ceiling through a Blob URL', async () => {
      const decoders = installBrowserDecoders({ width: 10_000, height: 10_000 });
      const file = new File([webpFileBytes(webpChunk('VP8L', webpVp8lPayload(10_000, 10_000)))], 'photo.webp', {
        type: 'image/webp',
      });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'photo.webp', image: decoders.image });
      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('accepts the VP8L alpha-used bit while checking the version field', async () => {
      const decoders = installBrowserDecoders();
      const file = new File([webpFileBytes(webpChunk('VP8L', webpVp8lPayload(1, 1, true)))], 'alpha.webp', {
        type: 'image/webp',
      });

      const result = await loadDocumentFile(file);

      expect('image' in result ? result.image : undefined).toBe(decoders.image);
      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
    });

    it('keeps animated WebP first-frame import while bounding canvas and frame dimensions', async () => {
      const decoders = installBrowserDecoders({ width: 2, height: 2 });
      const animated = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(2, 2, 0x02)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('ANMF', webpAnmfPayload(0, 0, 2, 2, webpChunk('VP8 ', webpVp8Payload(2, 2))))
      );
      const file = new File([animated], 'animated.webp', { type: 'image/webp' });

      const result = await loadDocumentFile(file);

      expect('image' in result ? result.image : undefined).toBe(decoders.image);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('accepts EXIF and XMP metadata after animated WebP frames', async () => {
      const decoders = installBrowserDecoders({ width: 1, height: 1 });
      const animated = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(1, 1, 0x0e)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('ANMF', webpAnmfPayload(0, 0, 1, 1, webpChunk('VP8 ', webpVp8Payload(1, 1)))),
        webpChunk('XMP ', bytes(1)),
        webpChunk('EXIF', bytes(2))
      );
      const file = new File([animated], 'animated-metadata.webp', { type: 'image/webp' });

      const result = await loadDocumentFile(file);

      expect('image' in result ? result.image : undefined).toBe(decoders.image);
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
    });

    it('ignores ANIM when the VP8X animation feature flag is clear', async () => {
      const decoders = installBrowserDecoders({ width: 2, height: 2 });
      const stillWithStrayAnim = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(2, 2)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('VP8 ', webpVp8Payload(2, 2))
      );
      const file = new File([stillWithStrayAnim], 'stray-animation-control.webp', { type: 'image/webp' });

      const result = await loadDocumentFile(file);

      expect('image' in result ? result.image : undefined).toBe(decoders.image);
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
    });

    it('bounds cumulative nested WebP animation subchunks', async () => {
      const decoders = installBrowserDecoders();
      const jpegLikeChunk = webpChunk('JUNK', new Uint8Array());
      const nestedChunks = new Uint8Array(jpegLikeChunk.length * 65_535);
      for (let offset = 0; offset < nestedChunks.length; offset += jpegLikeChunk.length) {
        nestedChunks.set(jpegLikeChunk, offset);
      }
      const frame = webpAnmfPayload(0, 0, 1, 1, webpChunk('VP8 ', webpVp8Payload(1, 1)), nestedChunks);
      const animated = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(1, 1, 0x02)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('ANMF', frame)
      );
      const file = new File([animated], 'many-subchunks.webp', { type: 'image/webp' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/excessive chunk sequence/i);

      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects ICCP metadata after a WebP image bitstream', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [
          webpFileBytes(
            webpChunk('VP8X', webpVp8xPayload(1, 1, 0x20)),
            webpChunk('VP8 ', webpVp8Payload(1, 1)),
            webpChunk('ICCP', bytes(1))
          ),
        ],
        'late-profile.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/ICC profile.*invalid position/i);
      expect(decoders.image).toBeUndefined();
    });

    it('rejects ALPH metadata after a WebP image bitstream', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [
          webpFileBytes(
            webpChunk('VP8X', webpVp8xPayload(1, 1, 0x10)),
            webpChunk('VP8 ', webpVp8Payload(1, 1)),
            webpChunk('ALPH', bytes(0))
          ),
        ],
        'late-alpha.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/alpha chunk.*invalid position/i);
      expect(decoders.image).toBeUndefined();
    });

    it('rejects ICCP metadata after an ALPH subchunk', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [
          webpFileBytes(
            webpChunk('VP8X', webpVp8xPayload(1, 1, 0x30)),
            webpChunk('ALPH', bytes(0)),
            webpChunk('ICCP', bytes(1)),
            webpChunk('VP8 ', webpVp8Payload(1, 1))
          ),
        ],
        'late-profile-after-alpha.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/ICC profile.*invalid position/i);
      expect(decoders.image).toBeUndefined();
    });

    it('rejects a VP8X alpha flag that disagrees with an extended VP8L bitstream', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(1, 1, 0x10)), webpChunk('VP8L', webpVp8lPayload(1, 1)))],
        'alpha-flag-mismatch.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/feature flags do not match/i);
      expect(decoders.image).toBeUndefined();
    });

    it('rejects an animated VP8X alpha flag when no frame carries alpha', async () => {
      const decoders = installBrowserDecoders();
      const animated = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(1, 1, 0x12)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('ANMF', webpAnmfPayload(0, 0, 1, 1, webpChunk('VP8 ', webpVp8Payload(1, 1))))
      );
      const file = new File([animated], 'animated-alpha-flag-mismatch.webp', { type: 'image/webp' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/feature flags do not match/i);
      expect(decoders.image).toBeUndefined();
    });

    it('rejects an animated WebP frame outside its canvas before constructing a decoder', async () => {
      const decoders = installBrowserDecoders();
      const animated = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(2, 2, 0x02)),
        webpChunk('ANIM', bytes(0, 0, 0, 0, 0, 0)),
        webpChunk('ANMF', webpAnmfPayload(1, 0, 1, 1, webpChunk('VP8 ', webpVp8Payload(1, 1))))
      );
      const file = new File([animated], 'bad-animation.webp', { type: 'image/webp' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/frame exceeds/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('uses the detected WebP MIME type on the Blob URL source', async () => {
      const decoders = installBrowserDecoders();
      const file = new File([webpFileBytes(webpChunk('VP8L', webpVp8lPayload(1, 1)))], 'image.bin', { type: '' });

      await loadImageFile(file, 'image/webp');

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
      expect(decoders.objectUrls[0]?.source).not.toBe(file);
      expect(decoders.objectUrls[0]?.source).toBeInstanceOf(Blob);
      expect((decoders.objectUrls[0]?.source as Blob).type).toBe('image/webp');
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('revokes a WebP Blob URL when native decoding fails', async () => {
      const decoders = installBrowserDecoders();
      decoders.imageMode = 'error';
      const file = new File([webpFileBytes(webpChunk('VP8 ', webpVp8Payload(1, 1)))], 'corrupt.webp', {
        type: 'image/webp',
      });

      await expect(loadDocumentFile(file)).rejects.toThrow('Failed to load image');

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('revokes a WebP Blob URL after post-decode dimension rejection', async () => {
      const decoders = installBrowserDecoders({ width: 10_001, height: 10_000 });
      const file = new File([webpFileBytes(webpChunk('VP8 ', webpVp8Payload(1, 1)))], 'large.webp', {
        type: 'image/webp',
      });

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('rejects WebP with a RIFF extent beyond the available bytes', async () => {
      const decoders = installBrowserDecoders();
      const data = webpFileBytes(webpChunk('VP8 ', webpVp8Payload(1, 1)));
      new DataView(data.buffer).setUint32(4, data.length, true);
      const file = new File([data], 'truncated.webp', { type: 'image/webp' });

      await expect(loadDocumentFile(file)).rejects.toThrow(/RIFF size/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects oversized VP8L dimensions before native decode', async () => {
      const decoders = installBrowserDecoders();
      const file = new File([webpFileBytes(webpChunk('VP8L', webpVp8lPayload(10_001, 10_000)))], 'large.webp', {
        type: 'image/webp',
      });

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects an oversized VP8X canvas before reading its image bitstream', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(10_001, 10_000)), webpChunk('VP8 ', webpVp8Payload(1, 1)))],
        'large-canvas.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects an oversized embedded VP8 bitstream behind a small VP8X canvas', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(10, 10)), webpChunk('VP8 ', webpVp8Payload(10_001, 10_000)))],
        'mismatched.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects a static VP8X canvas that disagrees with its image bitstream', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(10, 10)), webpChunk('VP8 ', webpVp8Payload(11, 10)))],
        'mismatched.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/do not match/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('skips bounded WebP metadata chunks and ignores physical trailing bytes', async () => {
      const decoders = installBrowserDecoders();
      const webp = webpFileBytes(
        webpChunk('VP8X', webpVp8xPayload(10, 10, 0x2c)),
        webpChunk('EXIF', bytes(1)),
        webpChunk('ICCP', bytes(1, 2, 3)),
        webpChunk('VP8 ', webpVp8Payload(10, 10)),
        webpChunk('XTRA', bytes(4, 5, 6)),
        webpChunk('XMP ', bytes(2))
      );
      const file = new File([webp, bytes(0xca, 0xfe)], 'trailing.webp', { type: 'image/webp' });

      const result = await loadDocumentFile(file);

      expect(result).toMatchObject({ fileName: 'trailing.webp', image: decoders.image });

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });

    it('rejects an oversized animated WebP canvas before native decode', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(10_001, 10_000, 0x02)))],
        'animated.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/too large/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('rejects a WebP ANMF chunk without an animation flag', async () => {
      const decoders = installBrowserDecoders();
      const file = new File(
        [webpFileBytes(webpChunk('VP8X', webpVp8xPayload(10, 10)), webpChunk('ANMF', new Uint8Array(16)))],
        'animated.webp',
        { type: 'image/webp' }
      );

      await expect(loadDocumentFile(file)).rejects.toThrow(/animation frame/i);

      expect(decoders.reader).toBeUndefined();
      expect(decoders.image).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(0);
    });

    it('revokes a JPEG Blob URL when native decoding fails', async () => {
      const decoders = installBrowserDecoders();
      decoders.imageMode = 'error';
      const file = new File([jpegFileBytes(1, 1)], 'corrupt.jpg', { type: 'image/jpeg' });

      await expect(loadDocumentFile(file)).rejects.toThrow('Failed to load image');

      expect(decoders.reader).toBeUndefined();
      expect(decoders.objectUrls).toHaveLength(1);
      expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
    });
  });

  it.each(['photo.jpg', 'photo.jpeg', 'photo.webp', 'photo.avif', 'photo.svg', 'PHOTO.PNG'])(
    'accepts %s on its extension alone, with no media type',
    async (name) => {
      const decoders = installBrowserDecoders();
      const lowerName = name.toLowerCase();
      const contents = lowerName.endsWith('.svg')
        ? '<svg/>'
        : lowerName.endsWith('.png')
          ? pngFileBytes(1, 1)
          : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
            ? jpegFileBytes(1, 1)
            : lowerName.endsWith('.webp')
              ? webpFileBytes(webpChunk('VP8 ', webpVp8Payload(1, 1)))
              : 'data';
      const file = new File([contents], name, { type: '' });

      const image = await loadImageFile(file);

      expect(image).toBe(decoders.image);
      if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.webp')) {
        expect(decoders.reader).toBeUndefined();
        expect(decoders.objectUrls).toMatchObject([{ source: file, url: 'blob:decoded-1' }]);
        expect(decoders.imageSrc).toBe('blob:decoded-1');
        expect(decoders.revokedObjectUrls).toEqual(['blob:decoded-1']);
      } else {
        // Other fallback formats retain their existing FileReader path in this slice.
        expect(decoders.readerInput).toBe(file);
      }
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
