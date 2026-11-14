import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur, type BlurToolArgs } from '../blur.ts';
import { sharpen } from '../sharpen.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource, Size } from '../../contexts/general-types.ts';

type PixelContext = ReturnType<typeof createPixelCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  filter: string;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];
  readonly buffer: Uint8ClampedArray;
  readonly filterValuesAtDraw: string[] = [];
  readonly ctx: PixelContext;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.buffer = new Uint8ClampedArray(this.width * this.height * 4);
    this.ctx = {
      ...createPixelCanvasContext(this),
      filter: '',
      drawImage: vi.fn(() => {
        this.filterValuesAtDraw.push(this.ctx.filter);
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const offset = (y * this.width + x) * 4;
            this.buffer[offset] = 100;
            this.buffer[offset + 1] = 150;
            this.buffer[offset + 2] = 200;
            this.buffer[offset + 3] = 255;
          }
        }
      }),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(this.buffer),
        width: this.width,
        height: this.height,
        colorSpace: 'srgb',
      })),
      putImageData: vi.fn((image: ImageData) => this.buffer.set(image.data)),
    } as unknown as PixelContext;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): PixelContext {
    return this.ctx;
  }
}

const size: Size = { width: 9, height: 9 };
const sourceBitmap = createMockImageBitmap(size.width, size.height);

const args = (overrides: Partial<BlurToolArgs> = {}): BlurToolArgs => ({
  radius: 5,
  toolName: 'blur',
  ...overrides,
});

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  overrideCanvasFilterSupport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  overrideCanvasFilterSupport(null);
});

/** Runs the processor and returns the single canvas it must have produced. */
const run = (overrides: Partial<BlurToolArgs> = {}): RecordingOffscreenCanvas => {
  const result = blur({ size, bitmap: sourceBitmap })(args(overrides));

  expect(result).toHaveLength(1);
  const canvas = result[0] as unknown as RecordingOffscreenCanvas;
  expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));

  return canvas;
};

describe('blur processor', () => {
  it('is a distinct two-stage curried processor', () => {
    const inner = blur({ size, bitmap: sourceBitmap });

    expect(blur).not.toBe(sharpen);
    expect(blur.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('is the exact module-level processor the registry imports, not a wrapper closure', async () => {
    const { toolProcessors } = await import('../toolProcessors.ts');
    expect(toolProcessors['blur'].imageProcessor).toBe(blur);
  });

  it('allocates a full document-sized canvas and passes the source bitmap to drawImage', () => {
    const canvas = run();

    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0);
  });

  it('allocates exactly one document-sized output canvas', () => {
    const canvas = run();

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });

  it('throws when the source bitmap is missing', () => {
    expect(() =>
      blur({ size, bitmap: undefined as unknown as BitmapSource })({
        radius: 5,
        toolName: 'blur',
      })
    ).toThrow('Blur tool requires a source bitmap');
  });

  it('sets the CSS filter before drawing with the requested radius', () => {
    const canvas = run({ radius: 7 });

    expect(canvas.ctx.filter).toBe('blur(7px)');
    expect(canvas.filterValuesAtDraw).toEqual(['blur(7px)']);
  });

  it('requires canvas filter support and throws when unsupported', () => {
    overrideCanvasFilterSupport(false);

    expect(() => run({ radius: 5 })).toThrowError('blur requires CanvasRenderingContext2D.filter');
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  describe('argument clamping and edge cases', () => {
    it('handles zero radius (no-op filter)', () => {
      const canvas = run({ radius: 0 });

      expect(canvas.ctx.filter).toBe('blur(0px)');
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(sourceBitmap, 0, 0);
    });

    it('handles very large radius', () => {
      const canvas = run({ radius: 1000 });

      expect(canvas.ctx.filter).toBe('blur(1000px)');
    });
  });
});

describe('BlurToolArgs type', () => {
  it('requires radius and toolName', () => {
    const args: BlurToolArgs = { radius: 5, toolName: 'blur' };
    expect(args.radius).toBe(5);
    expect(args.toolName).toBe('blur');
  });
});
