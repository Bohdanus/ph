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
    const file = new File(['<svg/>'], 'no-extension', { type: 'image/svg+xml' });

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
      const file = new File([name.endsWith('.svg') ? '<svg/>' : 'data'], name, { type: '' });

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
