import { MAX_CREATABLE_DOCUMENT_PIXELS } from './raster-utils.ts';

export function encodeSvg(canvas: HTMLCanvasElement): Blob {
  const { width, height } = canvas;
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `SVG image is too large to save (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
  const dataUrl = canvas.toDataURL('image/png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${dataUrl}" width="${width}" height="${height}" /></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
