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
 * `UTIF.decodeImage` then allocates `height * bytesPerRow`, where a row is
 * `ceil(width * bipp / 8) * 8` bytes and `bipp` is `Math.min(32, t258[0]) * t258.length` —
 * a product the file itself controls, entry by entry. `UTIF.toRGBA8` then allocates
 * `width * height * 4`. Nothing in the path bounds any of it, and a byte budget is the only
 * one of the three that can: a page's pixel count is independent of its bit depth.
 *
 * These pin that the budget is consulted before each allocation, that it bounds bytes and
 * sample counts as well as pixels, that it sits above the largest document the New Image
 * dialog can create, that the encoder obeys the same one, and that it rejects rather than
 * silently downscaling.
 */
describe('TIFF raster byte budget', () => {
  beforeEach(() => {
    decode.mockReset();
    decodeImage.mockReset();
    toRGBA8.mockReset();
    encodeImage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses a 65535×65535 header before decodeImage reaches its own allocation', async () => {
    decode.mockReturnValue([{ t256: [65535], t257: [65535] }]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image is too large to open (65535×65535). Maximum is 200000000 pixels.'
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
      'TIFF image is too large to open (40000×40000). Maximum is 200000000 pixels.'
    );
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it.each([
    ['one pixel over the cap', 10000, 20001],
    ['a single absurdly wide page', 1_000_000, 1000],
    ['a square the New Image dialog cannot create', 20000, 20000],
  ])('rejects %s rather than clamping it to fit', async (_label, width, height) => {
    decode.mockReturnValue([{ t256: [width], t257: [height] }]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      /TIFF image is too large to open/
    );
    expect(decodeImage).not.toHaveBeenCalled();
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the largest document the New Image dialog can create',
      {
        width: 10000,
        height: 10000,
        t256: [10000],
        t257: [10000],
        t258: [8, 8, 8, 8],
        t277: [4],
        t259: [1],
        t262: [2],
      },
    ],
    [
      'a 16-bit RGBA page of that same size',
      {
        width: 10000,
        height: 10000,
        t256: [10000],
        t257: [10000],
        t258: [16, 16, 16, 16],
        t277: [4],
        t259: [1],
        t262: [2],
      },
    ],
    [
      'a greyscale page that sits exactly on the cap',
      { width: 10000, height: 20000, t256: [10000], t257: [20000], t258: [8], t277: [1], t259: [1], t262: [1] },
    ],
  ])('decodes %s', async (_label, ifd) => {
    // A budget under the dialog's own maximum is a budget that refuses files the app just
    // created, and the refusal is silent until someone saves a document and cannot reopen it.
    installImageHarness();
    const page = { ...ifd };
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(new Uint8Array(4));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    expect(toRGBA8).toHaveBeenCalledExactlyOnceWith(page);
  });

  it('refuses a small page whose bits-per-sample list is the allocation lever', async () => {
    // 1000×1000 is 1/200th of the pixel cap and its decode buffer is 800 MB, a quarter of the
    // byte ceiling, so neither budget refuses it on size. What refuses it is the format: 200
    // BitsPerSample values against 4 samples per pixel is the factor UTIF multiplies the row
    // by in `UTIF.js` — `UTIF.decodeImage()`, and a 510-byte file gets to choose it.
    decode.mockReturnValue([
      { t256: [1000], t257: [1000], t258: new Array(200).fill(32), t277: [4], t259: [1], t262: [2] },
    ]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF file is malformed: it declares 200 bits-per-sample values for 4 samples per pixel.'
    );
    expect(decodeImage).not.toHaveBeenCalled();
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('refuses a page whose row length alone runs past the byte budget', async () => {
    // The sample counts agree here and the page is comfortably inside the pixel cap, so only
    // the predicted `height * ceil(width * bipp / 8)` refuses it: six 32-bit samples is 24
    // bytes per pixel, 1.92 GB over 10000×8000.
    decode.mockReturnValue([
      { t256: [10000], t257: [8000], t258: new Array(6).fill(32), t277: [6], t259: [1], t262: [2] },
    ]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image is too large to open (10000×8000). ' +
        'Decoding it would need more than 1600 MB, over the TIFF budget.'
    );
    expect(decodeImage).not.toHaveBeenCalled();
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('refuses a page whose strip byte counts enlarge the row past the budget', async () => {
    // The `t262 === 32803` branch in `UTIF.js` — `UTIF.decodeImage()` — replaces bipp with
    // `round(t279 * 8 / (width * t278))`, so a one-row strip carrying a 2 GB byte count
    // declares 16 Mbit per pixel. Every other tag on this page is an ordinary 8-bit RGBA IFD.
    decode.mockReturnValue([
      {
        t256: [1000],
        t257: [1000],
        t258: [8, 8, 8, 8],
        t277: [4],
        t259: [1],
        t262: [32803],
        t278: [1],
        t279: [2_000_000_000],
      },
    ]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      /Decoding it would need more than 1600 MB/
    );
    expect(decodeImage).not.toHaveBeenCalled();
    expect(toRGBA8).not.toHaveBeenCalled();
  });

  it('decodes a page predicting exactly the byte ceiling, because the check is strictly greater-than', async () => {
    // Nothing else in the suite sits on `MAX_TIFF_BYTES`, so without this case flipping the
    // comparison to `>=` is invisible — an off-by-one that would refuse a file the budget
    // admits. 10000×8000 at five 32-bit samples is 160 bits per pixel, so the predicted buffer is
    // `8000 × ceil(10000 × 160 / 8)` = 8000 × 200000 = 1,600,000,000 exactly: 8e7 pixels, a
    // comfortable 40% of the pixel cap, on the byte cap itself.
    installImageHarness();
    const page = {
      width: 10000,
      height: 8000,
      t256: [10000],
      t257: [8000],
      t258: new Array(5).fill(32),
      t277: [5],
      t259: [1],
      t262: [2],
    };
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(new Uint8Array(4));

    const pending = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
  });

  it('refuses the very next row, which is the smallest prediction over the byte ceiling', async () => {
    decode.mockReturnValue([
      { t256: [10000], t257: [8001], t258: new Array(5).fill(32), t277: [5], t259: [1], t262: [2] },
    ]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      /Decoding it would need more than 1600 MB/
    );
    expect(decodeImage).not.toHaveBeenCalled();
  });

  /**
   * The one term in the budget that geometry cannot price. `_decompress` opens with
   * `if (cmpr == 1 || …) for (j = 0; j < len; j++)`, and `cmpr` is `t259 ? t259[0] : 1`, so a file
   * that simply omits the compression tag gets a byte copy bounded by the byte counts it declares.
   * Three segments of 534 MB over a 64 × 64 page is 1.602 GB of copying from a ~30-byte IFD, and
   * the pixel, allocation and tile-work budgets all admit it.
   */
  describe('the byte counts an uncompressed page declares', () => {
    const tinyPage = { t256: [64], t257: [64], t258: [8, 8, 8, 8], t277: [4], t262: [2] };

    it('refuses declared counts that sum past the ceiling, with no compression tag at all', async () => {
      decode.mockReturnValue([
        {
          ...tinyPage,
          // Three offsets, because UTIF replaces the declared counts with a geometry-derived one
          // when there is exactly one segment — so a single entry would be the unreachable shape.
          t273: [0, 534000000, 1068000000],
          t279: [534000000, 534000000, 534000000],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        'TIFF image declares more compressed data than the budget allows (64×64). ' +
          'It would copy more than 1600 MB, over the TIFF budget.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('admits declared counts summing to exactly the ceiling, so the comparison stays strict', async () => {
      // Without a case ON the ceiling, `>` becoming `>=` is invisible here exactly as it was for
      // the allocation and work terms. Two counts that sum to 1,600,000,000 to the byte.
      installImageHarness();
      const page = {
        width: 64,
        height: 64,
        ...tinyPage,
        t259: [1],
        t273: [0, 800000000],
        t279: [800000000, 800000000],
      };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });

    it('reads TileByteCounts when StripByteCounts is absent', async () => {
      // UTIF's precedence is `bcnt = t279`, falling back to `t325`. A tiled page has no
      // `StripByteCounts` at all — the tag is `TileByteCounts` — so a guard that only knew `t279`
      // would price no tiled page by its declared counts.
      decode.mockReturnValue([
        {
          ...tinyPage,
          t324: [0, 534000000, 1068000000],
          t325: [534000000, 534000000, 534000000],
          t322: [16],
          t323: [16],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        /declares more compressed data than the budget allows/
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('prices the counts that matter even when one of them is negative', async () => {
      // `for (j = 0; j < len; j++)` does not run for a negative `len`, so that entry costs
      // nothing — but a guard that stopped counting at it would let `[-1, 4e9, 4e9, 4e9]` through
      // with twelve billion iterations still to do. The three positive entries are 12 GB on their
      // own, so the file is refused for the total rather than excused by the bad entry.
      decode.mockReturnValue([{ ...tinyPage, t273: [0, 1, 2, 3], t279: [-1, 4000000000, 4000000000, 4000000000] }]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        /declares more compressed data than the budget allows/
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('decodes an uncompressed page whose declared counts are its own raster', async () => {
      // The control: `bipl` is `ceil(64 × 32 / 8) × 8` = 256, so one 64-row segment is 16 KB, and
      // the sum of the declared counts is that. Refusing this would be refusing every
      // uncompressed TIFF the app can legitimately be handed.
      installImageHarness();
      const page = { width: 64, height: 64, ...tinyPage, t259: [1], t273: [0], t279: [16384] };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });

    it('does not price declared counts for a compressed page, where they are not a loop bound', async () => {
      // For any `cmpr` other than 1 the copy loop needs `len == tgt.length`, so it is bounded by a
      // buffer this module already prices, and the codec branches are driven by the compressed
      // stream — which cannot exceed the file. Pricing declared counts there would refuse files
      // on a number UTIF never uses as a bound.
      installImageHarness();
      const page = {
        width: 64,
        height: 64,
        ...tinyPage,
        t259: [5],
        t273: [0, 4000000000, 8000000000],
        t279: [4000000000, 4000000000, 4000000000],
      };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });
  });

  it('reports an unreadable bit depth as a malformed header, not as an image over budget', async () => {
    // `NaN > ceiling` is false, so an unparseable bit depth has to be refused on its own: a
    // budget that cannot read the value is not evidence of a small image. And it has to be
    // refused as what it is — a corrupt header. "Too large to open, over the TIFF budget" tells
    // the reader their image exceeds a ceiling when nothing about its size is known, which is
    // exactly what they cannot act on.
    decode.mockReturnValue([
      { t256: [1000], t257: [1000], t258: [NaN, NaN, NaN, NaN], t277: [4], t259: [1], t262: [2] },
    ]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF file is malformed: its headers do not determine a finite size for a 1000×1000 page.'
    );
    expect(decodeImage).not.toHaveBeenCalled();
  });

  /**
   * A tiled page is the one shape `predictDecodeBytes` used to miss entirely. `UTIF.decodeImage`
   * allocates the page-sized buffer first and then, in its `t322 != null` branch, a SECOND buffer
   * sized by the *tile* (`Math.ceil(tw*th*bipp/8)`) and copies tile by tile with both live. So the
   * tile buffer is added to the page buffer, not an alternative to it — and a tile is a tag pair,
   * so a ~200-byte file gets to choose its size independently of the page's geometry.
   */
  describe('the tile buffer of a tiled page', () => {
    it('refuses a tiled page whose tile buffer alone runs past the byte budget', async () => {
      // 1000×1000 is 1/200th of the pixel cap and its page buffer is 4 MB, so neither the pixel
      // budget nor the page-size prediction touches this. The tile is `ceil(23168² × 4)` =
      // 2,147,024,896 bytes against a 1.6 GB ceiling, and 23168 is the largest legal tile that
      // reaches it. Nothing downstream of the allocation reports an over-budget buffer; UTIF
      // attempts it.
      decode.mockReturnValue([
        {
          t256: [1000],
          t257: [1000],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [2],
          t322: [23168],
          t323: [23168],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        'TIFF image is too large to open (1000×1000). ' +
          'Decoding it would need more than 1600 MB, over the TIFF budget.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
      expect(toRGBA8).not.toHaveBeenCalled();
    });

    it('counts the tile buffer on top of the page buffer rather than against it', async () => {
      // 10000×8000 8-bit RGBA is 320 MB as a page buffer, and an 18000×18000 tile is 1.296 GB as
      // a tile buffer. Either one alone is inside the 1.6 GB ceiling; together they are 1.616 GB.
      // A rule that returned the larger of the two would admit this file.
      decode.mockReturnValue([
        {
          t256: [10000],
          t257: [8000],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [2],
          t322: [18000],
          t323: [18000],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        /Decoding it would need more than 1600 MB/
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('decodes an ordinary tiled page, because tiles are usually small', async () => {
      // The control for the two cases above: 256×256 tiles over a full-size document is the shape
      // a real tiled TIFF has, and it must not be refused by a rule built for the pathological one.
      installImageHarness();
      const page = {
        width: 10000,
        height: 10000,
        t256: [10000],
        t257: [10000],
        t258: [8, 8, 8, 8],
        t277: [4],
        t259: [1],
        t262: [2],
        t322: [256],
        t323: [256],
      };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });

    it('refuses a tiled page that declares only half its tile geometry', async () => {
      // `t322` with no `t323` makes `UTIF.decodeImage` read `img["t323"][0]` off `undefined` and
      // throw a TypeError with no mention of TIFF geometry, so the geometry has to be refused
      // before anything tries to cost it — a product with a missing factor is `NaN`, and a `NaN`
      // budget would wave the page through. It is refused as a malformed tile rather than through
      // the undecidable-size path, which is for headers whose bits-per-pixel cannot be read at all.
      // Paired with the 256×256-tile case above, which has both tags.
      decode.mockReturnValue([
        { t256: [1000], t257: [1000], t258: [8, 8, 8, 8], t277: [4], t259: [1], t262: [2], t322: [256] },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        'TIFF file is malformed: it declares a 256×absent tile, and no TIFF tile is narrower or shorter than 16.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'a zero tile width', t322: [0], t323: [256], declared: '0×256' },
      { label: 'a zero tile length', t322: [256], t323: [0], declared: '256×0' },
      { label: 'both tile axes zero', t322: [0], t323: [0], declared: '0×0' },
      { label: 'a negative tile width', t322: [-256], t323: [256], declared: '-256×256' },
      { label: 'a negative tile length', t322: [256], t323: [-256], declared: '256×-256' },
    ])('refuses $label, because UTIF divides by it', async ({ t322, t323, declared }) => {
      // `ceil(0 * th * bipp / 8)` is 0, so a cost-based budget reads a zero tile as free and waves
      // the page through. UTIF then computes `tx = Math.floor((width + tw - 1) / tw)`, which is
      // `Infinity` for `tw === 0`, and `for (x = 0; x < tx; x++)` never terminates. This is the
      // same ~200-byte file as the 2.15 GB case, and hanging the tab is worse than the allocation:
      // the guard has to refuse a tile it cannot divide by rather than price it.
      decode.mockReturnValue([
        { t256: [1000], t257: [1000], t258: [8, 8, 8, 8], t277: [4], t259: [1], t262: [2], t322, t323 },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        `TIFF file is malformed: it declares a ${declared} tile, and no TIFF tile is narrower or shorter than 16.`
      );
      expect(decodeImage).not.toHaveBeenCalled();
      expect(toRGBA8).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'a 1×1 tile', t322: [1], t323: [1] },
      { label: 'a 15×16 tile', t322: [15], t323: [16] },
      { label: 'a 16×15 tile', t322: [16], t323: [15] },
    ])('refuses $label, which UTIF would divide by zero on', async ({ t322, t323 }) => {
      // `tx = floor((width + tw - 1) / tw)` is `Infinity` for `tw === 0`, and `for (x = 0; x < tx;
      // x++)` then never terminates, so no budget can price this — it has to be refused on the
      // division itself. A 10000×10000 page in 1×1 tiles would run that loop 10⁸ times out of a
      // ~200-byte IFD, against 3.9 × 10⁵ for the 16×16 tiles over the same page.
      decode.mockReturnValue([
        { t256: [10000], t257: [10000], t258: [8, 8, 8, 8], t277: [4], t259: [1], t262: [2], t322, t323 },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        /narrower or shorter than 16/
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('refuses a legal tile whose alignment alone moves more than the byte ceiling', async () => {
      // The other half of the tiled cost, and the half no buffer ceiling can see. `UTIF.decodeImage`
      // runs `ceil(width / tw) × ceil(height / th)` iterations, and each begins by clearing the
      // whole tile buffer — the `for (j = 0; j < tbuff.length; j++) tbuff[j] = 0;` is the loop's
      // first statement, not a prologue — so the work is the tile-ALIGNED raster, not the page's.
      //
      // 1 × 200000000 sits exactly on the pixel ceiling, and 16 × 16 is a legal tile, so every
      // other guard passes: the page buffer is 800 MB against a 1.6 GB ceiling and the tile buffer
      // is 1 KB. But the page is one pixel wide and the tile is sixteen, so it aligns to
      // 16 × 200000000 and clears 1024 bytes 12.5 million times — 12.8 GB of memset, from a
      // ~200-byte IFD, on the thread that draws the editor.
      decode.mockReturnValue([
        {
          t256: [1],
          t257: [200000000],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [2],
          t322: [16],
          t323: [16],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        "TIFF image's tile layout is too expensive to open (1×200000000). " +
          'Filling its tiles would move more than 1600 MB, over the TIFF budget.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
      expect(toRGBA8).not.toHaveBeenCalled();
    });

    it('admits a tile layout sitting exactly on the byte ceiling, so the comparison stays strict', async () => {
      // Without a case ON the ceiling, `tileWork > MAX` becoming `>=` is invisible, and so is a
      // divisor that is wrong by a factor of two or four. The sibling assertion for the allocation
      // ceiling says the same thing about itself, so the pair is repeated rather than assumed.
      //
      // A 1-pixel-wide page in 16-pixel tiles aligns to 16 across, and 25000000 rows is an exact
      // multiple of 16, so the aligned raster is `16 × 25000000` pixels at four bytes each —
      // 1,600,000,000, the ceiling to the byte. The pixel and allocation budgets are both far
      // below it (25 MP of 200 MP, 100 MB of 1.6 GB), so this guard is the only thing that can
      // decide it, and it has to let the boundary through.
      installImageHarness();
      // `width`/`height` are what `UTIF.decodeImage` copies off the IFD onto the page, and `decode`
      // is mocked here, so the post-decode guard reads these rather than `t256`/`t257`.
      const page = {
        width: 1,
        height: 25000000,
        t256: [1],
        t257: [25000000],
        t258: [8, 8, 8, 8],
        t277: [4],
        t259: [1],
        t262: [2],
        t322: [16],
        t323: [16],
      };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });

    it('refuses the very next tile row, which is the smallest aligned work over the ceiling', async () => {
      decode.mockReturnValue([
        {
          t256: [1],
          t257: [25000016],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [2],
          t322: [16],
          t323: [16],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        "TIFF image's tile layout is too expensive to open (1×25000016). " +
          'Filling its tiles would move more than 1600 MB, over the TIFF budget.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('prices a 32803 tiled page by the row length its strip counts imply, not by t258', async () => {
      // `predictTileWorkBytes` shares `predictBitsPerPixel` with the allocation predictor, so the
      // `t262 === 32803` rewrite has to reach the work figure as well as the peak. It does not
      // otherwise: at the 100 bits per pixel the strip counts imply the aligned work is 1.70 GB and
      // the page is refused, while at the 32 that `t258` declares it is 545 MB and the same page
      // decodes. A work predictor reading `t258` directly would admit this.
      //
      // The peak is 1.56 GB against the same 1.6 GB ceiling, so the allocation budget admits this
      // page and the work budget is the only thing that can refuse it — which is the pair of
      // quantities being genuinely independent, exercised in the direction that distinguishes them.
      decode.mockReturnValue([
        {
          t256: [10000],
          t257: [12400],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [32803],
          t278: [1],
          t279: [125000],
          t322: [1024],
          t323: [1024],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        "TIFF image's tile layout is too expensive to open"
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });

    it('still decodes a full-size page in small legal tiles, because alignment is nearly free there', async () => {
      // The control for the case above. 10000 × 10000 in 16 × 16 tiles is 625 × 625 = 390,625
      // iterations, and because both axes are already multiples of the tile it aligns to itself:
      // 400 MB of movement against the same 1.6 GB ceiling. A bound that refused this would be
      // refusing the shape real tiled TIFFs have, which is the failure mode a budget written from
      // the pathological case alone always has.
      installImageHarness();
      const page = {
        width: 10000,
        height: 10000,
        t256: [10000],
        t257: [10000],
        t258: [8, 8, 8, 8],
        t277: [4],
        t259: [1],
        t262: [2],
        t322: [16],
        t323: [16],
      };
      decode.mockReturnValue([page]);
      toRGBA8.mockReturnValue(new Uint8Array(4));

      const pending = loadTiffFile(new Blob(['tiff']));
      await vi.waitFor(() => expect(imageStub).not.toBeNull());
      imageStub!.onload!.call(imageStub!, new Event('load'));

      await expect(pending).resolves.toBe(imageStub);
      expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    });

    it('sizes the tile buffer by the row length a 32803 page replaces bipp with', async () => {
      // `t262 === 32803` with `t278`/`t279` replaces `bitsPerPixel` wholesale with
      // `round(t279 * 8 / (width * t278))` — 100 here, against the 32 the `t258` list declares —
      // and UTIF sizes `tbuff` by that same replaced value. So the tile term has to read
      // `bitsPerPixel` *after* the replacement.
      //
      // The geometry is chosen so the two ordersings disagree rather than merely both refusing:
      // at 100 bits per pixel the prediction is 2,136,579,200 and the page is refused, while at
      // the `t258`-declared 32 it is 1,499,705,344 and the page is admitted. Reading `bitsPerPixel`
      // before the replacement is therefore not a smaller refusal — it is no refusal at all.
      decode.mockReturnValue([
        {
          t256: [10000],
          t257: [9600],
          t258: [8, 8, 8, 8],
          t277: [4],
          t259: [1],
          t262: [32803],
          t278: [1],
          t279: [125000],
          t322: [8656],
          t323: [8656],
        },
      ]);

      await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
        'TIFF image is too large to open (10000×9600). ' +
          'Decoding it would need more than 1600 MB, over the TIFF budget.'
      );
      expect(decodeImage).not.toHaveBeenCalled();
    });
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

  describe('the encoder obeys the same budget', () => {
    const canvasOf = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      vi.spyOn(canvas, 'getContext').mockReturnValue({
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width, height })),
      } as unknown as CanvasRenderingContext2D);
      return canvas;
    };

    it('encodes the largest document the New Image dialog can create', async () => {
      encodeImage.mockReturnValue(new ArrayBuffer(4));

      const blob = await encodeTiff(canvasOf(10000, 10000));

      expect(encodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8ClampedArray), 10000, 10000, {
        t338: [2],
      });
      expect(blob.type).toBe('image/tiff');
    });

    it.each([
      ['one pixel over the cap', 10000, 20001],
      ['a square well past it', 30000, 30000],
    ])('refuses to write %s into a file this build would then refuse to read', async (_label, width, height) => {
      await expect(encodeTiff(canvasOf(width, height))).rejects.toThrow(
        `TIFF image is too large to save (${width}×${height}). Maximum is 200000000 pixels.`
      );
      expect(encodeImage).not.toHaveBeenCalled();
    });

    it('encodes a canvas sitting exactly on the pixel cap, which is what makes the byte cap unreachable here', async () => {
      // The pixel cap is `MAX_CREATABLE_DOCUMENT_PIXELS × 2`. A canvas on it rasterises to
      // `200000000 × 4` = 800 MB, which is *half* the 1.6 GB byte cap — so a save-side byte guard
      // would be a check no input can fail, and this case is the one that shows it: the ceiling
      // that refuses is the pixel one, one order of magnitude below the byte one.
      encodeImage.mockReturnValue(new ArrayBuffer(4));

      const blob = await encodeTiff(canvasOf(20000, 10000));

      expect(encodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8ClampedArray), 20000, 10000, {
        t338: [2],
      });
      expect(blob.type).toBe('image/tiff');
    });
  });
});
