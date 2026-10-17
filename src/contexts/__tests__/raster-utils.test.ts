import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertWithinDocumentPixelBudget,
  canvasToPngBlob,
  getCanvasImageData,
  imageDataToImage,
  loadImageSource,
  MAX_CREATABLE_DOCUMENT_PIXELS,
} from '../raster-utils.ts';

let putImageDataCalls: { width: number; height: number; data: Uint8ClampedArray }[];
let createImageDataCalls: [number, number][];
let createdCanvases: { width: number; height: number }[];
let dataUrls: string[];
let images: { src: string; onload: ((event: Event) => void) | null; onerror: ((event: Event) => void) | null }[];
let imageMode: 'load' | 'error' = 'load';

beforeEach(() => {
  putImageDataCalls = [];
  createImageDataCalls = [];
  createdCanvases = [];
  dataUrls = [];
  images = [];
  imageMode = 'load';
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function (this: HTMLCanvasElement) {
    createdCanvases.push({ width: this.width, height: this.height });
    return {
      canvas: this,
      createImageData(width: number, height: number) {
        createImageDataCalls.push([width, height]);
        return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
      },
      putImageData(image: ImageData) {
        putImageDataCalls.push({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (type?: string) {
    const url = `data:${type ?? ''};base64,raster`;
    dataUrls.push(url);
    return url;
  });
  vi.spyOn(globalThis, 'Image').mockImplementation(function (this: (typeof images)[number]) {
    this.onload = null;
    this.onerror = null;
    this.src = '';
    images.push(this);
    setTimeout(() => {
      if (imageMode === 'load') this.onload?.(new Event('load'));
      else this.onerror?.(new Event('error'));
    }, 0);
    return this as unknown as HTMLImageElement;
  } as unknown as typeof Image);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      canvas: this,
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      createImageData: (width: number, height: number) =>
        ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });
});

describe('getCanvasImageData', () => {
  it('reads the full canvas rectangle from the 2d context', () => {
    const imageData = { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 2, height: 2 };
    const getImageData = vi.fn(() => imageData);
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as unknown as CanvasRenderingContext2D);

    expect(getCanvasImageData(canvas)).toBe(imageData);
    expect(getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, 2, 2);
  });

  it('rejects canvases that cannot supply a 2d context', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    expect(() => getCanvasImageData(canvas)).toThrow('Unable to read canvas pixels');
  });
});

describe('assertWithinDocumentPixelBudget', () => {
  it('accepts dimensions at the document pixel ceiling', () => {
    expect(() => assertWithinDocumentPixelBudget({ width: 10_000, height: 10_000 })).not.toThrow();
  });

  it('rejects invalid dimensions before an allocation can occur', () => {
    expect(() => assertWithinDocumentPixelBudget({ width: 0, height: 10 }, 'Document')).toThrow(
      'Document has invalid dimensions'
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite width %s before an allocation can occur',
    (width) => {
      expect(() => assertWithinDocumentPixelBudget({ width, height: 10 }, 'Document')).toThrow(
        'Document has invalid dimensions'
      );
    }
  );

  it('rejects dimensions above the document pixel ceiling', () => {
    expect(() => assertWithinDocumentPixelBudget({ width: MAX_CREATABLE_DOCUMENT_PIXELS + 1, height: 1 })).toThrow(
      `Image is too large (${MAX_CREATABLE_DOCUMENT_PIXELS + 1}×1)`
    );
  });
});

describe('loadImageSource', () => {
  it('resolves with the image element once it loads', async () => {
    const pending = loadImageSource('data:image/png;base64,x');
    await vi.waitFor(() => expect(images).toHaveLength(1));
    expect(images[0].src).toBe('data:image/png;base64,x');
    await expect(pending).resolves.toBe(images[0]);
  });

  it('rejects with the default message when the source fails to decode', async () => {
    imageMode = 'error';
    await expect(loadImageSource('data:image/png;base64,broken')).rejects.toThrow('Failed to load image');
  });

  it('rejects with the caller-supplied message when the source fails to decode', async () => {
    imageMode = 'error';
    await expect(loadImageSource('data:image/png;base64,broken', 'Failed to decode BMP image')).rejects.toThrow(
      'Failed to decode BMP image'
    );
  });
});

describe('imageDataToImage', () => {
  it('copies pixels into a canvas of matching size and resolves the resulting image', async () => {
    const data = new Uint8ClampedArray([9, 8, 7, 255, 1, 2, 3, 4]);

    const image = await imageDataToImage({ data, width: 2, height: 1 }, 'Failed to decode ICO image');

    expect(createdCanvases).toEqual([{ width: 2, height: 1 }]);
    expect(createImageDataCalls).toEqual([[2, 1]]);
    expect([...putImageDataCalls[0].data]).toEqual([...data]);
    expect(dataUrls).toEqual(['data:image/png;base64,raster']);
    expect(image).toBe(images[0]);
  });

  it.each([
    ['a zero width', { width: 0, height: 1 }],
    ['a zero height', { width: 1, height: 0 }],
  ])('rejects %s before touching a canvas', async (_label, dimensions) => {
    await expect(imageDataToImage({ data: new Uint8ClampedArray(0), ...dimensions }, 'x')).rejects.toThrow(
      'Image has invalid dimensions'
    );
    expect(createdCanvases).toEqual([]);
  });

  it('rejects when the intermediate canvas has no 2d context', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(imageDataToImage({ data: new Uint8ClampedArray(4), width: 1, height: 1 }, 'x')).rejects.toThrow(
      'Unable to create a canvas for image decoding'
    );
  });

  it('rejects with the caller-supplied message when the browser cannot decode the canvas data URL', async () => {
    imageMode = 'error';
    await expect(
      imageDataToImage({ data: new Uint8ClampedArray(4), width: 1, height: 1 }, 'Failed to decode TIFF image')
    ).rejects.toThrow('Failed to decode TIFF image');
  });
});

describe('canvasToPngBlob', () => {
  it('resolves the PNG blob produced by the canvas', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(blob));

    await expect(canvasToPngBlob(canvas)).resolves.toBe(blob);
    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/png');
  });

  it('rejects when the canvas yields a null blob', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(null));

    await expect(canvasToPngBlob(canvas)).rejects.toThrow('Failed to create PNG blob from canvas');
  });

  it('rejects with the original error when the canvas throws synchronously', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation(() => {
      throw new Error('canvas is tainted');
    });

    await expect(canvasToPngBlob(canvas)).rejects.toThrow('canvas is tainted');
  });
});
