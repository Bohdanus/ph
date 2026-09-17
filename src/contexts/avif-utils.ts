import { decode, encode } from '@jsquash/avif';
import { getCanvasImageData, imageDataToImage } from './raster-utils.ts';

export async function loadAvifFile(file: Blob): Promise<HTMLImageElement> {
  const imageData = await decode(await file.arrayBuffer());
  if (!imageData) {
    throw new Error('Failed to decode AVIF image');
  }
  return imageDataToImage(imageData, 'Failed to decode AVIF image');
}

export async function encodeAvif(canvas: HTMLCanvasElement): Promise<Blob> {
  const buffer = await encode(getCanvasImageData(canvas), { quality: 80 });
  return new Blob([buffer], { type: 'image/avif' });
}
