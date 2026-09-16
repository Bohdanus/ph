import { resolveImageFormat, withFileExtension } from '../constants/imageFormats.ts';

export const saveImage = (canvas: HTMLCanvasElement | null, filename: string, format: string = 'image/png') => {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const imageFormat = resolveImageFormat(format);
  const link = document.createElement('a');
  link.download = withFileExtension(filename, imageFormat.extension);
  link.href = canvas.toDataURL(imageFormat.mimeType);
  link.click();

  return true;
};
