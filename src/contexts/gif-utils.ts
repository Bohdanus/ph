import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { getCanvasImageData } from './raster-utils.ts';

export async function encodeGif(canvas: HTMLCanvasElement): Promise<Blob> {
  const { data, width, height } = getCanvasImageData(canvas);
  if (!width || !height) {
    throw new Error('GIF dimensions must be greater than zero');
  }
  if (width > 65535 || height > 65535) {
    throw new Error('GIF dimensions cannot exceed 65535 pixels');
  }

  const hasTransparency = data.some((value, index) => index % 4 === 3 && value < 255);
  const paletteFormat = hasTransparency ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format: paletteFormat, oneBitAlpha: hasTransparency });
  const index = applyPalette(data, palette, paletteFormat);
  const transparentIndex = hasTransparency ? palette.findIndex((color) => color[3] === 0) : -1;
  const encoder = GIFEncoder();
  encoder.writeFrame(index, width, height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
  });
  encoder.finish();
  const bytes = encoder.bytes();
  const output = new Uint8Array(bytes.length);
  output.set(bytes);
  return new Blob([output.buffer], { type: 'image/gif' });
}
