import { describe, expect, it, vi } from 'vitest';
import { encodeIco } from '../ico-utils.ts';

describe('ICO encoding', () => {
  it('embeds the canvas PNG in an ICO container', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(png));

    const blob = await encodeIco(canvas);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe('image/x-icon');
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(1);
    expect(bytes[6]).toBe(32);
    expect(bytes[7]).toBe(24);
    expect(view.getUint32(14, true)).toBe(3);
    expect(view.getUint32(18, true)).toBe(22);
    expect([...bytes.slice(22)]).toEqual([112, 110, 103]);
  });
});
