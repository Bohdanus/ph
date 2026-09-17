import { decodeBmp } from './bmp-utils.ts';
import { canvasToPngBlob, imageDataToImage } from './raster-utils.ts';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(data: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => data[index] === byte);
}

function ensureRange(view: DataView, offset: number, length: number) {
  if (offset < 0 || offset + length > view.byteLength) throw new Error('Invalid ICO file');
}

function decodeBmpIcon(data: Uint8Array): ReturnType<typeof decodeBmp> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  ensureRange(view, 0, 40);
  const dibSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const rawHeight = view.getInt32(8, true);
  const bitsPerPixel = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  const colorsUsed = view.getUint32(32, true);
  if (dibSize < 40 || width <= 0 || rawHeight <= 0 || rawHeight % 2 !== 0) {
    throw new Error('Invalid ICO bitmap dimensions');
  }

  let auxiliarySize = 0;
  if (compression === 3 && dibSize === 40) auxiliarySize = 12;
  const paletteCount = bitsPerPixel <= 8 ? colorsUsed || 1 << bitsPerPixel : 0;
  const pixelDataOffset = dibSize + auxiliarySize + paletteCount * 4;
  const height = rawHeight / 2;
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const xorSize = rowStride * height;
  const maskStride = Math.ceil(width / 8) * 4;
  ensureRange(view, pixelDataOffset, xorSize + maskStride * height);

  const synthetic = new ArrayBuffer(14 + pixelDataOffset + xorSize);
  const syntheticView = new DataView(synthetic);
  syntheticView.setUint16(0, 0x4d42, true);
  syntheticView.setUint32(2, synthetic.byteLength, true);
  syntheticView.setUint32(10, 14 + pixelDataOffset, true);
  new Uint8Array(synthetic, 14, pixelDataOffset).set(data.subarray(0, pixelDataOffset));
  const syntheticDib = new DataView(synthetic, 14);
  syntheticDib.setInt32(8, height, true);
  new Uint8Array(synthetic, 14 + pixelDataOffset).set(data.subarray(pixelDataOffset, pixelDataOffset + xorSize));

  const decoded = decodeBmp(synthetic);
  const maskOffset = pixelDataOffset + xorSize;
  for (let sourceY = 0; sourceY < height; sourceY++) {
    const targetY = height - sourceY - 1;
    const rowOffset = maskOffset + sourceY * maskStride;
    for (let x = 0; x < width; x++) {
      const maskByte = data[rowOffset + Math.floor(x / 8)];
      if (((maskByte >> (7 - (x % 8))) & 1) === 1) decoded.data[(targetY * width + x) * 4 + 3] = 0;
    }
  }
  return decoded;
}

export async function loadIcoFile(file: Blob): Promise<HTMLImageElement> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  ensureRange(view, 0, 22);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1 || view.getUint16(4, true) < 1) {
    throw new Error('Invalid ICO header');
  }

  const imageCount = view.getUint16(4, true);
  ensureRange(view, 6, imageCount * 16);
  let bestEntryOffset = 6;
  let bestArea = 0;
  for (let index = 0; index < imageCount; index++) {
    const entryOffset = 6 + index * 16;
    const width = view.getUint8(entryOffset) || 256;
    const height = view.getUint8(entryOffset + 1) || 256;
    const area = width * height;
    if (area > bestArea) {
      bestArea = area;
      bestEntryOffset = entryOffset;
    }
  }

  const imageSize = view.getUint32(bestEntryOffset + 8, true);
  const imageOffset = view.getUint32(bestEntryOffset + 12, true);
  ensureRange(view, imageOffset, imageSize);
  const image = new Uint8Array(buffer, imageOffset, imageSize);
  if (!isPng(image)) return imageDataToImage(decodeBmpIcon(image), 'Failed to decode ICO image');

  const png = new Blob([image], { type: 'image/png' });
  const url = URL.createObjectURL(png);
  try {
    return await new Promise((resolve, reject) => {
      const imageElement = new Image();
      imageElement.onload = () => resolve(imageElement);
      imageElement.onerror = () => reject(new Error('Failed to decode ICO image'));
      imageElement.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function encodeIco(canvas: HTMLCanvasElement): Promise<Blob> {
  const png = new Uint8Array(await (await canvasToPngBlob(canvas)).arrayBuffer());
  const { width, height } = canvas;
  if (width < 1 || height < 1 || width > 256 || height > 256) {
    throw new Error('ICO dimensions cannot exceed 256 pixels');
  }

  const headerSize = 6;
  const directorySize = 16;
  const imageOffset = headerSize + directorySize;
  const buffer = new ArrayBuffer(imageOffset + png.length);
  const view = new DataView(buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint8(6, width === 256 ? 0 : width);
  view.setUint8(7, height === 256 ? 0 : height);
  view.setUint8(8, 0);
  view.setUint8(9, 0);
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, png.length, true);
  view.setUint32(18, imageOffset, true);
  new Uint8Array(buffer, imageOffset).set(png);
  return new Blob([buffer], { type: 'image/x-icon' });
}
