import UTIF from 'utif';
import { imageDataToImage } from './raster-utils.ts';

type IfdTags = Record<string, unknown>;

/**
 * The largest document this app can create, not a round number: `NewImageDialog` clamps each
 * axis to 10000 px (`NewImageDialog.tsx:111-112` when a preset is chosen and `:144-145` when the
 * DPI changes, with `max="10000"` on both inputs at `:198` and `:217`), so every preset at
 * every DPI the dialog offers lands at or below
 * 10000 × 10000. A budget under that number makes the app refuse files it just wrote.
 */
const MAX_CREATABLE_DOCUMENT_PIXELS = 100_000_000;

/**
 * The budget for the **page** buffer `UTIF.decodeImage` builds: `Math.min(32, t258[0])` bits per
 * sample (`UTIF.js` — `UTIF.decodeImage()`) times the four samples an RGBA page carries, so 16 bytes
 * per pixel. The byte ceiling is that product; the pixel ceiling is the same budget read at 8 bytes
 * per pixel, the largest per-pixel buffer a displayable 16-bit RGBA page declares, so the two agree
 * by construction. An 8-bit RGBA document of the app's own maximum needs a quarter of it, and the
 * 64 GB allocation a 510-byte file can ask for is 40× the ceiling.
 *
 * It is a budget on the page term, not on every byte UTIF can allocate: a tiled page adds a second
 * buffer sized by its tile tags rather than by the page, which is why `predictDecodeBytes` predicts
 * the two together and why that sum, not this number, is what the ceiling is compared against. A
 * page small enough to be nowhere near this figure can still exceed it through `t322`/`t323` alone.
 */
const MAX_TIFF_BYTES = MAX_CREATABLE_DOCUMENT_PIXELS * 16;
const MAX_TIFF_PIXELS = MAX_TIFF_BYTES / 8;

/**
 * The smallest tile a TIFF is allowed to declare. TileWidth (322) and TileLength (323) are
 * specified as multiples of 16, so this is a format floor rather than a tuned budget, and it is
 * what bounds the one cost a byte budget cannot see: `UTIF.decodeImage`'s tile loop runs
 * `ceil(width / tw) × ceil(height / th)` times regardless of how few offsets the file supplies.
 * That count is 3.9 × 10⁵ at 16 over a 10000×10000 page and 10⁸ at 1 — the same ~200-byte IFD,
 * seconds apart, with per-tile work too small to notice either way.
 */
const MIN_TILE = 16;

function assertPixelBudget(width: number, height: number, action: 'open' | 'save') {
  if (width * height > MAX_TIFF_PIXELS) {
    throw new Error(`TIFF image is too large to ${action} (${width}×${height}). Maximum is ${MAX_TIFF_PIXELS} pixels.`);
  }
}

/**
 * Decode-side only: this is the budget for a buffer `UTIF.decodeImage` is about to build from a
 * file's own tags, so there is no `save` to name. `encodeTiff` is bounded by the pixel ceiling
 * instead — see the comment above its call.
 */
function assertByteBudget(bytes: number | null, width: number, height: number) {
  // `null` is "the IFD does not yield a finite prediction", which is not evidence of a small
  // image, so it is refused on the same terms as one over the ceiling.
  if (bytes === null || bytes > MAX_TIFF_BYTES) {
    throw new Error(
      `TIFF image is too large to open (${width}×${height}). ` +
        `Decoding it would need more than ${MAX_TIFF_BYTES / 1_000_000} MB, over the TIFF budget.`
    );
  }
}

/** Reads tag 0 of a scalar TIFF tag, treating a missing or unreadable tag as absent. */
function tagValue(page: IfdTags, tag: string): number | undefined {
  const values = page[tag];
  if (!Array.isArray(values) || typeof values[0] !== 'number' || !Number.isFinite(values[0])) {
    return undefined;
  }
  return values[0];
}

/**
 * `BitsPerSample` (258) carries one entry per sample, so its count is `SamplesPerPixel` (277).
 * A page declaring 200 of them next to `t277 = 4` is not a wide-gamut image, it is the factor
 * UTIF multiplies the row length by (`Math.min(32, t258[0]) * t258.length`, `UTIF.js:116`).
 * This is refused on format grounds, so it holds whatever geometry the file also declares.
 */
function assertSamplesAgree(page: IfdTags) {
  if (!Array.isArray(page.t258) || !Array.isArray(page.t277)) {
    return;
  }
  const samplesPerPixel = page.t277[0];
  if (!Number.isInteger(samplesPerPixel) || samplesPerPixel < 1) {
    return;
  }
  if (page.t258.length !== samplesPerPixel) {
    throw new Error(
      `TIFF file is malformed: it declares ${page.t258.length} bits-per-sample values ` +
        `for ${samplesPerPixel} samples per pixel.`
    );
  }
}

/**
 * A tiled page's tile geometry has to be usable before it can be costed, and the test is a format
 * one rather than a budget one: refused here as malformed, not as too large, because a tile below
 * `MIN_TILE` is not a large file — it is a page whose loop count is unbounded.
 *
 * The floor alone is not the whole guarantee, and the gap is worth stating: a page can sit on the
 * pixel ceiling with one axis at 1 and the other at 200000000, which passes both ceilings here and
 * spends `ceil(200000000 / 16)` = 12.5 million iterations in the tile loop. That costs a couple of
 * seconds, not a freeze, and closing it needs a page-aspect rule rather than a tile rule, so it is
 * not this assertion's job.
 */
function assertTilesAreUsable(page: IfdTags) {
  const tileWidth = tagValue(page, 't322');
  if (tileWidth === undefined) {
    return;
  }
  const tileLength = tagValue(page, 't323');
  if (tileWidth < MIN_TILE || tileLength === undefined || tileLength < MIN_TILE) {
    const declared = tileLength === undefined ? 'absent' : tileLength;
    throw new Error(
      `TIFF file is malformed: it declares a ${tileWidth}×${declared} tile. ` +
        `TileWidth and TileLength are multiples of ${MIN_TILE}.`
    );
  }
}

/**
 * The exact `new Uint8Array` sizes `UTIF.decodeImage` reaches, from the fields it reads in
 * `UTIF.js` — `UTIF.decodeImage()`:
 *
 *   bipp  = t258 ? Math.min(32, t258[0]) * t258.length : (t277 ? t277[0] : 1)
 *   bipp  = Math.round(t279[0] * 8 / (width * t278[0]))   // uncompressed, t262 === 32803
 *   bipl  = Math.ceil(width * bipp / 8) * 8
 *   bytes = height * (bipl >>> 3)
 *   tiles = Math.ceil(t322[0] * t323[0] * bipp / 8)        // only when t322 is present
 *
 * `bipl` is divided in floating point rather than with UTIF's `>>> 3`. That is the same value
 * while `bipl` fits in 32 bits, and the 32-bit shift wraps *downwards* above that, so the
 * prediction is never smaller than the allocation that will be attempted.
 *
 * `tiles` is a **second buffer**, not an alternative to `bytes`: a tiled page allocates the
 * page-sized `bytes` first and the tile-sized `tbuff` beside it, and both are live while the
 * tiles are copied in, so the peak this has to cover is their **sum**. A page whose own geometry
 * is trivial can therefore ask for an enormous tile buffer — `{t256:[1000], t257:[1000],
 * t258:[8,8,8,8], t322:[23168], t323:[23168]}` is 1000×1000, so the page term is 4 MB and passes
 * every pixel check, while `tbuff` alone is `ceil(23168² × 4)` = 2,147,024,896 bytes against a
 * 1.6 GB ceiling, out of a ~200-byte file. Above 2³¹ UTIF's `|0` on that expression wraps, so the
 * allocation it then attempts is *smaller* than the figure here — the prediction stays on the safe
 * side of the real one, which is what this function needs, and it is not exact up there.
 *
 * Returns `null` when the tags do not yield a finite size, which is a malformed page rather
 * than a small one. A missing `t323` lands here too: the product is `NaN`, and `NaN` is not
 * finite.
 */
function predictDecodeBytes(page: IfdTags, width: number, height: number): number | null {
  const bitsPerSample = Array.isArray(page.t258) ? page.t258 : undefined;
  const compression = tagValue(page, 't259') ?? 1;
  const rowsPerStrip = tagValue(page, 't278');
  const stripBytes = tagValue(page, 't279');
  let bitsPerPixel = bitsPerSample
    ? Math.min(32, bitsPerSample[0]) * bitsPerSample.length
    : (tagValue(page, 't277') ?? 1);

  if (compression === 1 && stripBytes !== undefined && rowsPerStrip !== undefined && tagValue(page, 't262') === 32803) {
    bitsPerPixel = Math.round((stripBytes * 8) / (width * rowsPerStrip));
  }

  const pageBytes = height * Math.ceil((width * bitsPerPixel) / 8);
  const tileWidth = tagValue(page, 't322');
  if (tileWidth === undefined) {
    return Number.isFinite(pageBytes) ? pageBytes : null;
  }
  // Read after the `t262` branch above, deliberately: that branch replaces `bitsPerPixel` with the
  // row length the file's own strip byte counts imply, and UTIF sizes the tile buffer by the same
  // replaced value.
  const tileLength = tagValue(page, 't323') ?? Number.NaN;
  const bytes = pageBytes + Math.ceil((tileWidth * tileLength * bitsPerPixel) / 8);
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * Everything the budget can know before the decode: the page's own pixel count, the sample
 * counts, the tile geometry, and the size of the buffer `UTIF.decodeImage` is about to allocate
 * from them. The tile geometry is checked before it is costed, so the byte figure below is always
 * a real allocation and never an unbounded loop count.
 */
function assertIfdWithinBudget(page: IfdTags, width: number, height: number) {
  assertPixelBudget(width, height, 'open');
  assertSamplesAgree(page);
  assertTilesAreUsable(page);
  assertByteBudget(predictDecodeBytes(page, width, height), width, height);
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
function readIfdDimensions(page: IfdTags): [number, number] | null {
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
      assertIfdWithinBudget(page, declaredWidth, declaredHeight);
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
  assertIfdWithinBudget(page, width, height);

  const rgba = UTIF.toRGBA8(page);
  return imageDataToImage({ data: rgba, width, height }, 'Failed to decode TIFF image');
}

export async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
  // The pixel ceiling is the whole of the save-side budget, and this is the only place that
  // says so. The same reasoning as the loader: whatever this build writes, it has to be able to
  // read back, so a canvas the app will not create is refused here rather than saved into a file
  // `loadTiffFile` then rejects. `getImageData` below hands UTIF four bytes per pixel and UTIF's
  // own IFD declares `t258: [8, 8, 8, 8]`, so the raster the encoder builds is exactly
  // `width * height * 4` — and at the pixel ceiling that is `MAX_TIFF_PIXELS * 4`, half of
  // `MAX_TIFF_BYTES`, so the byte ceiling provably cannot bind and a second guard on it would
  // be a check no input can fail.
  assertPixelBudget(canvas.width, canvas.height, 'save');

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
