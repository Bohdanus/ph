import { MAX_CREATABLE_DOCUMENT_PIXELS } from './raster-utils.ts';

export const MAX_SVG_SOURCE_BYTES = 64 * 1024 * 1024;

export function encodeSvg(canvas: HTMLCanvasElement): Blob {
  const { width, height } = canvas;
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `SVG image is too large to save (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('SVG image could not encode the canvas as a PNG data URL');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${dataUrl}" width="${width}" height="${height}" /></svg>`;
  if (svg.length > MAX_SVG_SOURCE_BYTES) {
    throw new Error(`SVG image is too large to save (${svg.length} bytes). Maximum is ${MAX_SVG_SOURCE_BYTES} bytes.`);
  }
  return new Blob([svg], { type: 'image/svg+xml' });
}
