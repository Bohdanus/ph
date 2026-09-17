import { saveImageToDisk } from './image-load-save-utils.ts';

export const saveImage = async (
  canvas: HTMLCanvasElement | null,
  filename: string,
  format: string = 'image/png',
  quality?: number
) => {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  await saveImageToDisk(canvas, filename, format, quality);
  return true;
};
