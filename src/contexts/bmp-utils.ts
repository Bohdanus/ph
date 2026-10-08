import {
  getCanvasImageData,
  imageDataToImage,
  MAX_CREATABLE_DOCUMENT_PIXELS,
  type RgbaImageData,
} from './raster-utils.ts';

const BMP_SIGNATURE = 0x4d42;
const BI_RGB = 0;
const BI_BITFIELDS = 3;

function ensureRange(view: DataView, offset: number, length: number) {
  if (offset < 0 || offset + length > view.byteLength) {
    throw new Error('Invalid BMP file');
  }
}

function channelFromMask(value: number, mask: number): number {
  if (!mask) return 0;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0 && shift < 32) shift++;
  const scaledMask = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / scaledMask);
}

export function decodeBmp(buffer: ArrayBuffer): RgbaImageData {
  const view = new DataView(buffer);
  ensureRange(view, 0, 54);
  if (view.getUint16(0, true) !== BMP_SIGNATURE) throw new Error('Invalid BMP signature');

  const pixelOffset = view.getUint32(10, true);
  const dibOffset = 14;
  const dibSize = view.getUint32(dibOffset, true);
  if (dibSize < 40) throw new Error('Unsupported BMP header');
  ensureRange(view, dibOffset, dibSize);

  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const colorsUsed = view.getUint32(46, true);
  if (width <= 0 || rawHeight === 0 || planes !== 1) throw new Error('Invalid BMP dimensions');
  if (![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)) throw new Error('Unsupported BMP color depth');
  if (compression !== BI_RGB && !(compression === BI_BITFIELDS && (bitsPerPixel === 16 || bitsPerPixel === 32))) {
    throw new Error('Unsupported BMP compression');
  }

  const height = Math.abs(rawHeight);
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `BMP image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  ensureRange(view, pixelOffset, rowStride * height);
  const output = new Uint8ClampedArray(width * height * 4);

  let redMask = 0x00ff0000;
  let greenMask = 0x0000ff00;
  let blueMask = 0x000000ff;
  let alphaMask = 0;
  if (compression === BI_BITFIELDS) {
    const maskOffset = dibSize >= 52 ? dibOffset + 40 : dibOffset + dibSize;
    ensureRange(view, maskOffset, bitsPerPixel === 32 && dibSize >= 56 ? 16 : 12);
    redMask = view.getUint32(maskOffset, true);
    greenMask = view.getUint32(maskOffset + 4, true);
    blueMask = view.getUint32(maskOffset + 8, true);
    if (bitsPerPixel === 32 && dibSize >= 56) alphaMask = view.getUint32(maskOffset + 12, true);
  }

  const palette: number[][] = [];
  if (bitsPerPixel <= 8) {
    const paletteCount = colorsUsed || 1 << bitsPerPixel;
    const paletteOffset = dibOffset + dibSize;
    ensureRange(view, paletteOffset, paletteCount * 4);
    for (let index = 0; index < paletteCount; index++) {
      const offset = paletteOffset + index * 4;
      palette.push([view.getUint8(offset + 2), view.getUint8(offset + 1), view.getUint8(offset), 255]);
    }
  }

  for (let sourceY = 0; sourceY < height; sourceY++) {
    const targetY = rawHeight > 0 ? height - sourceY - 1 : sourceY;
    const rowOffset = pixelOffset + sourceY * rowStride;
    for (let x = 0; x < width; x++) {
      let red: number;
      let green: number;
      let blue: number;
      let alpha = 255;
      if (bitsPerPixel <= 8) {
        let index: number;
        if (bitsPerPixel === 8) index = view.getUint8(rowOffset + x);
        else if (bitsPerPixel === 4) {
          const value = view.getUint8(rowOffset + Math.floor(x / 2));
          index = x % 2 === 0 ? value >> 4 : value & 0x0f;
        } else {
          const value = view.getUint8(rowOffset + Math.floor(x / 8));
          index = (value >> (7 - (x % 8))) & 1;
        }
        const color = palette[index];
        if (!color) throw new Error('Invalid BMP palette index');
        [red, green, blue, alpha] = color;
      } else if (bitsPerPixel === 24) {
        const offset = rowOffset + x * 3;
        blue = view.getUint8(offset);
        green = view.getUint8(offset + 1);
        red = view.getUint8(offset + 2);
      } else if (bitsPerPixel === 16) {
        const value = view.getUint16(rowOffset + x * 2, true);
        if (compression === BI_RGB) {
          red = (((value >> 10) & 0x1f) * 255) / 31;
          green = (((value >> 5) & 0x1f) * 255) / 31;
          blue = ((value & 0x1f) * 255) / 31;
        } else {
          red = channelFromMask(value, redMask);
          green = channelFromMask(value, greenMask);
          blue = channelFromMask(value, blueMask);
          alpha = alphaMask ? channelFromMask(value, alphaMask) : 255;
        }
      } else {
        const offset = rowOffset + x * 4;
        if (compression === BI_RGB) {
          blue = view.getUint8(offset);
          green = view.getUint8(offset + 1);
          red = view.getUint8(offset + 2);
        } else {
          const value = view.getUint32(offset, true);
          red = channelFromMask(value, redMask);
          green = channelFromMask(value, greenMask);
          blue = channelFromMask(value, blueMask);
          alpha = alphaMask ? channelFromMask(value, alphaMask) : 255;
        }
      }

      const outputOffset = (targetY * width + x) * 4;
      output[outputOffset] = red;
      output[outputOffset + 1] = green;
      output[outputOffset + 2] = blue;
      output[outputOffset + 3] = alpha;
    }
  }

  return { data: output, width, height };
}

export async function loadBmpFile(file: Blob): Promise<HTMLImageElement> {
  return imageDataToImage(decodeBmp(await file.arrayBuffer()), 'Failed to decode BMP image');
}

export async function encodeBmp(canvas: HTMLCanvasElement): Promise<Blob> {
  const imageData = getCanvasImageData(canvas);
  const { width, height, data } = imageData;
  const rowStride = width * 4;
  const dibSize = 56;
  const pixelOffset = 14 + dibSize;
  const buffer = new ArrayBuffer(pixelOffset + rowStride * height);
  const view = new DataView(buffer);
  view.setUint16(0, BMP_SIGNATURE, true);
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, dibSize, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, BI_BITFIELDS, true);
  view.setUint32(34, rowStride * height, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(54, 0x00ff0000, true);
  view.setUint32(58, 0x0000ff00, true);
  view.setUint32(62, 0x000000ff, true);
  view.setUint32(66, 0xff000000, true);

  const output = new Uint8Array(buffer);
  for (let y = 0; y < height; y++) {
    const sourceY = height - y - 1;
    const rowOffset = pixelOffset + y * rowStride;
    for (let x = 0; x < width; x++) {
      const sourceOffset = (sourceY * width + x) * 4;
      const targetOffset = rowOffset + x * 4;
      output[targetOffset] = data[sourceOffset + 2];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset];
      output[targetOffset + 3] = data[sourceOffset + 3];
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}
