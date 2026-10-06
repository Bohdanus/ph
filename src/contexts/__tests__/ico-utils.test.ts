import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeIco, loadIcoFile } from '../ico-utils.ts';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A PNG whose IHDR chunk carries a real geometry, so `loadIcoFile`'s pre-decode check has something
 * to read: 8 signature bytes, a 4-byte chunk length, the `IHDR` type, then the two 4-byte
 * big-endian dimensions. The rest of the payload is filler — nothing decodes these bytes in jsdom,
 * and the point of the check is that it never gets that far.
 */
function pngOf(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set(PNG_SIGNATURE, 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}
const ICO_HEADER_SIZE = 6;
const ICO_DIRECTORY_ENTRY_SIZE = 16;

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
   * A real decode always reports a positive natural size, and the ICO fixtures below are declared
   * as 4×4 entries, so that is the default. A stub that left these `undefined` would be refused by
   * `assertWithinMaxEdge`'s integer test — which is the point: the PNG branch reads its geometry
   * from here, so the stub has to answer with one.
   */
  naturalWidth = 4;
  naturalHeight = 4;
  constructor() {
    recordImage(this as unknown as HTMLImageElement);
  }
}

/**
 * `loadIcoFile` funnels both container branches through `raster-utils.imageDataToImage`,
 * which needs a pixel-capable canvas context, `toDataURL` and an `Image` that fires
 * `onload`. jsdom supplies none of them, so the harness observes the exact `ImageData`
 * the decoder produced instead of re-deriving it from the fixture.
 */
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Drives a PNG entry all the way through the browser: `loadIcoFile` cannot settle until `onload`
 * fires, and the geometry it then reports has to be in place *before* that, because the ceiling is
 * read off the element rather than off the container.
 */
async function resolvePngIco(
  ico: Uint8Array<ArrayBuffer>,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined
): Promise<HTMLImageElement> {
  const pending = loadIcoFile(new Blob([ico]));
  await vi.waitFor(() => expect(imageStub).not.toBeNull());
  Object.assign(imageStub!, { naturalWidth, naturalHeight });
  imageStub!.onload!.call(imageStub!, new Event('load'));
  return pending;
}

async function resolveIco(ico: Uint8Array<ArrayBuffer>): Promise<HTMLImageElement> {
  const pending = loadIcoFile(new Blob([ico]));
  await vi.waitFor(() => expect(imageStub).not.toBeNull());
  imageStub!.onload!.call(imageStub!, new Event('load'));
  return pending;
}

async function decodeIco(ico: Uint8Array<ArrayBuffer>): Promise<ImageData> {
  await resolveIco(ico);
  expect(putImageData).toHaveBeenCalledTimes(1);
  return putImageData.mock.calls[0][0];
}

type IconRow = { rgba: number[]; indices?: number[]; transparent?: boolean[] };

/** Builds the DIB payload that sits inside a single ICO directory entry. */
function buildDib(options: {
  width: number;
  height: number;
  rows: IconRow[];
  bitsPerPixel?: number;
  compression?: number;
  dibSize?: number;
  maskBytes?: number;
  colorsUsed?: number;
  palette?: number[][];
  masks?: number[];
  /** Bytes of slack after the AND mask, so an entry is long enough for a wider mask block. */
  trailingBytes?: number;
}): Uint8Array<ArrayBuffer> {
  const { width, height, rows } = options;
  const bitsPerPixel = options.bitsPerPixel ?? 32;
  const compression = options.compression ?? 0;
  const dibSize = options.dibSize ?? 40;
  const maskBytes = options.maskBytes ?? 0;
  const palette = options.palette ?? [];
  const colorsUsed = options.colorsUsed ?? (bitsPerPixel <= 8 ? 1 << bitsPerPixel : 0);
  const trailingBytes = options.trailingBytes ?? 0;
  const pixelDataOffset = dibSize + maskBytes + colorsUsed * 4;
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const maskStride = Math.ceil(width / 8) * 4;
  const buffer = new ArrayBuffer(pixelDataOffset + rowStride * height + maskStride * height + trailingBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, dibSize, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, bitsPerPixel, true);
  view.setUint32(16, compression, true);
  view.setUint32(20, rowStride * height, true);
  view.setUint32(24, 2835, true);
  view.setUint32(28, 2835, true);
  view.setUint32(32, options.colorsUsed ?? 0, true);

  if (maskBytes >= 12 || dibSize >= 52) {
    const masks = options.masks ?? [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000];
    view.setUint32(40, masks[0], true);
    view.setUint32(44, masks[1], true);
    view.setUint32(48, masks[2], true);
    if (maskBytes >= 16 || dibSize >= 56) view.setUint32(52, masks[3], true);
  }

  palette.forEach((color, index) => {
    const at = dibSize + maskBytes + index * 4;
    bytes[at] = color[2];
    bytes[at + 1] = color[1];
    bytes[at + 2] = color[0];
    bytes[at + 3] = 0;
  });

  for (let y = 0; y < height; y++) {
    const row = rows[height - 1 - y];
    for (let x = 0; x < width; x++) {
      const at = pixelDataOffset + y * rowStride;
      const source = x * 4;
      if (bitsPerPixel >= 24) {
        const pixel = bitsPerPixel === 32 ? x * 4 : x * 3;
        bytes[at + pixel] = row.rgba[source + 2];
        bytes[at + pixel + 1] = row.rgba[source + 1];
        bytes[at + pixel + 2] = row.rgba[source];
        if (bitsPerPixel === 32) bytes[at + pixel + 3] = row.rgba[source + 3];
      } else if (bitsPerPixel === 16) {
        view.setUint16(
          at + x * 2,
          ((row.rgba[source] >> 3) << 10) | ((row.rgba[source + 1] >> 3) << 5) | (row.rgba[source + 2] >> 3),
          true
        );
      } else if (bitsPerPixel === 8) {
        bytes[at + x] = row.indices![x];
      } else if (bitsPerPixel === 4) {
        bytes[at + Math.floor(x / 2)] |= (row.indices![x] & 0x0f) << (x % 2 === 0 ? 4 : 0);
      } else {
        bytes[at + Math.floor(x / 8)] |= (row.indices![x] & 1) << (7 - (x % 8));
      }
    }
  }

  for (let y = 0; y < height; y++) {
    const row = rows[height - 1 - y];
    for (let x = 0; x < width; x++) {
      if (row.transparent?.[x]) {
        bytes[pixelDataOffset + rowStride * height + y * maskStride + Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
    }
  }

  return bytes;
}

function buildIco(
  entries: { width: number; height: number; data: Uint8Array<ArrayBuffer> }[]
): Uint8Array<ArrayBuffer> {
  const offsets: number[] = [];
  let total = ICO_HEADER_SIZE + entries.length * ICO_DIRECTORY_ENTRY_SIZE;
  for (const entry of entries) {
    offsets.push(total);
    total += entry.data.length;
  }
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  entries.forEach((entry, index) => {
    const at = ICO_HEADER_SIZE + index * ICO_DIRECTORY_ENTRY_SIZE;
    bytes[at] = entry.width % 256;
    bytes[at + 1] = entry.height % 256;
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.data.length, true);
    view.setUint32(at + 12, offsets[index], true);
    bytes.set(entry.data, offsets[index]);
  });
  return bytes;
}

function icon(dib: Uint8Array<ArrayBuffer>, width: number, height: number) {
  return buildIco([{ width, height, data: dib }]);
}

function canvasOf(width: number, height: number, png = new Blob(['png'], { type: 'image/png' })) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(png));
  return canvas;
}

describe('ICO encoding', () => {
  it('embeds the canvas PNG in an ICO container', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(png));

    const blob = await encodeIco(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe('image/x-icon');
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(1);
    expect(bytes[6]).toBe(32);
    expect(bytes[7]).toBe(24);
    expect(view.getUint32(14, true)).toBe(3);
    expect(view.getUint32(18, true)).toBe(22);
    expect([...bytes.slice(22)]).toEqual([112, 110, 103]);
  });

  it('stores a zero dimension byte for the 256 pixel ICO maximum', async () => {
    const blob = await encodeIco(canvasOf(256, 256));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(bytes[6]).toBe(0);
    expect(bytes[7]).toBe(0);
    expect(new DataView(bytes.buffer).getUint32(18, true)).toBe(ICO_HEADER_SIZE + ICO_DIRECTORY_ENTRY_SIZE);
  });

  it.each([
    { width: 257, height: 1 },
    { width: 1, height: 257 },
    { width: 512, height: 512 },
  ])('rejects a $width x $height canvas', async ({ width, height }) => {
    await expect(encodeIco(canvasOf(width, height))).rejects.toThrow('ICO dimensions cannot exceed 256 pixels');
  });

  it.each([
    { width: 0, height: 1 },
    { width: 1, height: 0 },
  ])('rejects a degenerate $width x $height canvas', async ({ width, height }) => {
    // A zero axis is not an over-large one, so it gets its own message: "cannot exceed 256
    // pixels" is false of a 0-pixel-wide canvas and tells the reader nothing about which half of
    // the guard fired.
    await expect(encodeIco(canvasOf(width, height))).rejects.toThrow(
      `ICO image has invalid dimensions to save (${width}×${height})`
    );
  });

  it.each([
    { width: 257, height: 1 },
    { width: 1, height: 257 },
    { width: 10000, height: 10000 },
  ])('refuses a $width x $height canvas without PNG-encoding it first', async ({ width, height }) => {
    // `canvasToPngBlob` rasterises the whole canvas through `toBlob`, so a guard that runs after
    // it has already paid for — and allocated — the encode of a raster it is about to refuse. On
    // the 10000×10000 case that is a full PNG encode of 400 MP before the throw.
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const toBlob = vi.fn().mockImplementation((callback: BlobCallback) => callback(png));
    vi.spyOn(canvas, 'toBlob').mockImplementation(toBlob);

    await expect(encodeIco(canvas)).rejects.toThrow('ICO dimensions cannot exceed 256 pixels');
    expect(toBlob).not.toHaveBeenCalled();
  });
});

describe('ICO decoding of 32-bit DIB entries', () => {
  /** Two rows of four distinct pixels, with an AND-mask hole punched in the top-right one. */
  const maskedRows: IconRow[] = [
    { rgba: [10, 20, 30, 255, 40, 50, 60, 255], transparent: [false, true] },
    { rgba: [70, 80, 90, 255, 100, 110, 120, 255] },
  ];
  const maskedPixels = [10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 255, 100, 110, 120, 255];

  it('decodes BI_BITFIELDS pixels and applies the 1-bit AND mask as transparency', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [10, 20, 30, 255, 200, 100, 50, 255], transparent: [true, false] }],
    });

    const image = await decodeIco(icon(dib, 2, 1));

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(Array.from(image.data)).toEqual([10, 20, 30, 0, 200, 100, 50, 255]);
  });

  it('flips the bottom-up XOR rows of a multi-row icon', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [1, 2, 3, 255, 4, 5, 6, 255] }, { rgba: [7, 8, 9, 255, 10, 11, 12, 255] }],
    });

    expect(Array.from((await decodeIco(icon(dib, 2, 2))).data)).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
    ]);
  });

  it('reads the alpha channel mask out of a 56-byte DIB header', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      dibSize: 56,
      rows: [{ rgba: [9, 8, 7, 0] }],
    });

    expect(Array.from((await decodeIco(icon(dib, 1, 1))).data)).toEqual([9, 8, 7, 0]);
  });

  it('falls back to opaque alpha when the mask block carries no alpha DWORD', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 12,
      rows: [{ rgba: [5, 6, 7, 128] }],
    });

    // 12 mask bytes is the spec-minimal block: three RGB DWORDs and no alpha DWORD, so
    // `decodeBmp` leaves the channel opaque however the pixel itself was authored. The entry
    // is exactly sized, so only the 12-byte reading leaves room for the XOR row and the AND
    // mask row that follow it.
    expect(Array.from((await decodeIco(icon(dib, 1, 1))).data)).toEqual([5, 6, 7, 255]);
  });

  it('decodes a 32-bit DIB whose mask block is the spec-legal 12-byte RGB-only form', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 12,
      // Padding the 16-byte reading cannot use: the AND mask needs 8 bytes after the XOR
      // block, so reading that block 4 bytes late wants 80 against an entry of 79. A decoder
      // that assumes the optional alpha DWORD therefore reads trailing padding as the head of
      // the XOR block, which displaces the pixels by a whole pixel and walks the AND mask off
      // the scanlines it belongs to.
      trailingBytes: 3,
      rows: maskedRows,
    });

    const image = await decodeIco(icon(dib, 2, 2));

    expect([image.width, image.height]).toEqual([2, 2]);
    expect(Array.from(image.data)).toEqual(maskedPixels);
  });

  it('keeps reading the 16-byte mask block when the entry is long enough for both forms', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      // Both readings fit now, so nothing but the 4-byte extent separates them. Preferring
      // the narrower block would shift this icon by a pixel. The alpha DWORD is written at
      // 52..55 either way; `decodeBmp` keys it off `dibSize >= 56`, which an ICO's 40-byte
      // DIB header never satisfies, so what this asserts is the offset and not the channel.
      trailingBytes: 8,
      rows: maskedRows,
    });

    const image = await decodeIco(icon(dib, 2, 2));

    expect(Array.from(image.data)).toEqual(maskedPixels);
  });
});

describe('ICO decoding of legacy colour depths', () => {
  it('decodes an 8-bit palette icon', async () => {
    installImageHarness();
    const dib = buildDib({
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
      rows: [{ rgba: new Array(16).fill(0), indices: [3, 2, 1, 0] }],
    });

    const image = await decodeIco(icon(dib, 4, 1));

    expect([image.width, image.height]).toEqual([4, 1]);
    expect(Array.from(image.data)).toEqual([255, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);
  });

  it('decodes a 1-bit monochrome icon', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 8,
      height: 1,
      bitsPerPixel: 1,
      colorsUsed: 2,
      palette: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      rows: [{ rgba: new Array(32).fill(0), indices: [0, 1, 0, 1, 1, 0, 1, 0] }],
    });

    const image = await decodeIco(icon(dib, 8, 1));

    expect(image.width).toBe(8);
    expect(Array.from(image.data)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255,
      255, 255, 0, 0, 0, 255,
    ]);
  });

  it('decodes a 4-bit palette icon', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 4,
      height: 1,
      bitsPerPixel: 4,
      colorsUsed: 16,
      palette: Array.from({ length: 16 }, (_, index) => [index * 16, 0, 0]),
      rows: [{ rgba: new Array(16).fill(0), indices: [1, 2, 3, 4] }],
    });

    expect(Array.from((await decodeIco(icon(dib, 4, 1))).data)).toEqual([
      16, 0, 0, 255, 32, 0, 0, 255, 48, 0, 0, 255, 64, 0, 0, 255,
    ]);
  });

  it('decodes a 24-bit BI_RGB icon', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 1,
      bitsPerPixel: 24,
      rows: [{ rgba: [10, 20, 30, 255, 200, 100, 50, 255] }],
    });

    expect(Array.from((await decodeIco(icon(dib, 2, 1))).data)).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);
  });

  it('decodes a 16-bit BI_BITFIELDS icon through the RGB 565 masks', async () => {
    installImageHarness();
    const dib = buildDib({
      width: 2,
      height: 1,
      bitsPerPixel: 16,
      compression: 3,
      maskBytes: 12,
      masks: [0x7c00, 0x03e0, 0x001f],
      rows: [{ rgba: [255, 0, 0, 255, 0, 255, 0, 255] }],
    });

    expect(Array.from((await decodeIco(icon(dib, 2, 1))).data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
});

describe('ICO directory selection', () => {
  it('decodes the largest entry rather than the first one', async () => {
    installImageHarness();
    const small = buildDib({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [1, 2, 3, 255] }],
    });
    const large = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [9, 9, 9, 255, 8, 8, 8, 255] }, { rgba: [7, 7, 7, 255, 6, 6, 6, 255] }],
    });

    const image = await decodeIco(
      buildIco([
        { width: 1, height: 1, data: small },
        { width: 2, height: 2, data: large },
      ])
    );

    expect([image.width, image.height]).toEqual([2, 2]);
    expect(Array.from(image.data)).toEqual([9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255, 6, 6, 6, 255]);
  });

  it('ranks a zero dimension byte as 256 so it outranks a smaller declared entry', async () => {
    installImageHarness();
    const declaredAs256 = buildDib({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [3, 3, 3, 255] }],
    });
    const twoByTwo = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [4, 4, 4, 255, 5, 5, 5, 255] }, { rgba: [6, 6, 6, 255, 7, 7, 7, 255] }],
    });

    // 0x00 in a directory entry means 256, not 0: if the decoder read it as 0 the
    // 1x1 payload would lose to the 2x2 entry on area.
    const image = await decodeIco(
      buildIco([
        { width: 0, height: 0, data: declaredAs256 },
        { width: 2, height: 2, data: twoByTwo },
      ])
    );

    expect(Array.from(image.data)).toEqual([3, 3, 3, 255]);
  });
});

describe('ICO PNG-compressed entries', () => {
  it('hands the embedded PNG to the browser through an object URL and revokes it', async () => {
    installImageHarness();
    const png = new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]);

    const image = await resolveIco(icon(png, 4, 4));

    expect(image).toBe(imageStub);
    const [source] = vi.mocked(URL.createObjectURL).mock.calls[0] as [Blob];
    expect(source.type).toBe('image/png');
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(png);
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledExactlyOnceWith('blob:mock-url');
  });

  it('rejects and still revokes the object URL when the browser cannot decode the PNG', async () => {
    installImageHarness();
    const pending = loadIcoFile(new Blob([icon(new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]), 4, 4)]));
    await vi.waitFor(() => expect(imageStub).not.toBeNull());

    imageStub!.onerror!.call(imageStub!, new Event('error'));

    await expect(pending).rejects.toThrow('Failed to decode ICO image');
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledExactlyOnceWith('blob:mock-url');
  });

  it('refuses a PNG entry the encoder would then reject, closing the same asymmetry on this branch', async () => {
    // A DIB declares its geometry in a header this module parses, so it can be checked before the
    // decode. A PNG entry does not: the only geometry is what the browser reports after it has
    // already decoded. Leaving that unchecked is how a 512×512 PNG icon — what most tools emit at
    // and above 256 — opens here and is then refused by `Save as ICO`.
    installImageHarness();
    const png = new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]);
    const pending = resolvePngIco(icon(png, 4, 4), 512, 512);

    await expect(pending).rejects.toThrow('ICO image is too large to open (512×512)');
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledExactlyOnceWith('blob:mock-url');
  });

  it('refuses an over-large PNG entry before the browser decodes it', async () => {
    // The post-`onload` check is the authority but it is too late to bound anything: the raster is
    // already allocated by the time `naturalWidth` exists. A 4096×4096 entry is a ~2-6 MB file and
    // 67 MB of RGBA, so the geometry has to be read out of the entry's own bytes — which is what
    // IHDR is — before the blob URL is created at all.
    installImageHarness();
    const pending = loadIcoFile(new Blob([icon(pngOf(4096, 4096), 4, 4)]));

    await expect(pending).rejects.toThrow('ICO image is too large to open (4096×4096)');
    expect(imageStub).toBeNull();
    expect(vi.mocked(URL.createObjectURL)).not.toHaveBeenCalled();
  });

  it('accepts a PNG entry on its declared IHDR geometry, without reaching the browser', async () => {
    installImageHarness();
    const pending = resolvePngIco(icon(pngOf(64, 48), 64, 48), 64, 48);

    await expect(pending).resolves.toBeInstanceOf(ImageStub);
  });

  it('falls back on the browser-reported geometry when the IHDR is unreadable', async () => {
    // A PNG whose first chunk is not IHDR is malformed, and refusing to guess is the decoder's job:
    // the guard declines to read it and the post-`onload` check still applies. Here the stub reports
    // 512×512, so the post-`onload` check is what refuses — the pre-check never spoke.
    installImageHarness();
    const notIhdr = new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]);
    const pending = resolvePngIco(icon(notIhdr, 4, 4), 512, 512);

    await expect(pending).rejects.toThrow('ICO image is too large to open (512×512)');
  });

  it.each([
    { label: 'both axes', naturalWidth: undefined, naturalHeight: undefined },
    { label: 'the width alone', naturalWidth: undefined, naturalHeight: 4 },
    { label: 'the height alone', naturalWidth: 4, naturalHeight: undefined },
  ])(
    'refuses a PNG entry with $label unreadable, rather than assuming it is small',
    async ({ naturalWidth, naturalHeight }) => {
      // `undefined < 1` and `undefined > 256` are both false, so a range-only guard waves an
      // unreadable geometry through and the document reaches the Save dialog unchecked. Each axis
      // has to be caught on its own, or dropping one of the two comparisons is invisible.
      installImageHarness();
      const pending = resolvePngIco(
        icon(new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]), 4, 4),
        naturalWidth,
        naturalHeight
      );

      await expect(pending).rejects.toThrow('ICO image has invalid dimensions to open');
    }
  );

  it('accepts a PNG entry sitting exactly on the ICO maximum', async () => {
    installImageHarness();
    const png = new Uint8Array([...PNG_SIGNATURE, 0x0a, 0x0a]);

    await expect(resolvePngIco(icon(png, 256, 256), 256, 256)).resolves.toBeInstanceOf(ImageStub);
  });
});

describe('ICO malformed container input', () => {
  it.each([
    ['a buffer shorter than the 22-byte header', new Uint8Array(21), 'Invalid ICO file'],
    [
      'a non-zero reserved field',
      (() => {
        const bytes = icon(new Uint8Array([1, 2, 3, 4]), 1, 1);
        new DataView(bytes.buffer).setUint16(0, 1, true);
        return bytes;
      })(),
      'Invalid ICO header',
    ],
    [
      'a non-icon type',
      (() => {
        const bytes = icon(new Uint8Array([1, 2, 3, 4]), 1, 1);
        new DataView(bytes.buffer).setUint16(2, 2, true);
        return bytes;
      })(),
      'Invalid ICO header',
    ],
    [
      'an empty directory',
      (() => {
        const bytes = icon(new Uint8Array([1, 2, 3, 4]), 1, 1);
        new DataView(bytes.buffer).setUint16(4, 0, true);
        return bytes;
      })(),
      'Invalid ICO header',
    ],
    [
      'a directory that runs past the end of the file',
      (() => {
        const bytes = icon(new Uint8Array([1, 2, 3, 4]), 1, 1);
        new DataView(bytes.buffer).setUint16(4, 64, true);
        return bytes;
      })(),
      'Invalid ICO file',
    ],
    [
      'an image offset or size that runs past the end of the file',
      (() => {
        const bytes = icon(new Uint8Array([1, 2, 3, 4]), 1, 1);
        new DataView(bytes.buffer).setUint32(14, 4096, true);
        return bytes;
      })(),
      'Invalid ICO file',
    ],
    ['an empty image payload', icon(new Uint8Array(0), 1, 1), 'Invalid ICO file'],
  ])('rejects %s', async (_label, bytes, message) => {
    await expect(loadIcoFile(new Blob([bytes]))).rejects.toThrow(message);
  });
});

describe('ICO malformed DIB entries', () => {
  const validDib = () =>
    buildDib({
      width: 1,
      height: 1,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [1, 2, 3, 255] }],
    });

  it.each([
    [
      'a DIB header smaller than BITMAPINFOHEADER',
      (dib: Uint8Array) => new DataView(dib.buffer).setUint32(0, 12, true),
    ],
    ['a zero width', (dib: Uint8Array) => new DataView(dib.buffer).setInt32(4, 0, true)],
    ['a zero doubled height', (dib: Uint8Array) => new DataView(dib.buffer).setInt32(8, 0, true)],
    ['a negative doubled height', (dib: Uint8Array) => new DataView(dib.buffer).setInt32(8, -2, true)],
    ['an odd doubled height', (dib: Uint8Array) => new DataView(dib.buffer).setInt32(8, 3, true)],
  ])('rejects %s', async (_label, corrupt) => {
    const dib = validDib();
    corrupt(dib);

    await expect(loadIcoFile(new Blob([icon(dib, 1, 1)]))).rejects.toThrow('Invalid ICO bitmap dimensions');
  });

  it.each([
    {
      axis: 'width',
      dib: () => buildDib({ width: 300, height: 1, rows: [{ rgba: new Array(1200).fill(255) }] }),
      entry: [300, 1],
    },
    {
      axis: 'height',
      dib: () =>
        buildDib({ width: 1, height: 300, rows: Array.from({ length: 300 }, () => ({ rgba: [1, 2, 3, 255] })) }),
      entry: [1, 300],
    },
  ])(
    'rejects a DIB whose $axis exceeds the ICO maximum, which Save as ICO would then refuse',
    async ({ dib, entry }) => {
      // A file that opens and then cannot be saved back is the round-trip asymmetry: `encodeIco`
      // enforces the 256 ceiling on the way out, and nothing on the way in enforced it here, so the
      // document reached the Save dialog already larger than the format it was about to be written
      // in. The two halves have to read the same number.
      await expect(loadIcoFile(new Blob([icon(dib(), entry[0], entry[1])]))).rejects.toThrow(
        'ICO image is too large to open'
      );
    }
  );

  it('still opens a DIB sitting exactly on the ICO maximum', async () => {
    // The ceiling is `> 256`, not `>= 256`: an ICO directory entry stores 256 as a zero byte, so
    // 256 is the format's own largest geometry and `encodeIco` writes it (its `width === 256 ? 0`
    // branch). A guard that refused it would make the largest legal icon unsavable.
    installImageHarness();
    const dib = buildDib({ width: 256, height: 1, rows: [{ rgba: new Array(1024).fill(255) }] });

    const image = await resolveIco(icon(dib, 256, 1));

    expect(image).toBe(imageStub);
  });

  it('rejects a DIB colour depth the BMP decoder behind it cannot read', async () => {
    const dib = validDib();
    new DataView(dib.buffer).setUint16(14, 7, true);

    await expect(loadIcoFile(new Blob([icon(dib, 1, 1)]))).rejects.toThrow('Invalid ICO file');
  });

  it('rejects a DIB whose pixel payload is truncated relative to its declared geometry', async () => {
    const dib = buildDib({
      width: 2,
      height: 2,
      bitsPerPixel: 32,
      compression: 3,
      maskBytes: 16,
      rows: [{ rgba: [1, 2, 3, 255, 4, 5, 6, 255] }, { rgba: [7, 8, 9, 255, 10, 11, 12, 255] }],
    });
    new DataView(dib.buffer).setInt32(4, 16, true);

    await expect(loadIcoFile(new Blob([icon(dib, 16, 16)]))).rejects.toThrow('Invalid ICO file');
  });
});
