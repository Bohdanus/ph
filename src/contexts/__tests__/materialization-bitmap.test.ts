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

  it('accepts HTMLCanvasElement and returns an ImageBitmap when createImageBitmap is available', async () => {
    const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
    const owned = { width: 100, height: 100, close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => owned);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    await expect(toOwnedBitmap(canvas)).resolves.toBe(owned);
    expect(createImageBitmap).toHaveBeenCalledWith(canvas);
  });

  it('falls back to the HTMLCanvasElement when createImageBitmap is unavailable', async () => {
    const canvas = { width: 100, height: 100 } as HTMLCanvasElement;
    vi.stubGlobal('createImageBitmap', undefined);

    await expect(toOwnedBitmap(canvas)).resolves.toBe(canvas);
  });

  it.each([{} as OffscreenCanvas, { width: 100, height: 100 } as HTMLCanvasElement])(
    'propagates errors when createImageBitmap throws',
    async (canvas) => {
      const createImageBitmap = vi.fn(async () => {
        throw new Error('createImageBitmap failed');
      });
      vi.stubGlobal('createImageBitmap', createImageBitmap);

      await expect(toOwnedBitmap(canvas)).rejects.toThrow('createImageBitmap failed');
    }
  );
});
