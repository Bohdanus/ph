/**
 * Helpers for the undo/redo specs: the header's two buttons, and the horizontal
 * "bands" a history test strokes into.
 *
 * Why bands at all. A whole-canvas ink check cannot tell which stroke a replay
 * left behind: after two undos out of three strokes, "some ink is present" is
 * true for the correct result and for a history cursor that is off by one in
 * either direction. Splitting the canvas into fixed horizontal strips and
 * asserting the expected ink state of EACH strip does distinguish them, so the
 * band clip and the per-band ink read live here rather than in the spec.
 *
 * The geometry half (clip construction, band centres, per-band reads over a
 * captured band stack) is pure and takes no `Page`, so it is unit-tested in
 * `__tests__/history-helpers.unit.test.ts` under the Node e2e Vitest project. The
 * two waiters are the only functions here that need a browser, and they add
 * nothing of their own: both delegate to the suite's single poll loop.
 */
import { type Locator, type Page } from '@playwright/test';
// The poll loop is imported through the spec-facing re-export so this module has
// one import direction with the specs, exactly as `waitForCanvasRedraw` does.
// The pixel primitives are not re-exported there, so they come from the module
// that owns them.
import { waitForCanvasPixels, type WaitForCanvasPixelsOptions } from './canvas-redraw';
import {
  hasDarkPixels,
  isBuffer,
  loadImageData,
  type BoundingBox,
  type ClipOptions,
  type ImageDataResult,
} from './canvas-helpers';

export const UNDO_BUTTON_TEST_ID = 'undo-button';
export const REDO_BUTTON_TEST_ID = 'redo-button';

export function getUndoButton(page: Page): Locator {
  return page.getByTestId(UNDO_BUTTON_TEST_ID);
}

export function getRedoButton(page: Page): Locator {
  return page.getByTestId(REDO_BUTTON_TEST_ID);
}

export interface CanvasBand {
  /** Zero-based position of this band within its stack, top to bottom. */
  readonly index: number;
  /** The band in page coordinates, ready for `page.screenshot({ clip })`. */
  readonly clip: Required<ClipOptions>;
}

/**
 * The part of a canvas box a clipped screenshot can actually read.
 *
 * WHY THE INTERSECTION. `page.screenshot({ clip })` intersects the clip with the
 * VISIBLE page rect and hands back that intersection without mentioning it, in
 * BOTH axes. Measured on this Playwright build at a 1280x720 window:
 *
 * | clip requested                       | image returned |
 * | ------------------------------------ | -------------- |
 * | 400 wide at x=1100                   | 180 wide       |
 * | 100 tall at y=-20                     | 80 tall        |
 * | 840 tall at y=100 (720-tall window)  | 620 tall       |
 * | 100 tall at y=900, entirely below it  | THROWS         |
 *
 * A band cut from the truncated part therefore reads as permanently clean, which
 * is a silent PASS rather than a failure — the band assertion would report "the
 * undo removed the stroke" about a strip of canvas that was never captured.
 * Laying the bands out over the visible intersection makes that unrepresentable
 * instead of relying on the window size.
 *
 * Those four rows are PROPERTIES OF THE BROWSER, not measurements of this
 * application, and the distinction is the whole point: the table above stays true
 * whatever the layout does, while the claim this function used to rest on — that
 * the workspace canvas overflows the page and therefore needed a taller window —
 * stopped being true. It is now a GUARD rather than a correction. `min-h-0
 * overflow-y-auto` on the left sidebar's `<aside>`
 * (`src/components/SidebarLeft/SidebarLeft.tsx:335`) is what bounds the grid row,
 * `e2e/sidebar-layout.spec.ts:21` pins that the default page does not scroll, and
 * the measured canvas box and page heights for both toolbar layouts live in P1 of
 * `e2e/OPEN_PROBLEMS.md` — deliberately not restated here, because a number
 * written next to the code is the number that goes stale.
 *
 * WHY IT IS ALSO LOAD-BEARING FOR THE WAITERS. The poll loop behind `waitForBands`
 * routes every clip through `onScreenClip` (`e2e/helpers/canvas-helpers.ts`), which
 * SCROLLS a region that is not in view and then restores the offset. A spec's own
 * `page.screenshot({ clip })` call does not. So a clip that reached past the fold
 * would be captured twice, at two different extents, inside one test: the waiter
 * would scroll and photograph the whole region, the spec's own capture would come
 * back truncated, and the band reads that follow would be slicing two different
 * rectangles. Intersecting here is what makes the two capture paths agree on what
 * "the whole canvas" is. `onScreenClip` is also private to its module, so it is not
 * an alternative to this function even in principle.
 *
 * WHY THE THROW RATHER THAN PLAYWRIGHT'S. Playwright already refuses an empty
 * intersection, as the last table row shows. It refuses it with
 * `Clipped area is either empty or outside the resulting image` — naming neither
 * the box nor the viewport — and from inside the poll loop, so a wait that never
 * resolves reports its own timeout and never mentions the cause. This throws at
 * the geometry layer instead, with both operands in the message, and throws
 * before a single screenshot is taken.
 *
 * The viewport is taken at the page origin because screenshot clips are
 * page-relative and this suite never scrolls the document: at scroll 0 the
 * intersection above is with the window, and Playwright does not scroll to reach a
 * clip, which is why the last table row is a refusal rather than a capture.
 */
export function visibleCanvasBox(box: BoundingBox, viewport: { width: number; height: number }): BoundingBox {
  const left = Math.max(box.x, 0);
  const top = Math.max(box.y, 0);
  const right = Math.min(box.x + box.width, viewport.width);
  const bottom = Math.min(box.y + box.height, viewport.height);
  if (right <= left || bottom <= top) {
    throw new Error(
      `visibleCanvasBox: canvas box ${JSON.stringify(box)} does not overlap the ${viewport.width}x${viewport.height} viewport`
    );
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The horizontal edge between two bands, in page coordinates.
 *
 * Every band boundary is derived from this one expression, so consecutive bands
 * share an edge exactly rather than to within a rounding step, and the stack
 * covers `box` to the last bit. Rounding each edge independently would leave
 * sub-pixel seams and overlaps that a band-wide capture then has to classify.
 */
function bandEdge(box: BoundingBox, edgeIndex: number, bandCount: number): number {
  return box.y + (box.height * edgeIndex) / bandCount;
}

/**
 * One guard for the three entry points that take a band and a band count, so a
 * misconfigured band fails the same way whichever of them was called. A silent
 * out-of-range band would otherwise be clamped or wrapped into a real-looking
 * clip and the assertion would be made about a strip the caller never asked for.
 */
function assertBandGeometry(bandCount: number, band: number): void {
  if (!Number.isInteger(bandCount) || bandCount < 1) {
    throw new Error(`band geometry: bandCount must be a positive integer, got ${String(bandCount)}`);
  }
  if (!Number.isInteger(band) || band < 0 || band >= bandCount) {
    throw new Error(`band geometry: band must be an integer in [0, ${bandCount}), got ${String(band)}`);
  }
}

/**
 * Page-coordinate clip of one horizontal band of `box`.
 *
 * `box` is a workspace-canvas bounding box; the result is a PAGE clip, the space
 * `page.screenshot({ clip })` and `waitForCanvasPixels` both take. The whole box
 * width is used, so a band is "this horizontal strip of the canvas" and nothing
 * else — a band that also cropped X could be read as clean simply because the
 * stroke was outside the crop.
 */
export function bandClip(box: BoundingBox, band: number, bandCount: number): Required<ClipOptions> {
  assertBandGeometry(bandCount, band);
  const top = bandEdge(box, band, bandCount);
  const bottom = bandEdge(box, band + 1, bandCount);
  return { x: box.x, y: top, width: box.width, height: bottom - top };
}

/**
 * Box-relative y of a band's centre: where a caller should stroke to land inside
 * it. `drawLine` takes box-relative coordinates, which is why this is relative
 * to the box while `bandClip` is in page space.
 *
 * The centre is the midpoint of the same edges `bandClip` cuts at, so a stroke
 * drawn here cannot straddle two bands however thin the box or the line.
 */
export function bandCentreY(box: BoundingBox, band: number, bandCount: number): number {
  assertBandGeometry(bandCount, band);
  return bandEdge(box, band + 0.5, bandCount) - box.y;
}

/** Every band of `box`, top to bottom, as one stack. */
export function canvasBands(box: BoundingBox, bandCount: number): CanvasBand[] {
  assertBandGeometry(bandCount, 0);
  return Array.from({ length: bandCount }, (_unused, index) => ({ index, clip: bandClip(box, index, bandCount) }));
}

/**
 * The whole canvas as a one-band stack, for a whole-canvas ink or clear wait.
 * Reading the canvas as three bands and combining the answers by hand is the
 * same assertion written three times.
 */
export function wholeCanvasBand(box: BoundingBox): CanvasBand {
  return { index: 0, clip: bandClip(box, 0, 1) };
}

/**
 * The smallest rect containing every band. This is the clip the poll loop
 * screenshots once per tick, so a per-band assertion costs one capture per poll
 * rather than one per band.
 */
export function bandUnionClip(bands: readonly CanvasBand[]): Required<ClipOptions> {
  if (bands.length === 0) {
    throw new Error('bandUnionClip: needs at least one band');
  }
  const left = Math.min(...bands.map((band) => band.clip.x));
  const top = Math.min(...bands.map((band) => band.clip.y));
  const right = Math.max(...bands.map((band) => band.clip.x + band.clip.width));
  const bottom = Math.max(...bands.map((band) => band.clip.y + band.clip.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The band stack's share of a captured image, in image rows: how many rows of
 * `image` each band occupies.
 *
 * The capture comes back in DEVICE pixels, which are not the CSS pixels the
 * clips are written in, so the band heights are scaled by what the image
 * actually is rather than by `devicePixelRatio`. That is the suite's one
 * scaling rule, and its owner says why in so many words
 * (`e2e/helpers/screenshot-scale.ts:6`: dividing by `devicePixelRatio` is
 * deliberately unsupported, because capture scaling and rounding break the
 * assumption while the decoded image dimensions are the truth). It is the
 * reason a half-size capture is read correctly instead of sampling the top
 * half of the bands twice.
 */
export function bandRows(
  bands: readonly CanvasBand[],
  imageHeight: number
): ReadonlyArray<{ readonly top: number; readonly bottom: number }> {
  if (!Number.isInteger(imageHeight) || imageHeight < 1) {
    throw new Error(`bandRows: imageHeight must be a positive integer, got ${String(imageHeight)}`);
  }
  const union = bandUnionClip(bands);
  const scale = imageHeight / union.height;
  return bands.map((band) => {
    const top = Math.round((band.clip.y - union.y) * scale);
    const bottom = Math.round((band.clip.y + band.clip.height - union.y) * scale);
    // A band always owns at least one row, and never one past the image: a band
    // that rounded away entirely would report "clean" for a crop it never read.
    const clampedTop = Math.min(Math.max(top, 0), imageHeight - 1);
    return { top: clampedTop, bottom: Math.min(Math.max(bottom, clampedTop + 1), imageHeight) };
  });
}

/**
 * The predicate behind "this band is inked", shared by the single-band wait and
 * the per-band read.
 *
 * It is the suite's existing dark-pixel definition (`hasDarkPixels`: every
 * channel below 60, ignoring fully transparent pixels) rather than a new
 * threshold, so "inked" means one thing across the suite. That threshold is
 * deliberately lenient: a half-restored stroke leaves a few dark pixels and
 * still reads as inked, which is what makes the band assertion able to fail.
 */
export function bandIsInked(screenshot: Buffer | ImageDataResult): Promise<boolean> {
  return hasDarkPixels(screenshot);
}

function sliceRows(image: ImageDataResult, top: number, bottom: number): ImageDataResult {
  const height = bottom - top;
  const rowBytes = image.width * 4;
  const data = new Uint8ClampedArray(image.width * height * 4);
  data.set(image.data.subarray(top * rowBytes, bottom * rowBytes));
  return { width: image.width, height, data };
}

/**
 * Per-band ink flags for a capture taken with `bandUnionClip(bands)`.
 *
 * One capture in, one flag per band out, in band order. Splitting the capture
 * and re-reading each band through `bandIsInked` keeps "is this band inked"
 * defined in exactly one place instead of once per caller.
 */
export async function bandInkFlags(
  screenshot: Buffer | ImageDataResult,
  bands: readonly CanvasBand[]
): Promise<boolean[]> {
  const image = isBuffer(screenshot) ? await loadImageData(screenshot) : screenshot;
  const rows = bandRows(bands, image.height);
  const flags: boolean[] = [];
  for (const row of rows) {
    flags.push(await hasDarkPixels(sliceRows(image, row.top, row.bottom)));
  }
  return flags;
}

/**
 * The per-band state, as it reads inside the poll loop's timeout message
 * ("Canvas did not render <this> within <n>ms"). Named after the band's own index
 * rather than its position in the expected list, so a single-band wait reports the
 * band the caller asked about.
 */
function describeBands(bands: readonly CanvasBand[], expected: readonly boolean[]): string {
  return expected.map((inked, position) => `band ${bands[position].index} ${inked ? 'inked' : 'clean'}`).join(', ');
}

/**
 * Waits until the bands hold exactly the ink `expected` reports — every band at
 * once, not each in turn.
 *
 * The all-bands-at-once part is the point. After an undo the interesting state
 * is a conjunction ("the surviving stroke is back AND the removed ones are
 * gone"), and waiting only on the half that is already true returns instantly
 * and then reads the canvas mid-replay.
 */
export function waitForBands(
  page: Page,
  bands: readonly CanvasBand[],
  expected: readonly boolean[],
  options: WaitForCanvasPixelsOptions = {}
): Promise<void> {
  if (expected.length !== bands.length) {
    throw new Error(`waitForBands: expected ${bands.length} band states, got ${expected.length}`);
  }
  return waitForCanvasPixels(
    page,
    bandUnionClip(bands),
    async (screenshot) => {
      const flags = await bandInkFlags(screenshot, bands);
      return flags.every((inked, index) => inked === expected[index]);
    },
    {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      description: options.description ?? describeBands(bands, expected),
    }
  );
}

/** Waits until one band carries ink. The single-band special case of `waitForBands`. */
export function waitForBandInked(
  page: Page,
  band: CanvasBand,
  options: WaitForCanvasPixelsOptions = {}
): Promise<void> {
  return waitForBands(page, [band], [true], options);
}
