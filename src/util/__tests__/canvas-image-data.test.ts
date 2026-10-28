import { describe, expect, it, vi } from 'vitest';
import { makeMockCanvas } from '@/__tests__/canvas-mock.ts';
import { MAX_RASTER_SELECTION_PIXELS } from '../selection-mask.ts';
import { readCanvasImageDataAtLogicalSize } from '../canvas-image-data.ts';

function makeImageData(width: number, height: number, fill?: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = fill(x, y);
        data[offset + 1] = y;
        data[offset + 2] = x;
        data[offset + 3] = 255;
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function makeCanvasWithPixels(width: number, height: number, ratio?: number): HTMLCanvasElement {
  const source = makeImageData(width, height, (x, y) => y * width + x);
  const canvas = makeMockCanvas(width, height, {
    createImageData: vi.fn((targetWidth: number, targetHeight: number) =>
      makeImageData(targetWidth, targetHeight)
    ) as unknown as CanvasRenderingContext2D['createImageData'],
    getImageData: vi.fn((x: number, y: number, readWidth: number, readHeight: number) => {
      const result = makeImageData(readWidth, readHeight);
      for (let row = 0; row < readHeight; row += 1) {
        for (let column = 0; column < readWidth; column += 1) {
          const sourceOffset = ((y + row) * width + x + column) * 4;
          const targetOffset = (row * readWidth + column) * 4;
          result.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
        }
      }
      return result;
    }),
  });
  if (ratio !== undefined) {
    canvas.getAttribute = vi.fn((name: string) =>
      name === 'data-hidpi-ratio' ? String(ratio) : null
    ) as unknown as HTMLCanvasElement['getAttribute'];
  }
  return canvas;
}

describe('readCanvasImageDataAtLogicalSize', () => {
  it.each([
    ['2x backing pixels', 4, 4, 2, 2, [5, 7, 13, 15]],
    ['fractional 1.5x backing pixels', 3, 3, 2, 2, [0, 2, 6, 8]],
  ])('samples logical pixel centres from %s', (_label, backingWidth, backingHeight, width, height, expected) => {
    const canvas = makeCanvasWithPixels(Number(backingWidth), Number(backingHeight));

    const imageData = readCanvasImageDataAtLogicalSize(canvas, {
      width: Number(width),
      height: Number(height),
    });

    expect(imageData?.width).toBe(width);
    expect(imageData?.height).toBe(height);
    expect(Array.from({ length: imageData!.data.length / 4 }, (_, i) => imageData!.data[i * 4])).toEqual(expected);
  });

  it('uses the unrounded canvas DPR transform for odd logical dimensions', () => {
    // resizeCanvas(3, 3, 1.5) creates a 5x5 backing store, while the context transform
    // remains exactly 1.5. The third logical pixel centre maps to source index 3, not 4.
    const canvas = makeCanvasWithPixels(5, 5, 1.5);

    const imageData = readCanvasImageDataAtLogicalSize(canvas, { width: 3, height: 3 });

    expect(Array.from({ length: imageData!.data.length / 4 }, (_, i) => imageData!.data[i * 4])).toEqual([
      0, 2, 3, 10, 12, 13, 15, 17, 18,
    ]);
  });

  it('returns the direct logical-grid readback without copying another RGBA frame', () => {
    const source = makeImageData(2, 2, (x, y) => y * 2 + x);
    const createImageData = vi.fn();
    const canvas = makeMockCanvas(2, 2, {
      createImageData,
      getImageData: vi.fn(() => source),
    });

    const result = readCanvasImageDataAtLogicalSize(canvas, { width: 2, height: 2 });

    expect(result).toBe(source);
    expect(createImageData).not.toHaveBeenCalled();
  });

  it('keeps high-DPI source readbacks within bounded row chunks across chunk boundaries', () => {
    const canvas = makeMockCanvas(1024, 2048, {
      createImageData: vi.fn((width: number, height: number) =>
        makeImageData(width, height)
      ) as unknown as CanvasRenderingContext2D['createImageData'],
      getImageData: vi.fn((_x: number, y: number, width: number, height: number) =>
        makeImageData(width, height, (_sourceX, sourceY) => (y + sourceY) % 251)
      ),
    });

    const imageData = readCanvasImageDataAtLogicalSize(canvas, { width: 512, height: 1024 });
    const context = canvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };

    expect(imageData?.height).toBe(1024);
    expect(Array.from([0, 510, 511, 512, 1023], (row) => imageData!.data[row * 512 * 4])).toEqual([1, 17, 19, 21, 39]);
    expect(context.getImageData).toHaveBeenCalledTimes(2);
    for (const [, , readWidth, readHeight] of context.getImageData.mock.calls) {
      expect(readWidth * readHeight).toBeLessThanOrEqual(1_048_576);
    }
  });

  it('rejects logical frames above the shared pixel budget before allocation or readback', () => {
    const canvas = makeCanvasWithPixels(1, 1);
    const width = 4097;
    const height = Math.ceil((MAX_RASTER_SELECTION_PIXELS + 1) / width);

    expect(readCanvasImageDataAtLogicalSize(canvas, { width, height })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});
