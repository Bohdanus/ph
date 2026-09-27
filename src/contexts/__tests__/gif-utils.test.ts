import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeGif } from '../gif-utils.ts';

type GifBlock =
  | { kind: 'graphic-control'; packed: number; delay: number; transparentIndex: number }
  | { kind: 'application'; label: string }
  | { kind: 'image'; left: number; top: number; width: number; height: number; packed: number; codeSize: number }
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
      blocks.push({
        kind: 'image',
        left: u16(bytes, cursor + 1),
        top: u16(bytes, cursor + 3),
        width: u16(bytes, cursor + 5),
        height: u16(bytes, cursor + 7),
        packed: imagePacked,
        codeSize: bytes[code],
      });
      cursor = code + 1;
      while (bytes[cursor] !== 0) cursor += bytes[cursor] + 1;
      cursor += 1;
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

describe('GIF encoding error paths', () => {
  it('rejects canvases with a zero width', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = { getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 0, height: 1 })) };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF dimensions must be greater than zero');
  });

  it('rejects canvases with a zero height', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = { getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 1, height: 0 })) };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF dimensions must be greater than zero');
  });

  it('rejects canvases that exceed the 65535 pixel limit', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = { getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0), width: 70000, height: 1 })) };
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    await expect(encodeGif(canvas)).rejects.toThrow('GIF dimensions cannot exceed 65535 pixels');
  });

  it('accepts exactly 65535 pixels on each axis', async () => {
    // The 16-bit logical screen descriptor cannot express more, so the boundary must be
    // inclusive rather than an off-by-one rejection.
    const context = {
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([1, 2, 3, 255]), width: 65535, height: 65535 })),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
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
