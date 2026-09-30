import type { Size } from '../contexts/general-types.ts';

/**
 * How a document-sized canvas is laid out inside the container that displays it.
 *
 * The workspace canvas is sized to the DOCUMENT in backing-store pixels and displayed with CSS
 * `object-contain` (`components/Main/Main.tsx`), so the browser scales the raster by `scale` on the
 * way to the screen. `scale` is therefore CSS px per document px, and it is the divisor that turns
 * a screen-constant length into the document-px length a canvas context actually draws in.
 */
export type ContainDimensions = {
  innerWidth: number; // inner image
  innerHeight: number;
  outerWidth: number; // container
  outerHeight: number;
  offsetX: number; // gap between image and container
  offsetY: number;
  scale: number; // how much is image scaled to be contained
};

/**
 * The contain fit, as arithmetic and nothing else.
 *
 * Extracted from `usePointerPosition`'s `calculateDimensions` so that the pointer mapping and the
 * overlay painters that need the same divisor cannot drift apart: the marching ants and the
 * selection outline are drawn into a DOCUMENT-sized canvas but have to look constant on screen, and
 * the one number that makes that true is the same number the pointer is divided by.
 *
 * `scale` is CSS px per document px, so it is DPR-invariant — `clientX` and
 * `getBoundingClientRect` are both CSS px, and dividing one by the other can never need a
 * `devicePixelRatio` factor. See `hooks/__tests__/usePointerPosition.test.ts` for the pin.
 */
export function containFit(outer: Size, image: Size): ContainDimensions {
  const scaleX = outer.width / image.width;
  const scaleY = outer.height / image.height;

  const scale = Math.min(scaleX, scaleY);

  const innerWidth = image.width * scale;
  const innerHeight = image.height * scale;

  return {
    innerWidth,
    innerHeight,
    outerWidth: outer.width,
    outerHeight: outer.height,
    offsetX: (outer.width - innerWidth) / 2,
    offsetY: (outer.height - innerHeight) / 2,
    scale,
  };
}
