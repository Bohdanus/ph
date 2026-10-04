import UTIF from 'utif';
import { imageDataToImage } from './raster-utils.ts';

type IfdTags = Record<string, unknown>;

/**
 * The largest document this app can create, not a round number: `NewImageDialog` clamps each
 * axis to 10000 px — in `computePixelsFromPreset`'s callers, when a preset is chosen and again when
 * the DPI changes, with `max="10000"` on both inputs — so every preset at every DPI the dialog
 * offers lands at or below 10000 × 10000. A budget under that number makes the app refuse files it
 * just wrote.
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
 * specified as multiples of 16, so this is a format floor rather than a tuned budget.
 *
 * What it buys is that the tile loop is finite at all. `UTIF.decodeImage`'s bound is
 * `ceil(width / tw) × ceil(height / th)` — `tx` is `floor((width + tw - 1) / tw)`, which is
 * `Infinity` at `tw === 0` — so a zero tile never returns, and no budget can price an unbounded
 * loop. Over a 10000×10000 page the floor takes the count from 10⁸ at 1-pixel tiles to 3.9 × 10⁵
 * at 16.
 *
 * The floor is not what bounds the work, and used to be described as though it were:
 * `predictTileWorkBytes` prices that separately. What the floor alone still cannot see is a page
 * much narrower than its tile, where the waste is in the page rather than in the tile.
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
  if (bytes !== null && bytes > MAX_TIFF_BYTES) {
    throw new Error(
      `TIFF image is too large to open (${width}×${height}). ` +
        `Decoding it would need more than ${MAX_TIFF_BYTES / 1_000_000} MB, over the TIFF budget.`
    );
  }
  // `null` is "the IFD does not yield a finite size", and that is a statement about the header
  // rather than about the image: an unreadable `BitsPerSample` makes every product below it
  // `NaN`. Reporting that as too large would tell the reader their image exceeds a budget when
  // the file is corrupt, which is not actionable and sends them looking for a size problem they
  // do not have. `assertSamplesAgree` refuses a mismatched count with a format message; this is
  // the same class of fault and is worded as one.
  if (bytes === null) {
    throw new Error(
      `TIFF file is malformed: its headers do not determine a finite size for a ${width}×${height} page.`
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
 * UTIF multiplies the row length by (`Math.min(32, t258[0]) * t258.length` — `UTIF.js`,
 * `UTIF.decodeImage()`).
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
 * `MIN_TILE` is not a large file — it is a page whose loop count UTIF's own division cannot bound,
 * since `tx = floor((width + tw - 1) / tw)` is `Infinity` at `tw === 0`.
 *
 * The floor bounds the loop only to the extent that tiles are at least one pixel wide; a page much
 * narrower than its tile still wastes the whole tile per row, which no tile-size rule can see.
 * `predictTileWorkBytes` prices that separately rather than leaving it to this assertion.
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
      `TIFF file is malformed: it declares a ${tileWidth}×${declared} tile, ` +
        `and no TIFF tile is narrower or shorter than ${MIN_TILE}.`
    );
  }
}

/**
 * The bits UTIF will bill per pixel, from the same fields it reads in `UTIF.js` —
 * `UTIF.decodeImage()`:
 *
 *   bipp = t258 ? Math.min(32, t258[0]) * t258.length : (t277 ? t277[0] : 1)
 *   bipp = Math.round(t279[0] * 8 / (width * t278[0]))   // uncompressed, t262 === 32803
 *
 * Both the allocation and the work term are priced from this one function, so the `t262` rewrite
 * cannot be applied to one and forgotten in the other.
 */
function predictBitsPerPixel(page: IfdTags, width: number): number {
  const bitsPerSample = Array.isArray(page.t258) ? page.t258 : undefined;
  const compression = tagValue(page, 't259') ?? 1;
  const rowsPerStrip = tagValue(page, 't278');
  const stripBytes = tagValue(page, 't279');
  const bitsPerPixel = bitsPerSample
    ? Math.min(32, bitsPerSample[0]) * bitsPerSample.length
    : (tagValue(page, 't277') ?? 1);

  if (compression === 1 && stripBytes !== undefined && rowsPerStrip !== undefined && tagValue(page, 't262') === 32803) {
    return Math.round((stripBytes * 8) / (width * rowsPerStrip));
  }
  return bitsPerPixel;
}

/**
 * The `new Uint8Array` sizes `UTIF.decodeImage` reaches, up to its 32-bit coercion, from the
 * fields it reads:
 *
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
  const bitsPerPixel = predictBitsPerPixel(page, width);
  const pageBytes = height * Math.ceil((width * bitsPerPixel) / 8);
  const tileWidth = tagValue(page, 't322');
  if (tileWidth === undefined) {
    return Number.isFinite(pageBytes) ? pageBytes : null;
  }
  const tileLength = tagValue(page, 't323') ?? Number.NaN;
  const bytes = pageBytes + Math.ceil((tileWidth * tileLength * bitsPerPixel) / 8);
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * The bytes a tiled page makes UTIF **move**, which is a different quantity from the peak it
 * allocates, and the peak budget cannot see it.
 *
 * `UTIF.decodeImage` runs `ceil(width / tw) × ceil(height / th)` iterations, and each one starts
 * by clearing the whole tile buffer — `for (var j = 0; j < tbuff.length; j++) tbuff[j] = 0;` is
 * the loop's first statement, not a prologue. So the work is that count times
 * `ceil(tw * th * bipp / 8)`: the **tile-aligned** raster, `ceil(width / tw) * tw` across by
 * `ceil(height / th) * th` down, rather than the page's own.
 *
 * The distance between the two is the whole reason this is a second guard. A 1 × 200000000 page in
 * legal 16 × 16 tiles aligns to 16 × 200000000, so it clears 1024 bytes 12.5 million times — 12.8 GB
 * of memset out of a ~200-byte IFD — while its page buffer is 800 MB and its tile buffer 1 KB, both
 * comfortably inside the ceiling. `MIN_TILE` cannot help either: 16 is exactly the floor it
 * enforces, and the waste comes from the page being narrower than one tile, not from the tile being
 * small.
 *
 * Priced against the same `MAX_TIFF_BYTES` as the peak, and for the same reason: it is the traffic
 * the loader would otherwise push through that buffer.
 *
 * **It is tighter than the peak, by exactly the alignment waste, and that is not always slack.**
 * The peak is `width × height`; the work is `ceil(width / tw) × tw × ceil(height / th) × th`, so the
 * work can only exceed the peak by the inflation alignment adds — and it binds on that inflation
 * alone whenever the page's own bytes are already within `8 / bipp` of the ceiling. At 8-bit RGBA
 * (4 bytes per pixel) that is a factor of two of headroom, which is generous. At 16-bit RGBA it is
 * **1.0** — any inflation at all crosses it — and at 16-bit 5-sample it is 0.8, so the work figure
 * binds *before* the peak does.
 *
 * The consequence is deliberate and worth stating rather than discovering: a tiled page near the
 * ceiling can be refused for a half-percent misalignment that the peak budget admitted, and which
 * tile size is refused is not monotonic, because a finer grid aligns the page more closely. The
 * same 16-bit page passes in 16-pixel tiles and fails in 64. That is the guard working — the page
 * really would move more than the ceiling — but it means the effective open-side ceiling for a
 * tiled 16-bit page is a little under `MAX_TIFF_PIXELS`, and `MAX_TIFF_PIXELS` alone no longer
 * states it.
 */
function predictTileWorkBytes(page: IfdTags, width: number, height: number): number | null {
  const tileWidth = tagValue(page, 't322');
  if (tileWidth === undefined) {
    return null;
  }
  const tileLength = tagValue(page, 't323');
  if (tileLength === undefined) {
    return null;
  }
  const alignedWidth = Math.ceil(width / tileWidth) * tileWidth;
  const alignedHeight = Math.ceil(height / tileLength) * tileLength;
  const bytes = (alignedWidth * alignedHeight * predictBitsPerPixel(page, width)) / 8;
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * The bytes a page makes UTIF read out of the file **because the file said so**, which is the one
 * cost no other term here can see: every other budget in this module is derived from `t256`/`t257`
 * and the tile tags, so a page may declare any segment size over geometry that is trivially small.
 *
 * `_decompress` opens with `if (cmpr == 1 || (len == tgt.length && cmpr != 32767)) for (let j = 0;
 * j < len; j++)`, and `len` is `bcnt[i]` — `t279`, or `t325` when `t279` is absent, indexed by
 * segment. Four of the codec branches are bounded by that same declared count rather than by the
 * compressed stream: PackBits and Thunder loop `while (off < off + len)`, G3 and G4 loop
 * `while ((boff >>> 3) < off + slen)`. So the counts are priced for every compression, not only the
 * uncompressed one — three 534 MB segments is 1.602 GB of work over a 64 × 64 page, and a thousand
 * offsets carrying a thousand four-billion counts is 4 × 10¹² iterations from a ~8 KB IFD.
 *
 * UTIF replaces the declared counts with a geometry-derived one when there is exactly one offset
 * (`cmpr == 1 && soff.length == 1`). That substitution is deliberately not mirrored, so a
 * single-segment file whose count disagrees with its geometry is refused rather than excused.
 */
function predictDeclaredSegmentBytes(page: IfdTags): number | null {
  const counts = Array.isArray(page.t279) ? page.t279 : Array.isArray(page.t325) ? page.t325 : undefined;
  if (!counts) {
    return null;
  }
  return counts.reduce((total, value) => {
    // `for (let j = 0; j < len; j++)` does not stop for a non-finite `len`, and one is reachable
    // in six bytes: UTIF's IFD reader honours a tag's declared type without checking it against the
    // tag, and its RATIONAL branch is `readUint(numerator) / readUint(denominator)` with no zero
    // check. A StripByteCounts declared RATIONAL with a zero denominator arrives here as `Infinity`
    // and never returns. There is no count too large to refuse.
    if (value === Number.POSITIVE_INFINITY) {
      return Number.POSITIVE_INFINITY;
    }
    // A negative or `NaN` count makes the loop not run at all, so it contributes nothing and
    // counting it as zero is exact. It must not, though, abandon the total: `[-1, 4e9, 4e9, 4e9]`
    // is twelve billion iterations this function would otherwise decline to price at all.
    return total + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

/**
 * Everything the budget can know before the decode: the page's own pixel count, the sample
 * counts, the tile geometry, the size of the buffer `UTIF.decodeImage` is about to allocate from
 * them, the amount a tiled page would have to move through that buffer, and the byte counts the
 * file itself declares per segment. The tile geometry is checked before either is computed, so the
 * byte figure is always a real allocation and never an unbounded loop count.
 */
function assertIfdWithinBudget(page: IfdTags, width: number, height: number) {
  assertPixelBudget(width, height, 'open');
  assertSamplesAgree(page);
  assertTilesAreUsable(page);
  assertByteBudget(predictDecodeBytes(page, width, height), width, height);
  const tileWork = predictTileWorkBytes(page, width, height);
  if (tileWork !== null && tileWork > MAX_TIFF_BYTES) {
    throw new Error(
      `TIFF image's tile layout is too expensive to open (${width}×${height}). ` +
        `Filling its tiles would move more than ${MAX_TIFF_BYTES / 1_000_000} MB, over the TIFF budget.`
    );
  }
  const segmentBytes = predictDeclaredSegmentBytes(page);
  if (segmentBytes !== null && segmentBytes > MAX_TIFF_BYTES) {
    throw new Error(
      `TIFF image declares more segment data than the budget allows (${width}×${height}). ` +
        `It would read more than ${MAX_TIFF_BYTES / 1_000_000} MB, over the TIFF budget.`
    );
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
