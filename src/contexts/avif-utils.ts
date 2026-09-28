import { decode, encode } from '@jsquash/avif';
import { getCanvasImageData, imageDataToImage } from './raster-utils.ts';

/** Refuse to rasterise a decoded image larger than this many pixels (≈ 400 MP, 1.6 GB RGBA). */
const MAX_AVIF_PIXELS = 80_000_000;

export async function loadAvifFile(file: Blob): Promise<HTMLImageElement> {
  // The geometry is only known once the codec has returned, so the budget cannot sit before
  // `decode()`. It still bounds everything downstream of it — the canvas, the ImageData copy
  // and the PNG data URL — rather than leaving those to the size the decoder reports.
  const imageData = await decode(await file.arrayBuffer());
  if (!imageData) {
    throw new Error('Failed to decode AVIF image');
  }
  if (imageData.width * imageData.height > MAX_AVIF_PIXELS) {
    throw new Error(
      `AVIF image is too large to open (${imageData.width}×${imageData.height}). ` +
        `Maximum is ${MAX_AVIF_PIXELS} pixels.`
    );
  }
  return imageDataToImage(imageData, 'Failed to decode AVIF image');
}

export async function encodeAvif(canvas: HTMLCanvasElement): Promise<Blob> {
  const buffer = await encode(getCanvasImageData(canvas), { quality: 80 });
  return new Blob([buffer], { type: 'image/avif' });
}
