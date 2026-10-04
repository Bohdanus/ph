import { createFloodFillMask } from '../util/floodFill.ts';
import { blendPixel } from '../util/pixels.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';
import type { BitmapSource, Point, Size } from '../contexts/general-types.ts';
import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type FillToolName = 'magic-eraser' | 'paint-bucket';

/**
 * Adobe's tolerance scale for the bucket, the magic eraser and the background eraser is 0-255,
 * not the 0-100 the Magic Wand uses: those three scale 0-255 onto a 3-channel maximum, and a pixel
 * differing only in alpha counts as inside the region. `createFloodFillMask` takes the same 0-255
 * scale, and both Options bars render the slider with `max={FILL_TOLERANCE_MAX}` so the two cannot
 * drift into each other.
 */
export const FILL_TOLERANCE_MAX = 255;

/** Adobe's seeded default for both the bucket and the magic eraser, and `createFloodFillMask`'s. */
export const FILL_TOLERANCE_DEFAULT = 32;

export type FillToolArgs = {
  toolName: FillToolName;
  /** Adobe's 0-255 scale. See `FILL_TOLERANCE_MAX`. */
  tolerance: number;
  /** Photoshop's Contiguous: 4-connected from the seed, or every matching pixel in the layer. */
  contiguous: boolean;
  /** 0..1, the convention `DrawToolArgs.alpha` already uses. */
  alpha: number;
  /**
   * The fill colour, meaningful for the bucket. Carried for both names so the pair shares one args
   * type and so the Magic Eraser's own options bar can render a swatch that is honestly inert
   * rather than absent.
   */
  color: string;
  /** The click, in image coordinates — the flood fill's seed. It has no other channel: a durable
   * `apply-raster-processor` op replays from the stored args alone. */
  pos: Point;
  /**
   * No `size`, and its absence is the same argument as `pos`'s presence inverted: both processors
   * read the geometry from the curried `ProcessorToolParams`, and the durable call site passes
   * `{ bitmap, size }` beside the stored args rather than inside them. A `size` here was written by
   * the tool area and read by nothing, so a reader trusting it got the seeded `1x1` and a writer
   * forgetting it produced a silently layer-sized fill.
   */
};

/** Read `bitmap` back at `size`. The same read `src/tools/transform.ts:87-94` performs. */

/** `hexToRgb` returns the `"r, g, b"` triple as a string for `rgba(...)`; a fill needs the numbers. */
const parseHexColor = (color: string): [number, number, number] => {
  const hex = color.replace('#', '');

  return [
    parseInt(hex.substring(0, 2), 16) || 0,
    parseInt(hex.substring(2, 4), 16) || 0,
    parseInt(hex.substring(4, 6), 16) || 0,
  ];
};

const readSourcePixels = (bitmap: BitmapSource, size: Size): ImageData => {
  const sourceCanvas = new OffscreenCanvas(size.width, size.height);
  const context = sourceCanvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return context.getImageData(0, 0, size.width, size.height);
};

type FillRegion = {
  imageData: ImageData;
  mask: Uint8Array;
  bounds: { left: number; top: number; right: number; bottom: number };
};

const resolveFillRegion = (bitmap: BitmapSource, size: Size, args: FillToolArgs): FillRegion | null => {
  const imageData = readSourcePixels(bitmap, size);
  const region = createFloodFillMask(imageData, args.pos, {
    tolerance: args.tolerance,
    contiguous: args.contiguous,
  });

  // A `null` region covers both "the seed is outside the layer" and "nothing matched the
  // tolerance", so a caller never has to tell those apart — and a fill that matched nothing is a
  // no-op on the layer rather than a blanking of it.
  if (!region || !region.bounds) return null;

  return { imageData, mask: region.mask, bounds: region.bounds };
};

/**
 * Shared shell for both fills: a layer-sized canvas, the source drawn back in, and `paint` applied
 * to the matched region. Both tools return the *whole* layer, because `commit: 'raster'` replaces
 * the layer's pixels with this canvas.
 */
const fillLayer =
  (
    params: ProcessorToolParams | CreatorToolParams,
    args: ToolArgs,
    paint: (region: FillRegion, args: FillToolArgs) => void
  ) =>
  (): ToolResult => {
    const { size } = params;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    // No source bitmap means the `createLayerFromTool` path: a brand-new layer that has nothing to
    // fill, so the answer is an empty canvas of the right size.
    if (!('bitmap' in params)) return [canvas];

    const fillArgs = args as unknown as FillToolArgs;
    const region = resolveFillRegion(params.bitmap, size, fillArgs);

    if (!region) {
      ctx.drawImage(params.bitmap, 0, 0, size.width, size.height);
      return [canvas];
    }

    paint(region, fillArgs);
    ctx.putImageData(region.imageData, 0, 0);

    return [canvas];
  };

/**
 * Paint bucket: the matched region's RGB becomes `color`, composited at `alpha`, and its alpha
 * rises to the fill's own coverage so a fill over fully transparent pixels makes them opaque
 * instead of tinting nothing.
 */
export const paintBucket =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult =>
    fillLayer(params, args, (region, fillArgs) => {
      const [fillRed, fillGreen, fillBlue] = parseHexColor(fillArgs.color);
      const { alpha } = fillArgs;
      const { data, width } = region.imageData;
      const { left, top, right, bottom } = region.bounds;

      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const pixelIndex = y * width + x;
          if (!region.mask[pixelIndex]) continue;

          // A real source-over, not a lerp. Lerping straight RGB against the destination's
          // straight RGB is only meaningful when the destination is opaque: at `alpha = 0.5` over
          // a fully transparent region the destination's stored RGB is 0, so the old code wrote
          // (128,0,0,128) — half of the fill mixed with half of nothing, i.e. half-black. Correct
          // straight-alpha compositing gives (255,0,0,128): half coverage of clean red. Adobe
          // describes Opacity as "lower opacity values create more transparent fills", which
          // only holds if the fill colour survives the blend. `blendPixel` is the shared
          // primitive and is what the gradient, smudge and clone-stamp paths already use.
          blendPixel(data, pixelIndex * 4, { r: fillRed, g: fillGreen, b: fillBlue, a: 255 }, alpha);
        }
      }
    })();

/**
 * Magic Eraser: the matched region loses alpha, at `alpha` — the same `destination-out` model the
 * Eraser's stroke uses, so the two agree on what Opacity means. At the seeded `1` the region
 * becomes fully transparent; below 1 it is partially erased, which is what Photoshop's slider
 * does. The region's RGB is deliberately left alone: erasing to transparent discards alpha, not
 * colour, and keeps a later re-fill from inheriting a darkened edge.
 */
export const magicEraser =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult =>
    fillLayer(params, args, (region, fillArgs) => {
      const { data, width } = region.imageData;
      const { left, top, right, bottom } = region.bounds;

      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const pixelIndex = y * width + x;
          if (!region.mask[pixelIndex]) continue;

          data[pixelIndex * 4 + 3] = Math.round(data[pixelIndex * 4 + 3] * (1 - fillArgs.alpha));
        }
      }
    })();
