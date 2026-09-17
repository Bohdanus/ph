import UTIF from 'utif';
import { imageDataToImage } from './raster-utils.ts';

export async function loadTiffFile(file: Blob): Promise<HTMLImageElement> {
  const buffer = await file.arrayBuffer();
  const pages = UTIF.decode(buffer);
  const page = pages[0];

  if (!page) {
    throw new Error('TIFF file contains no image pages');
  }

  UTIF.decodeImage(buffer, page);
  const { width, height } = page;
  if (!width || !height) {
    throw new Error('TIFF image has invalid dimensions');
  }

  const rgba = UTIF.toRGBA8(page);
  return imageDataToImage({ data: rgba, width, height }, 'Failed to decode TIFF image');
}

export async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to read canvas pixels for TIFF encoding');
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const buffer = UTIF.encodeImage(data, canvas.width, canvas.height);
  return new Blob([buffer], { type: 'image/tiff' });
}
