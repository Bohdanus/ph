import { describe, expect, it, vi } from 'vitest';
import { decodeBmp, encodeBmp } from '../bmp-utils.ts';

describe('BMP encoding and decoding', () => {
  it('round-trips canvas RGBA pixels through a 32-bit BMP', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
    const context = { getImageData: vi.fn(() => ({ data: pixels, width: 2, height: 1 })) };
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const blob = await encodeBmp(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = decodeBmp(bytes.buffer);

    expect(blob.type).toBe('image/bmp');
    expect(bytes[0]).toBe(0x42);
    expect(bytes[1]).toBe(0x4d);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect([...decoded.data]).toEqual([...pixels]);
  });
});
