import { describe, expect, it, vi } from 'vitest';
import { encodeAvif } from '../avif-utils.ts';

const { encode } = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('@jsquash/avif', () => ({ decode: vi.fn(), encode }));

describe('AVIF encoding', () => {
  it('encodes canvas pixels with the AVIF codec', async () => {
    const imageData = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    const context = { getImageData: vi.fn(() => imageData) };
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    encode.mockResolvedValue(new ArrayBuffer(4));

    const blob = await encodeAvif(canvas);

    expect(encode).toHaveBeenCalledExactlyOnceWith(imageData, { quality: 80 });
    expect(blob.type).toBe('image/avif');
    expect(blob.size).toBe(4);
  });
});
