/**
 * Single scaling rule for converting coordinates between screenshot/image pixel
 * space and CSS page space: map them proportionally onto the target element's
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
 * A rectangle in CSS page space. `canvas-helpers.ts` re-exports this as `BoundingBox`,
 * the name the specs import, and `cdp-helpers.ts` calls it `BoundingBox` too.
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
 * A same-named type once sat in `e2e/helpers/cdp-helpers.ts` and meant a DIFFERENT space.
 * `Page.captureScreenshot` reads its clip against the DOCUMENT origin, so the identical
 * numbers named a region `scrollY` pixels away. Passing a viewport-relative number to CDP
 * does not throw; it photographs the wrong pixels, which is how a capture came back as
 * mostly white — a plausible image of a document that is mostly white. Anything handed to
 * `captureCanvasScreenshot` must be converted with `viewportRectToPageRect` first, and
 * anything handed to `page.screenshot` must not be. `cdp-helpers.ts` imports this type and
 * states the same asymmetry in its own longer comment, at the call site that could get it
 * wrong.
 */
export interface ClipOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
 * `Locator.boundingBox()` measures against the viewport, so it goes negative as soon as
 * the window scrolls, while CDP `Page.captureScreenshot` — which this suite calls
 * directly in `cdp-helpers.ts` — takes its clip relative to the document origin. The
 * scroll offset is read live from `window.scrollX`/`window.scrollY` via `getPageScroll`
 * (canvas-helpers.ts); see `e2e/OPEN_PROBLEMS.md` for why the app no longer scrolls at
 * document level and what `onScreenClip` still scrolls into view. Without this
 * translation the capture silently lands offset from the region the caller measured — it
 * does not throw, it returns the wrong pixels, which is how `select-move.spec.ts` came to
 * read a moved line as unmoved.
 *
 * DO NOT apply this to `page.screenshot({ clip })`. That one is the odd one out: Playwright
 * takes the clip in VIEWPORT coordinates and adds the scroll offset itself, so converting
 * there moves the clip the wrong way. For example, a marker at document y=600 with the
 * window scrolled by 440px is at viewport y=160: Playwright needs y=160, while CDP needs
 * y=600. Passing either coordinate space to the other capture API targets different
 * pixels.
 *
 * The offset is a parameter rather than something read here, so the rule stays pure and
 * testable; it must be read at the call site, per capture, because the window can scroll
 * between one capture and the next.
 */
export function viewportRectToPageRect(rect: CssBox, scroll: ScrollOffset): CssBox {
  return {
    x: rect.x + scroll.x,
    y: rect.y + scroll.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Maps an image point to CSS page space. `image.width` and `image.height` must be positive;
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
 * Inverse of `imagePointToCss`: maps a CSS page point back onto image pixels of a
 * capture of `box`. Divides by the box extent, so a zero-area box yields NaN/Infinity
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
 * Maps a captured image's pixel bounds onto the CSS page. Each corner goes through
 * `imagePointToCss`, so this is the point rule with one added convention, and the
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
