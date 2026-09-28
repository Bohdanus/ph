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
 */

export interface Point {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CssBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CssBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
 * directly in `cdp-helpers.ts` — takes its clip relative to the document origin. This app
 * is 1177px tall in Playwright's 720px window, so it does scroll, and a canvas scrolled
 * 440px down reports `y: -340` where it used to report `y: 100`. Without this translation
 * the capture silently lands 440px away from the region the caller measured — it does not
 * throw, it returns the wrong pixels, which is how `select-move.spec.ts` came to read a
 * moved line as unmoved.
 *
 * DO NOT apply this to `page.screenshot({ clip })`. That one is the odd one out: Playwright
 * takes the clip in VIEWPORT coordinates and adds the scroll offset itself, so converting
 * there moves the clip 440px the wrong way. Measured against a static marker at document
 * y=600 with the window scrolled to 440, a viewport-relative clip captures the marker and a
 * page-relative one does not; for raw CDP the two answers are exactly reversed.
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

export function imageBoundsToCss(
  image: ImageSize,
  box: CssBox,
  bounds: { left: number; top: number; right: number; bottom: number }
): CssBounds {
  const topLeft = imagePointToCss(image, box, { x: bounds.left, y: bounds.top });
  const bottomRight = imagePointToCss(image, box, { x: bounds.right, y: bounds.bottom });
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
}
