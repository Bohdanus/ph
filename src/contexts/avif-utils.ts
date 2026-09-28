import { decode, encode } from '@jsquash/avif';
import { getCanvasImageData, imageDataToImage } from './raster-utils.ts';

/**
 * Refuse to rasterise an image larger than this many pixels — 80 MP, which is 320 MB of RGBA
 * on the canvas, the ImageData copy and the data URL. The number is a product decision, not a
 * security constant, and it currently sits *below* the 100 MP the New Image dialog can create,
 * so the ceiling itself is still an open question (HANDOFF.md item 45). `assertPixelBudget` is
 * the single place the rule lives, so the encoder cannot drift from the decoder and write a file
 * this build then refuses to reopen. Above the ceiling the file is rejected, never clamped or
 * downscaled: a clamp silently hands the user a smaller image than the one they opened.
 */
const MAX_AVIF_PIXELS = 80_000_000;

function assertPixelBudget(width: number, height: number, action: 'open' | 'save') {
  if (width * height > MAX_AVIF_PIXELS) {
    throw new Error(`AVIF image is too large to ${action} (${width}×${height}). Maximum is ${MAX_AVIF_PIXELS} pixels.`);
  }
}

export async function loadAvifFile(file: Blob): Promise<HTMLImageElement> {
  // The geometry is only known once the codec has returned, so the budget cannot sit before
  // `decode()`. It still bounds everything downstream of it — the canvas, the ImageData copy
  // and the PNG data URL — rather than leaving those to the size the decoder reports.
  const imageData = await decode(await file.arrayBuffer());
  if (!imageData) {
    throw new Error('Failed to decode AVIF image');
  }
  assertPixelBudget(imageData.width, imageData.height, 'open');
  return imageDataToImage(imageData, 'Failed to decode AVIF image');
}

export async function encodeAvif(canvas: HTMLCanvasElement): Promise<Blob> {
  // The same budget the loader applies, on the same reasoning as `encodeTiff`: whatever this
  // build writes it has to be able to read back. Here the geometry is synchronous, so the check
  // sits before the pixels are read and a refused canvas costs a comparison rather than a
  // `getImageData` copy of the whole raster.
  assertPixelBudget(canvas.width, canvas.height, 'save');

  const buffer = await encode(getCanvasImageData(canvas), { quality: 80 });
  return new Blob([buffer], { type: 'image/avif' });
}
