import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { Size } from '../../contexts/general-types.ts';
import { healingBrush, type HealingBrushToolArgs } from '../healingBrush.ts';

class RecordingCanvas {
  readonly buffer: Uint8ClampedArray;
  readonly ctx: any;
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
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        this.buffer[offset] = x * 20;
        this.buffer[offset + 1] = 100;
        this.buffer[offset + 2] = y === 1 && x === 1 ? 160 : 100;
        this.buffer[offset + 3] = 255;
      }
    }
  }

  getContext() {
    return this.ctx;
  }
}

const size: Size = { width: 9, height: 9 };
const args = (overrides: Partial<HealingBrushToolArgs> = {}): HealingBrushToolArgs => ({
  size: 3,
  hardness: 100,
  opacity: 1,
  source: { x: 1, y: 1 },
  aligned: true,
  points: [{ x: 4, y: 4 }],
  toolName: 'healing-brush',
  ...overrides,
});

beforeEach(() => vi.stubGlobal('OffscreenCanvas', RecordingCanvas as unknown as typeof OffscreenCanvas));
afterEach(() => vi.unstubAllGlobals());

describe('healing brush', () => {
  it('transfers source texture while correcting it toward destination luminance', () => {
    const [result] = healingBrush({ size, bitmap: createMockImageBitmap(size.width, size.height) })(args());
    const canvas = result as unknown as RecordingCanvas;
    const center = (4 * size.width + 4) * 4;

    expect(Array.from(canvas.buffer.slice(center, center + 4))).toEqual([31, 111, 171, 255]);
    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('does not write when a source has not been sampled', () => {
    const [result] = healingBrush({ size, bitmap: createMockImageBitmap(size.width, size.height) })(
      args({ source: null })
    );
    const canvas = result as unknown as RecordingCanvas;

    expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
  });
});
