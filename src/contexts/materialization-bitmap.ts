import type { BitmapSource } from './general-types.ts';

export async function toOwnedBitmap(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<BitmapSource> {
  if (globalThis.createImageBitmap) return globalThis.createImageBitmap(canvas);
  return canvas;
}
