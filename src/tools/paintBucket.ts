import type { Point } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';
import { floodFill } from '../util/flood-fill.ts';
import { blendPixel, forEachPixelInSize, fromHex, type Rgba } from '../util/pixels.ts';

export type PaintBucketToolArgs = {
  color: string;
  tolerance: number;
  contiguous: boolean;
  alpha: number;
  /**
   * The clicked pixel the flood fill starts from, in the active layer's OWN pixel space
   * (layer-local, not document space — the processor's buffer is the layer raster, and
   * `useLayer` hands it `size: layer.pos` with no document origin), or `null` when no
   * click has produced one.
   *
   * ## Why a click coordinate is part of the tool's args
   *
   * A bucket is a CLICK, so unlike every stroke tool in the family it has no `points`
   * to carry the gesture. The seed is still the only thing that distinguishes one
   * invocation from another: the same layer plus the same
   * `{ color, tolerance, contiguous, alpha }` describes two different fills when the
   * clicks were on different pixels. Every other channel the processor receives is
   * exhausted — `ProcessorToolParams` is `{ size, bitmap }` and carries no click, the
   * layer's `tmpCanvas` is the source raster rather than a gesture record, and
   * `ToolResult`'s second element is an OUTPUT `Pos` patch rather than an input. So the
   * seed rides in the args, which is the same place `MagicWandToolArgs`' seed rides
   * (`SelectionMetadata.magicWand.seed`) for the same reason, with the difference that
   * the Wand is `commit: 'selection'` and gets a `Selection` to hang it on while this
   * tool is `commit: 'raster'` and has no such side channel.
   *
   * ## Why in the ARGS rather than a module-level "last seed"
   *
   * Because the args object is what `updateLayerByTool` hands to the `TOOL_ACTION`
   * history entry, so a replay re-runs this exact processor with this exact seed. A
   * module-level mutable variable read out of band would make a replayed fill land
   * wherever the user last clicked, which is precisely the `replay.deterministic: false`
   * contract the registry for this tool must not quietly break.
   *
   * ## Why `Point | null` and not `Point`
   *
   * `null` is "no click yet", and it is a NO-OP rather than a throw or a fill of
   * everything — `defaultSettings['paint-bucket']` is seeded with `null`, and that
   * literal has to be well defined because it is what the tool-settings and
   * tool-processors suites dispatch. `readSeed` below refuses anything that is not a
   * finite point inside the layer.
   */
  seed: Point | null;
  toolName: 'paint-bucket';
};

/**
 * @deprecated Superseded by `PaintBucketToolArgs`, which now carries `seed` itself.
 * This name used to be the widening `PaintBucketToolArgs & { seed?: Point | null }` —
 * the runtime shape the processor actually accepted, published under a name the
 * registry did not know about. Nothing should refer to it any more; it is retained only
 * because `src/tools/__tests__/paint-bucket.test.ts` imports it, and that file belongs to
 * a different phase. Delete both the import and this alias together.
 */
export type PaintBucketSeedArgs = PaintBucketToolArgs;

/** `{ size }` reduced to the integer extents a pixel buffer can hold, matching `pixels.ts`. */
const rasterSize = (size: { width: number; height: number }): { width: number; height: number } => ({
  width: Number.isFinite(size.width) ? Math.max(0, Math.floor(size.width)) : 0,
  height: Number.isFinite(size.height) ? Math.max(0, Math.floor(size.height)) : 0,
});

/**
 * A seed the fill may actually run from: a finite point inside the layer raster.
 *
 * `floodFill` re-checks all of this and returns `null` for each case, so the guard is not
 * about making the call safe — it is about failing BEFORE the buffer is allocated, so a
 * bucket with no seed costs one `drawImage` and no `getImageData` over the whole layer.
 */
const readSeed = (args: PaintBucketToolArgs, width: number, height: number): Point | null => {
  const seed = args.seed;
  if (!seed) return null;
  if (!Number.isFinite(seed.x) || !Number.isFinite(seed.y)) return null;
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) return null;

  return seed;
};

/**
 * `fromHex` throws on anything that is not `#rgb`/`#rrggbb`, which is the right contract for
 * a literal and the wrong one for a tool argument: a colour that failed to parse must leave
 * the layer untouched, not abort the fill from inside a pointer handler. `tempUpdateLayer`
 * catches a throw and only `console.error`s it, so an uncaught `TypeError` would present to
 * the user as a click that did nothing at all.
 */
const readFillColor = (color: string): Rgba | null => {
  try {
    return fromHex(color);
  } catch {
    return null;
  }
};

/**
 * The Photoshop bucket: recolour the region a click lands in, leaving everything else — and
 * every enclosed hole inside that region — exactly as it was.
 *
 * The mask comes from `floodFill` rather than from the Magic Wand's
 * `createMagicWandSelectionFromImageData`, and that is not a stylistic choice. The Wand
 * entry point returns a traced POLYGON and returns `null` outright whenever the region has an
 * enclosed hole, because a `Selection` is a single point path and committing the outer
 * contour alone would cover pixels the region reports as excluded. A ring of paint with a
 * differently-coloured hole in the middle is an ordinary thing to click on, so that `null` is
 * the bucket's most common legitimate input. The mask keeps the hole bytes at 0 and reports
 * the whole region, which is exactly the information a fill needs and a contour cannot carry.
 *
 * The pixels are composited with `blendPixel` rather than assigned, so `alpha` is the
 * Photoshop opacity: the fill is a source-over blend of the opaque `color` at `alpha` over
 * each covered pixel, which is also why a fill over transparent pixels lands opaque rather
 * than multiplying them into nothing.
 */
export const paintBucket =
  ({ bitmap, size }: ProcessorToolParams) =>
  (args: PaintBucketToolArgs): ToolResult => {
    const { width, height } = rasterSize(size);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);

    const seed = readSeed(args, width, height);
    if (!seed) return [canvas];

    const color = readFillColor(args.color);
    if (!color) return [canvas];

    // The reduced-canvas guard production already uses elsewhere (`src/test/setup.ts:191`
    // documents why the global context has no read-back): without `getImageData` there is no
    // buffer to fill, and a context that cannot be read is not one this tool can improve on.
    if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return [canvas];

    const imageData = ctx.getImageData(0, 0, width, height);
    const region = floodFill(imageData, seed, { tolerance: args.tolerance, contiguous: args.contiguous });
    if (!region) return [canvas];

    forEachPixelInSize({ width, height }, (x, y, offset) => {
      if (region.mask[y * width + x] !== 1) return;
      blendPixel(imageData.data, offset, color, args.alpha);
    });

    ctx.putImageData(imageData, 0, 0);

    return [canvas];
  };
