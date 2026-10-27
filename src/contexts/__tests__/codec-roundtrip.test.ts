import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeTiff, loadTiffFile } from '../tiff-utils.ts';
import { encodeBmp, loadBmpFile } from '../bmp-utils.ts';
import { encodeIco, loadIcoFile } from '../ico-utils.ts';
import { encodeGif } from '../gif-utils.ts';
import { encodeSvg } from '../svg-utils.ts';
import { loadDocumentFile } from '../image-load-save-utils.ts';

/**
 * Real-codec round trips.
 *
 * `tiff-utils.test.ts` mocks `utif` to pin the module's contract with hand-written page
 * objects. This file deliberately does not mock anything: it drives the real `utif`,
 * `gifenc` and the app's own BMP/ICO readers so the assertions are about bytes that a
 * third-party encoder actually produced.
 *
 * `@jsquash/avif` is the one exception — it fetches its libavif WASM over the network at
 * `encode()`/`decode()` time, and jsdom has no `fetch`, so no real AVIF round trip is
 * possible here. AVIF is covered through its public contract in `avif-utils.test.ts`.
 */

type StubImage = HTMLImageElement;

let imageStub: StubImage | null = null;
let putImageData: ReturnType<typeof vi.fn<(imageData: ImageData) => void>>;

function recordImage(image: StubImage) {
  imageStub = image;
}

class ImageStub {
  onload: HTMLImageElement['onload'] = null;
  onerror: HTMLImageElement['onerror'] = null;
  src = '';
  /**
   * A real decode always reports a positive natural size, and no browser reports it as 0 once
   * `onload` has fired — but a blob URL carries no geometry a stub could read it from, so a test
   * that exercises a branch which consults it has to say what the geometry is. `loadIcoFile`'s
   * PNG-entry branch does consult it, and refuses an unreadable one, so leaving these at 0 makes
   * that branch's ceiling tests fail here rather than pass for the wrong reason.
   */
  naturalWidth = 0;
  naturalHeight = 0;
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
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

/**
 * Resolves `loadImageSource` by firing the stubbed `Image.onload` and returns the RGBA
 * buffer the codec decoder handed to `imageDataToImage`.
 */
async function loadAndCapturePixels(pending: Promise<HTMLImageElement>) {
  await vi.waitFor(() => expect(imageStub).not.toBeNull());
  imageStub!.onload!.call(imageStub!, new Event('load'));
  await expect(pending).resolves.toBe(imageStub);
  const image = putImageData.mock.calls[0][0];
  return { width: image.width, height: image.height, data: Array.from(image.data) };
}

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = (index * 47 + 3) % 256;
    data[index * 4 + 1] = (index * 89 + 41) % 256;
    data[index * 4 + 2] = (index * 151 + 97) % 256;
    data[index * 4 + 3] = (index * 67 + 19) % 256;
  }
  return data;
}

function grey(width: number, height: number, level: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data.set([level, level, level, 255], index * 4);
  }
  return data;
}

function pixelCanvas(width: number, height: number, data: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const getImageData = vi.fn(() => ({ data, width, height }));
  vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);
  return canvas;
}

function tiffHeader(bytes: Uint8Array) {
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  return {
    byteOrder: littleEndian ? 'little-endian' : bigEndian ? 'big-endian' : 'unknown',
    magic: littleEndian ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TIFF encode/decode round trip through the real utif codec', () => {
  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 6 },
    { width: 6, height: 1 },
    { width: 3, height: 2 },
    { width: 9, height: 5 },
  ])('preserves every pixel of a $width x $height image', async ({ width, height }) => {
    const data = gradient(width, height);
    const encoded = await encodeTiff(pixelCanvas(width, height, data));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadTiffFile(new Blob([bytes], { type: 'image/tiff' })));

    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.data).toEqual(Array.from(data));
  });

  it('round-trips what the encoder writes at a size the budgets actually apply to', async () => {
    // The budget reads the encoder's own IFD back — `t258` has one entry per sample and
    // `t258.length` is the multiplier the decode budget is built on — so a file this build
    // writes has to survive the budget this build applies. The small cases above cannot
    // catch a disagreement, because a small page is inside every ceiling.
    const width = 640;
    const height = 480;
    const data = gradient(width, height);
    const encoded = await encodeTiff(pixelCanvas(width, height, data));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadTiffFile(new Blob([bytes], { type: 'image/tiff' })));

    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.data).toEqual(Array.from(data));
  });

  it('produces a well-formed TIFF container', async () => {
    const encoded = await encodeTiff(pixelCanvas(2, 2, gradient(2, 2)));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const header = tiffHeader(bytes);

    expect(encoded.type).toBe('image/tiff');
    expect(header.byteOrder).not.toBe('unknown');
    expect(header.magic).toBe(42);
    // 8-byte header plus at least an IFD entry and a pixel payload.
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it('round-trips a fully transparent image without collapsing the alpha channel', async () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0, 12, 34, 56, 0, 200, 100, 50, 255]);
    const encoded = await encodeTiff(pixelCanvas(2, 2, data));
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadTiffFile(encoded));

    expect(decoded.data).toEqual(Array.from(data));
  });

  it('round-trips a greyscale image', async () => {
    const data = grey(4, 2, 128);
    const encoded = await encodeTiff(pixelCanvas(4, 2, data));
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadTiffFile(encoded));

    expect(decoded.data).toEqual(Array.from(data));
  });

  it('rejects a zero-sized TIFF produced from an empty raster', async () => {
    const encoded = await encodeTiff(pixelCanvas(0, 0, new Uint8ClampedArray(0)));
    installImageHarness();

    await expect(loadTiffFile(encoded)).rejects.toThrow('TIFF image has invalid dimensions');
  });

  it.each([
    ['an empty buffer', new ArrayBuffer(0)],
    ['random bytes that are not a TIFF', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer],
    ['a truncated TIFF header', new Uint8Array([0x49, 0x49, 0x2a]).buffer],
  ])('rejects %s', async (_label, buffer) => {
    installImageHarness();

    await expect(loadTiffFile(new Blob([buffer], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image has invalid dimensions'
    );
    expect(putImageData).not.toHaveBeenCalled();
  });
});

describe('BMP encode/decode round trip through the app decoder', () => {
  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 4 },
    { width: 4, height: 1 },
    { width: 3, height: 2 },
  ])('preserves every pixel of a $width x $height image', async ({ width, height }) => {
    const data = gradient(width, height);
    const encoded = await encodeBmp(pixelCanvas(width, height, data));
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadBmpFile(new Blob([bytes], { type: 'image/bmp' })));

    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.data).toEqual(Array.from(data));
  });

  it('round-trips a greyscale image', async () => {
    const data = grey(3, 3, 200);
    const encoded = await encodeBmp(pixelCanvas(3, 3, data));
    installImageHarness();

    const decoded = await loadAndCapturePixels(loadBmpFile(encoded));

    expect(decoded.data).toEqual(Array.from(data));
  });
});

describe('ICO encode/load round trip through the real container', () => {
  it('reopens an ICO written by encodeIco through loadIcoFile', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 32;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob([png], { type: 'image/png' })));
    const encoded = await encodeIco(canvas);
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    installImageHarness();

    const pending = loadIcoFile(encoded);
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    // The geometry the canvas was encoded at: `loadIcoFile` reads it off the element, and it is
    // the same 48×32 the directory entry below declares.
    Object.assign(imageStub!, { naturalWidth: 48, naturalHeight: 32 });
    imageStub!.onload!.call(imageStub!, new Event('load'));
    await expect(pending).resolves.toBe(imageStub);

    const view = new DataView(bytes.buffer);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(1);
    expect(bytes[6]).toBe(48);
    expect(bytes[7]).toBe(32);
    expect(Array.from(bytes.slice(22))).toEqual(Array.from(png));
  });
});

describe('GIF and SVG encoders produce parsable containers', () => {
  it('writes a GIF whose header and trailer frame the payload', async () => {
    const bytes = new Uint8Array(await (await encodeGif(pixelCanvas(2, 1, gradient(2, 1)))).arrayBuffer());

    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
    expect(bytes[6] | (bytes[7] << 8)).toBe(2);
    expect(bytes[8] | (bytes[9] << 8)).toBe(1);
    expect(bytes.at(-1)).toBe(0x3b);
  });

  it('wraps a canvas into an SVG document', async () => {
    const canvas = pixelCanvas(6, 4, gradient(6, 4));
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,flattened');

    const svg = await encodeSvg(canvas).text();

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="6" height="4" viewBox="0 0 6 4">')).toBe(
      true
    );
    expect(svg).toContain('<image href="data:image/png;base64,flattened" width="6" height="4" />');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

describe('document loader dispatch to the real codecs', () => {
  it('routes a .tif file into the TIFF decoder', async () => {
    const data = gradient(3, 2);
    const encoded = await encodeTiff(pixelCanvas(3, 2, data));
    installImageHarness();

    const pending = loadDocumentFile(new File([encoded], 'scan.tif', { type: 'application/octet-stream' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    const imported = await pending;

    expect(imported).toMatchObject({ fileName: 'scan.tif' });
    expect('image' in imported).toBe(true);
    expect(Array.from(putImageData.mock.calls[0][0].data)).toEqual(Array.from(data));
  });

  it('routes a .bmp file into the BMP decoder', async () => {
    const data = gradient(2, 3);
    const encoded = await encodeBmp(pixelCanvas(2, 3, data));
    installImageHarness();

    const pending = loadDocumentFile(new File([encoded], 'photo.bmp', { type: 'application/octet-stream' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    const imported = await pending;

    expect(imported).toMatchObject({ fileName: 'photo.bmp' });
    expect('image' in imported).toBe(true);
    expect(Array.from(putImageData.mock.calls[0][0].data)).toEqual(Array.from(data));
  });

  it('routes a .ico file into the ICO decoder', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob([png], { type: 'image/png' })));
    const encoded = await encodeIco(canvas);
    installImageHarness();

    const pending = loadDocumentFile(new File([encoded], 'favicon.ico', { type: 'application/octet-stream' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    Object.assign(imageStub!, { naturalWidth: 16, naturalHeight: 16 });
    imageStub!.onload!.call(imageStub!, new Event('load'));
    const imported = await pending;

    expect(imported).toMatchObject({ fileName: 'favicon.ico' });
    expect('image' in imported).toBe(true);
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1);
  });
});
