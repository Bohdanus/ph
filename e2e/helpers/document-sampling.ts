import { type Page } from '@playwright/test';
import {
  type BoundingBox,
  DEFAULT_DOCUMENT_SIZE,
  type DocumentSize,
  containFit,
  getColorAtPoint,
  getWorkspaceCanvas,
  loadImageData,
} from './canvas-helpers';
import { type ClipOptions, type ImageSize, type Point, cssPointToImage } from './screenshot-scale';

/**
 * Sampling a DOCUMENT point, in the two coordinate spaces a capture lives in.
 *
 * There are three spaces in play and every bug this module exists to prevent is a
 * confusion between two of them:
 *
 * - DOCUMENT pixels. Where the artwork is. Every sample point in a spec is named here,
 *   because a box-relative offset is specified relative to the window and names a
 *   different document pixel after any reflow.
 * - CSS page pixels. What `page.screenshot({ clip })` takes and what `page.mouse` takes.
 * - IMAGE pixels, or DEVICE pixels. What `getColorAtPoint` reads, and what the DECODED
 *   screenshot is measured in. At `deviceScaleFactor: 2` these are twice the CSS numbers
 *   and at 1x they are identical to them.
 *
 * The third confusion is the one that hides: at 1x `cssPointToImage` is the identity, so
 * passing a CSS-pixel coordinate straight to `getColorAtPoint` is correct on the host the
 * test was written on and reads a different pixel on any other. A 17-CSS-px window centred
 * on a point became a 34x34 device-pixel image, and the CSS centre `8` then addressed
 * device pixel (8,8) — the top-left QUARTER of the window, whose 7x7 sample reached 2.5
 * to 5.5 device pixels up and to the left of the point the caller named.
 *
 * So the centre of a capture is converted through `cssPointToImage` against the DECODED
 * image's own dimensions, never against an assumed device pixel ratio: CDP and
 * `page.screenshot` disagree about what a ratio means, and the decoded image is the only
 * thing both of them are describing. `sampleCentreInImage` is that conversion, split out
 * as a pure function so `__tests__/document-sampling.unit.test.ts` can pin it in both
 * axes at 1x and 2x without a browser.
 */

/**
 * The half-extent of the averaging window, in IMAGE pixels.
 *
 * 3 is a 7x7 average: wide enough to absorb a capture's resampling and a layer's
 * anti-aliased edge, narrow enough that a 10px pen stroke still has a solid interior in
 * it. The draw tool's pen is `lineWidth: 10` (`src/tools/settings.ts`,
 * `savedDrawPerPen.pen`), so a 7x7 window centred on the middle of a stroke sees core.
 */
export const SAMPLE_RADIUS = 3;

/**
 * The CSS-pixel size of the capture a document sample is taken through: one pixel of
 * margin on every side of a `2r + 1` window.
 *
 * It is the tightest size that holds the window at BOTH capture scales, and its
 * half-extent matters for more than the arithmetic: the clip is a rectangle in CSS page
 * pixels, so `windowCss / 2 / scale` is the window's radius in DOCUMENT units, and every
 * sample point derived by offsetting a stroke by that radius has to clear the stroke it
 * is measuring. A capture that is four times wider than it needs to be silently widens
 * every "a fixed distance off the edge" claim by four times.
 *
 * At 1x this is an 8x8 image with a 7x7 window: the window's near edge is 4.12 document
 * units from the centre at the suite's fit, and a sample point offset from a 10px pen
 * stroke by more than `5 + 4.12` is provably clear of the ink.
 */
export function sampleWindowCss(radius: number = SAMPLE_RADIUS): number {
  return 2 * (radius + 1);
}

export interface DocumentSampleRegion {
  /** Page-relative CSS rect, ready for `page.screenshot({ clip })`. */
  clip: Required<ClipOptions>;
  /** The rect's CSS size — the denominator the capture's own scale comes from. */
  size: ImageSize;
}

export interface DocumentSampleOptions {
  /** Defaults to the seeded 800x600 document. Pass the measured size when you have it. */
  documentSize?: DocumentSize;
  /** Averaging window half-extent in image pixels. Defaults to `SAMPLE_RADIUS`. */
  radius?: number;
  /** Capture size in CSS pixels. Defaults to `sampleWindowCss(radius)`. */
  windowCss?: number;
  /** See `getColorAtPoint`: refuse near-white pixels instead of averaging them in. */
  ignoreNearWhite?: boolean;
  nearWhiteThreshold?: number;
}

/**
 * The page-relative CSS rect that photographs a window centred on a DOCUMENT point.
 *
 * `box` is the app's CONTAINER rect, the same one `documentToCanvasOffset` takes, and the
 * contain fit is the app's own: the letterboxed document is centred in the box, so a
 * document point is `box origin + offset + point * scale`.
 */
export function documentSampleRegion(
  box: BoundingBox,
  documentX: number,
  documentY: number,
  options: DocumentSampleOptions = {}
): DocumentSampleRegion {
  const documentSize = options.documentSize ?? DEFAULT_DOCUMENT_SIZE;
  const windowCss = options.windowCss ?? sampleWindowCss(options.radius ?? SAMPLE_RADIUS);
  const { scale, offsetX, offsetY } = containFit(box, documentSize);
  const centreCssX = box.x + offsetX + documentX * scale;
  const centreCssY = box.y + offsetY + documentY * scale;
  const half = windowCss / 2;
  return {
    clip: { x: centreCssX - half, y: centreCssY - half, width: windowCss, height: windowCss },
    size: { width: windowCss, height: windowCss },
  };
}

/**
 * The IMAGE address of a capture's own centre, derived from the DECODED image.
 *
 * `image` is the decoded capture's pixel size and `cssSize` the CSS size the capture was
 * ASKED for, so `image.width / cssSize.width` and `image.height / cssSize.height` are the
 * capture's two scales, measured rather than declared. They are kept per axis rather than
 * collapsed into one: a clip whose CSS size is not a whole number of device pixels comes
 * back short on one axis only, and spending a single scalar on both would move half the
 * measurement by a fraction of a pixel in the wrong direction.
 *
 * The result is a float by construction. `getColorAtPoint` rejects a non-integer
 * coordinate outright — a fractional address puts the sample window off the pixel grid and
 * reads a pixel the caller never named — so the caller rounds, and this function does not
 * hide the fraction it produced.
 */
export function sampleCentreInImage(image: ImageSize, cssSize: { width: number; height: number }): Point {
  return cssPointToImage(
    image,
    { x: 0, y: 0, width: cssSize.width, height: cssSize.height },
    {
      x: cssSize.width / 2,
      y: cssSize.height / 2,
    }
  );
}

/**
 * The whole-document rect inside the canvas box, in page-relative CSS pixels.
 *
 * THIS IS NOT `canvasRedrawClip`. That one is a fixed 300x100 box-relative rect chosen to
 * contain the standard test line, and it is not derived from the fit: at the suite's
 * 974x583 box its left edge sits at box x 100 while the document's own left edge is at
 * `offsetX = 98.33`, so a viewport 3px shorter — `offsetX` reaches 100 at a box height of
 * 580.5 — puts the LETTERBOX inside it.
 *
 * That matters because the letterbox is a colour the dark predicates accept. In the light
 * theme it is `#ffffff` and nothing false-passes; under DARK it is `#121212`, which is
 * inside `hasDarkPixels` (all three channels under 60) with no stroke on the canvas at
 * all, so a wait for the stroke returns on a frame containing nothing. In the other
 * direction a negative wait — "wait until the stroke has LOST its dark core" — can never
 * settle against a dark letterbox and times out instead, which is a false failure of a
 * correct app.
 *
 * A clip built from the contain fit cannot contain the letterbox, because the fitted
 * document rect is a SUBSET of the box by construction (`scale = min(...)` makes
 * `documentSize * scale` no larger than either box axis). So polling this rect instead is
 * the spec-side statement that the pixels being waited for are pixels of the document.
 */
export function documentClipInBox(
  box: BoundingBox,
  documentSize: DocumentSize = DEFAULT_DOCUMENT_SIZE
): Required<ClipOptions> {
  const { scale, offsetX, offsetY } = containFit(box, documentSize);
  return {
    x: box.x + offsetX,
    y: box.y + offsetY,
    width: documentSize.width * scale,
    height: documentSize.height * scale,
  };
}

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so a document point cannot be placed');
  return box;
}

/**
 * The colour at a DOCUMENT point, read from a live screenshot of the page.
 *
 * `null` means "no pixel at this point", which is a real answer and the only one that can
 * distinguish a live document from an erased one: the document behind the layer is white,
 * so a point the artwork has been removed from samples nothing when `ignoreNearWhite` is
 * set, and a test that treats `null` as a pass has asserted nothing.
 *
 * PRECONDITION: the named point must be at least `windowCss / 2 / scale` DOCUMENT units inside
 * the document's own edge — with the default window that is `4 / scale`, which is 4.12 document
 * units at the suite's 0.9717 fit. The capture is a rectangle in CSS page pixels centred on the
 * point, so a point nearer than that to an edge photographs the LETTERBOX beside the document as
 * well as the document, and the reading is then a mixture of paper and surround.
 *
 * Nothing here detects that, and `ignoreNearWhite` cannot rescue it: in the dark theme the
 * letterbox is `#121212`, so PAPER near the edge is what reads dark, and the option that would
 * have thrown the sample away discards near-white pixels — the opposite of the ones in play.
 * The region is deliberately NOT clamped to the document. A clamp would keep the capture inside
 * the artwork and silently move it off the point the caller named, returning a confident reading
 * of somewhere else; a documented precondition fails loudly at the call site instead. No call
 * site in the suite is inside that distance today — every sampled point is at least 100 document
 * units from an edge — so this is the shape the NEXT caller has to respect, not a live defect.
 *
 * The box is measured here, on every sample, rather than captured once by the caller. A
 * box measured before a tool switch goes stale the moment the new options bar changes the
 * height of the toolbar, and every point in the document then maps to the wrong pixel —
 * the defect `e2e/OPEN_PROBLEMS.md` records. Re-measuring costs one DOM read next to a
 * screenshot, so there is no reason to hold a stale copy.
 */
export async function sampleDocumentPoint(
  page: Page,
  documentX: number,
  documentY: number,
  options: DocumentSampleOptions = {}
): Promise<{ red: number; green: number; blue: number } | null> {
  const region = documentSampleRegion(await canvasBox(page), documentX, documentY, options);
  const image = await loadImageData(await page.screenshot({ clip: region.clip }));
  const centre = sampleCentreInImage({ width: image.width, height: image.height }, region.size);
  return getColorAtPoint(image, Math.round(centre.x), Math.round(centre.y), options.radius ?? SAMPLE_RADIUS, {
    ignoreNearWhite: options.ignoreNearWhite,
    nearWhiteThreshold: options.nearWhiteThreshold,
  });
}
