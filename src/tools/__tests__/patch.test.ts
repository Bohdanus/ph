import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPixelCanvasContext } from '../../test/setup.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { Size } from '../../contexts/general-types.ts';
import { patch, type PatchToolArgs } from '../patch.ts';

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
const args = (overrides: Partial<PatchToolArgs> = {}): PatchToolArgs => ({
  sourceRect: { x: 4, y: 4, width: 2, height: 2 },
  donorPoint: { x: 1, y: 1 },
  diffusion: 0,
  toolName: 'patch',
  ...overrides,
});

beforeEach(() => vi.stubGlobal('OffscreenCanvas', RecordingCanvas as unknown as typeof OffscreenCanvas));
afterEach(() => vi.unstubAllGlobals());

describe('patch', () => {
  it('copies a donor rectangle with destination-luminance correction', () => {
    const [result] = patch({ size, bitmap: createMockImageBitmap(size.width, size.height) })(args());
    const canvas = result as unknown as RecordingCanvas;
    const center = (4 * size.width + 4) * 4;

    expect(Array.from(canvas.buffer.slice(center, center + 4))).toEqual([31, 111, 171, 255]);
    expect(canvas.ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it('does not write for an empty target rectangle', () => {
    const [result] = patch({ size, bitmap: createMockImageBitmap(size.width, size.height) })(
      args({ sourceRect: { x: 0, y: 0, width: 0, height: 0 } })
    );
    const canvas = result as unknown as RecordingCanvas;

    expect(canvas.ctx.getImageData).not.toHaveBeenCalled();
    expect(canvas.ctx.putImageData).not.toHaveBeenCalled();
  });

  it('keeps diffusion step 7 distinct from step 6', () => {
    const [diffusionSix] = patch({ size, bitmap: createMockImageBitmap(size.width, size.height) })(
      args({ sourceRect: { x: 0, y: 0, width: 9, height: 9 }, donorPoint: { x: 1, y: 0 }, diffusion: 6 })
    );
    const [diffusionSeven] = patch({ size, bitmap: createMockImageBitmap(size.width, size.height) })(
      args({ sourceRect: { x: 0, y: 0, width: 9, height: 9 }, donorPoint: { x: 1, y: 0 }, diffusion: 7 })
    );
    const sixCanvas = diffusionSix as unknown as RecordingCanvas;
    const sevenCanvas = diffusionSeven as unknown as RecordingCanvas;
    const interior = (4 * size.width + 4) * 4;

    expect(Array.from(sixCanvas.buffer.slice(interior, interior + 4))).not.toEqual(
      Array.from(sevenCanvas.buffer.slice(interior, interior + 4))
    );
  });
});
