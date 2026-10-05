import type { Point, Pos } from '../contexts/general-types.ts';

/**
 * Return the document-space raster frame needed to contain a stroke.
 *
 * Layers are stored tightly around their content, while Photoshop treats the transparent
 * part of a layer as addressable canvas.  Raster strokes therefore process the presented
 * layer plus the brush footprint, without changing the document frame or sampling another
 * layer.  The returned frame is stable for replay because it is plain data that can travel
 * with the tool args.
 */
export const rasterBoundsForStroke = (base: Pos, points: readonly Point[], radius: number, previous?: Pos): Pos => {
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  let left = Math.min(base.x, previous?.x ?? base.x);
  let top = Math.min(base.y, previous?.y ?? base.y);
  let right = Math.max(base.x + base.width, (previous?.x ?? base.x) + (previous?.width ?? 0));
  let bottom = Math.max(base.y + base.height, (previous?.y ?? base.y) + (previous?.height ?? 0));

  for (const point of points) {
    left = Math.min(left, point.x - safeRadius);
    top = Math.min(top, point.y - safeRadius);
    right = Math.max(right, point.x + safeRadius);
    bottom = Math.max(bottom, point.y + safeRadius);
  }

  const x = Math.floor(left);
  const y = Math.floor(top);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(right) - x),
    height: Math.max(1, Math.ceil(bottom) - y),
  };
};

/** True when a stroke travels from inside the current frame to outside it. */
export const strokeExitsRasterBounds = (base: Pos, points: readonly Point[]): boolean => {
  let wasInside = false;
  for (const point of points) {
    const inside =
      point.x >= base.x && point.x <= base.x + base.width && point.y >= base.y && point.y <= base.y + base.height;
    if (!inside && wasInside) return true;
    wasInside ||= inside;
  }
  return false;
};
