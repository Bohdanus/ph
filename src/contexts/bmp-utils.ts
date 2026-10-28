import {
  getCanvasImageData,
  imageDataToImage,
  MAX_CREATABLE_DOCUMENT_PIXELS,
  type RgbaImageData,
} from './raster-utils.ts';

const BMP_SIGNATURE = 0x4d42;
const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;
const BI_JPEG = 4;
const BI_PNG = 5;
const BI_ALPHABITFIELDS = 6;
const MAX_BMP_PIXEL_OFFSET_BYTES = 1024 * 1024;
const MAX_BMP_PREFIX_BYTES = MAX_CREATABLE_DOCUMENT_PIXELS * 4 + MAX_BMP_PIXEL_OFFSET_BYTES;

export async function preflightBmpFile(
  file: Blob,
  { allowNativeCompression = false }: { allowNativeCompression?: boolean } = {}
): Promise<Blob> {
  const header = await file.slice(0, 54).arrayBuffer();
  const view = new DataView(header);
  ensureRange(view, 0, 54);
  if (view.getUint16(0, true) !== BMP_SIGNATURE) throw new Error('Invalid BMP signature');

  const dibSize = view.getUint32(14, true);
  if (dibSize < 40) throw new Error('Unsupported BMP header');

  const pixelOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitsPerPixel = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  const imageSize = view.getUint32(34, true);
  const colorsUsed = view.getUint32(46, true);
  if (width <= 0 || rawHeight === 0) throw new Error('Invalid BMP dimensions');
  if (planes !== 1) throw new Error('Invalid BMP dimensions');

  const height = Math.abs(rawHeight);
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `BMP image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }

  if (pixelOffset > MAX_BMP_PIXEL_OFFSET_BYTES) throw new Error('BMP pixel data offset is too large');
  const dibEnd = 14 + dibSize;
  if (!Number.isSafeInteger(dibEnd) || dibEnd > pixelOffset || dibEnd > file.size) {
    throw new Error('Invalid BMP pixel data offset');
  }

  if (compression === BI_JPEG || compression === BI_PNG) {
    throw new Error('Embedded BMP image compression cannot be safely preflighted');
  }
  if (![1, 4, 8, 16, 24, 32].includes(bitsPerPixel)) {
    throw new Error('Unsupported BMP color depth');
  }
  if (
    (compression === BI_RLE8 && bitsPerPixel !== 8) ||
    (compression === BI_RLE4 && bitsPerPixel !== 4) ||
    (compression === BI_BITFIELDS && bitsPerPixel !== 16 && bitsPerPixel !== 32) ||
    (compression === BI_ALPHABITFIELDS && bitsPerPixel !== 16 && bitsPerPixel !== 32) ||
    ![BI_RGB, BI_RLE8, BI_RLE4, BI_BITFIELDS, BI_ALPHABITFIELDS].includes(compression)
  ) {
    throw new Error('Unsupported BMP compression');
  }
  if (!allowNativeCompression && compression !== BI_RGB && compression !== BI_BITFIELDS) {
    throw new Error('Unsupported BMP compression');
  }

  let metadataEnd = dibEnd;
  if (compression === BI_BITFIELDS && dibSize === 40) metadataEnd += 12;
  if (compression === BI_ALPHABITFIELDS) {
    if (dibSize === 40) metadataEnd += 16;
    else if (dibSize === 52) metadataEnd += 4;
    else if (dibSize < 56) throw new Error('Unsupported BMP alpha bitfields header');
  }
  if (bitsPerPixel <= 8) {
    const paletteCount = colorsUsed || 1 << bitsPerPixel;
    if (paletteCount > 1 << bitsPerPixel) throw new Error('Invalid BMP palette');
    metadataEnd += paletteCount * 4;
  }
  if (!Number.isSafeInteger(metadataEnd) || metadataEnd > pixelOffset) {
    throw new Error('Invalid BMP pixel data offset');
  }
  if (compression === BI_ALPHABITFIELDS) {
    const masksBuffer = await file.slice(54, 70).arrayBuffer();
    const masksView = new DataView(masksBuffer);
    ensureRange(masksView, 0, 16);
    const masks = Array.from({ length: 4 }, (_, index) => masksView.getUint32(index * 4, true));
    if (bitsPerPixel === 16 && masks.some((mask) => mask > 0xffff)) {
      throw new Error('Invalid BMP bitfield mask');
    }
    if (masks[3] === 0) throw new Error('Invalid BMP alpha bitfield mask');
    if (
      masks.some((mask) => !isContiguousBitMask(mask)) ||
      masks.some((mask, index) => masks.slice(index + 1).some((otherMask) => (mask & otherMask) !== 0))
    ) {
      throw new Error('Invalid BMP bitfield mask');
    }
  }

  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const uncompressedBytes = rowStride * height;
  let pixelDataBytes = uncompressedBytes;
  if (compression === BI_RLE8 || compression === BI_RLE4) {
    const declaredFileSize = view.getUint32(2, true);
    if (imageSize > 0) {
      pixelDataBytes = imageSize;
    } else if (declaredFileSize > pixelOffset) {
      pixelDataBytes = declaredFileSize - pixelOffset;
    } else {
      pixelDataBytes = file.size - pixelOffset;
    }
    const maxCompressedBytes = Math.max(1024, width * height * 4 + height * 2);
    if (pixelDataBytes > maxCompressedBytes) {
      throw new Error('Invalid BMP pixel data range');
    }
  }
  const pixelEnd = pixelOffset + pixelDataBytes;
  if (
    !Number.isSafeInteger(pixelEnd) ||
    pixelEnd > MAX_BMP_PREFIX_BYTES ||
    pixelEnd > file.size ||
    pixelDataBytes <= 0
  ) {
    throw new Error('Invalid BMP pixel data range');
  }

  return file.slice(0, pixelEnd, file.type);
}

function ensureRange(view: DataView, offset: number, length: number) {
  if (offset < 0 || offset + length > view.byteLength) {
    throw new Error('Invalid BMP file');
  }
}

function isContiguousBitMask(mask: number): boolean {
  if (mask === 0) return true;
  let normalizedMask = mask;
  while ((normalizedMask & 1) === 0) normalizedMask >>>= 1;
  return (normalizedMask & (normalizedMask + 1)) === 0;
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
    if (paletteCount > 1 << bitsPerPixel) throw new Error('Invalid BMP palette');
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
  const boundedFile = await preflightBmpFile(file);
  return imageDataToImage(decodeBmp(await boundedFile.arrayBuffer()), 'Failed to decode BMP image');
}

export async function encodeBmp(canvas: HTMLCanvasElement): Promise<Blob> {
  const { width, height } = canvas;
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `BMP image is too large to save (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
  const { data } = getCanvasImageData(canvas);
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
