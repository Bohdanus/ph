import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layer as PsdLayer, PixelData } from 'ag-psd';

import { loadPsd } from '../psd-utils.ts';

/**
 * `ag-psd` can only produce well-formed layer records, so several `loadPsd` branches are
 * unreachable through a real encode/decode round-trip: a document without any layer record
 * (the flattened-composite fallback), a layer record with inverted bounds, a layer whose name
 * is absent, a grayscale document, and the reader's own `logMissingFeatures` output. This file
 * drives them with a stubbed reader, the same technique the sibling `psd-utils.fill-opacity`
 * file uses, and keeps `psd-utils.test.ts` on the genuine codec.
 */
const { getCompositeImageData, getLayerImageData, readPsd } = vi.hoisted(() => ({
  getCompositeImageData: vi.fn(),
  getLayerImageData: vi.fn(),
  readPsd: vi.fn(),
}));

vi.mock('ag-psd', async (importActual) => {
  const actual = await importActual<typeof import('ag-psd')>();
  return { ...actual, getCompositeImageData, getLayerImageData, readPsd };
});

// A pixel-backed 2d context: the globally installed mock in `src/test/setup.ts` has no
// read-back on purpose, and this branch needs real `putImageData`/`getImageData` semantics.
let pixels: WeakMap<HTMLCanvasElement, Uint8ClampedArray>;
beforeEach(() => {
  pixels = new WeakMap();
  getCompositeImageData.mockReset();
  getLayerImageData.mockReset();
  readPsd.mockReset();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    const readBack = (bytes: Uint8ClampedArray) => ({
      width: this.width,
      height: this.height,
      data: bytes.slice(),
      colorSpace: 'srgb' as const,
    });
    const existing = pixels.get(this);
    if (existing)
      return { canvas: this, getImageData: () => readBack(existing) } as unknown as CanvasRenderingContext2D;
    const bytes = new Uint8ClampedArray(this.width * this.height * 4);
    pixels.set(this, bytes);
    return {
      canvas: this,
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      getImageData: () => readBack(bytes),
      putImageData: (image: PixelData) => bytes.set(image.data),
    } as unknown as CanvasRenderingContext2D;
  });
});

/**
 * `loadPsd` validates the 26-byte PSD signature before it ever reaches `readPsd`
 * (`psd-utils.ts:61-67`), so every stubbed document needs a real-looking header.
 */
function psdBuffer(size = { width: 4, height: 3 }): ArrayBuffer {
  const buffer = new ArrayBuffer(26);
  const view = new DataView(buffer);
  view.setUint32(0, 0x38425053); // '8BPS'
  view.setUint16(4, 1); // version 1
  view.setUint32(14, size.height);
  view.setUint32(18, size.width);
  view.setUint16(22, 8); // bits per channel
  view.setUint16(24, 3); // color mode: RGB
  return buffer;
}

function stubDocument(document: Record<string, unknown>, size?: { width: number; height: number }): ArrayBuffer {
  readPsd.mockReturnValue({ width: size?.width ?? 4, height: size?.height ?? 3, ...document });
  return psdBuffer(size);
}

function pixelsOf(width: number, height: number, data: number[]): PixelData {
  return { width, height, data: new Uint8ClampedArray(data) };
}

describe('loadPsd reader warnings and unnamed layers', () => {
  it('collects the reader log output into the warning list', async () => {
    readPsd.mockImplementation((_buffer: ArrayBuffer, options: { log?: (...messages: unknown[]) => void }) => {
      options.log?.('layer 1 is truncated');
      return { width: 4, height: 3, children: [] };
    });
    getCompositeImageData.mockReturnValue(undefined);

    const result = await loadPsd(psdBuffer());

    expect(result.warnings).toContain('PSD reader: layer 1 is truncated');
  });

  it('records the reader options it decodes with', async () => {
    readPsd.mockReturnValue({ width: 4, height: 3, children: [] });
    getCompositeImageData.mockReturnValue(undefined);

    await loadPsd(psdBuffer());

    expect(readPsd).toHaveBeenCalledExactlyOnceWith(expect.any(ArrayBuffer), {
      useRawData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      logMissingFeatures: true,
      log: expect.any(Function),
    });
  });

  it('notes the grayscale-to-RGB conversion', async () => {
    stubDocument({ colorMode: 1, children: [{ name: 'Grey', imageData: pixelsOf(1, 1, [10, 20, 30, 255]) }] });

    const result = await loadPsd(psdBuffer());

    expect(result.warnings).toContain('Grayscale PSD converted to RGB.');
  });

  it('falls back to "Layer" for a layer record without a name', async () => {
    stubDocument({ children: [{ name: undefined, left: 1, top: 0, right: 2, bottom: 1 }] });

    const result = await loadPsd(psdBuffer());

    expect(Object.values(result.layers).map((layer) => layer.name)).toEqual(['Layer']);
  });

  it('warns about per-channel Blend If ranges the reader cannot round-trip', async () => {
    stubDocument({
      children: [
        {
          name: 'Channel Blend If',
          left: 0,
          top: 0,
          right: 1,
          bottom: 1,
          blendingRanges: {
            compositeGrayBlendSource: [0, 0, 255, 255],
            compositeGraphBlendDestinationRange: [0, 0, 255, 255],
            ranges: [
              {
                sourceRange: [0, 0, 255, 255],
                destRange: [0, 0, 128, 255],
                channelName: 'red',
              },
            ],
          },
        },
      ],
    });

    const result = await loadPsd(psdBuffer());

    expect(result.warnings.join(' ')).toContain('"Channel Blend If": Custom blending ranges');
  });

  it('stays quiet for default Blend If ranges on every channel', async () => {
    stubDocument({
      children: [
        {
          name: 'DefaultRanges',
          left: 0,
          top: 0,
          right: 1,
          bottom: 1,
          blendingRanges: {
            compositeGrayBlendSource: [0, 0, 255, 255],
            compositeGraphBlendDestinationRange: [0, 0, 255, 255],
            ranges: [{ sourceRange: [0, 0, 255, 255], destRange: [0, 0, 255, 255], channelName: 'red' }],
          },
        },
      ],
    });

    const result = await loadPsd(psdBuffer());

    expect(result.warnings.join(' ')).not.toContain('Blend If');
  });

  it.each([
    ['an adjustment layer', { adjustment: { type: 'levels' } }],
    ['a vector fill layer', { vectorFill: { color: { r: 1, g: 0, b: 0 } } }],
    ['a knockout layer', { knockout: 1 }],
    ['a channel-blending-restricted layer', { channelBlendingRestrictions: [{ name: 'r', enabled: false }] }],
    ['a layer with animation frames', { animationFrames: [{ name: 'Frame 1' }] }],
  ])('warns that %s is not preserved', async (_label, patch) => {
    stubDocument({ children: [{ name: 'Fancy', left: 0, top: 0, right: 1, bottom: 1, ...patch } as PsdLayer] });

    const result = await loadPsd(psdBuffer());

    const warning = result.warnings.find((entry) => entry.startsWith('"Fancy": '));
    expect(warning).toMatch(/is unsupported and is not preserved/);
  });

  it('warns about a transparency-only lock, which has no dedicated editor lock', async () => {
    stubDocument({
      children: [{ name: 'Locked', left: 0, top: 0, right: 1, bottom: 1, transparencyProtected: true }],
    });

    const result = await loadPsd(psdBuffer());

    expect(result.warnings.join(' ')).toContain('Photoshop lock flags');
    expect(Object.values(result.layers)[0]).toMatchObject({ locked: true });
  });
});

describe('loadPsd geometry and budget validation', () => {
  it('rejects a layer record whose right edge is left of its left edge', async () => {
    stubDocument({ children: [{ name: 'Inverted', left: 10, top: 0, right: 4, bottom: 1 }] });

    await expect(loadPsd(psdBuffer())).rejects.toThrow('Invalid PSD layer dimensions: Inverted');
  });

  it('rejects a layer record whose bottom edge is above its top edge', async () => {
    stubDocument({ children: [{ name: 'Flipped', left: 0, top: 9, right: 1, bottom: 2 }] });

    await expect(loadPsd(psdBuffer())).rejects.toThrow('Invalid PSD layer dimensions: Flipped');
  });

  it('rejects a single layer larger than the per-layer raster budget', async () => {
    stubDocument({ children: [{ name: 'Huge', left: 0, top: 0, right: 9000, bottom: 9000 }] });

    await expect(loadPsd(psdBuffer())).rejects.toThrow('dimensions');
  });

  it('rejects a document whose layer rasters cumulatively exceed the total budget', async () => {
    const bigLayer = (name: string): PsdLayer => ({ name, left: 0, top: 0, right: 5000, bottom: 5000 });
    stubDocument({ children: [bigLayer('A'), bigLayer('B'), bigLayer('C')] });

    await expect(loadPsd(psdBuffer())).rejects.toThrow('64 megapixel total raster budget');
  });
});

describe('loadPsd flattened-composite fallback', () => {
  it('imports the composite image when the document has no layer records', async () => {
    stubDocument({ children: [] }, { width: 2, height: 2 });
    getCompositeImageData.mockReturnValue(pixelsOf(2, 2, [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]));

    const result = await loadPsd(psdBuffer({ width: 2, height: 2 }));
    const layers = Object.values(result.layers);

    expect(result.size).toEqual({ width: 2, height: 2 });
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      id: layers[0].id,
      name: 'Composite',
      tmpCanvas: null,
      isBedrock: false,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 0, y: 0, width: 2, height: 2 },
      source: { kind: 'image', name: 'Composite', isBedrock: true, size: { width: 2, height: 2 } },
      operations: [],
    });
    expect(layers[0].bitmap).toBeInstanceOf(HTMLCanvasElement);
    expect(Array.from((layers[0].bitmap as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 2, 2).data)).toEqual(
      [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]
    );
    expect(result.warnings).toEqual(['No leaf layers; imported the flattened composite image.']);
  });

  it('a composite PSD layer is bedrock through its source, not its snapshot', async () => {
    stubDocument({ children: [] }, { width: 2, height: 2 });
    getCompositeImageData.mockReturnValue(pixelsOf(2, 2, [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]));

    const result = await loadPsd(psdBuffer({ width: 2, height: 2 }));
    const layer = Object.values(result.layers)[0];

    expect(layer).toMatchObject({
      isBedrock: false,
      source: { kind: 'image', isBedrock: true, size: { width: 2, height: 2 } },
    });
  });

  it('falls back to the composite when the document carries no child list at all', async () => {
    readPsd.mockReturnValue({ width: 2, height: 2 });
    getCompositeImageData.mockReturnValue(pixelsOf(2, 2, [9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255, 6, 6, 6, 255]));

    const result = await loadPsd(psdBuffer({ width: 2, height: 2 }));

    expect(Object.values(result.layers).map((layer) => layer.name)).toEqual(['Composite']);
    expect(result.warnings).toEqual(['No leaf layers; imported the flattened composite image.']);
  });

  it('returns no layers and no warning when neither leaf layers nor a composite exist', async () => {
    stubDocument({ children: [] });
    getCompositeImageData.mockReturnValue(undefined);

    const result = await loadPsd(psdBuffer());

    expect(result.layers).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});
