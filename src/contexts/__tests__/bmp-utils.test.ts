import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeBmp, encodeBmp, loadBmpFile, preflightBmpFile } from '../bmp-utils.ts';
import { MAX_CREATABLE_DOCUMENT_PIXELS } from '../raster-utils.ts';

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
});

/** Deterministic, fully distinct RGBA fill so a channel swap cannot survive a round trip. */
function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = (index * 37) % 256;
    data[index * 4 + 1] = (index * 91 + 13) % 256;
    data[index * 4 + 2] = (index * 173 + 57) % 256;
    data[index * 4 + 3] = index % 5 === 0 ? 128 : 255;
  }
  return data;
}

function canvasOf(width: number, height: number, data: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData: vi.fn(() => ({ data, width, height })),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
}

type BmpSpec = {
  width: number;
  height: number;
  bitsPerPixel: number;
  compression?: number;
  dibSize?: number;
  colorsUsed?: number;
  masks?: number[];
  topDown?: boolean;
  palette?: number[][];
  /** Per pixel: an RGB(A) tuple for 24/32-bit, or the packed 16-bit word. */
  rows?: Array<Array<number | number[]>>;
  indices?: number[][];
  truncate?: number;
};

/** Hand-assembles a BMP so every decoder branch can be reached with known bytes. */
function buildBmp(spec: BmpSpec): ArrayBuffer {
  const {
    width,
    height,
    bitsPerPixel,
    compression = 0,
    dibSize = 40,
    colorsUsed = 0,
    topDown = false,
    palette = [],
    rows = [],
    indices = [],
  } = spec;
  const masks = spec.masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];
  const maskBytes =
    compression === 3
      ? dibSize === 40
        ? bitsPerPixel === 32
          ? 16
          : 12
        : 0
      : compression === 6
        ? dibSize === 40
          ? 16
          : dibSize === 52
            ? 4
            : 0
        : 0;
  const paletteCount = colorsUsed || (bitsPerPixel <= 8 ? 1 << bitsPerPixel : 0);
  const pixelOffset = 14 + dibSize + maskBytes + paletteCount * 4;
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const total = pixelOffset + rowStride * height;
  const full = new ArrayBuffer(total);
  const view = new DataView(full);
  const bytes = new Uint8Array(full);

  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, total, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, dibSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, topDown ? -height : height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, bitsPerPixel, true);
  view.setUint32(30, compression, true);
  view.setUint32(34, rowStride * height, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, colorsUsed, true);

  if (maskBytes > 0) {
    view.setUint32(54, masks[0], true);
    view.setUint32(58, masks[1], true);
    view.setUint32(62, masks[2], true);
    if (maskBytes === 16 || (compression === 6 && maskBytes === 4)) view.setUint32(66, masks[3], true);
  } else if (dibSize >= 52) {
    view.setUint32(54, masks[0], true);
    view.setUint32(58, masks[1], true);
    view.setUint32(62, masks[2], true);
    if (dibSize >= 56) view.setUint32(66, masks[3], true);
  }

  palette.forEach((color, index) => {
    const at = 14 + dibSize + maskBytes + index * 4;
    bytes[at] = color[2];
    bytes[at + 1] = color[1];
    bytes[at + 2] = color[0];
    bytes[at + 3] = 0;
  });

  for (let y = 0; y < height; y++) {
    const source = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      const at = pixelOffset + y * rowStride;
      if (bitsPerPixel === 32) {
        const pixel = rows[source][x] as number[];
        bytes[at + x * 4] = pixel[2];
        bytes[at + x * 4 + 1] = pixel[1];
        bytes[at + x * 4 + 2] = pixel[0];
        bytes[at + x * 4 + 3] = pixel[3];
      } else if (bitsPerPixel === 24) {
        const pixel = rows[source][x] as number[];
        bytes[at + x * 3] = pixel[2];
        bytes[at + x * 3 + 1] = pixel[1];
        bytes[at + x * 3 + 2] = pixel[0];
      } else if (bitsPerPixel === 16) {
        view.setUint16(at + x * 2, rows[source][x] as number, true);
      } else if (bitsPerPixel === 8) {
        bytes[at + x] = indices[source][x];
      } else if (bitsPerPixel === 4) {
        bytes[at + Math.floor(x / 2)] |= (indices[source][x] & 0x0f) << (x % 2 === 0 ? 4 : 0);
      } else {
        bytes[at + Math.floor(x / 8)] |= (indices[source][x] & 1) << (7 - (x % 8));
      }
    }
  }

  return spec.truncate ? full.slice(0, total - spec.truncate) : full;
}

function makeBmpHeader() {
  const buffer = new ArrayBuffer(54);
  const view = new DataView(buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, 54, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 2, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 0, true);
  return view;
}

describe('BMP encoding and decoding', () => {
  it('round-trips canvas RGBA pixels through a 32-bit BMP without corrupting channel order', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255]);
    const canvas = canvasOf(2, 2, pixels);

    const blob = await encodeBmp(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = decodeBmp(bytes.buffer);

    expect(blob.type).toBe('image/bmp');
    expect(bytes[0]).toBe(0x42);
    expect(bytes[1]).toBe(0x4d);
    expect(bytes.byteLength).toBeGreaterThan(54);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...pixels]);
  });

  it('rejects an over-budget canvas before reading pixels', async () => {
    const canvas = document.createElement('canvas');
    const getContext = vi.spyOn(canvas, 'getContext');
    Object.defineProperties(canvas, {
      width: { configurable: true, value: 10_001 },
      height: { configurable: true, value: 10_000 },
    });

    await expect(encodeBmp(canvas)).rejects.toThrow(
      'BMP image is too large to save (10001×10000). Maximum is 100000000 pixels.'
    );
    expect(getContext).not.toHaveBeenCalled();
  });

  it('writes a BITMAPV4HEADER with 2835 pixels-per-metre and the four channel masks', async () => {
    const blob = await encodeBmp(canvasOf(1, 1, new Uint8ClampedArray([1, 2, 3, 4])));
    const view = new DataView(await blob.arrayBuffer());

    expect(view.getUint16(0, true)).toBe(0x4d42);
    expect(view.getUint32(2, true)).toBe(70 + 4);
    expect(view.getUint32(10, true)).toBe(70);
    expect(view.getUint32(14, true)).toBe(56);
    expect(view.getInt32(18, true)).toBe(1);
    expect(view.getInt32(22, true)).toBe(1);
    expect(view.getUint16(26, true)).toBe(1);
    expect(view.getUint16(28, true)).toBe(32);
    expect(view.getUint32(30, true)).toBe(3);
    expect(view.getUint32(34, true)).toBe(4);
    expect(view.getInt32(38, true)).toBe(2835);
    expect(view.getInt32(42, true)).toBe(2835);
    expect([54, 58, 62, 66].map((offset) => view.getUint32(offset, true))).toEqual([
      0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000,
    ]);
  });

  it('stores pixel rows bottom-up', async () => {
    const data = new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
    const bytes = new Uint8Array(await (await encodeBmp(canvasOf(2, 2, data))).arrayBuffer());

    // 2x2, 32bpp BGRA: the first stored row is the bottom row (3,3,3) / (4,4,4).
    expect([...bytes.slice(70, 78)]).toEqual([3, 3, 3, 255, 4, 4, 4, 255]);
    expect([...bytes.slice(78, 86)]).toEqual([1, 1, 1, 255, 2, 2, 2, 255]);
  });

  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 5 },
    { width: 5, height: 1 },
    { width: 3, height: 2 },
    { width: 7, height: 4 },
  ])('round-trips a $width x $height image byte for byte', async ({ width, height }) => {
    const data = gradient(width, height);
    const blob = await encodeBmp(canvasOf(width, height, data));
    const decoded = decodeBmp(await blob.arrayBuffer());

    expect([decoded.width, decoded.height]).toEqual([width, height]);
    expect(decoded.data).toHaveLength(width * height * 4);
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });
});

describe('BMP decoding of stored pixel formats', () => {
  it('decodes a bottom-up 24-bit BI_RGB image', () => {
    const buffer = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 24,
      rows: [
        [
          [10, 20, 30],
          [200, 100, 50],
        ],
      ],
    });

    const decoded = decodeBmp(buffer);

    expect([decoded.width, decoded.height]).toEqual([2, 1]);
    expect(Array.from(decoded.data)).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);
  });

  it('decodes a top-down (negative height) 24-bit image without flipping rows', () => {
    const buffer = buildBmp({
      width: 2,
      height: 2,
      bitsPerPixel: 24,
      topDown: true,
      rows: [
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        [
          [7, 8, 9],
          [10, 11, 12],
        ],
      ],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  });

  it('decodes 16-bit BI_RGB as RGB555', () => {
    const buffer = buildBmp({
      width: 3,
      height: 1,
      bitsPerPixel: 16,
      rows: [[[0x7c00], [0x03e0], [0x001f]]],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it('rounds fractional 16-bit channel values to the nearest 8-bit level', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 16,
      rows: [[[(1 << 10) | (1 << 5) | 1]]],
    });

    const decoded = decodeBmp(buffer);

    // 1/31 of full scale on every channel.
    expect(Array.from(decoded.data)).toEqual([8, 8, 8, 255]);
  });

  it('decodes 16-bit BI_BITFIELDS through explicit 565 masks', () => {
    const buffer = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 16,
      compression: 3,
      masks: [0x7c00, 0x03e0, 0x001f],
      rows: [[[0x7c00], [0x001f]]],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('decodes 32-bit BI_RGB as opaque BGRA and ignores the unused fourth byte', () => {
    const buffer = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 32,
      rows: [
        [
          [9, 8, 7, 0],
          [6, 5, 4, 0],
        ],
      ],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([9, 8, 7, 255, 6, 5, 4, 255]);
  });

  it('decodes 32-bit BI_BITFIELDS with an alpha mask from a 56-byte header', () => {
    const buffer = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      dibSize: 56,
      rows: [
        [
          [1, 2, 3, 0],
          [4, 5, 6, 128],
        ],
      ],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([1, 2, 3, 0, 4, 5, 6, 128]);
  });

  it('treats 32-bit BI_BITFIELDS as opaque when the mask block has no alpha DWORD', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      rows: [[[7, 8, 9, 0]]],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([7, 8, 9, 255]);
  });

  it('maps a zeroed channel mask to a zero channel instead of dividing by zero', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      masks: [0, 0x0000ff00, 0x000000ff, 0xff000000],
      rows: [[[200, 130, 60, 255]]],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([0, 130, 60, 255]);
  });

  it.each([
    {
      label: 'an 8-bit palette',
      spec: {
        width: 4,
        height: 1,
        bitsPerPixel: 8,
        colorsUsed: 4,
        palette: [
          [255, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
          [255, 255, 0],
        ],
        indices: [[3, 2, 1, 0]],
      },
      expected: [255, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255],
    },
    {
      label: 'a 4-bit palette',
      spec: {
        width: 4,
        height: 1,
        bitsPerPixel: 4,
        colorsUsed: 16,
        palette: Array.from({ length: 16 }, (_, index) => [index * 16, 0, 0]),
        indices: [[1, 2, 3, 4]],
      },
      expected: [16, 0, 0, 255, 32, 0, 0, 255, 48, 0, 0, 255, 64, 0, 0, 255],
    },
    {
      label: 'a 1-bit monochrome palette',
      spec: {
        width: 8,
        height: 1,
        bitsPerPixel: 1,
        colorsUsed: 2,
        palette: [
          [0, 0, 0],
          [255, 255, 255],
        ],
        indices: [[0, 1, 0, 1, 1, 0, 1, 0]],
      },
      expected: [
        0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255,
        255, 255, 0, 0, 0, 255,
      ],
    },
  ] satisfies { label: string; spec: BmpSpec; expected: number[] }[])('decodes $label image', ({ spec, expected }) => {
    const decoded = decodeBmp(buildBmp(spec));

    expect(Array.from(decoded.data)).toEqual(expected);
  });

  it('expands the palette to a full 2^bpp table when colorsUsed is zero', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 1,
      palette: [
        [11, 22, 33],
        [44, 55, 66],
      ],
      indices: [[1]],
    });

    expect(Array.from(decodeBmp(buffer).data)).toEqual([44, 55, 66, 255]);
  });

  it('rejects an index that falls outside the declared palette', () => {
    const buffer = buildBmp({
      width: 2,
      height: 1,
      bitsPerPixel: 8,
      colorsUsed: 2,
      palette: [
        [1, 1, 1],
        [2, 2, 2],
      ],
      indices: [[0, 9]],
    });

    expect(() => decodeBmp(buffer)).toThrow('Invalid BMP palette index');
  });
});

describe('BMP decoding error paths', () => {
  it('rejects buffers with an invalid BMP signature', () => {
    const view = makeBmpHeader();
    view.setUint16(0, 0x0000, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Invalid BMP signature');
  });

  it('rejects a buffer that cannot even hold the 54-byte header', () => {
    expect(() => decodeBmp(new ArrayBuffer(53))).toThrow('Invalid BMP file');
  });

  it('rejects headers smaller than the BITMAPINFOHEADER minimum', () => {
    const view = makeBmpHeader();
    view.setUint32(14, 20, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP header');
  });

  it('rejects a DIB header that runs past the end of the file', () => {
    const view = makeBmpHeader();
    view.setUint32(14, 4096, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Invalid BMP file');
  });

  it.each([
    ['a zero width', (view: DataView) => view.setInt32(18, 0, true)],
    ['a negative width', (view: DataView) => view.setInt32(18, -4, true)],
    ['a zero height', (view: DataView) => view.setInt32(22, 0, true)],
    ['a plane count other than one', (view: DataView) => view.setUint16(26, 0, true)],
  ])('rejects %s', (_label, corrupt) => {
    const view = makeBmpHeader();
    corrupt(view);
    expect(() => decodeBmp(view.buffer)).toThrow('Invalid BMP dimensions');
  });

  it.each([10_000, -10_000])('rejects over-budget dimensions before reading pixels (%i height)', (rawHeight) => {
    const view = makeBmpHeader();
    view.setInt32(18, 10_001, true);
    view.setInt32(22, rawHeight, true);

    expect(() => decodeBmp(view.buffer)).toThrow(
      'BMP image is too large to open (10001×10000). Maximum is 100000000 pixels.'
    );
  });

  it.each([0, 2, 15, 48])('rejects the unsupported color depth %i', (bitsPerPixel) => {
    const view = makeBmpHeader();
    view.setUint16(28, bitsPerPixel, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP color depth');
  });

  it.each([
    ['RLE8', 1, 1],
    ['RLE4', 2, 4],
    ['JPEG', 4, 24],
    ['PNG', 5, 32],
    ['ALPHABITFIELDS', 6, 32],
  ])('rejects the %s compression mode', (_label, compression, bitsPerPixel) => {
    const view = makeBmpHeader();
    view.setUint16(28, bitsPerPixel, true);
    view.setUint32(30, compression, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP compression');
  });

  it('rejects BI_BITFIELDS on colour depths that carry no masks', () => {
    const view = makeBmpHeader();
    view.setUint16(28, 24, true);
    view.setUint32(30, 3, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP compression');
  });

  it('rejects a BI_BITFIELDS mask block that runs past the end of the file', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      rows: [[[1, 2, 3, 255]]],
      truncate: 8,
    });
    expect(() => decodeBmp(buffer)).toThrow('Invalid BMP file');
  });

  it('rejects a pixel array that is shorter than the declared geometry', () => {
    const buffer = buildBmp({
      width: 8,
      height: 8,
      bitsPerPixel: 32,
      rows: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => [1, 2, 3, 255])),
      truncate: 64,
    });
    expect(() => decodeBmp(buffer)).toThrow('Invalid BMP file');
  });

  it('rejects a palette that runs past the end of the file', () => {
    const buffer = buildBmp({
      width: 1,
      height: 1,
      bitsPerPixel: 8,
      colorsUsed: 256,
      indices: [[0]],
      truncate: 1000,
    });
    expect(() => decodeBmp(buffer)).toThrow('Invalid BMP file');
  });
});

describe('loadBmpFile', () => {
  it('rejects loadBmpFile when the buffer is not a valid BMP', async () => {
    const view = makeBmpHeader();
    view.setUint16(0, 0x0000, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    await expect(loadBmpFile(blob)).rejects.toThrow('Invalid BMP signature');
  });

  it('rasterises the decoded pixels onto a canvas and resolves the image', async () => {
    const data = gradient(3, 2);
    const bmp = await (await encodeBmp(canvasOf(3, 2, data))).arrayBuffer();
    // Installed after `canvasOf` so the per-canvas getContext spy cannot shadow the
    // prototype spy that `imageDataToImage` relies on.
    installImageHarness();

    const pending = loadBmpFile(new Blob([bmp], { type: 'image/bmp' }));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));

    await expect(pending).resolves.toBe(imageStub);
    const image = putImageData.mock.calls[0][0];
    expect([image.width, image.height]).toEqual([3, 2]);
    expect(Array.from(image.data)).toEqual(Array.from(data));
  });

  it('rejects when the decoded image has no usable dimensions', async () => {
    installImageHarness();
    const view = makeBmpHeader();
    view.setInt32(18, 0, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    await expect(loadBmpFile(blob)).rejects.toThrow('Invalid BMP dimensions');
  });

  it('rejects oversized BMP dimensions before buffering the full file', async () => {
    installImageHarness();
    const view = makeBmpHeader();
    const width = 10_001;
    const height = Math.ceil(MAX_CREATABLE_DOCUMENT_PIXELS / width) + 1;
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    const fullFileRead = vi.spyOn(blob, 'arrayBuffer');

    await expect(loadBmpFile(blob)).rejects.toThrow('BMP image is too large to open');
    expect(fullFileRead).not.toHaveBeenCalled();
    expect(imageStub).toBeNull();
  });

  it('reads only the BMP header and pixel bytes when the file has a large trailing payload', async () => {
    const bmp = buildBmp({
      width: 2,
      height: 2,
      bitsPerPixel: 24,
      rows: [
        [
          [10, 20, 30],
          [40, 50, 60],
        ],
        [
          [70, 80, 90],
          [100, 110, 120],
        ],
      ],
    });
    const blob = new Blob([bmp, new Uint8Array(1024 * 1024)], { type: 'image/bmp' });
    const fullFileRead = vi.spyOn(blob, 'arrayBuffer');
    const fileSlice = vi.spyOn(blob, 'slice');
    installImageHarness();

    const pending = loadBmpFile(blob);
    await vi.waitFor(() => expect(imageStub).not.toBeNull());
    imageStub!.onload!.call(imageStub!, new Event('load'));
    await expect(pending).resolves.toBe(imageStub);

    expect(fullFileRead).not.toHaveBeenCalled();
    expect(fileSlice).toHaveBeenLastCalledWith(0, bmp.byteLength, 'image/bmp');
  });

  it('rejects a huge BMP pixel offset before reading the file payload', async () => {
    const view = makeBmpHeader();
    view.setUint32(10, 2 * 1024 * 1024, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    const fullFileRead = vi.spyOn(blob, 'arrayBuffer');

    await expect(loadBmpFile(blob)).rejects.toThrow('BMP pixel data offset is too large');
    expect(fullFileRead).not.toHaveBeenCalled();
  });

  it('rejects an impossible color palette before reading the file payload', async () => {
    const view = makeBmpHeader();
    view.setUint16(28, 8, true);
    view.setUint32(46, 257, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    const fullFileRead = vi.spyOn(blob, 'arrayBuffer');

    await expect(loadBmpFile(blob)).rejects.toThrow('Invalid BMP palette');
    const directBuffer = new ArrayBuffer(62);
    new Uint8Array(directBuffer).set(new Uint8Array(view.buffer));
    expect(() => decodeBmp(directBuffer)).toThrow('Invalid BMP palette');
    expect(fullFileRead).not.toHaveBeenCalled();
  });

  it('allows a bounded worst-case RLE8 payload up to the document pixel limit', async () => {
    const width = 10_000;
    const height = 1_000;
    const pixelOffset = 14 + 40 + 256 * 4;
    const compressedBytes = width * height * 2 + height * 2 + 2;
    const fileSize = pixelOffset + compressedBytes;
    const header = new Uint8Array(54);
    const view = new DataView(header.buffer);
    view.setUint16(0, 0x4d42, true);
    view.setUint32(2, fileSize, true);
    view.setUint32(10, pixelOffset, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 8, true);
    view.setUint32(30, 1, true);
    view.setUint32(34, compressedBytes, true);
    view.setUint32(46, 256, true);
    const headerBlob = new Blob([header], { type: 'image/bmp' });
    const boundedBlob = new Blob([], { type: 'image/bmp' });
    const slice = vi.fn((_start: number, end: number) => (end === 54 ? headerBlob : boundedBlob));
    const file = { size: fileSize, type: 'image/bmp', slice } as unknown as Blob;

    await expect(preflightBmpFile(file, { allowNativeCompression: true })).resolves.toBe(boundedBlob);
    expect(slice).toHaveBeenNthCalledWith(1, 0, 54);
    expect(slice).toHaveBeenNthCalledWith(2, 0, fileSize, 'image/bmp');
  });
});

describe('preflightBmpFile BI_ALPHABITFIELDS', () => {
  it.each([40, 52, 56, 108, 124])('accepts a %i-byte DIB header with an alpha mask', async (dibSize) => {
    const blob = new Blob(
      [
        buildBmp({
          width: 1,
          height: 1,
          bitsPerPixel: 32,
          compression: 6,
          dibSize,
          rows: [[[1, 2, 3, 255]]],
        }),
      ],
      { type: 'image/bmp' }
    );

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).resolves.toBeInstanceOf(Blob);
  });

  it('accepts 16-bit alpha bitfields with four external masks', async () => {
    const blob = new Blob([buildBmp({ width: 1, height: 1, bitsPerPixel: 16, compression: 6, rows: [[0x8001]] })], {
      type: 'image/bmp',
    });

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).resolves.toBeInstanceOf(Blob);
  });

  it('rejects alpha bitfields at color depths other than 16 or 32 bits', async () => {
    const blob = new Blob([buildBmp({ width: 1, height: 1, bitsPerPixel: 24, compression: 6, rows: [[[1, 2, 3]]] })], {
      type: 'image/bmp',
    });

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).rejects.toThrow(
      'Unsupported BMP compression'
    );
  });

  it.each([41, 51, 53, 55])('rejects an unsupported %i-byte alpha bitfields header', async (dibSize) => {
    const blob = new Blob(
      [buildBmp({ width: 1, height: 1, bitsPerPixel: 32, compression: 6, dibSize, rows: [[[1, 2, 3, 255]]] })],
      { type: 'image/bmp' }
    );

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).rejects.toThrow(
      'Unsupported BMP alpha bitfields header'
    );
  });

  it.each([40, 52, 56])('rejects a %i-byte DIB header without an alpha mask', async (dibSize) => {
    const blob = new Blob(
      [
        buildBmp({
          width: 1,
          height: 1,
          bitsPerPixel: 32,
          compression: 6,
          dibSize,
          masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0],
          rows: [[[1, 2, 3, 255]]],
        }),
      ],
      { type: 'image/bmp' }
    );

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).rejects.toThrow(
      'Invalid BMP alpha bitfield mask'
    );
  });

  it.each([40, 52, 56])('rejects a truncated %i-byte DIB alpha mask', async (dibSize) => {
    const blob = new Blob(
      [
        buildBmp({
          width: 1,
          height: 1,
          bitsPerPixel: 32,
          compression: 6,
          dibSize,
          rows: [[[1, 2, 3, 255]]],
          truncate: 5,
        }),
      ],
      { type: 'image/bmp' }
    );

    await expect(preflightBmpFile(blob, { allowNativeCompression: true })).rejects.toThrow();
  });

  it('keeps alpha bitfields disabled unless native compression is allowed', async () => {
    const blob = new Blob(
      [
        buildBmp({
          width: 1,
          height: 1,
          bitsPerPixel: 32,
          compression: 6,
          dibSize: 56,
          rows: [[[1, 2, 3, 255]]],
        }),
      ],
      { type: 'image/bmp' }
    );

    await expect(preflightBmpFile(blob)).rejects.toThrow('Unsupported BMP compression');
  });
});
