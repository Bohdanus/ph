/**
 * Single scaling rule for converting coordinates between screenshot/image pixel
 * space and the target element's CSS space: map them proportionally onto its
 * bounding box, with scaleX = box.width / image.width and scaleY = box.height /
 * image.height, and box origin added in the image -> CSS direction. Dividing by
 * devicePixelRatio is deliberately not supported — capture scaling and rounding
 * break that assumption, while the decoded image dimensions are the truth.
 * Both directions live here so the rule has exactly one implementation, and both
 * are pure and dependency-free so they are unit-testable without a Playwright runtime.
 *
 * The viewport-relative -> page-relative translation below is the same kind of rule
 * for the pair of spaces `boundingBox()` and the capture APIs disagree about, so it
 * lives here too rather than being written a second time next to its only caller.
 *
 * One conversion here carries a convention the point rule does not. `imageBoundsToCss`
 * takes `left`/`top`/`right`/`bottom` as INCLUSIVE image pixel indices -- the shape
 * `screenshotBoundsToCss` produces and both of its consumers pass through -- and runs
 * each corner through the point rule, so `right`/`bottom` land on the CENTRE of the last
 * covered pixel. `right - left` is therefore the distance between two pixel centres and
 * under-reports the covered width by exactly one image pixel. Both current consumers want
 * a point or a tolerant comparison, so it is documented rather than corrected; that
 * function's own JSDoc spells out what a caller doing area or delta math must add.
 *
 * This module also owns every coordinate SHAPE the suite uses -- `CssBox`, `CssBounds`
 * and `ClipOptions` are declared here and nowhere else. They used to be duplicated
 * across `canvas-helpers.ts` and `cdp-helpers.ts`, which interoperated by structural
 * typing rather than by aliasing, so a field added to one copy silently did not reach
 * the others and the compiler was happy with all three. `canvas-helpers.ts` re-exports
 * `CssBox` under the name `BoundingBox` because that is the name the specs import, so
 * no caller outside this directory had to change; `cdp-helpers.ts` imports both shapes
 * directly. Do not re-declare them: `__tests__/screenshot-scale.unit.test.ts` scans every
 * module in this directory and fails on a second copy under any of the four names OR
 * under a new name with the same fields -- the rename is the one a name-matching guard
 * misses, and it is the same drift.
 *
 * The `imageBoundsToCss` convention below is the one place where a caller can be right
 * about the mapping and still be wrong about the data, so its real consumers are named
 * where the arithmetic lives rather than here.
 */

export interface Point {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CssBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A CSS rectangle with no coordinate-space brand. `canvas-helpers.ts` re-exports this as
 * `BoundingBox`, the name the specs import, and `cdp-helpers.ts` calls it `BoundingBox` too.
 */
export interface CssBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A screenshot clip, in VIEWPORT-relative CSS pixels. Every axis is optional: an omitted
 * axis means "whatever the default for this call site is", and `buildClip` in
 * canvas-helpers.ts resolves one of these against a `Required<ClipOptions>` default.
 *
 * THE ORIGIN IS THE POINT. `page.screenshot({ clip })` measures the clip against the
 * viewport and adds `window.scrollX/Y` itself, and it trims the clip to the viewport, so a
 * region entirely above or below the fold collapses to zero height and throws.
 *
 * Raw CDP `Page.captureScreenshot` instead reads its clip against the DOCUMENT origin.
 * Passing a viewport-relative number to that API can silently target different pixels;
 * callers using raw CDP must convert it with `viewportRectToPageRect` first. The shared
 * `captureCanvasScreenshot` helper uses Playwright's `page.screenshot`, so its clip stays
 * viewport-relative and must not be converted.
 */
export interface ClipOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

declare const viewportClipBrand: unique symbol;

/** A clip whose coordinates have been explicitly identified as viewport-relative. */
export type ViewportClipOptions = ClipOptions & { readonly [viewportClipBrand]: true };

/** A complete viewport-relative clip. */
export type ViewportClip = Required<ViewportClipOptions>;

/**
 * Mark a rectangle whose origin and dimensions were computed in viewport CSS space.
 * This is an explicit type boundary and does not convert coordinates. Use
 * `canvasRedrawClip` when the rectangle is relative to the workspace canvas box.
 */
export function viewportClip(clip: Required<ClipOptions>): ViewportClip;
export function viewportClip(clip: ClipOptions): ViewportClipOptions;
export function viewportClip(clip: ClipOptions): ViewportClipOptions {
  return clip as ViewportClipOptions;
}

/** `window.scrollX` / `window.scrollY`, read at the moment a clip is built. */
export interface ScrollOffset {
  x: number;
  y: number;
}

/**
 * Viewport-relative rect -> page-relative rect: the same rect with the scroll offset
 * added to its origin, extent untouched.
 *
 * `Locator.boundingBox()` and `page.screenshot({ clip })` both use viewport coordinates.
 * This conversion is used when `onScreenClip` reasons about the requested page position
 * relative to the current scroll offset; raw CDP screenshot clips also use page
 * coordinates, but `captureCanvasScreenshot` no longer calls that API.
 *
 * Do not apply this conversion to `page.screenshot({ clip })`. Playwright takes the clip in
 * viewport coordinates and applies the scroll offset itself. For example, a marker at
 * document y=600 with the window scrolled by 440px is at viewport y=160: Playwright needs
 * y=160, while raw CDP needs y=600. Passing either coordinate space to the other API
 * targets different pixels.
 *
 * The offset is a parameter rather than something read here, so the rule stays pure and
 * testable; it must be read at the call site, per capture, because the window can scroll
 * between one capture and the next. Non-finite offsets throw rather than returning a
 * viewport rect that would be mistaken for a page rect.
 */
export function viewportRectToPageRect(rect: CssBox, scroll: ScrollOffset): CssBox {
  if (!Number.isFinite(scroll.x) || !Number.isFinite(scroll.y)) {
    throw new RangeError(`viewportRectToPageRect: scroll offsets must be finite; received ${scroll.x}, ${scroll.y}`);
  }
  return {
    x: rect.x + scroll.x,
    y: rect.y + scroll.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Maps an image point into the supplied box's CSS coordinates. `image.width` and
 * `image.height` must be positive;
 * this is deliberately raw arithmetic, so invalid dimensions preserve their NaN/Infinity
 * result. Callers using a potentially empty capture must validate it before mapping. The
 * `screenshotBoundsToCss` wrapper is the guarded entry point for screenshot bounds.
 */
export function imagePointToCss(image: ImageSize, box: CssBox, point: Point): Point {
  return {
    x: box.x + (point.x * box.width) / image.width,
    y: box.y + (point.y * box.height) / image.height,
  };
}

/**
 * Inverse of `imagePointToCss`: maps a point in the supplied box's CSS coordinates back
 * onto image pixels of a capture of `box`. Divides by the box extent, so a zero-area box yields NaN/Infinity
 * rather than throwing, exactly like a zero-sized image does in the forward direction;
 * callers pass the result to pixel samplers, which surface that as "no pixel found".
 */
export function cssPointToImage(image: ImageSize, box: CssBox, point: Point): Point {
  return {
    x: (image.width * (point.x - box.x)) / box.width,
    y: (image.height * (point.y - box.y)) / box.height,
  };
}

/**
 * Maps a captured image's pixel bounds into the supplied box's CSS coordinates. Each
 * corner goes through `imagePointToCss`, so this is the point rule with one added convention, and the
 * convention is the caller's, not the arithmetic's.
 *
 * `left` / `top` / `right` / `bottom` are INCLUSIVE image pixel indices -- the shape
 * `screenshotBoundsToCss` in canvas-helpers.ts produces, and what
 * `viewport-drawing.spec.ts` and `text-tool.spec.ts` feed in. `right` and `bottom` are still converted as
 * points, so they land on the CENTRE of the last covered pixel rather than on its outer
 * edge.
 *
 * The off-by-one that follows is real and currently invisible: `right - left` measures
 * between two pixel centres, so it under-reports the covered width by exactly one image
 * pixel. Image pixels 10..14 inclusive are five of them, and at 1:1 with the box the
 * span reports 4 rather than 5. A caller that wants the covered AREA, or a drag DELTA,
 * has to add one image pixel itself (half a CSS pixel on a 2x capture) before the
 * multiplication. Neither current consumer does: they want a location or a tolerant
 * comparison, so nothing breaks today.
 *
 * Do not "fix" this by mapping `right`/`bottom` to the outer edge instead. Two existing
 * cases in `screenshot-scale.unit.test.ts` pin the centre-of-the-last-pixel answer as the
 * convention, so changing the arithmetic is a deliberate change to the callers' contract
 * and not a local correction -- which is the whole reason it is written down here.
 */
export function imageBoundsToCss(
  image: ImageSize,
  box: CssBox,
  bounds: { left: number; top: number; right: number; bottom: number }
): CssBounds {
  const topLeft = imagePointToCss(image, box, { x: bounds.left, y: bounds.top });
  const bottomRight = imagePointToCss(image, box, { x: bounds.right, y: bounds.bottom });
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}
