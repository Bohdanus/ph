import { decodeBmp } from './bmp-utils.ts';
import { canvasToPngBlob, imageDataToImage } from './raster-utils.ts';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The largest edge an ICO can express. A directory entry stores each axis in one byte, where a
 * stored `0` means 256 rather than 0, so 256 is the format's own maximum and not a round number
 * this app chose. It is declared once because both halves of the format have to agree on it: an
 * entry that opens at 512×512 and then cannot be saved back is a file the app accepts and then
 * refuses to write.
 */
const MAX_EDGE = 256;

/**
 * One ceiling for every geometry an ICO can present, on the way in and on the way out. The two
 * halves of `loadIcoFile` reach their geometry differently — a DIB declares it in a header, a PNG
 * entry only in the stream the browser decodes — so the shared helper is what makes "opens, and can
 * be saved back" one property rather than two coincidental ones.
 */
function assertWithinMaxEdge(width: number, height: number, action: 'open' | 'save') {
  // The integer test is not decoration. A PNG entry's geometry arrives from the browser rather
  // than from a header this module parses, and `undefined < 1` and `undefined > 256` are both
  // false — so a shape guard written only with the range comparisons waves an unreadable geometry
  // straight through, which is the same defect the AVIF budget had.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`ICO image has invalid dimensions to ${action} (${width}×${height}).`);
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    if (action === 'save') {
      throw new Error('ICO dimensions cannot exceed 256 pixels');
    }
    throw new Error(`ICO image is too large to open (${width}×${height}). Maximum is ${MAX_EDGE} pixels per axis.`);
  }
}

/**
 * Width and height from a PNG's IHDR chunk, which the format requires to be the first chunk after
 * the signature: 8 signature bytes, a 4-byte length, a 4-byte type, then the two 4-byte big-endian
 * values. Reading them here is a pure byte decode — it is how the ceiling on this branch can be
 * enforced before the browser allocates the raster rather than after.
 *
 * Returns `null` when the header is not the shape described, which leaves the caller to fall back
 * on the browser-reported geometry: a malformed IHDR is the decoder's error to report, not this
 * guard's to invent.
 */
function pngDimensions(data: Uint8Array): [number, number] | null {
  if (data.length < 24) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunkType = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunkType !== 'IHDR') return null;
  return [view.getUint32(16), view.getUint32(20)];
}

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
  // The geometry a BMP-shaped DIB decodes to, against the same ceiling `encodeIco` enforces on
  // the way out. Checked on the declared axes rather than on the directory entry, because the
  // entry's zero-byte-means-256 convention is a property of the *directory* — a DIB declares real
  // dimensions, and it is those that reach `decodeBmp`.
  assertWithinMaxEdge(width, rawHeight / 2, 'open');
  const height = rawHeight / 2;

  const paletteCount = bitsPerPixel <= 8 ? colorsUsed || 1 << bitsPerPixel : 0;
  const rowStride = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const xorSize = rowStride * height;
  const maskStride = Math.ceil(width / 8) * 4;
  const payloadSize = xorSize + maskStride * height;
  // A 40-byte BI_BITFIELDS DIB is followed by the three RGB mask DWORDs, and the alpha DWORD
  // that grows the block to 16 bytes is an optional extension the format does not require. In
  // an ICO the masks sit outside the header, so `dibSize` is 40 in both forms and cannot tell
  // them apart: the only discriminator is whether the entry still holds the XOR rows and the
  // AND mask that follow the wider block. Where both fit, the 4-byte difference is
  // unobservable, so the wider reading is the default and the narrower one the fallback.
  let auxiliarySize = 0;
  if (compression === 3 && dibSize === 40) {
    const wideBlockSize = dibSize + 16 + paletteCount * 4;
    auxiliarySize = bitsPerPixel === 32 && wideBlockSize + payloadSize <= view.byteLength ? 16 : 12;
  }
  const pixelDataOffset = dibSize + auxiliarySize + paletteCount * 4;
  ensureRange(view, pixelDataOffset, payloadSize);

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

  // Before the blob URL, so before the browser's decode. A 4096×4096 PNG entry is a ~2-6 MB file
  // that rasterises to 67 MB, and the ceiling has to be able to see that without paying for it.
  const declared = pngDimensions(image);
  if (declared) {
    assertWithinMaxEdge(declared[0], declared[1], 'open');
  }

  const png = new Blob([image], { type: 'image/png' });
  const url = URL.createObjectURL(png);
  try {
    const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageElement = new Image();
      imageElement.onload = () => resolve(imageElement);
      imageElement.onerror = () => reject(new Error('Failed to decode ICO image'));
      imageElement.src = url;
    });
    // The authority, and the only one that can see a PNG whose IHDR was unreadable. It cannot be
    // the only one: the check above is what stops the raster being allocated at all.
    assertWithinMaxEdge(decoded.naturalWidth, decoded.naturalHeight, 'open');
    return decoded;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function encodeIco(canvas: HTMLCanvasElement): Promise<Blob> {
  // Before the encode, not after it: `canvasToPngBlob` rasterises the whole canvas through
  // `toBlob`, so `Save as ICO` on a 10000×10000 document would pay a full PNG encode of 400 MB of
  // RGBA — and allocate it — only to be refused by the geometry check below. The canvas carries its
  // own geometry, so the guard costs two comparisons.
  assertWithinMaxEdge(canvas.width, canvas.height, 'save');
  const { width, height } = canvas;

  const png = new Uint8Array(await (await canvasToPngBlob(canvas)).arrayBuffer());

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
