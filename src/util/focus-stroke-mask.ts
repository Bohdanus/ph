import type { Point } from '../contexts/general-types.ts';
import { BRUSH_SPACING_DEFAULT, brushDabCenters } from './brush-engine.ts';

/**
 * The tip DIAMETER a focus stroke paints under, and the single source of the number.
 *
 * It is load-bearing twice over, and the two uses must agree or a stroke misbehaves in a way no
 * assertion in the tree would catch. The tool area widens the layer's processing frame by this
 * radius so the tip has somewhere to land (`rasterBoundsForStroke`), and this module clips to
 * exactly this radius. If the frame were the smaller of the two, the outer half of every tip
 * would be cut off by the staged raster's own edge; if it were the larger, the layer would grow
 * transparent padding nobody painted. Hence one constant rather than three literals.
 *
 * Photoshop's Blur and Sharpen tools default to a 40px round brush.
 */
export const FOCUS_STROKE_BRUSH_SIZE = 40;

/**
 * Composite a whole-frame filter result back through the brush footprint of a stroke.
 *
 * The filter runs over the whole staged frame because that is what the processor computes, and
 * its result is then clipped to the tip. `source` is the unfiltered frame: the tool effect is
 * confined to the footprint and everything under the brush but outside it keeps its original
 * pixels, which is what painting with a focus tool means.
 *
 * The footprint is the union of one disc per DAB CENTRE, not per pointer sample. Pointer samples
 * are whatever the browser coalesced the drag into, so their density is a function of pointer
 * speed: sampling them directly leaves unfiltered stripes between discs on a fast drag. Every
 * other paint-family tool in this repository already interpolates through `brushDabCenters` for
 * that reason, and this follows it. One point yields one centre, so a click needs no special
 * case.
 */
export const compositeStrokeFootprint = (
  source: ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas,
  filtered: ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas,
  size: { width: number; height: number },
  points: readonly Point[]
): OffscreenCanvas => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0);

  const centers = brushDabCenters([...points], FOCUS_STROKE_BRUSH_SIZE, BRUSH_SPACING_DEFAULT);
  if (centers.length === 0) return canvas;

  ctx.save();
  ctx.beginPath();
  // `arc()` on a non-empty path joins from the current point with a zero-width connector, so
  // every disc contributes winding +1 under the `nonzero` rule `clip()` applies. The clip region
  // is therefore the union of the discs, which is the stroke.
  for (const center of centers) {
    ctx.arc(center.x, center.y, FOCUS_STROKE_BRUSH_SIZE / 2, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.drawImage(filtered, 0, 0);
  ctx.restore();
  return canvas;
};
