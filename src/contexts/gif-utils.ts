import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { getCanvasImageData } from './raster-utils.ts';

// gifenc's `oneBitAlpha` binarises each quantised cluster's mean alpha against this
// threshold, so the wrapper has to agree with it on which pixels are transparent
// instead of inventing a second cut-off.
const TRANSPARENT_ALPHA_THRESHOLD = 127;

export async function encodeGif(canvas: HTMLCanvasElement): Promise<Blob> {
  const { data, width, height } = getCanvasImageData(canvas);
  if (!width || !height) {
    throw new Error('GIF dimensions must be greater than zero');
  }
  if (width > 65535 || height > 65535) {
    throw new Error('GIF dimensions cannot exceed 65535 pixels');
  }

  // One strided pass over the alpha bytes only. Scanning all four channels through a
  // modulo predicate was the dominant cost of this path, and the early exit keeps a fully
  // opaque document down to a single sweep.
  let hasTransparency = false;
  let hasTransparentPixels = false;
  for (let offset = 3; offset < data.length; offset += 4) {
    const alpha = data[offset];
    if (alpha < 255) hasTransparency = true;
    if (alpha <= TRANSPARENT_ALPHA_THRESHOLD) {
      // This also implies `hasTransparency`, since a transparent pixel is not opaque.
      hasTransparentPixels = true;
      break;
    }
  }

  const paletteFormat = hasTransparency ? 'rgba4444' : 'rgb565';
  let palette: number[][];
  let index: Uint8Array;
  if (hasTransparentPixels) {
    // `quantize` merges colour bins on RGB alone and only binarises the surviving
    // clusters' mean alpha afterwards, so a transparent pixel can be absorbed into an
    // opaque neighbour and leave the palette with no zero-alpha entry at all. Reserve
    // slot 0 rather than searching for one the merge already destroyed.
    const opaquePalette = quantize(data, 255, { format: paletteFormat, oneBitAlpha: true });
    palette = [[0, 0, 0, 0], ...opaquePalette];
    index = applyPalette(data, palette, paletteFormat);
    for (let pixel = 0, pixels = data.length >> 2; pixel < pixels; pixel += 1) {
      if (data[pixel * 4 + 3] <= TRANSPARENT_ALPHA_THRESHOLD) index[pixel] = 0;
    }
  } else {
    palette = quantize(data, 256, { format: paletteFormat, oneBitAlpha: hasTransparency });
    index = applyPalette(data, palette, paletteFormat);
  }

  const encoder = GIFEncoder();
  encoder.writeFrame(index, width, height, {
    palette,
    transparent: hasTransparentPixels,
    transparentIndex: 0,
  });
  encoder.finish();
  const bytes = encoder.bytes();
  const output = new Uint8Array(bytes.length);
  output.set(bytes);
  return new Blob([output.buffer], { type: 'image/gif' });
}
