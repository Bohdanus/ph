import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCanvas, readPsd, writePsd, type Layer as PsdLayer, type PixelData } from 'ag-psd';

import { loadPsd, savePsd } from '../psd-utils.ts';
import type { Layer } from '../layer-types.ts';

/**
 * Real-`ag-psd` coverage for the `loadPsd`/`savePsd` branches the gold `psd-utils.test.ts`
 * never reaches because a well-formed document does not exercise them: a missing canvas
 * context, the 2000-layer ceiling on both sides of the codec, and every rejected layer
 * offset/dimension/opacity. Documents that `ag-psd` itself refuses to express (absent layer
 * names, inverted layer bounds, the flattened-composite fallback) live in the sibling
 * `psd-utils.stub.test.ts`.
 */
let contexts: WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>;
beforeEach(() => {
  contexts = new WeakMap();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    const existing = contexts.get(this);
    if (existing) return existing;
    const bytes = new Uint8ClampedArray(this.width * this.height * 4);
    const context = {
      canvas: this,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      getImageData: () => ({ width: this.width, height: this.height, data: bytes.slice() }),
      putImageData: (image: PixelData) => bytes.set(image.data),
      drawImage(
        this: CanvasRenderingContext2D,
        source: HTMLCanvasElement,
        x: number,
        y: number,
        width = source.width,
        height = source.height
      ) {
        const input = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
        for (let dy = 0; dy < height; dy++)
          for (let dx = 0; dx < width; dx++) {
            if (x + dx < 0 || y + dy < 0 || x + dx >= this.canvas.width || y + dy >= this.canvas.height) continue;
            const from =
              (Math.floor((dy * source.height) / height) * source.width + Math.floor((dx * source.width) / width)) * 4;
            const to = ((y + dy) * this.canvas.width + x + dx) * 4;
            const alpha = (input[from + 3] / 255) * this.globalAlpha;
            const oldAlpha = bytes[to + 3] / 255;
            const outAlpha = alpha + oldAlpha * (1 - alpha);
            for (let c = 0; c < 3; c++)
              bytes[to + c] = outAlpha
                ? (input[from + c] * alpha + bytes[to + c] * oldAlpha * (1 - alpha)) / outAlpha
                : 0;
            bytes[to + 3] = outAlpha * 255;
          }
      },
    } as unknown as CanvasRenderingContext2D;

    contexts.set(this, context);
    return context;
  });
  initializeCanvas(
    (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData
  );
});

function raster(data: PixelData) {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data as ImageData, 0, 0);
  return canvas;
}

function layer(patch: Partial<Layer> = {}): Layer {
  return {
    id: 'layer',
    name: 'Layer',
    isBedrock: false,
    bitmap: raster({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }),
    tmpCanvas: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 1, height: 1 },
    presentationBounds: null,
    operations: [],
    ...patch,
  };
}

function singleLayerPsd(): ArrayBuffer {
  return writePsd(
    {
      width: 2,
      height: 1,
      children: [
        {
          name: 'Only',
          imageData: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) },
        } as PsdLayer,
      ],
    },
    { noBackground: true }
  );
}

describe('psd-utils environment and size limits', () => {
  it('fails loudly when the document canvas has no 2d context', async () => {
    const buffer = await singleLayerPsd();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);

    await expect(loadPsd(buffer)).rejects.toThrow('PSD requires a 2D canvas context');
  });

  it('rejects a document whose layer record count exceeds the limit', async () => {
    const buffer = await writePsd(
      {
        width: 2,
        height: 2,
        children: Array.from({ length: 2001 }, (_unused, index): PsdLayer => ({
          name: `L${index}`,
          imageData: { width: 1, height: 1, data: new Uint8ClampedArray([index % 256, 0, 0, 255]) },
        })),
      },
      { noBackground: true }
    );

    await expect(loadPsd(buffer)).rejects.toThrow('too many layers');
  });

  it('accepts a document that sits exactly on the layer limit', async () => {
    const buffer = await writePsd(
      {
        width: 2,
        height: 2,
        children: Array.from({ length: 2000 }, (_unused, index): PsdLayer => ({
          name: `L${index}`,
          imageData: { width: 1, height: 1, data: new Uint8ClampedArray([index % 256, 0, 0, 255]) },
        })),
      },
      { noBackground: true }
    );

    const imported = await loadPsd(buffer);

    expect(Object.keys(imported.layers)).toHaveLength(2000);
  });

  it('rejects an export whose layer count exceeds the limit', async () => {
    const layers = Object.fromEntries(
      Array.from({ length: 2001 }, (_unused, index) => [String(index), layer({ id: String(index), order: index })])
    );

    await expect(savePsd(layers, { width: 1, height: 1 })).rejects.toThrow('too many layers');
  });
});

describe('savePsd layer field validation', () => {
  it.each([
    ['an infinite x offset', { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 }],
    ['a non-finite y offset', { x: 0, y: Number.NaN, width: 1, height: 1 }],
    ['an x offset past the PSD limit', { x: 0x7fffffff, y: 0, width: 1, height: 1 }],
    ['a y offset past the PSD limit', { x: 0, y: -(0x7fffffff - 29999), width: 1, height: 1 }],
  ])('rejects %s', async (_label, pos) => {
    await expect(savePsd({ input: layer({ pos }) }, { width: 4, height: 4 })).rejects.toThrow(
      'Invalid PSD layer offset: Layer'
    );
  });

  it.each([
    ['zero width', { x: 0, y: 0, width: 0, height: 1 }],
    ['zero height', { x: 0, y: 0, width: 1, height: 0 }],
    ['a negative width', { x: 0, y: 0, width: -4, height: 4 }],
    ['a non-finite height', { x: 0, y: 0, width: 4, height: Number.POSITIVE_INFINITY }],
  ])('rejects %s', async (_label, pos) => {
    await expect(savePsd({ input: layer({ pos }) }, { width: 4, height: 4 })).rejects.toThrow(
      'Invalid PSD layer dimensions: Layer'
    );
  });

  it.each([
    ['a non-finite order', { order: Number.NaN, opacity: 1 }],
    ['an infinite order', { order: Number.POSITIVE_INFINITY, opacity: 1 }],
    ['an opacity above one', { order: 0, opacity: 1.5 }],
    ['a negative opacity', { order: 0, opacity: -0.25 }],
    ['a non-finite opacity', { order: 0, opacity: Number.NaN }],
  ])('rejects %s', async (_label, patch) => {
    await expect(savePsd({ input: layer(patch) }, { width: 1, height: 1 })).rejects.toThrow(
      'Invalid PSD layer order or opacity: Layer'
    );
  });
});

describe('loadPsd with a flattened-only document', () => {
  it('imports the single empty layer record the codec writes for a flattened document', async () => {
    // A PSD written from a flattened canvas still carries one layer record with zero bounds,
    // so `loadPsd` takes the leaf path with an empty name and a 1x1 transparent raster rather
    // than the composite fallback. Pinned so the fallback is not "optimised" away blindly.
    const buffer = await writePsd(
      {
        width: 2,
        height: 2,
        canvas: raster({
          width: 2,
          height: 2,
          data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 0, 0, 0, 255]),
        }),
      },
      { noBackground: true }
    );
    expect(readPsd(buffer, { useImageData: true }).children).toHaveLength(1);

    const imported = await loadPsd(buffer);
    const layers = Object.values(imported.layers);

    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ name: '', order: 0, pos: { x: 0, y: 0, width: 1, height: 1 } });
    expect(imported.warnings.join(' ')).toContain('No raster preview');
    expect(imported.warnings.join(' ')).not.toContain('No leaf layers');
    expect(Array.from((layers[0].bitmap as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)).toEqual(
      [0, 0, 0, 0]
    );
  });
});
