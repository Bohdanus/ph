import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCanvas, readPsd, writePsd, type Layer as PsdLayer, type PixelData } from 'ag-psd';

import { loadPsd, savePsd } from '../psd-utils.ts';
import { loadDocumentFile } from '../image-load-save-utils.ts';
import type { Layer } from '../layer-types.ts';

const pixel = (r = 0, g = 0, b = 0, a = 255): PixelData => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([r, g, b, a]),
});

// Local pixel-backed canvas: actual PSD encoding/decoding, without node-canvas.
// Only source-over composition is simulated; other modes are checked as metadata/canvas calls.
let contexts: WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>;
let drawCalls: { mode: string; alpha: number }[];
beforeEach(() => {
  contexts = new WeakMap();
  drawCalls = [];
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (context) return context;
    const canvas = this;
    const bytes = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const stateStack: Array<{ alpha: number; mode: GlobalCompositeOperation; filter: string }> = [];
    context = {
      canvas,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      filter: 'none',
      save(this: CanvasRenderingContext2D) {
        stateStack.push({ alpha: this.globalAlpha, mode: this.globalCompositeOperation, filter: this.filter });
      },
      restore(this: CanvasRenderingContext2D) {
        const state = stateStack.pop();
        if (!state) return;
        this.globalAlpha = state.alpha;
        this.globalCompositeOperation = state.mode;
        this.filter = state.filter;
      },
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      getImageData: () => ({ width: canvas.width, height: canvas.height, data: bytes.slice() }),
      putImageData: (image: PixelData) => bytes.set(image.data),
      drawImage(
        this: CanvasRenderingContext2D,
        source: HTMLCanvasElement,
        x: number,
        y: number,
        width: number = source.width,
        height: number = source.height
      ) {
        const input = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
        drawCalls.push({ mode: this.globalCompositeOperation, alpha: this.globalAlpha });
        for (let dy = 0; dy < height; dy++)
          for (let dx = 0; dx < width; dx++) {
            if (x + dx < 0 || y + dy < 0 || x + dx >= canvas.width || y + dy >= canvas.height) continue;
            const from =
              (Math.floor((dy * source.height) / height) * source.width + Math.floor((dx * source.width) / width)) * 4;
            const to = ((y + dy) * canvas.width + x + dx) * 4;
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
    contexts.set(canvas, context);
    return context;
  });
  initializeCanvas(
    (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    (width: number, height: number) =>
      ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }) as ImageData
  );
});

function raster(data = pixel(255)) {
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
    bitmap: raster(),
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

function binary(children: PsdLayer[]) {
  return writePsd({ width: 3, height: 2, children }, { noBackground: true });
}

function pixels(...values: number[]): PixelData {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(values),
  };
}

describe('PSD codec binary roundtrip', () => {
  it('opens a real layered PSD through the document loader with displayable leaf layers', async () => {
    const buffer = await writePsd(
      {
        width: 3,
        height: 2,
        children: [
          {
            name: 'Background',
            left: 0,
            top: 0,
            imageData: pixels(12, 24, 36, 255, 48, 60, 72, 255, 84, 96, 108, 255, 120, 132, 144, 255),
          },
          {
            name: 'Foreground',
            left: 1,
            top: 0,
            imageData: {
              width: 2,
              height: 1,
              data: new Uint8ClampedArray([220, 10, 20, 255, 30, 40, 50, 128]),
            },
            opacity: 200 / 255,
          },
        ],
      },
      { noBackground: true }
    );
    const file = new File([buffer], 'layered.PSD', { type: 'application/octet-stream' });

    const imported = await loadDocumentFile(file);

    expect(imported).toMatchObject({ fileName: 'layered.PSD' });
    expect('document' in imported).toBe(true);
    if (!('document' in imported)) throw new Error('Expected a PSD document');

    const layers = Object.values(imported.document.layers).sort((a, b) => a.order - b.order);
    expect(imported.document.size).toEqual({ width: 3, height: 2 });
    expect(layers).toHaveLength(2);
    expect(layers.map(({ name, order }) => [name, order])).toEqual([
      ['Background', 0],
      ['Foreground', 1],
    ]);
    expect(layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Background',
          visible: true,
          tmpCanvas: null,
          pos: { x: 0, y: 0, width: 2, height: 2 },
          bitmap: expect.any(HTMLCanvasElement),
        }),
        expect.objectContaining({
          name: 'Foreground',
          visible: true,
          opacity: 200 / 255,
          tmpCanvas: null,
          pos: { x: 1, y: 0, width: 2, height: 1 },
          bitmap: expect.any(HTMLCanvasElement),
        }),
      ])
    );

    const background = layers[0].bitmap as HTMLCanvasElement;
    const foreground = layers[1].bitmap as HTMLCanvasElement;
    expect({ width: background.width, height: background.height }).toEqual({ width: 2, height: 2 });
    expect({ width: foreground.width, height: foreground.height }).toEqual({ width: 2, height: 1 });
    expect(Array.from(background.getContext('2d')!.getImageData(0, 0, 2, 2).data)).toEqual([
      12, 24, 36, 255, 48, 60, 72, 255, 84, 96, 108, 255, 120, 132, 144, 255,
    ]);
    expect(Array.from(foreground.getContext('2d')!.getImageData(0, 0, 2, 1).data)).toEqual([
      220, 10, 20, 255, 30, 40, 50, 128,
    ]);

    const display = document.createElement('canvas');
    display.width = imported.document.size.width;
    display.height = imported.document.size.height;
    const displayContext = display.getContext('2d')!;
    const drawImage = vi.spyOn(displayContext, 'drawImage');
    for (const currentLayer of layers) {
      if (!currentLayer.visible || !currentLayer.bitmap) continue;
      displayContext.globalAlpha = currentLayer.opacity;
      displayContext.globalCompositeOperation = currentLayer.blendMode;
      displayContext.drawImage(
        currentLayer.bitmap,
        currentLayer.pos.x,
        currentLayer.pos.y,
        currentLayer.pos.width,
        currentLayer.pos.height
      );
    }
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenNthCalledWith(1, background, 0, 0, 2, 2);
    expect(drawImage).toHaveBeenNthCalledWith(2, foreground, 1, 0, 2, 1);
    expect(Array.from(displayContext.getImageData(0, 0, 3, 2).data)).toEqual([
      12, 24, 36, 255, 183, 21, 31, 255, 30, 40, 50, 100, 84, 96, 108, 255, 120, 132, 144, 255, 0, 0, 0, 0,
    ]);
    expect(imported.document.warnings).toEqual([]);
  });

  it('preserves metadata, bottom-first order, negative offsets, hidden pixels and locks', async () => {
    const imported = await loadPsd(
      binary([
        { name: 'Bottom', imageData: pixel(255), left: -1, top: 2 },
        {
          name: 'Top ✓',
          imageData: pixel(0, 255),
          left: 1,
          opacity: 128 / 255,
          hidden: true,
          blendMode: 'soft light',
          protected: { position: true },
        },
      ])
    );
    const layers = Object.values(imported.layers);
    expect(imported.size).toEqual({ width: 3, height: 2 });
    expect(layers.map(({ name, order }) => [name, order])).toEqual([
      ['Bottom', 0],
      ['Top ✓', 1],
    ]);
    expect(layers[0].pos).toEqual({ x: -1, y: 2, width: 1, height: 1 });
    expect(layers[1]).toMatchObject({ visible: false, locked: true, opacity: 128 / 255, blendMode: 'soft-light' });
    const result = readPsd(await savePsd(imported.layers, imported.size), { useImageData: true });
    expect(result.children?.map((l) => l.name)).toEqual(['Bottom', 'Top ✓']);
    expect(result.children?.[1]).toMatchObject({
      hidden: true,
      opacity: 128 / 255,
      blendMode: 'soft light',
      transparencyProtected: true,
    });
    expect(Array.from(result.children![1].imageData!.data)).toEqual([0, 255, 0, 255]);
  });

  it('warns when a layer uses non-default Blend If ranges', async () => {
    const imported = await loadPsd(
      binary([
        {
          name: 'Blend If',
          imageData: pixel(255),
          blendingRanges: {
            compositeGrayBlendSource: [0, 0, 128, 255],
            compositeGraphBlendDestinationRange: [0, 0, 255, 255],
            ranges: [],
          },
        },
      ])
    );

    expect(imported.warnings.join(' ')).toContain('Blend If');
  });

  it('uses tmpCanvas, scales pixels, sorts layers and composites visible layers with quantized opacity', async () => {
    const bottom = layer({
      id: 'bottom',
      order: -2,
      tmpCanvas: raster(pixel(0, 0, 255)),
      pos: { x: 0, y: 0, width: 2, height: 1 },
    });
    const top = layer({ id: 'top', order: 5, opacity: 0.5 });
    const hidden = layer({ id: 'hidden', order: 9, visible: false, bitmap: raster(pixel(0, 255)) });
    const result = readPsd(await savePsd({ hidden, top, bottom }, { width: 2, height: 1 }), { useImageData: true });
    expect(Array.from(result.children![0].imageData!.data)).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
    expect(Array.from(result.imageData!.data)).toEqual([128, 0, 127, 255, 0, 0, 255, 255]);
    expect(result.children).toHaveLength(3);
    expect(top.opacity).toBe(0.5);
  });

  it('keeps empty layers with a transparent 1x1 raster', async () => {
    const imported = await loadPsd(binary([{ name: 'Empty', hidden: true }]));
    expect(Object.values(imported.layers)[0].pos).toMatchObject({ width: 1, height: 1 });
    expect(imported.warnings.join(' ')).toContain('No raster preview');
    const empty = layer({ bitmap: null, pos: { x: 2, y: 1, width: 8, height: 9 } });
    const result = readPsd(await savePsd({ empty }, { width: 3, height: 2 }), { useImageData: true });
    expect(result.children![0]).toMatchObject({ left: 2, top: 1, right: 3, bottom: 2 });
    expect(Array.from(result.children![0].imageData!.data)).toEqual([0, 0, 0, 0]);
  });

  it('flattens nested groups and warns about fidelity, masks, effects, clipping, and text previews', async () => {
    const imported = await loadPsd(
      binary([
        {
          name: 'Group',
          hidden: true,
          opacity: 128 / 255,
          blendMode: 'multiply',
          protected: { composite: true },
          children: [
            {
              name: 'Nested',
              children: [
                {
                  name: 'Text',
                  imageData: pixel(44),
                  text: { text: 'Hello' },
                  clipping: true,
                  mask: { imageData: pixel(255) },
                  effects: { disabled: true },
                  blendMode: 'dissolve',
                },
                { name: 'Empty' },
              ],
            },
          ],
        },
      ])
    );
    const layers = Object.values(imported.layers);
    expect(layers.map((l) => l.name)).toEqual(['Text', 'Empty']);
    expect(layers[0]).toMatchObject({ visible: false, locked: true, opacity: 128 / 255, blendMode: 'source-over' });
    for (const feature of [
      'Group flattened',
      'mask',
      'effects',
      'clipping',
      'Text is imported as a raster preview',
      'dissolve',
    ]) {
      expect(imported.warnings.join(' ')).toContain(feature);
    }
    expect(Array.from((layers[0].bitmap as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data)).toEqual(
      [44, 0, 0, 255]
    );
  });

  it.each([
    ['source-over', 'normal'],
    ['color-dodge', 'color dodge'],
    ['color-burn', 'color burn'],
    ['hard-light', 'hard light'],
    ['soft-light', 'soft light'],
    ['multiply', 'multiply'],
    ['screen', 'screen'],
    ['overlay', 'overlay'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['difference', 'difference'],
    ['exclusion', 'exclusion'],
    ['hue', 'hue'],
    ['saturation', 'saturation'],
    ['color', 'color'],
    ['luminosity', 'luminosity'],
  ] as const)('maps canvas %s to PSD %s in both directions', async (canvasMode, psdMode) => {
    const input = layer({ blendMode: canvasMode });
    const saved = await savePsd({ input }, { width: 1, height: 1 });
    expect(readPsd(saved, { useImageData: true }).children![0].blendMode).toBe(psdMode);
    expect(drawCalls.some(({ mode }) => mode === canvasMode)).toBe(true);
    expect(Object.values((await loadPsd(saved)).layers)[0].blendMode).toBe(canvasMode);
  });

  it.each(['destination-out', 'lighter', 'copy', 'xor'] as const)(
    'rejects unsupported export mode %s',
    async (blendMode) => {
      await expect(savePsd({ layer: layer({ blendMode }) }, { width: 1, height: 1 })).rejects.toThrow(
        'Unsupported PSD export blend mode'
      );
    }
  );

  it.each([
    { width: 0, height: 1 },
    { width: 1.5, height: 1 },
    { width: 30001, height: 1 },
    { width: 10000, height: 10000 },
  ])('rejects invalid dimensions %j', async (size) => {
    await expect(savePsd({}, size)).rejects.toThrow('dimensions');
  });

  it('rejects unsupported headers and bit depths before decoding', async () => {
    await expect(loadPsd(new ArrayBuffer(1))).rejects.toThrow('header');
    for (const [offset, value, message] of [
      [22, 16, '8-bit'],
      [22, 32, '8-bit'],
      [24, 4, 'RGB'],
      [4, 2, 'PSB'],
    ] as const) {
      const buffer = binary([]);
      new DataView(buffer).setUint16(offset, value);
      await expect(loadPsd(buffer)).rejects.toThrow(message);
    }
    const buffer = binary([]);
    new DataView(buffer).setUint32(18, 0);
    await expect(loadPsd(buffer)).rejects.toThrow('dimensions');
  });

  it('rejects invalid layer geometry, opacity, and raster budgets', async () => {
    await expect(
      savePsd({ input: layer({ pos: { x: NaN, y: 0, width: 1, height: 1 } }) }, { width: 1, height: 1 })
    ).rejects.toThrow('offset');
    await expect(savePsd({ input: layer({ opacity: NaN }) }, { width: 1, height: 1 })).rejects.toThrow('opacity');
    await expect(
      savePsd({ input: layer({ pos: { x: 0, y: 0, width: 8000, height: 8000 } }) }, { width: 8000, height: 8000 })
    ).rejects.toThrow('budget');
  });

  it('rasterizes fractional geometry into enclosing integer bounds', async () => {
    const input = layer({ pos: { x: -0.5, y: 0.25, width: 1.75, height: 1.5 } });
    const saved = await savePsd({ input }, { width: 3, height: 3 });
    const result = readPsd(saved, { useImageData: true });
    expect(result.children![0]).toMatchObject({ left: -1, top: 0, right: 2, bottom: 2 });
    expect(input.pos).toEqual({ x: -0.5, y: 0.25, width: 1.75, height: 1.5 });
  });

  it('uses smart object previews and warns when previews are absent', async () => {
    const placedLayer: NonNullable<PsdLayer['placedLayer']> = {
      id: '12345678-1234-1234-1234-123456789abc',
      type: 'raster',
      transform: [0, 0, 1, 0, 1, 1, 0, 1],
      width: 1,
      height: 1,
    };
    const result = await loadPsd(
      binary([
        { name: 'Smart', placedLayer, imageData: pixel(25, 50, 75) },
        { name: 'Missing', placedLayer },
      ])
    );
    expect(result.warnings.filter((warning) => warning.includes('Smart object'))).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('No raster preview');
    const saved = readPsd(await savePsd(result.layers, result.size), { useImageData: true });
    expect(Array.from(saved.children![0].imageData!.data)).toEqual([25, 50, 75, 255]);
    expect(saved.children![0].placedLayer).toBeUndefined();
  });
});
