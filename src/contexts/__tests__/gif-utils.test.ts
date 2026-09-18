import { describe, expect, it, vi } from 'vitest';
import { encodeGif } from '../gif-utils.ts';

describe('GIF encoding', () => {
  it('encodes a canvas as a valid single-frame GIF with the expected signature', async () => {
    const context = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
        width: 2,
        height: 1,
      })),
    };
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const blob = await encodeGif(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe('image/gif');
    expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.length).toBeGreaterThan(20);
    expect(bytes.at(0)).toBe(0x47);
    expect(bytes.at(1)).toBe(0x49);
    expect(bytes.at(2)).toBe(0x46);
    expect(bytes.at(3)).toBe(0x38);
    expect(bytes.at(-1)).toBe(0x3b);
  });
});
