import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeGif } from '../gif-utils.ts';

type GifBlock =
  | { kind: 'graphic-control'; packed: number; delay: number; transparentIndex: number }
  | { kind: 'application'; label: string }
  | {
      kind: 'image';
      left: number;
      top: number;
      width: number;
      height: number;
      packed: number;
      codeSize: number;
      lzw: number[];
    }
  | { kind: 'unknown-extension'; label: number };

type Gif = {
  signature: string;
  width: number;
  height: number;
  packed: number;
  backgroundIndex: number;
  aspectRatio: number;
  globalColorTable: number[][];
  blocks: GifBlock[];
  trailer: number;
};

function u16(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

/**
 * Minimal GIF89a reader. gifenc only encodes, so the only way to assert on the produced
 * bytes is to walk the container: header, logical screen descriptor, global colour table,
 * extension blocks, image descriptor and trailer.
 */
function parseGif(bytes: Uint8Array): Gif {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  const packed = bytes[10];
  const tableEntries = 2 ** ((packed & 0x07) + 1);
  const globalColorTable: number[][] = [];
  let cursor = 13;
  if (packed & 0x80) {
    for (let index = 0; index < tableEntries; index++) {
      globalColorTable.push([bytes[cursor], bytes[cursor + 1], bytes[cursor + 2]]);
      cursor += 3;
    }
  }

  const blocks: GifBlock[] = [];
  let trailer = -1;
  while (cursor < bytes.length) {
    const marker = bytes[cursor];
    if (marker === 0x3b) {
      trailer = marker;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[cursor + 1];
      if (label === 0xf9) {
        blocks.push({
          kind: 'graphic-control',
          packed: bytes[cursor + 3],
          delay: u16(bytes, cursor + 4),
          transparentIndex: bytes[cursor + 6],
        });
        cursor += 8;
        continue;
      }
      if (label === 0xff) {
        blocks.push({ kind: 'application', label: String.fromCharCode(...bytes.subarray(cursor + 3, cursor + 14)) });
      } else {
        blocks.push({ kind: 'unknown-extension', label });
      }
      cursor += 2;
      while (bytes[cursor] !== 0) cursor += bytes[cursor] + 1;
      cursor += 1;
      continue;
    }
    if (marker === 0x2c) {
      const imagePacked = bytes[cursor + 9];
      let code = cursor + 10;
      if (imagePacked & 0x80) code += 3 * 2 ** ((imagePacked & 0x07) + 1);
      // The palette indexes themselves are LZW-compressed behind the initial code size
      // byte, so the sub-blocks are collected here and decoded by `decodeIndices`.
      const lzw: number[] = [];
      let scan = code + 1;
      while (bytes[scan] !== 0) {
        const size = bytes[scan];
        for (let offset = 1; offset <= size; offset += 1) lzw.push(bytes[scan + offset]);
        scan += size + 1;
      }
      blocks.push({
        kind: 'image',
        left: u16(bytes, cursor + 1),
        top: u16(bytes, cursor + 3),
        width: u16(bytes, cursor + 5),
        height: u16(bytes, cursor + 7),
        packed: imagePacked,
        codeSize: bytes[code],
        lzw,
      });
      cursor = scan + 1;
      continue;
    }
    throw new Error(`Unexpected GIF block marker 0x${marker.toString(16)} at ${cursor}`);
  }

  return {
    signature,
    width: u16(bytes, 6),
    height: u16(bytes, 8),
    packed,
    backgroundIndex: bytes[11],
    aspectRatio: bytes[12],
    globalColorTable,
    blocks,
    trailer,
  };
}

/**
 * GIF LZW decoder, matched to the encoder in `gifenc/src/lzwEncode.js`: codes are packed
 * least-significant-bit first, the dictionary starts with `1 << codeSize` literal entries
 * and grows by one entry per emitted code until it reaches the next code-width boundary.
 * Decoding is what makes the palette indices themselves assertable — the container alone
 * only proves which entry was *declared* transparent, not which one the pixels use.
 */
function decodeIndices(image: Extract<GifBlock, { kind: 'image' }>): number[] {
  const minCodeSize = image.codeSize;
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = clear + 2;
  let dictionary: (number[] | undefined)[] = [];
  const reset = () => {
    dictionary = new Array(clear + 2);
    for (let literal = 0; literal < clear; literal += 1) dictionary[literal] = [literal];
    codeSize = minCodeSize + 1;
    next = clear + 2;
  };
  reset();

  const indices: number[] = [];
  let previous: number[] | null = null;
  let bit = 0;
  for (;;) {
    let code = 0;
    for (let order = 0; order < codeSize; order += 1, bit += 1) {
      code |= (((image.lzw[bit >> 3] ?? 0) >> (bit & 7)) & 1) << order;
    }
    if (code === end) return indices;
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    let entry = dictionary[code];
    if (!entry) {
      if (!previous || code !== next) throw new Error(`Unexpected LZW code ${code}`);
      entry = [...previous, previous[0]];
    }
    for (const value of entry) indices.push(value);
    if (previous) {
      dictionary[next] = [...previous, entry[0]];
      next += 1;
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }
}

function graphicControl(gif: Gif) {
  return gif.blocks.find((block) => block.kind === 'graphic-control') as Extract<GifBlock, { kind: 'graphic-control' }>;
}

function imageBlock(gif: Gif) {
  return gif.blocks.find((block) => block.kind === 'image') as Extract<GifBlock, { kind: 'image' }>;
}

async function encode(width: number, height: number, data: Uint8ClampedArray) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    getImageData: vi.fn(() => ({ data, width, height })),
  } as unknown as CanvasRenderingContext2D);
  const blob = await encodeGif(canvas);
  return parseGif(new Uint8Array(await blob.arrayBuffer()));
}

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = (index * 53) % 256;
    data[index * 4 + 1] = (index * 101 + 7) % 256;
    data[index * 4 + 2] = (index * 199 + 29) % 256;
    data[index * 4 + 3] = 255;
  }
  return data;
}

describe('GIF encoding', () => {
  it('encodes a canvas as a valid single-frame GIF with the expected signature', async () => {
    const context = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
        width: 2,
        height: 1,
      })),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const blob = await encodeGif(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe('image/gif');
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(20);
    expect(bytes.at(0)).toBe(0x47);
    expect(bytes.at(1)).toBe(0x49);
    expect(bytes.at(2)).toBe(0x46);
    expect(bytes.at(3)).toBe(0x38);
    expect(bytes.at(-1)).toBe(0x3b);
  });

  it('writes a logical screen descriptor and a global colour table', async () => {
    const gif = await encode(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));

    expect(gif.signature).toBe('GIF89a');
    expect([gif.width, gif.height]).toEqual([2, 1]);
    // Global colour table present, 8-bit colour resolution, unsorted.
    expect(gif.packed & 0x80).toBe(0x80);
    expect((gif.packed >> 4) & 0x07).toBe(0b111);
    expect((gif.packed >> 3) & 0x01).toBe(0);
    expect(gif.backgroundIndex).toBe(0);
    expect(gif.aspectRatio).toBe(0);
    expect(gif.globalColorTable).toHaveLength(2);
    // The quantizer's entry order is an implementation detail; the palette contents are not.
    expect(new Set(gif.globalColorTable.map((color) => color.join(',')))).toEqual(new Set(['0,255,0', '255,0,0']));
    expect(gif.trailer).toBe(0x3b);
  });

  it('writes exactly one image block with the canvas geometry and a local-table-free descriptor', async () => {
    const gif = await encode(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));

    const images = gif.blocks.filter((block) => block.kind === 'image');
    expect(images).toHaveLength(1);
    const [image] = images as Extract<GifBlock, { kind: 'image' }>[];
    expect([image.left, image.top, image.width, image.height]).toEqual([0, 0, 2, 1]);
    expect(image.packed & 0x80).toBe(0);
    expect(image.packed & 0x40).toBe(0);
    expect(image.codeSize).toBe(8);
    expect(gif.blocks.some((block) => block.kind === 'application' && block.label === 'NETSCAPE2.0')).toBe(true);
  });

  it('marks an opaque image with the transparency flag cleared', async () => {
    const gif = await encode(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]));

    const control = gif.blocks.find((block) => block.kind === 'graphic-control') as Extract<
      GifBlock,
      { kind: 'graphic-control' }
    >;
    expect(control.packed & 0x01).toBe(0);
    expect(control.delay).toBe(0);
  });

  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 4 },
    { width: 4, height: 1 },
    { width: 3, height: 2 },
    { width: 6, height: 5 },
  ])('encodes a $width x $height frame with matching screen and image dimensions', async ({ width, height }) => {
    const gif = await encode(width, height, gradient(width, height));

    expect([gif.width, gif.height]).toEqual([width, height]);
    const images = gif.blocks.filter((block) => block.kind === 'image') as Extract<GifBlock, { kind: 'image' }>[];
    expect(images).toHaveLength(1);
    expect([images[0].width, images[0].height]).toEqual([width, height]);
    expect(gif.globalColorTable.length).toBeGreaterThanOrEqual(2);
    expect(gif.globalColorTable.length & (gif.globalColorTable.length - 1)).toBe(0);
    expect(gif.trailer).toBe(0x3b);
  });

  it('switches to a transparency-flagged frame when any pixel is not fully opaque', async () => {
    const gif = await encode(2, 1, new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]));

    const control = gif.blocks.find((block) => block.kind === 'graphic-control') as Extract<
      GifBlock,
      { kind: 'graphic-control' }
    >;
    expect(control.packed & 0x01).toBe(0x01);
    // The palette entry the transparent index points at must be the cleared colour so the
    // transparent pixel blends against whatever is behind it.
    expect(gif.globalColorTable[control.transparentIndex]).toEqual([0, 0, 0]);
    expect(gif.globalColorTable).toContainEqual([255, 0, 0]);
  });

  // GIF only has a 1-bit transparency flag, so gifenc's `oneBitAlpha` threshold decides
  // which side of the midpoint a semi-transparent pixel lands on. 127 and below become
  // transparent, 128 and above are written out fully opaque.
  it.each([
    { alpha: 127, transparent: true },
    { alpha: 128, transparent: false },
  ])('rounds a pixel with alpha $alpha to transparent=$transparent', async ({ alpha, transparent }) => {
    const gif = await encode(2, 1, new Uint8ClampedArray([0, 0, 0, alpha, 0, 0, 255, 255]));

    const control = gif.blocks.find((block) => block.kind === 'graphic-control') as Extract<
      GifBlock,
      { kind: 'graphic-control' }
    >;
    expect((control.packed & 0x01) === 0x01).toBe(transparent);
    if (transparent) {
      expect(gif.globalColorTable[control.transparentIndex]).toEqual([0, 0, 0]);
    }
    expect(gif.globalColorTable).toContainEqual([0, 0, 255]);
  });

  it('encodes a fully transparent single pixel without an opaque colour entry', async () => {
    const gif = await encode(1, 1, new Uint8ClampedArray([0, 0, 0, 0]));

    const control = gif.blocks.find((block) => block.kind === 'graphic-control') as Extract<
      GifBlock,
      { kind: 'graphic-control' }
    >;
    expect(control.transparentIndex).toBe(0);
    expect(control.packed & 0x01).toBe(0x01);
    expect(gif.globalColorTable).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});

// The transparent slot cannot be *found* in the quantised palette: `quantize` merges
// colour bins on RGB alone and only binarises the surviving clusters' mean alpha
// afterwards, so a fully transparent pixel absorbed into an opaque neighbour leaves no
// zero-alpha entry to find and the frame is written opaque — a valid file, a successful
// download, and silent data loss.
describe('GIF transparent palette slot', () => {
  it('keeps the transparent slot for a single fully transparent pixel in a large opaque field', async () => {
    const width = 100;
    const height = 100;
    const data = gradient(width, height);
    const transparentPixel = 4321;
    data[transparentPixel * 4] = 0;
    data[transparentPixel * 4 + 1] = 0;
    data[transparentPixel * 4 + 2] = 0;
    data[transparentPixel * 4 + 3] = 0;

    const gif = await encode(width, height, data);
    const control = graphicControl(gif);
    const indices = decodeIndices(imageBlock(gif));

    expect(indices).toHaveLength(width * height);
    expect(control.packed & 0x01).toBe(0x01);
    expect(control.transparentIndex).toBe(0);
    expect(gif.globalColorTable[control.transparentIndex]).toEqual([0, 0, 0]);
    // Only the genuinely transparent pixel may sit on the reserved slot.
    expect(indices[transparentPixel]).toBe(0);
    expect(indices.filter((entry) => entry === 0)).toHaveLength(1);
    // Reserving the slot must not shift the opaque field onto its neighbour's colour.
    let worstChannelError = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const color = gif.globalColorTable[indices[pixel]];
      worstChannelError = Math.max(
        worstChannelError,
        Math.abs(color[0] - data[pixel * 4]),
        Math.abs(color[1] - data[pixel * 4 + 1]),
        Math.abs(color[2] - data[pixel * 4 + 2])
      );
    }
    expect(worstChannelError).toBeLessThanOrEqual(32);
  });

  it('forces only pixels at or below the transparency threshold onto the reserved slot', async () => {
    // 127 is the alpha that gifenc's `oneBitAlpha` binarises to transparent, so it is the
    // last value that belongs on the slot; 128 has to keep an opaque entry of its own.
    const width = 4;
    const height = 1;
    const data = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 127, 255, 255, 255, 128, 0, 0, 0, 255]);

    const gif = await encode(width, height, data);
    const control = graphicControl(gif);
    const indices = decodeIndices(imageBlock(gif));

    expect(indices).toHaveLength(width * height);
    expect(control.packed & 0x01).toBe(0x01);
    expect(control.transparentIndex).toBe(0);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(0);
    expect(indices[2]).not.toBe(0);
    expect(gif.globalColorTable[indices[2]]).toEqual([255, 255, 255]);
    expect(indices[3]).not.toBe(0);
    expect(gif.globalColorTable[indices[3]]).toEqual([0, 0, 0]);
  });

  it('spends no palette slot on a frame whose softest pixel is above the threshold', async () => {
    // Nothing here binarises transparent, so the frame stays unflagged and keeps the full
    // colour budget rather than reserving a slot that no pixel points at. The four levels
    // are far enough apart that each survives quantisation exactly.
    const width = 8;
    const height = 8;
    const levels = [64, 128, 192, 255];
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const level = levels[pixel % levels.length];
      data[pixel * 4] = level;
      data[pixel * 4 + 1] = level;
      data[pixel * 4 + 2] = level;
      data[pixel * 4 + 3] = 255;
    }
    for (const [pixel, alpha] of [
      [0, 128],
      [1, 200],
      [width, 254],
      [width + 1, 130],
    ] as const) {
      data[pixel * 4] = 255;
      data[pixel * 4 + 1] = 255;
      data[pixel * 4 + 2] = 255;
      data[pixel * 4 + 3] = alpha;
    }

    const gif = await encode(width, height, data);
    const control = graphicControl(gif);
    const indices = decodeIndices(imageBlock(gif));

    expect(indices).toHaveLength(width * height);
    expect(control.packed & 0x01).toBe(0);
    // A reserved fifth entry would pad the table to eight colours; four is the whole set.
    expect(gif.globalColorTable).toEqual([
      [255, 255, 255],
      [64, 64, 64],
      [128, 128, 128],
      [192, 192, 192],
    ]);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      expect(gif.globalColorTable[indices[pixel]]).toEqual([data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]]);
    }
  });
});

describe('GIF encoding error paths', () => {
  // Every case below states its geometry on the canvas rather than in a fake `getImageData`
  // return value. `encodeGif` reads `canvas.width`/`canvas.height` for its guards, because
  // `getCanvasImageData` allocates the whole raster before a guard that used its reported
  // geometry could run — so a mock reporting an impossible canvas proved nothing about the
  // ordering. A real canvas cannot be 70000 px wide and a mocked `getImageData` could, which is
  // exactly the gap: these are the geometries the guard has to survive, put where the guard
  // reads them.

  it('rejects a canvas with a zero width without reading its pixels', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 1;
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 1 }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF image has invalid dimensions (0×1)');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('rejects a canvas with a zero height without reading its pixels', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 0;
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 1, height: 0 }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF image has invalid dimensions (1×0)');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('rejects canvases that exceed the 65535 pixel limit before allocating their raster', async () => {
    // 70000 × 100000 is the case the hoisted guard exists for: `getCanvasImageData` would
    // allocate 28 GB of it to hand back a buffer this then refuses.
    const canvas = document.createElement('canvas');
    canvas.width = 70000;
    canvas.height = 100000;
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 70000, height: 100000 }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF dimensions cannot exceed 65535 pixels');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('refuses a geometry that is not a positive integer, rather than pricing it', async () => {
    // `!width` and `> 65535` are both false for a fraction, so the range comparisons alone admit
    // one and hand it to `getCanvasImageData`. `canvas.width` is an unsigned long so this cannot
    // arrive from a real canvas; it is pinned so the guard matches `avif-utils.ts` and
    // `ico-utils.ts` rather than being the one sibling that checks size only.
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { value: 4.5, configurable: true });
    Object.defineProperty(canvas, 'height', { value: 4, configurable: true });
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 4.5, height: 4 }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF image has invalid dimensions (4.5×4)');
    expect(getImageData).not.toHaveBeenCalled();
  });

  it('rejects an over-limit width and an over-limit height independently', async () => {
    const tooWide = document.createElement('canvas');
    tooWide.width = 65536;
    tooWide.height = 1;
    vi.spyOn(tooWide, 'getContext').mockReturnValue({ getImageData: vi.fn() } as unknown as CanvasRenderingContext2D);
    const tooTall = document.createElement('canvas');
    tooTall.width = 1;
    tooTall.height = 65536;
    vi.spyOn(tooTall, 'getContext').mockReturnValue({ getImageData: vi.fn() } as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(tooWide)).rejects.toThrow('GIF dimensions cannot exceed 65535 pixels');
    await expect(encodeGif(tooTall)).rejects.toThrow('GIF dimensions cannot exceed 65535 pixels');
  });

  it('accepts exactly 65535 pixels on each axis', async () => {
    // The 16-bit logical screen descriptor cannot express more, so the boundary must be
    // inclusive rather than an off-by-one rejection. The guard reads the canvas, so the canvas
    // has to carry the boundary geometry — a mocked `getImageData` reporting it would leave
    // the real canvas at 300 × 150 and the assertion would be about nothing.
    const canvas = document.createElement('canvas');
    canvas.width = 65535;
    canvas.height = 65535;
    const context = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([1, 2, 3, 255]), width: 65535, height: 65535 })),
    };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const gif = parseGif(new Uint8Array(await (await encodeGif(canvas)).arrayBuffer()));

    expect([gif.width, gif.height]).toEqual([65535, 65535]);
  });

  it('rejects a canvas without a 2d context', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    await expect(encodeGif(canvas)).rejects.toThrow('Unable to read canvas pixels');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
