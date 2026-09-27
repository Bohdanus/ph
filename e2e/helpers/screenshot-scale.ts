/**
 * Single scaling rule for converting coordinates between screenshot/image pixel
 * space and CSS page space: map them proportionally onto the target element's
 * bounding box, with scaleX = box.width / image.width and scaleY = box.height /
 * image.height, and box origin added in the image -> CSS direction. Dividing by
 * devicePixelRatio is deliberately not supported — capture scaling and rounding
 * break that assumption, while the decoded image dimensions are the truth.
 * Both directions live here so the rule has exactly one implementation, and both
 * are pure and dependency-free so they are unit-testable without a Playwright runtime.
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
