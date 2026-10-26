import type { Pos, RasterSelectionMask } from '../contexts/general-types.ts';

/** Above this many directed pixel-boundary edges, retaining Point objects is wasteful. */
export const MAX_VECTOR_SELECTION_BOUNDARY_EDGES = 32_768;
/** Bounds the temporary readback, flood-fill workspace, and persisted selection-mask area. */
export const MAX_RASTER_SELECTION_PIXELS = 16_777_216;

/** Validate document-space pixel dimensions before allocating full-frame selection buffers. */
export function isRasterSelectionSizeWithinBudget(width: number, height: number): boolean {
  if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0) return false;
  const area = width * height;
  return Number.isSafeInteger(area) && area <= MAX_RASTER_SELECTION_PIXELS;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_CHUNK_BYTES = 3 * 8_192;
const DECODED_MASK_CACHE_LIMIT = 2;

type DecodedMaskCacheEntry = { width: number; height: number; data: string; packed: Uint8Array };
const decodedMaskCache: DecodedMaskCacheEntry[] = [];

function isPlainDataObject(value: unknown, requiredKeys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== requiredKeys.length) return false;
  return (
    requiredKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    }) && keys.every((key) => typeof key === 'string' && requiredKeys.includes(key))
  );
}

/**
 * Validate the JSON-safe representation before history accepts or decodes it.
 * The encoded byte count is exact, so an oversized or truncated payload cannot make
 * a later replay allocate an attacker-controlled amount of memory.
 */
export function isCanonicalRasterSelectionMask(value: unknown): value is RasterSelectionMask {
  if (!isPlainDataObject(value, ['width', 'height', 'data'])) return false;
  const { width, height, data } = value;
  if (
    typeof width !== 'number' ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !isRasterSelectionSizeWithinBudget(width, height) ||
    typeof data !== 'string'
  ) {
    return false;
  }

  const byteLength = Math.ceil((width * height) / 8);
  const expectedLength = Math.ceil(byteLength / 3) * 4;
  // Check this before scanning either the Base64 or selected-bit payload. The
  // dimensions cap the canonical payload; a tiny mask must not make validation
  // walk an arbitrarily large malformed string on the history thread.
  if (data.length !== expectedLength) return false;

  const expectedPadding = byteLength % 3 === 0 ? 0 : 3 - (byteLength % 3);
  const actualPadding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (!BASE64.test(data) || actualPadding !== expectedPadding) {
    return false;
  }

  let hasSelectedPixel = false;
  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];
    if (character !== '=' && character !== 'A') {
      hasSelectedPixel = true;
      break;
    }
  }
  if (!hasSelectedPixel) return false;

  const group = data.slice(-4);
  const values = [...group].map((character) => (character === '=' ? 0 : BASE64_ALPHABET.indexOf(character)));
  if ((actualPadding === 2 && (values[1]! & 15) !== 0) || (actualPadding === 1 && (values[2]! & 3) !== 0)) {
    return false;
  }
  const lastByte =
    byteLength % 3 === 1
      ? (values[0]! << 2) | (values[1]! >> 4)
      : byteLength % 3 === 2
        ? ((values[1]! & 15) << 4) | (values[2]! >> 2)
        : (values[2]! << 6) | values[3]!;
  const usedBits = (width * height) % 8;
  return usedBits === 0 || (lastByte & ~((1 << usedBits) - 1)) === 0;
}

function encodeBase64(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const end = Math.min(bytes.length, offset + BASE64_CHUNK_BYTES);
    let binary = '';
    for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]);
    pieces.push(btoa(binary));
  }
  return pieces.join('');
}

/**
 * Crop a one-byte-per-pixel binary mask to its selected bounds and pack one bit per pixel.
 * The returned value is JSON-safe for both legacy history and durable selection snapshots.
 */
export function encodeRasterSelectionMask(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: Pos
): RasterSelectionMask | null {
  const { x, y, width: boundsWidth, height: boundsHeight } = bounds;
  const area = boundsWidth * boundsHeight;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    mask.length < width * height ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(boundsWidth) ||
    !Number.isSafeInteger(boundsHeight) ||
    x < 0 ||
    y < 0 ||
    boundsWidth <= 0 ||
    boundsHeight <= 0 ||
    x + boundsWidth > width ||
    y + boundsHeight > height ||
    area > MAX_RASTER_SELECTION_PIXELS
  ) {
    return null;
  }

  const packed = new Uint8Array(Math.ceil(area / 8));
  let bitIndex = 0;
  let hasSelectedPixel = false;
  for (let localY = 0; localY < boundsHeight; localY += 1) {
    const row = (y + localY) * width + x;
    for (let localX = 0; localX < boundsWidth; localX += 1, bitIndex += 1) {
      if (mask[row + localX] === 1) {
        packed[bitIndex >>> 3] |= 1 << (bitIndex & 7);
        hasSelectedPixel = true;
      }
    }
  }

  if (!hasSelectedPixel) return null;
  return { width: boundsWidth, height: boundsHeight, data: encodeBase64(packed) };
}

/** Return the private cached byte array; only read-only queries may receive it. */
function cachedRasterSelectionBytes(mask: RasterSelectionMask): Uint8Array | null {
  if (isPlainDataObject(mask, ['width', 'height', 'data'])) {
    const { width, height, data } = mask;
    if (
      typeof width === 'number' &&
      Number.isSafeInteger(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isSafeInteger(height) &&
      height > 0 &&
      Number.isSafeInteger(width * height) &&
      width * height <= MAX_RASTER_SELECTION_PIXELS &&
      typeof data === 'string' &&
      data.length === Math.ceil(Math.ceil((width * height) / 8) / 3) * 4
    ) {
      const cachedIndex = decodedMaskCache.findIndex(
        (entry) => entry.width === width && entry.height === height && entry.data === data
      );
      if (cachedIndex >= 0) {
        const [cached] = decodedMaskCache.splice(cachedIndex, 1);
        if (cached) decodedMaskCache.unshift(cached);
        return cached?.packed ?? null;
      }
    }
  }

  if (!isCanonicalRasterSelectionMask(mask)) return null;
  try {
    const binary = atob(mask.data);
    if (binary.length !== Math.ceil((mask.width * mask.height) / 8)) return null;
    const packed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) packed[index] = binary.charCodeAt(index);
    decodedMaskCache.unshift({ width: mask.width, height: mask.height, data: mask.data, packed });
    if (decodedMaskCache.length > DECODED_MASK_CACHE_LIMIT) decodedMaskCache.length = DECODED_MASK_CACHE_LIMIT;
    return packed;
  } catch {
    return null;
  }
}

/** Decode a validated mask into an owned copy of its packed bytes. */
export function decodeRasterSelectionMask(mask: RasterSelectionMask): Uint8Array | null {
  return cachedRasterSelectionBytes(mask)?.slice() ?? null;
}

/** Read one pixel from the packed row-major mask. Out-of-bounds pixels are unselected. */
export function isRasterSelectionPixelSelected(mask: RasterSelectionMask, packed: Uint8Array, x: number, y: number) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }
  const bitIndex = y * mask.width + x;
  return (packed[bitIndex >>> 3] & (1 << (bitIndex & 7))) !== 0;
}

/** Read one pixel through the private decode cache without exposing or copying its bytes. */
export function isRasterSelectionPixelSelectedAt(mask: RasterSelectionMask, x: number, y: number): boolean {
  const packed = cachedRasterSelectionBytes(mask);
  return packed ? isRasterSelectionPixelSelected(mask, packed, x, y) : false;
}

/** Test one pixel of the two-sided boundary without materializing a document-sized byte mask. */
export function isRasterSelectionBoundaryPixel(
  mask: RasterSelectionMask,
  packed: Uint8Array,
  x: number,
  y: number
): boolean {
  const selected = isRasterSelectionPixelSelected(mask, packed, x, y);
  return (
    selected !== isRasterSelectionPixelSelected(mask, packed, x - 1, y) ||
    selected !== isRasterSelectionPixelSelected(mask, packed, x + 1, y) ||
    selected !== isRasterSelectionPixelSelected(mask, packed, x, y - 1) ||
    selected !== isRasterSelectionPixelSelected(mask, packed, x, y + 1)
  );
}

/** Build a one-pixel-wide raster of both sides of every selected/unselected boundary. */
export function createRasterSelectionBoundaryMask(mask: RasterSelectionMask, packed: Uint8Array): Uint8Array | null {
  if (!isCanonicalRasterSelectionMask(mask) || packed.length !== Math.ceil((mask.width * mask.height) / 8)) {
    return null;
  }

  const width = mask.width + 2;
  const height = mask.height + 2;
  const boundary = new Uint8Array(width * height);
  for (let y = -1; y <= mask.height; y += 1) {
    for (let x = -1; x <= mask.width; x += 1) {
      if (isRasterSelectionBoundaryPixel(mask, packed, x, y)) {
        boundary[(y + 1) * width + x + 1] = 1;
      }
    }
  }

  return boundary;
}

/**
 * Count exposed pixel sides without allocating a boundary graph. Returns as soon as the
 * complexity limit is crossed; callers can then retain the original mask instead of tracing it.
 */
export function countSelectionBoundaryEdges(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: Pos,
  stopAfter = MAX_VECTOR_SELECTION_BOUNDARY_EDGES
): number {
  if (!isRasterSelectionSizeWithinBudget(width, height)) {
    throw new RangeError(`Selection is limited to ${MAX_RASTER_SELECTION_PIXELS.toLocaleString()} pixels`);
  }

  const minX = Math.max(0, Math.floor(bounds.x));
  const minY = Math.max(0, Math.floor(bounds.y));
  const maxX = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const maxY = Math.min(height, Math.ceil(bounds.y + bounds.height));
  let edges = 0;

  const selected = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (!selected(x, y)) continue;
      if (!selected(x, y - 1) && ++edges > stopAfter) return edges;
      if (!selected(x + 1, y) && ++edges > stopAfter) return edges;
      if (!selected(x, y + 1) && ++edges > stopAfter) return edges;
      if (!selected(x - 1, y) && ++edges > stopAfter) return edges;
    }
  }

  return edges;
}
