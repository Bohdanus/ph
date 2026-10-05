import type { Point, Pos } from '../contexts/general-types.ts';

/**
 * Return the document-space raster frame needed to contain a stroke.
 *
 * Layers are stored tightly around their content, while Photoshop treats the transparent
 * part of a layer as addressable canvas.  Raster strokes therefore process the presented
 * layer plus the brush footprint, without changing the document frame or sampling another
 * layer.  The returned frame is stable for replay because it is plain data that can travel
 * with the tool args.
 *
 * The frame only ever GROWS along one stroke, and that comes from `points` alone: every
 * caller passes `usePaintStroke`'s append-only live array, which carries every earlier point,
 * so the union it returns covers the earlier frames without being told about them. A fourth
 * parameter carrying the previously staged frame was removed as dead — both production call
 * sites read it out of the TOOL SETTINGS, which nothing ever writes a frame back into, so it
 * was always `undefined`. Cross-stroke growth is the committed `pos` instead, which is what
 * the next stroke is given as its `base`.
 */
export const rasterBoundsForStroke = (base: Pos, points: readonly Point[], radius: number): Pos => {
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  let left = base.x;
  let top = base.y;
  let right = base.x + base.width;
  let bottom = base.y + base.height;

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
