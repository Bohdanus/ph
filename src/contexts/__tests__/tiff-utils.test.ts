import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTiff, loadTiffFile } from '../tiff-utils.ts';

const { decode, decodeImage, encodeImage, toRGBA8 } = vi.hoisted(() => ({
  decode: vi.fn(),
  decodeImage: vi.fn(),
  encodeImage: vi.fn(),
  toRGBA8: vi.fn(),
}));

vi.mock('utif', () => ({ default: { decode, decodeImage, encodeImage, toRGBA8 } }));

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
    const page = { width: 2, height: 1 };
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const imageData = { data: new Uint8ClampedArray(8) };
    const context = {
      createImageData: vi.fn(() => imageData),
      putImageData: vi.fn(),
    };
    let image!: InstanceType<typeof ImageMock>;
    class ImageMock {
      onload = () => {};
      onerror = () => {};
      src = '';

      constructor() {
        image = this;
      }
    }
    vi.stubGlobal('Image', ImageMock);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,decoded');
    decode.mockReturnValue([page]);
    toRGBA8.mockReturnValue(rgba);

    const promise = loadTiffFile(new Blob(['tiff']));
    await vi.waitFor(() => expect(image).toBeDefined());
    image.onload();

    await expect(promise).resolves.toBe(image);
    expect(decode).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer));
    expect(decodeImage).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), page);
    expect(context.createImageData).toHaveBeenCalledWith(2, 1);
    expect([...imageData.data]).toEqual([...rgba]);
    expect(context.putImageData).toHaveBeenCalledWith(imageData, 0, 0);
  });

  it('encodes canvas RGBA pixels as a TIFF blob', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    const context = { getImageData: vi.fn(() => ({ data: pixels })) };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const buffer = new ArrayBuffer(4);
    encodeImage.mockReturnValue(buffer);

    const blob = await encodeTiff(canvas);

    expect(encodeImage).toHaveBeenCalledExactlyOnceWith(pixels, 1, 1);
    expect(blob.type).toBe('image/tiff');
    expect(blob.size).toBe(4);
  });
});

describe('TIFF error paths', () => {
  it('rejects files whose first decoded page is missing', async () => {
    decode.mockReturnValue([]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF file contains no image pages'
    );
  });

  it('rejects pages with invalid dimensions', async () => {
    decode.mockReturnValue([{}]);

    await expect(loadTiffFile(new Blob(['tiff'], { type: 'image/tiff' }))).rejects.toThrow(
      'TIFF image has invalid dimensions'
    );
  });

  it('rejects encoding when the canvas has no 2d context', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    await expect(encodeTiff(canvas)).rejects.toThrow('Unable to read canvas pixels for TIFF encoding');
  });
});
