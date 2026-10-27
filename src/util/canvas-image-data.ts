import type { Size } from '../contexts/general-types.ts';
import { MAX_RASTER_SELECTION_PIXELS } from './selection-mask.ts';

const MAX_READBACK_CHUNK_PIXELS = 1_048_576;

/**
 * Read the composited document canvas on its logical pixel grid.
 *
 * The displayed canvas can have a device-pixel-ratio-sized backing bitmap, while pointer
 * positions and selection geometry remain in document pixels. `getImageData` addresses the
 * backing bitmap, so this samples each logical pixel at its centre and copies only bounded
 * source-row chunks into the logical result.
 */
export function readCanvasImageDataAtLogicalSize(
  canvas: HTMLCanvasElement | null,
  logicalSize: Size
): ImageData | null {
  const width = Number.isFinite(logicalSize.width) ? Math.floor(logicalSize.width) : 0;
  const height = Number.isFinite(logicalSize.height) ? Math.floor(logicalSize.height) : 0;
  const area = width * height;
  if (
    !canvas ||
    canvas.width <= 0 ||
    canvas.height <= 0 ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(area) ||
    area > MAX_RASTER_SELECTION_PIXELS
  ) {
    return null;
  }

  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // The common 1x backing already is the logical grid. Returning that readback directly
    // avoids holding a second full RGBA frame while Magic Wand or Magnetic Lasso builds its
    // own mask/gradient buffer.
    if (canvas.width === width && canvas.height === height) {
      return ctx.getImageData(0, 0, width, height);
    }

    const imageData = ctx.createImageData(width, height);
    // `resizeCanvas()` rounds the backing dimensions but applies the unrounded device
    // pixel ratio to the context transform. Recover that authored ratio when available;
    // deriving it from (for example) 5 backing pixels / 3 document pixels shifts the
    // last logical pixel centre from backing column 3 to column 4 at DPR 1.5.
    const ratioAttribute = canvas.getAttribute?.('data-hidpi-ratio');
    const declaredRatio = ratioAttribute === null || ratioAttribute === undefined ? Number.NaN : Number(ratioAttribute);
    const hasDeclaredRatio =
      Number.isFinite(declaredRatio) &&
      declaredRatio > 0 &&
      canvas.width === Math.round(width * declaredRatio) &&
      canvas.height === Math.round(height * declaredRatio);
    const scaleX = hasDeclaredRatio ? declaredRatio : canvas.width / width;
    const scaleY = hasDeclaredRatio ? declaredRatio : canvas.height / height;
    const rowsPerChunk = Math.max(1, Math.floor(MAX_READBACK_CHUNK_PIXELS / (canvas.width * scaleY)));

    for (let logicalTop = 0; logicalTop < height; logicalTop += rowsPerChunk) {
      const logicalBottom = Math.min(height, logicalTop + rowsPerChunk);
      const firstSourceY = Math.min(canvas.height - 1, Math.floor((logicalTop + 0.5) * scaleY));
      const lastSourceY = Math.min(canvas.height - 1, Math.floor((logicalBottom - 0.5) * scaleY));
      const source = ctx.getImageData(0, firstSourceY, canvas.width, lastSourceY - firstSourceY + 1);

      for (let logicalY = logicalTop; logicalY < logicalBottom; logicalY += 1) {
        const sourceY = Math.min(canvas.height - 1, Math.floor((logicalY + 0.5) * scaleY));
        const sourceRow = (sourceY - firstSourceY) * canvas.width * 4;
        const targetRow = logicalY * width * 4;
        for (let logicalX = 0; logicalX < width; logicalX += 1) {
          const sourceX = Math.min(canvas.width - 1, Math.floor((logicalX + 0.5) * scaleX));
          const sourceOffset = sourceRow + sourceX * 4;
          const targetOffset = targetRow + logicalX * 4;
          imageData.data[targetOffset] = source.data[sourceOffset]!;
          imageData.data[targetOffset + 1] = source.data[sourceOffset + 1]!;
          imageData.data[targetOffset + 2] = source.data[sourceOffset + 2]!;
          imageData.data[targetOffset + 3] = source.data[sourceOffset + 3]!;
        }
      }
    }

    return imageData;
  } catch (error) {
    console.error(error);
    return null;
  }
}
