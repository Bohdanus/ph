import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crop } from '../crop.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';
import type { BitmapSource, RectXYSorted, Size } from '../../contexts/general-types.ts';

/**
 * A recording OffscreenCanvas that captures how the crop processor uses it.
 *
 * The crop processor (`src/tools/crop.ts`) does three observable things:
 * 1. Allocates `new OffscreenCanvas(size.width, size.height)` at the DOCUMENT size.
 * 2. Reads `trimRect(rect, size)` and then RESIZES the canvas to the cropped
 *    dimensions by assigning `canvas.width` / `canvas.height`.
 * 3. Calls `ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height)`
 *    to copy the source region into the zero-origin destination.
 *
 * This class records all three so every step can be asserted.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  readonly constructedWidth: number;
  readonly constructedHeight: number;
  width: number;
  height: number;
  readonly drawImageCalls: unknown[][] = [];

  private readonly context: { drawImage: ReturnType<typeof vi.fn> };

  constructor(width: number, height: number) {
    this.constructedWidth = Math.max(1, Math.ceil(width));
    this.constructedHeight = Math.max(1, Math.ceil(height));
    this.width = this.constructedWidth;
    this.height = this.constructedHeight;

    this.context = {
      drawImage: vi.fn((...args: unknown[]) => {
        this.drawImageCalls.push(args);
      }),
    };

    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): { drawImage: ReturnType<typeof vi.fn> } {
    return this.context;
  }
}

/** A stand-in for the layer bitmap `drawImage` paints from. */
function makeBitmap(width: number, height: number): BitmapSource {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

const DOCUMENT_SIZE: Size = { width: 800, height: 600 };
const BITMAP = makeBitmap(DOCUMENT_SIZE.width, DOCUMENT_SIZE.height);

/**
 * The crop processor's signature: a curried call. `crop({ bitmap, size })`
 * returns `(args: CropToolArgs) => [canvas, size]`.
 */
const runCrop = (rect: RectXYSorted | null, overrides: Partial<ProcessorToolParams> = {}) => {
  RecordingOffscreenCanvas.instances = [];
  const processor = crop({ bitmap: BITMAP, size: DOCUMENT_SIZE, ...overrides });
  const canvas = processor({ rect, toolName: 'crop' })[0] as unknown as RecordingOffscreenCanvas;

  return canvas;
};

const runCropWithResult = (rect: RectXYSorted | null, overrides: Partial<ProcessorToolParams> = {}) => {
  RecordingOffscreenCanvas.instances = [];
  const processor = crop({ bitmap: BITMAP, size: DOCUMENT_SIZE, ...overrides });
  return processor({ rect, toolName: 'crop' });
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crop processor', () => {
  it('allocates the offscreen canvas at the document size, then resizes to the crop', () => {
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };

    const canvas = runCrop(rect);

    expect(canvas.constructedWidth).toBe(800);
    expect(canvas.constructedHeight).toBe(600);
    // trimRect clamps to 100,50,300,250 — the canvas is resized to the crop.
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(250);
  });

  it('returns the canvas and the trimmed size as the tool result', () => {
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };

    RecordingOffscreenCanvas.instances = [];
    const result = crop({ bitmap: BITMAP, size: DOCUMENT_SIZE })({ rect, toolName: 'crop' });

    expect(result).toHaveLength(2);
    const [returnedCanvas, size] = result;
    expect(returnedCanvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
    expect(size).toEqual({ width: 300, height: 250 });
  });

  it('draws the source region into a zero-origin destination of the same size', () => {
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };
    // trimRect returns x=100, y=50, width=300, height=250.
    const canvas = runCrop(rect);

    expect(canvas.drawImageCalls).toHaveLength(1);
    expect(canvas.drawImageCalls[0]).toEqual([
      BITMAP,
      100,
      50,
      300,
      250, // source: x, y, width, height
      0,
      0,
      300,
      250, // destination: dx, dy, width, height
    ]);
  });

  it('clamps a rect that crosses the right and bottom edges', () => {
    // 300x250 from (700, 500) would overshoot; trimRect clamps to 100x100.
    const rect = { x1: 700, y1: 500, x2: 1000, y2: 750 };

    const canvas = runCrop(rect);

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(100);
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 700, 500, 100, 100, 0, 0, 100, 100]);
  });

  it('clamps a rect that crosses the left and top edges', () => {
    const rect = { x1: -100, y1: -50, x2: 200, y2: 200 };

    const canvas = runCrop(rect);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
    // The source rect is clamped to the image origin.
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 0, 0, 200, 200, 0, 0, 200, 200]);
  });

  it('handles a rect at the exact image boundary', () => {
    // Cropping from the top-left corner to the bottom-right corner.
    const rect = { x1: 0, y1: 0, x2: 800, y2: 600 };

    const canvas = runCrop(rect);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 0, 0, 800, 600, 0, 0, 800, 600]);
  });

  it('normalises an inverted rect before trimming and drawing', () => {
    // x2 < x1 and y2 < y1 — a right-to-left, bottom-to-top drag.
    const rect = { x1: 400, y1: 300, x2: 100, y2: 50 };

    const canvas = runCrop(rect);

    // trimRect sorts first, so the result is the same as the upright rect.
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(250);
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 100, 50, 300, 250, 0, 0, 300, 250]);
  });

  it('collapses a rect fully outside the image to the original bitmap', () => {
    const rect = { x1: 900, y1: 700, x2: 1000, y2: 800 };

    const result = runCropWithResult(rect);

    expect(result[0]).toBe(BITMAP);
    expect(result[1]).toBeUndefined();
  });

  it('collapses a zero-area click point to the original bitmap', () => {
    const rect = { x1: 200, y1: 150, x2: 200, y2: 150 };

    const result = runCropWithResult(rect);
    expect(result[0]).toBe(BITMAP);
    expect(result[1]).toBeUndefined();
  });

  it('rounds fractional coordinates before drawing', () => {
    const rect = { x1: 100.4, y1: 50.6, x2: 400.4, y2: 300.6 };

    const canvas = runCrop(rect);

    // trimRect rounds each edge: x=100, y=51, width=300, height=250.
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 100, 51, 300, 250, 0, 0, 300, 250]);
  });

  it('crops a rect that extends past all four edges to the full intersection', () => {
    // The rect is larger than the image in every direction.
    const rect = { x1: -50, y1: -50, x2: 850, y2: 650 };

    const canvas = runCrop(rect);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.drawImageCalls[0]).toEqual([BITMAP, 0, 0, 800, 600, 0, 0, 800, 600]);
  });

  it('allocates only one offscreen canvas per invocation', () => {
    const before = RecordingOffscreenCanvas.instances.length;

    runCrop({ x1: 100, y1: 50, x2: 400, y2: 300 });

    expect(RecordingOffscreenCanvas.instances).toHaveLength(before + 1);
  });

  it('uses the bitmap passed in params, not a hard-coded one', () => {
    const customBitmap = makeBitmap(320, 240);
    const rect = { x1: 0, y1: 0, x2: 100, y2: 80 };

    RecordingOffscreenCanvas.instances = [];
    const [canvas] = crop({ bitmap: customBitmap, size: DOCUMENT_SIZE })({ rect, toolName: 'crop' });

    expect((canvas as unknown as RecordingOffscreenCanvas).drawImageCalls[0][0]).toBe(customBitmap);
  });
});
