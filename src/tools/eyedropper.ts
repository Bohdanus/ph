import type { Ctx2D, Point } from '../contexts/general-types.ts';
import { isPointInSize, readRgba, type Rgba } from '../util/pixels.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * Bare on purpose, like the other `commit: 'unimplemented'` tools: the eyedropper's
 * only setting is which layer it samples, and that travels in the options bar rather
 * than in its args. `tool-settings.test.ts` reduces every unimplemented tool to exactly
 * `{ toolName }`, so adding a field here would fail that contract before it earned one.
 */
export type EyedropperToolArgs = {
  toolName: 'eyedropper';
};

/**
 * A read-back context with `bitmap` drawn into it, or `null` when this environment has no
 * pixel read-back at all.
 *
 * The `drawImage` is not a formality. `BitmapSource` is an `ImageBitmap`, an
 * `HTMLCanvasElement`, an `HTMLImageElement` or an `OffscreenCanvas`
 * (`src/contexts/general-types.ts:72`), and only the last two of those can be read
 * directly; one scratch canvas of the layer's own size is the single path that reaches all
 * four.
 */
const createSamplingContext = ({ bitmap, size }: ProcessorToolParams): Ctx2D | null => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // `src/test/setup.ts:182-190` documents why this is a real branch and not paranoia: the
  // globally installed mock context has no `getImageData`, and every raster tool in this
  // directory already guards on exactly this.
  if (!ctx || typeof ctx.getImageData !== 'function') return null;

  // There is deliberately no `clearRect` before the draw. A fresh `OffscreenCanvas` is
  // transparent black by spec, and this context is private to this call, so there is
  // nothing to clear and no `globalCompositeOperation` a previous caller could have left
  // behind: the `source-over` default composites the source over transparency to exactly
  // the source. `Paint/Paint.tsx:75` does clear, but it reuses a canvas React already owns.
  ctx.drawImage(bitmap, 0, 0);

  return ctx;
};

/**
 * The colour at `point` of `bitmap`, or `null` when there is no colour there to report.
 *
 * This is the repo's first pixel SAMPLER, so the two rules that make it a sampler rather
 * than a buffer reader live here. Everything else in `src/util/pixels.ts` is about
 * addressing a buffer a caller already holds; the question of which pixel a pointer
 * coordinate names is answered once, here, rather than by each caller.
 *
 * ## The addressing rule: floor
 *
 * Pixel `n` on an axis covers `[n, n + 1)`, so a pointer at `1.7` is inside pixel 1 and a
 * pointer at `-0.25` is outside the raster entirely. `Math.floor` is therefore the whole
 * rule, and containment is checked on the FLOORED point through `isPointInSize`
 * (`:211-212`), whose half-open interval makes the last pixel of each axis addressable
 * and the four points one past each edge not.
 *
 * `readRgba` is deliberately NOT the addresser here. It rejects a fractional byte offset by
 * returning transparent black (`:66-79`), because its byte-offset signature cannot see a
 * height and a fractional coordinate there is a bug rather than a place. That guard is
 * right for a buffer walk and wrong for a pointer: handed `(1.7, 2.9)` directly it would
 * report "no colour" for a point plainly inside a red pixel, and a pointer on a
 * half-pixel boundary would sample black about half the time. Flooring first is also what
 * `createMagicWandSelectionFromImageData` seeds its growth with
 * (`src/util/magicWand.ts:196-197`), so the wand and the eyedropper agree on which pixel
 * a coordinate names.
 *
 * ## `a === 0` returns `null`, not black
 *
 * `getImageData` un-premultiplies on read, and un-premultiplying a zero alpha divides by
 * zero: the RGB a buffer carries for a fully transparent pixel is `0, 0, 0` whatever
 * colour it was authored in. Returning it would set the editor's foreground to black on a
 * click over empty canvas. `null` is Photoshop's own answer — its swatch shows a
 * crossed-out square and no colour is applied — and it is the same value an off-document
 * click returns, so a caller has one "nothing to report" case rather than two.
 *
 * ## A translucent pixel is returned UNCHANGED
 *
 * `getImageData` hands back STRAIGHT (unassociated) alpha, the model
 * `src/util/pixels.ts:18-21` documents for every buffer in the repo, so the channels here
 * are already Photoshop's un-premultiplied RGB. Round-tripping them through
 * `premultiplyRgba`/`unpremultiplyRgba` would only buy the quantisation those two
 * document (`:367-369`): at `a = 128` a straight channel keeps 128 of its 256 values, so
 * a red of 200 comes back as 199 and `#c86432` as `#c76432`. The alpha is returned
 * alongside the colour rather than dropped, so a caller that can carry it may; `toHex` is
 * where Photoshop's 6-digit `#rrggbb` (and the store's `color` field) comes from.
 */
export const sampleColorAt = ({ bitmap, size }: ProcessorToolParams) => {
  /**
   * One scratch canvas per sampler, not per point, and built at most once.
   *
   * `undefined` is "not built yet" and is deliberately distinct from a cached `null`: a
   * raster with no read-back is never retried, while a raster nobody has sampled yet pays
   * for nothing. This is the whole reason the export is a factory — the doc comment above
   * claims one draw serves every point of a raster, and this is what makes that true.
   */
  let context: Ctx2D | null | undefined;
  const getContext = (): Ctx2D | null => {
    if (context === undefined) context = createSamplingContext({ bitmap, size });
    return context;
  };

  return (point: Point): Rgba | null => {
    const pixel = { x: Math.floor(point.x), y: Math.floor(point.y) };
    if (!isPointInSize(pixel, size)) return null;

    const ctx = getContext();
    if (!ctx) return null;

    let rgba: Rgba;
    try {
      // `1 x 1` because one pixel is the entire request: a full-raster `getImageData` for a
      // click on a 6000x4000 document allocates 96MB to read four bytes.
      rgba = readRgba(ctx.getImageData(pixel.x, pixel.y, 1, 1).data, 0, 0, 1);
    } catch {
      // A context can lose read-back under a transfer or a resize, and this runs inside a
      // pointer handler where a throw would take the gesture with it. `null` is the honest
      // answer — it is the same value the tool gives for a click on empty canvas.
      return null;
    }

    return rgba.a === 0 ? null : rgba;
  };
};

/**
 * The eyedropper's processor-shaped no-op, and deliberately not its behaviour.
 *
 * The registry wires the shared `unimplemented` stub for this tool
 * (`src/tools/toolProcessors.ts:246-250`) because the eyedropper pushes no history entry,
 * so there is nothing for a replay to re-run: what it produces is a `SET_COLOR` in the
 * store, and a colour is not a layer. The sampling itself is `sampleColorAt` above, which
 * the tool area calls directly and which has no reason to be wrapped in the registry's
 * `(params) => (args) => ToolResult` shape — there are no args to carry a coordinate and
 * the result is a colour, not a raster.
 */
export const eyedropper =
  ({ bitmap }: ProcessorToolParams) =>
  (): ToolResult => {
    return [bitmap];
  };
