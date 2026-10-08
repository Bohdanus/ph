import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { Size } from '../../contexts/general-types.ts';
import { spotHealing, type SpotHealingToolArgs } from '../spotHealing.ts';

type PixelContext = ReturnType<typeof createPixelCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};

class RecordingOffscreenCanvas {
  static seed: ((canvas: RecordingOffscreenCanvas) => void) | null = null;
  readonly buffer: Uint8ClampedArray;
  readonly ctx: PixelContext;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = new Uint8ClampedArray(width * height * 4);
    this.ctx = {
      ...createPixelCanvasContext(this),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(this.buffer), width, height, colorSpace: 'srgb' })),
      putImageData: vi.fn((image: ImageData) => this.buffer.set(image.data)),
    } as unknown as PixelContext;
    RecordingOffscreenCanvas.seed?.(this);
  }

  getContext(): PixelContext {
    return this.ctx;
  }
}

const size: Size = { width: 9, height: 9 };
const args = (overrides: Partial<SpotHealingToolArgs> = {}): SpotHealingToolArgs => ({
  size: 3,
  hardness: 100,
  opacity: 1,
  points: [{ x: 4, y: 4 }],
  toolName: 'spot-healing',
  ...overrides,
});

beforeEach(() => {
  RecordingOffscreenCanvas.seed = (canvas) => {
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const offset = (y * size.width + x) * 4;
        canvas.buffer[offset] = y * 20;
        canvas.buffer[offset + 1] = 100;
        canvas.buffer[offset + 2] = 100;
        canvas.buffer[offset + 3] = 255;
      }
    }
  };
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  RecordingOffscreenCanvas.seed = null;
});

describe('spot healing', () => {
  it('copies deterministic nearby texture into the dab and writes one raster result', () => {
    const source = createMockImageBitmap(size.width, size.height);
    const [result] = spotHealing({ size, bitmap: source })(args());
    const canvas = result as unknown as RecordingOffscreenCanvas;
    const center = canvas.buffer[(4 * size.width + 4) * 4];

    expect(center).toBe(40);
    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('does not read or write pixels for an empty stroke', () => {
    const source = createMockImageBitmap(size.width, size.height);
    const [result] = spotHealing({ size, bitmap: source })(args({ points: [] }));
    const canvas = result as unknown as RecordingOffscreenCanvas;

    expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
  });
});
