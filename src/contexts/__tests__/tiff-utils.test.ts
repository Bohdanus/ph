import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTiff, loadTiffFile } from '../tiff-utils.ts';

const { decode, decodeImage, encodeImage, toRGBA8 } = vi.hoisted(() => ({
  decode: vi.fn(),
  decodeImage: vi.fn(),
  encodeImage: vi.fn(),
  toRGBA8: vi.fn(),
}));

vi.mock('utif', () => ({ default: { decode, decodeImage, encodeImage, toRGBA8 } }));

type StubImage = HTMLImageElement;

let imageStub: StubImage | null = null;
let putImageData: ReturnType<typeof vi.fn<(imageData: ImageData) => void>>;

/**
 * `loadTiffFile` finishes in `raster-utils.imageDataToImage`, which needs a pixel-capable
 * canvas context, `toDataURL` and an `Image` that fires `onload` — none of which jsdom
 * provides. The stub is a real constructor so `new Image()` keeps its type identity.
 */
function recordImage(image: StubImage) {
  imageStub = image;
}

class ImageStub {
  onload: HTMLImageElement['onload'] = null;
  onerror: HTMLImageElement['onerror'] = null;
  src = '';
  constructor() {
    recordImage(this as unknown as HTMLImageElement);
  }
}

function installImageHarness() {
  imageStub = null;
  putImageData = vi.fn<(imageData: ImageData) => void>();
  vi.stubGlobal('Image', ImageStub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    }),
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,decoded');
}

describe('TIFF encoding and decoding', () => {
  beforeEach(() => {
    decode.mockReset();
    decodeImage.mockReset();
    encodeImage.mockReset();
    toRGBA8.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes the first TIFF page into a browser image', async () => {
    installImageHarness();
    const page = { width: 2, height: 1 };
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(rgba);

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    expect(decode).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer));
    expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    expect(toRGBA8).toHaveBeenCalledExactlyOnceWith(page);
    const image = putImageData.mock.calls[0][0];
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(Array.from(image.data)).toEqual(Array.from(rgba));
  });

  it('passes the raw file bytes to the decoder rather than a re-wrapped buffer', async () => {
    installImageHarness();
    const payload = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const page = { width: 1, height: 1 };
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(new Uint8Array([0, 0, 0, 255]));

    const pending = loadTiffFile(new Blob([payload], { type: 'image/tiff' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    await pending;

    const [buffer] = decode.mock.calls[0] as [ArrayBuffer];
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(payload));
  });

  it('always decodes and converts only the first page of a multi-page TIFF', async () => {
    installImageHarness();
    const first = { width: 1, height: 1 };
    const second = { width: 4, height: 4 };
    decode.mockReturnValue([first, second]);
    toRGBA8.mockReturnValue(new Uint8Array([7, 7, 7, 255]));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    await expect(pending).resolves.toBe(imageStub);

    expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), first);
    expect(toRGBA8).toHaveBeenCalledExactlyOnceWith(first);
    expect(putImageData.mock.calls[0][0]).toMatchObject({ width: 1, height: 1 });
  });

  it('reads the page geometry only after the page has been decoded', async () => {
    installImageHarness();
    // utif leaves `width`/`height` undefined until `decodeImage` runs, so reading them
    // before that call would reject a perfectly valid file.
    const page: { width?: number; height?: number } = {};
    decode.mockReturnValue([page]);
    decodeImage.mockImplementation(() => {
      page.width = 3;
      page.height = 2;
    });
    toRGBA8.mockReturnValue(new Uint8Array(24));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    await expect(pending).resolves.toBe(imageStub);

    expect(decodeImage.mock.invocationCallOrder[0]).toBeLessThan(toRGBA8.mock.invocationCallOrder[0]);
    expect(putImageData.mock.calls[0][0]).toMatchObject({ width: 3, height: 2 });
  });

  it('rejects when the browser cannot decode the rasterised TIFF', async () => {
    installImageHarness();
    decode.mockReturnValue([{ width: 1, height: 1 }]);
    toRGBA8.mockReturnValue(new Uint8Array([1, 2, 3, 255]));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onerror!.call(imageStub!, new Event('error'));

    await expect(pending).rejects.toThrow('Failed to decode TIFF image');
  });

  it('encodes canvas RGBA pixels as a TIFF blob', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data: pixels })),
    } as unknown as CanvasRenderingContext2D);
    const buffer = new ArrayBuffer(4);
    encodeImage.mockReturnValue(buffer);

    const blob = await encodeTiff(canvas);

    expect(encodeImage).toHaveBeenCalledExactlyOnceWith(pixels, 1, 1, { t338: [2] });
    expect(blob.type).toBe('image/tiff');
    expect(blob.size).toBe(4);
  });

  it('requests the whole canvas rectangle from getImageData', async () => {
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(48) }));
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);
    encodeImage.mockReturnValue(new ArrayBuffer(48));

    const blob = await encodeTiff(canvas);

    expect(getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, 4, 3);
    expect(encodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8ClampedArray), 4, 3, { t338: [2] });
    expect(new Uint8Array(await blob.arrayBuffer())).toHaveLength(48);
  });

  it('declares the straight alpha it is given as unassociated, never premultiplied', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 0, 0, 128]) })),
    } as unknown as CanvasRenderingContext2D);
    encodeImage.mockReturnValue(new ArrayBuffer(4));

    await encodeTiff(canvas);

    // UTIF's default IFD sets ExtraSamples (tag 338) to 1 = associated, which tells every
    // reader that multiplies by alpha to do it a second time. `getImageData` is straight
    // alpha, so the file must say 2. The pixels are handed over untouched: it is the
    // declaration that was wrong, not the data.
    const [pixels, , , metadata] = encodeImage.mock.calls[0] as [Uint8ClampedArray, number, number, { t338: number[] }];
    expect(metadata).toEqual({ t338: [2] });
    expect(metadata.t338).not.toEqual([1]);
    expect(Array.from(pixels)).toEqual([255, 0, 0, 128]);
  });

  it('wraps the encoder output verbatim', async () => {
    const buffer = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0x00]).buffer;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    } as unknown as CanvasRenderingContext2D);
    encodeImage.mockReturnValue(buffer);

    expect(new Uint8Array(await (await encodeTiff(canvas)).arrayBuffer())).toEqual(
      new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0x00])
    );
  });

  it('propagates an encoder rejection', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    } as unknown as CanvasRenderingContext2D);
    encodeImage.mockImplementation(() => {
      throw new Error('tiff encoder rejected the raster');
    });

    await expect(encodeTiff(canvas)).rejects.toThrow('tiff encoder rejected the raster');
  });
});

describe('TIFF error paths', () => {
  beforeEach(() => {
    decode.mockReset();
    decodeImage.mockReset();
    // Reset here too, so the `not.toHaveBeenCalled()` assertions below do not depend on
    // which tests in this describe happened to reach the converter first.
    toRGBA8.mockReset();
  });

  it('rejects files whose first decoded page is missing', async () => {
    decode.mockReturnValue([]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF file contains no image pages'
    );
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty page', {}],
    ['a zero width', { width: 0, height: 1 }],
    ['a zero height', { width: 1, height: 0 }],
  ])('rejects %s', async (_label, page) => {
    decode.mockReturnValue([page]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image has invalid dimensions'
    );
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('propagates a decoder failure for a malformed TIFF', async () => {
    decode.mockImplementation(() => {
      throw new Error('unknown Dtype');
    });

    await expect(loadTiffFile(new Blob(['not a tiff'], { type: 'image/tiff' }))).rejects.toThrow('unknown Dtype');
  });

  it('rejects encoding when the canvas has no 2d context', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    await expect(encodeTiff(canvas)).rejects.toThrow('Unable to read canvas pixels for TIFF encoding');
    expect(encodeImage).not.toHaveBeenCalled();
  });
});

/**
 * A TIFF is a 4-byte signature plus one IFD, so a ~200-byte file can declare 65535×65535.
 * `UTIF.decodeImage` then allocates `height * bytesPerRow` from those tags and `UTIF.toRGBA8`
 * allocates `width * height * 4` — 17.2 GB for that header, with no bound anywhere in the
 * path. These pin that the budget is consulted before either allocating call, and that it
 * rejects rather than silently downscaling.
 */
describe('TIFF decode pixel budget', () => {
  beforeEach(() => {
    decode.mockReset();
    decodeImage.mockReset();
    toRGBA8.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses a 65535×65535 header before decodeImage reaches its own allocation', async () => {
    decode.mockReturnValue([{ t256: [65535], t257: [65535] }]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image is too large to open (65535×65535). Maximum is 80000000 pixels.'
    );
    expect(decodeImage).not.toHaveBeenCalled();
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('refuses a header whose dimensions only materialise after decodeImage', async () => {
    // utif leaves `width`/`height` unset until `decodeImage` copies them off the IFD, so the
    // IFD is the only place a budget can catch this before the allocation.
    const page: { width?: number; height?: number } = {};
    decode.mockReturnValue([page]);
    decodeImage.mockImplementation(() => {
      page.width = 40000;
      page.height = 40000;
    });

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image is too large to open (40000×40000). Maximum is 80000000 pixels.'
    );
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it.each([
    ['just over the cap', 10001, 8000],
    ['a single absurdly wide page', 1_000_000, 1000],
  ])('rejects %s rather than clamping it to fit', async (_label, width, height) => {
    decode.mockReturnValue([{ t256: [width], t257: [height] }]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      /TIFF image is too large to open/
    );
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('still decodes a large page that sits exactly on the cap', async () => {
    installImageHarness();
    const page = { width: 10000, height: 8000, t256: [10000], t257: [8000] };
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(new Uint8Array(4));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    expect(toRGBA8).toHaveBeenCalledExactlyOnceWith(page);
  });

  it('leaves an IFD without usable geometry tags to the post-decode guard', async () => {
    // `UTIF.decode` always writes t256/t257, but a page the mock hands over without them
    // must not be rejected for the budget — only for the dimensions.
    installImageHarness();
    decode.mockReturnValue([{ width: 2, height: 1 }]);
    toRGBA8.mockReturnValue(new Uint8Array(8));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    expect(toRGBA8).toHaveBeenCalledExactlyOnceWith({ width: 2, height: 1 });
  });
});
