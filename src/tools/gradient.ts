import type { Point } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';
import { blendPixel, forEachPixelInSize, fromHex, type Rgba } from '../util/pixels.ts';

export type GradientToolArgs = {
  type: 'linear' | 'radial';
  from: Point;
  to: Point;
  colorA: string;
  colorB: string;
  alpha: number;
  toolName: 'gradient';
};

/** `{ size }` reduced to the integer extents a pixel buffer can hold, matching `pixels.ts`. */
const rasterSize = (size: { width: number; height: number }): { width: number; height: number } => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/**
 * `fromHex` throws on anything that is not `#rgb`/`#rrggbb`, which is the right contract for
 * a literal and the wrong one for a tool argument: an unparseable stop must leave the layer
 * untouched rather than abort the fill from inside a pointer handler, where
 * `tempUpdateLayer`'s catch would turn it into a click that appears to do nothing.
 */
const readStop = (color: string): Rgba | null => {
  try {
    return fromHex(color);
  } catch {
    return null;
  }
};

/** One stop sampled at `t` in [0, 1], un-premultiplied. The endpoints are exact. */
const sampleStop = (a: Rgba, b: Rgba, t: number): Rgba => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
  a: 255,
});

/**
 * A gradient's axis, in the form both shapes project onto. `lengthSquared` is the
 * linear-only denominator; `radius` is the radial falloff distance. Both are zero for a
 * zero-length drag, which is the degenerate case `isDegenerate` exists to catch — dividing
 * by either would put a `NaN` or an `Infinity` into every channel of every pixel.
 */
type GradientAxis = {
  dx: number;
  dy: number;
  lengthSquared: number;
  radius: number;
};

const readAxis = (from: Point, to: Point): GradientAxis | null => {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return null;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  // Non-finite covers a coordinate pair whose difference overflows to Infinity as well as a
  // NaN, and both make the projection below meaningless.
  if (!Number.isFinite(lengthSquared) || lengthSquared === 0) return null;

  return { dx, dy, lengthSquared, radius: Math.sqrt(lengthSquared) };
};

/**
 * The gradient's own zero-length falloff. `floodFill`'s `null` covers the analogous bucket
 * case, but a bucket that matched nothing is a normal outcome while a zero-length gradient is
 * not, so the tool area is the place that decides not to commit one — this is the
 * processor-level backstop for a replayed or otherwise-constructed one.
 */
const isDegenerate = (from: Point, to: Point): boolean => {
  const axis = readAxis(from, to);
  return axis === null;
};

/**
 * Photoshop's Gradient Tool, rasterized in the pixel buffer rather than through
 * `createLinearGradient` / `createRadialGradient`.
 *
 * The choice is testability, and it is not a close one. This repo's canvas context is a mock
 * in every test environment, and `src/test/setup.ts:148-149` stubs both gradient factories to
 * return a bare `{ addColorStop: vi.fn() }` that never rasterizes anything — so a
 * canvas-gradient implementation would paint a uniform mock colour and every assertion about
 * where colourA ends and colourB begins would be asserting nothing. Doing the arithmetic
 * against the `Uint8ClampedArray` the processor already owns puts the result where jsdom can
 * read it back byte for byte, which is why the endpoints, the midpoint and the radial radius
 * are pinned as exact numbers in `src/tools/__tests__/gradient.test.ts`.
 *
 * It is also the same arithmetic the canvas would do, stated explicitly rather than delegated:
 *
 * - LINEAR projects the pixel onto the `from`->`to` axis and clamps to the ends, so the pixel
 *   AT `from` is `t = 0` and the pixel at `to` is `t = 1`, and everything before or after the
 *   axis holds its nearest end colour rather than fading to transparent — which is Photoshop's
 *   "clamp to the ends" behaviour and the reason a short drag fills the whole layer.
 * - RADIAL falls off with Euclidean distance from `from` against the drag's own length as the
 *   radius, so `from` is the centre and the circle through `to` is the second stop. Photoshop
 *   mirrors past that circle; this does not, and a mirrored radial has no representation in
 *   the fixed `from`/`to` args.
 *
 * `alpha` is applied through `blendPixel` as the source's effective alpha, so it is the
 * Photoshop opacity of the whole gradient rather than a third stop.
 */
export const gradient =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ type, from, to, colorA, colorB, alpha }: GradientToolArgs): ToolResult => {
    const { width, height } = rasterSize(size);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);

    if (isDegenerate(from, to)) return [canvas];

    const axis = readAxis(from, to)!;
    const a = readStop(colorA);
    const b = readStop(colorB);
    if (!a || !b) return [canvas];

    // The reduced-canvas guard production already uses elsewhere (`src/test/setup.ts:191`
    // documents why the global context has no read-back): with no buffer to walk, there is
    // nothing to rasterize into.
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

    const imageData = ctx.getImageData(0, 0, width, height);
    const { dx, dy, lengthSquared, radius } = axis;

    forEachPixelInSize({ width, height }, (x, y, offset) => {
      const projected =
        type === 'radial'
          ? Math.sqrt((x - from.x) * (x - from.x) + (y - from.y) * (y - from.y)) / radius
          : ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared;

      // Clamp rather than skip: a projection below 0 or above 1 is a defined position on the
      // axis (behind `from`, past `to`), and Photoshop holds the nearest end colour there.
      const t = projected < 0 ? 0 : projected > 1 ? 1 : projected;
      blendPixel(imageData.data, offset, sampleStop(a, b, t), alpha);
    });

    ctx.putImageData(imageData, 0, 0);

    return [canvas];
  };
