import { describe, expect, it, vi } from 'vitest';
import { decodeBmp, encodeBmp, loadBmpFile } from '../bmp-utils.ts';

describe('BMP encoding and decoding', () => {
  it('round-trips canvas RGBA pixels through a 32-bit BMP without corrupting channel order', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255]);
    const context = { getImageData: vi.fn(() => ({ data: pixels, width: 2, height: 2 })) };
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const blob = await encodeBmp(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = decodeBmp(bytes.buffer);

    expect(blob.type).toBe('image/bmp');
    expect(bytes[0]).toBe(0x42);
    expect(bytes[1]).toBe(0x4d);
    expect(bytes.byteLength).toBeGreaterThan(54);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect([...decoded.data]).toEqual([...pixels]);
  });
});

function makeBmpHeader() {
  const buffer = new ArrayBuffer(54);
  const view = new DataView(buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, 54, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 2, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 0, true);
  return view;
}

describe('BMP decoding error paths', () => {
  it('rejects buffers with an invalid BMP signature', () => {
    const view = makeBmpHeader();
    view.setUint16(0, 0x0000, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Invalid BMP signature');
  });

  it('rejects headers smaller than the BITMAPINFOHEADER minimum', () => {
    const view = makeBmpHeader();
    view.setUint32(14, 20, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP header');
  });

  it('rejects non-positive dimensions', () => {
    const view = makeBmpHeader();
    view.setInt32(18, 0, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Invalid BMP dimensions');
  });

  it('rejects unsupported color depths', () => {
    const view = makeBmpHeader();
    view.setUint16(28, 15, true);
    expect(() => decodeBmp(view.buffer)).toThrow('Unsupported BMP color depth');
  });

  it('rejects loadBmpFile when the buffer is not a valid BMP', async () => {
    const view = makeBmpHeader();
    view.setUint16(0, 0x0000, true);
    const blob = new Blob([view.buffer], { type: 'image/bmp' });
    await expect(loadBmpFile(blob)).rejects.toThrow('Invalid BMP signature');
  });
});
