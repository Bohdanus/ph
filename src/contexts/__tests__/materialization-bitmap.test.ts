import { afterEach, describe, expect, it, vi } from 'vitest';
import { toOwnedBitmap } from '../materialization-bitmap.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toOwnedBitmap', () => {
  it('uses createImageBitmap when the platform provides it', async () => {
    const canvas = {} as OffscreenCanvas;
    const owned = { close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => owned);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    await expect(toOwnedBitmap(canvas)).resolves.toBe(owned);
    expect(createImageBitmap).toHaveBeenCalledWith(canvas);
  });

  it('falls back to the canvas when createImageBitmap is unavailable', async () => {
    const canvas = {} as OffscreenCanvas;
    vi.stubGlobal('createImageBitmap', undefined);

    await expect(toOwnedBitmap(canvas)).resolves.toBe(canvas);
  });
});
