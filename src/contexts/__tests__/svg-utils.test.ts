import { describe, expect, it, vi } from 'vitest';
import { encodeSvg } from '../svg-utils.ts';

describe('SVG encoding', () => {
  it('wraps the flattened canvas PNG in a valid SVG image', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,pixels');

    const blob = encodeSvg(canvas);

    expect(blob.type).toBe('image/svg+xml');
    await expect(blob.text()).resolves.toContain('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"');
    await expect(blob.text()).resolves.toContain('data:image/png;base64,pixels');
  });
});
