import UTIF from 'utif';
import { imageDataToImage } from './raster-utils.ts';

/** Refuse to materialise a raster larger than this many pixels (≈ 400 MP, 1.6 GB RGBA). */
const MAX_TIFF_PIXELS = 80_000_000;

function assertWithinPixelBudget(width: number, height: number) {
  if (width * height > MAX_TIFF_PIXELS) {
    throw new Error(`TIFF image is too large to open (${width}×${height}). Maximum is ${MAX_TIFF_PIXELS} pixels.`);
  }
}

/**
 * Reads the geometry straight out of the IFD, before `UTIF.decodeImage` runs. A TIFF is a
 * 4-byte signature plus one IFD, so a ~200-byte file can declare 65535×65535. `decodeImage`
 * allocates `height * bytesPerRow` from those tags with no bound of its own, and
 * `toRGBA8` then allocates `width * height * 4` — so the budget has to be consulted before
 * `decodeImage`, not just before `toRGBA8`.
 *
 * `UTIF.decodeImage` copies these exact values into `page.width`/`page.height`, so this
 * check can never disagree with the one taken after the decode: same product, earlier.
 * Returns `null` when the tags are absent or unrecognisable, leaving the post-decode
 * geometry guard to handle those.
 */
function readIfdDimensions(page: Record<string, unknown>): [number, number] | null {
  const width = Array.isArray(page.t256) ? page.t256[0] : undefined;
  const height = Array.isArray(page.t257) ? page.t257[0] : undefined;
  return typeof width === 'number' && typeof height === 'number' ? [width, height] : null;
}

export async function loadTiffFile(file: Blob): Promise<HTMLImageElement> {
  const buffer = await file.arrayBuffer();
  const pages = UTIF.decode(buffer);
  const page = pages[0];

  if (!page) {
    throw new Error('TIFF file contains no image pages');
  }

  // Anything not positive is left to the post-decode guard, which reports it as an invalid
  // geometry rather than as a size problem.
  const declared = readIfdDimensions(page);
  if (declared) {
    const [declaredWidth, declaredHeight] = declared;
    if (declaredWidth > 0 && declaredHeight > 0) {
      assertWithinPixelBudget(declaredWidth, declaredHeight);
    }
  }

  UTIF.decodeImage(buffer, page);
  const { width, height } = page;
  if (!width || !height) {
    throw new Error('TIFF image has invalid dimensions');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('TIFF image has invalid dimensions');
  }
  assertWithinPixelBudget(width, height);

  const rgba = UTIF.toRGBA8(page);
  return imageDataToImage({ data: rgba, width, height }, 'Failed to decode TIFF image');
}

export async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to read canvas pixels for TIFF encoding');
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  // `getImageData` yields unassociated (straight) alpha, but UTIF's default IFD declares
  // ExtraSamples (tag 338) as 1 — associated, i.e. premultiplied. Every reader that honours
  // the tag then multiplies the colour by alpha a second time, so feathered edges and soft
  // masks gain a dark halo in Photoshop, Lightroom and Preview. Declare 2, the truth.
  const buffer = UTIF.encodeImage(data, canvas.width, canvas.height, { t338: [2] });
  return new Blob([buffer], { type: 'image/tiff' });
}
