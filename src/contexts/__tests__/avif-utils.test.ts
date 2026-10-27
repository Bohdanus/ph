import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAvif, loadAvifFile } from '../avif-utils.ts';

const { decode, encode } = vi.hoisted(() => ({ decode: vi.fn(), encode: vi.fn() }));
vi.mock('@jsquash/avif', () => ({ decode, encode }));

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  decode.mockReset();
  encode.mockReset();
});

function canvasOf(width: number, height: number, data: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData: vi.fn(() => ({ data, width, height })),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
}

/**
 * `@jsquash/avif` loads its libavif WASM modules over `fetch`, which jsdom does not
 * implement, so a real AVIF round trip cannot run in this environment. These tests
 * therefore pin the module's public contract instead: which arguments reach the codec,
 * how the codec's return value is turned into a Blob, and how every failure mode of the
 * WASM boundary is surfaced to the caller.
 */
describe('AVIF encoding', () => {
  it('encodes canvas pixels with the AVIF codec', async () => {
    const imageData = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    const context = { getImageData: vi.fn(() => imageData) };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    encode.mockResolvedValue(new ArrayBuffer(4));

    const blob = await encodeAvif(canvas);

    expect(encode).toHaveBeenCalledExactlyOnceWith(imageData, { quality: 80 });
    expect(blob.type).toBe('image/avif');
    expect(blob.size).toBe(4);
  });

  it('wraps the codec buffer verbatim so the blob payload equals the encoder output', async () => {
    const payload = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 97, 118, 105, 102]);
    const canvas = canvasOf(2, 1, new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]));
    encode.mockResolvedValue(payload.buffer);

    const blob = await encodeAvif(canvas);

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(payload);
    expect(blob.type).toBe('image/avif');
  });

  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 8 },
    { width: 8, height: 1 },
    { width: 5, height: 3 },
  ])('forwards the full $width x $height pixel buffer for each geometry', async ({ width, height }) => {
    const data = new Uint8ClampedArray(width * height * 4).fill(200);
    const canvas = canvasOf(width, height, data);
    encode.mockResolvedValue(new ArrayBuffer(1));

    await encodeAvif(canvas);

    expect(encode).toHaveBeenCalledExactlyOnceWith({ data, width, height }, { quality: 80 });
  });

  it('propagates an encoder rejection instead of wrapping it in an empty blob', async () => {
    const canvas = canvasOf(1, 1, new Uint8ClampedArray([0, 0, 0, 255]));
    encode.mockRejectedValue(new Error('avif encoder out of memory'));

    await expect(encodeAvif(canvas)).rejects.toThrow('avif encoder out of memory');
  });

  it('rejects when the canvas has no readable 2d context', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    await expect(encodeAvif(canvas)).rejects.toThrow('Unable to read canvas pixels');
    expect(encode).not.toHaveBeenCalled();
  });

  it('never reads a zero-sized pixel buffer through the encoder', async () => {
    const canvas = canvasOf(1, 1, new Uint8ClampedArray(0));
    encode.mockResolvedValue(new ArrayBuffer(1));

    await encodeAvif(canvas);

    expect(encode.mock.calls[0][0]).toMatchObject({ width: 1, height: 1 });
  });

  it('refuses a canvas beyond the pixel budget rather than writing a file it cannot reopen', async () => {
    const canvas = canvasOf(10000, 8001, new Uint8ClampedArray(0));

    await expect(encodeAvif(canvas)).rejects.toThrow(
      'AVIF image is too large to save (10000×8001). Maximum is 80000000 pixels.'
    );
    expect(encode).not.toHaveBeenCalled();
  });

  it('refuses an over-budget canvas before it reads a single pixel back out of it', async () => {
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 10000, height: 8001 }));
    const canvas = document.createElement('canvas');
    canvas.width = 10000;
    canvas.height = 8001;
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeAvif(canvas)).rejects.toThrow('AVIF image is too large to save');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('encodes a canvas sitting exactly on the pixel budget, because the check is strictly greater-than', async () => {
    const canvas = canvasOf(10000, 8000, new Uint8ClampedArray(0));
    encode.mockResolvedValue(new ArrayBuffer(1));

    await expect(encodeAvif(canvas)).resolves.toBeInstanceOf(Blob);
    expect(encode).toHaveBeenCalledExactlyOnceWith(
      { data: expect.any(Uint8ClampedArray), width: 10000, height: 8000 },
      { quality: 80 }
    );
  });
});

describe('AVIF decoding', () => {
  it('hands the file buffer to the codec and rasterises the decoded pixels', async () => {
    installImageHarness();
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128, 9, 9, 9, 255, 8, 8, 8, 0]);
    decode.mockResolvedValue({ data, width: 2, height: 2, colorSpace: 'srgb' });
    const file = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'image/avif' });

    const pending = loadAvifFile(file);
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    const [buffer] = decode.mock.calls[0] as [ArrayBuffer];
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const image = putImageData.mock.calls[0][0];
    expect([image.width, image.height]).toEqual([2, 2]);
    expect(Array.from(image.data)).toEqual(Array.from(data));
  });

  it('rejects with a descriptive error when the codec cannot decode the payload', async () => {
    installImageHarness();
    decode.mockResolvedValue(null);
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    await expect(loadAvifFile(file)).rejects.toThrow('Failed to decode AVIF image');
    expect(putImageData).not.toHaveBeenCalled();
  });

  it('propagates a codec rejection for malformed AVIF data', async () => {
    installImageHarness();
    decode.mockRejectedValue(new Error('Invalid AVIF payload'));
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    await expect(loadAvifFile(file)).rejects.toThrow('Invalid AVIF payload');
  });

  it('rejects when the codec reports a zero dimension image', async () => {
    installImageHarness();
    decode.mockResolvedValue({ data: new Uint8ClampedArray(0), width: 0, height: 4, colorSpace: 'srgb' });
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    // The budget owns the shape of the geometry as well as its size, so this is refused there
    // and the message names AVIF rather than the generic rasteriser that used to catch it.
    await expect(loadAvifFile(file)).rejects.toThrow('AVIF image has invalid dimensions to open (0×4)');
  });

  it.each([
    { label: 'a negative width', width: -5, height: -3 },
    { label: 'a negative height', width: 4, height: -3 },
    { label: 'a fractional width', width: 4.5, height: 4 },
    { label: 'a fractional height', width: 4, height: 0.5 },
    { label: 'a NaN width', width: Number.NaN, height: 4 },
    { label: 'a NaN height', width: 4, height: Number.NaN },
  ])('rejects $label rather than letting it reach createImageData', async ({ width, height }) => {
    // `width * height > 80000000` is false for every one of these, so before the shape guard the
    // budget waved them all through — and the DOM answered with an `IndexSizeError` naming
    // neither AVIF nor the file the user opened.
    installImageHarness();
    decode.mockResolvedValue({ data: new Uint8ClampedArray(0), width, height, colorSpace: 'srgb' });
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    await expect(loadAvifFile(file)).rejects.toThrow('AVIF image has invalid dimensions to open');
    expect(putImageData).not.toHaveBeenCalled();
  });

  it('rejects a negative canvas geometry on the save path before the pixels are read', async () => {
    const canvas = document.createElement('canvas');
    // A real canvas clamps a negative assignment, so the negative geometry is injected through
    // the property the budget reads — the same shape a decoded negative takes on the open path.
    Object.defineProperty(canvas, 'width', { value: -5, configurable: true });
    Object.defineProperty(canvas, 'height', { value: -3, configurable: true });
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: -5, height: -3 }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeAvif(canvas)).rejects.toThrow('AVIF image has invalid dimensions to save (-5×-3)');
    expect(getImageData).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it('still refuses an over-budget canvas, so the shape guard did not replace the budget', async () => {
    const canvas = canvasOf(10000, 8001, new Uint8ClampedArray(0));

    await expect(encodeAvif(canvas)).rejects.toThrow(
      'AVIF image is too large to save (10000×8001). Maximum is 80000000 pixels.'
    );
  });

  it('rejects a decoded image beyond the pixel budget rather than downscaling it', async () => {
    installImageHarness();
    decode.mockResolvedValue({
      data: new Uint8ClampedArray(0),
      width: 10000,
      height: 8001,
      colorSpace: 'srgb',
    });
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    await expect(loadAvifFile(file)).rejects.toThrow(
      'AVIF image is too large to open (10000×8001). Maximum is 80000000 pixels.'
    );
    expect(putImageData).not.toHaveBeenCalled();
  });

  it('rejects when the canvas for the decoded image cannot be created', async () => {
    installImageHarness();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    decode.mockResolvedValue({ data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' });
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    await expect(loadAvifFile(file)).rejects.toThrow('Unable to create a canvas for image decoding');
  });

  it('rejects when the browser cannot decode the rasterised AVIF image', async () => {
    installImageHarness();
    decode.mockResolvedValue({ data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, colorSpace: 'srgb' });
    const file = new Blob([new Uint8Array([0])], { type: 'image/avif' });

    const pending = loadAvifFile(file);
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onerror!.call(imageStub!, new Event('error'));

    await expect(pending).rejects.toThrow('Failed to decode AVIF image');
  });
});

describe('AVIF round-trip through the public contract', () => {
  it('re-encodes decoded pixels so an AVIF save/load cycle preserves the geometry', async () => {
    const source = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 255, 100, 110, 120, 0]);
    const avif = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 97, 118, 105, 102]);
    encode.mockResolvedValue(avif.buffer);
    const saved = await encodeAvif(canvasOf(2, 2, source));
    expect(decode).not.toHaveBeenCalled();
    // Installed after `canvasOf` so the per-canvas getContext spy cannot shadow the
    // prototype spy that `imageDataToImage` relies on.
    installImageHarness();

    decode.mockResolvedValue({ data: source, width: 2, height: 2, colorSpace: 'srgb' });
    const pending = loadAvifFile(new Blob([saved], { type: 'image/avif' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    const image = putImageData.mock.calls[0][0];
    expect([image.width, image.height]).toEqual([2, 2]);
    expect(Array.from(image.data)).toEqual(Array.from(source));
  });

  it('keeps the encode quality fixed at 80 across repeated saves', async () => {
    const canvas = canvasOf(1, 1, new Uint8ClampedArray([0, 0, 0, 255]));
    encode.mockResolvedValue(new ArrayBuffer(1));

    await encodeAvif(canvas);
    await encodeAvif(canvas);

    expect(encode).toHaveBeenCalledTimes(2);
    expect(encode.mock.calls.map(([, options]) => options)).toEqual([{ quality: 80 }, { quality: 80 }]);
  });
});
