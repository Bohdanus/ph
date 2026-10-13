import { drawLine } from '../util/draw.ts';
import { setupDrawCtx, type DrawToolArgs } from './draw.ts';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SPACING_DEFAULT,
  brushDabCenters,
  clampBrushTipSettings,
  tipAlphaAt,
  type BrushTipSettings,
} from '../util/brush-engine.ts';
import { pixelIndex } from '../util/pixels.ts';
import { createSelectionAlphaMask } from '../util/selection.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * The three eraser modes Photoshop's bar offers, all of which this renderer can now produce.
 *
 * `brush` is the soft tip and it is the seeded default, because Photoshop's is too — Adobe
 * describes it as erasing "with adjustable softness and opacity settings", and a first stroke
 * that comes out hard-edged is the opposite of what the tool is for. `pencil` and `block` are
 * the two hard modes and they keep the single-path `ctx.stroke()` / square-stamp renderers,
 * unchanged and still exact.
 */
export type EraserMode = 'brush' | 'pencil' | 'block';

/**
 * Photoshop's eraser default tip is a soft round brush, so the seeded `Hardness` is a real
 * falloff rather than the engine's own 100%. A hard seeded edge would leave the defect in place
 * for every user who never opened the bar.
 */
export const ERASER_HARDNESS_DEFAULT = 50;
export const ERASER_HARDNESS_MIN = BRUSH_HARDNESS_MIN;
export const ERASER_HARDNESS_MAX = BRUSH_HARDNESS_MAX;

/**
 * The dab spacing, as a percentage of the tip diameter, and the engine's default rather than a
 * setting of this tool's own — the same reasoning `SMUDGE_SPACING_PERCENT` in
 * `src/tools/smudge.ts:38-40` records. Photoshop's eraser bar does expose `Spacing`, so this is
 * the value that bar's slider starts and stops at rather than a constant: a tool that carried no
 * spacing would stamp one tip per pointer sample and the density would follow the pointer's rate.
 */
export const ERASER_SPACING_PERCENT = BRUSH_SPACING_DEFAULT;

export type EraserToolArgs = {
  mode: EraserMode;
  /**
   * Tip size in pixels, the same scalar `DrawToolArgs.lineWidth` carries. Not the `Size` type: an
   * eraser tip is a single edge length, and the Options bar caps it — see `ERASER_SIZE_MAX`. It
   * is also the DIAMETER in `brush` mode, because the tip is stamped rather than stroked.
   */
  lineWidth: number;
  /** 0..1, the convention `DrawToolArgs.alpha` already uses. Ignored by `block` mode. */
  alpha: number;
  /** 0-100, the tip's falloff. `brush` mode only; the hard modes have no edge to soften. */
  hardness: number;
  /** 1-100 percent of the tip diameter between dab centres. `brush` mode only. */
  spacing: number;
  /**
   * The store's foreground colour. An eraser subtracts alpha, so this never reaches the pixels; it
   * is carried so the Block stamp and the options-bar swatch agree on one value, and so a stroke
   * handed to the shared painter always has a `fillStyle`/`strokeStyle` to write.
   */
  color: string;
  points: Point[];
  /** The committed selection snapshot that clips this stroke during replay. */
  selection?: {
    points: Point[];
    featherRadius: number;
    antiAlias: boolean;
  };

  toolName: 'eraser';
};

/**
 * `EraserToolArgs` as the shared stroke painter's args: alpha subtraction, hard edge, no dash.
 *
 * The two hard modes only. A `brush` stroke never reaches `drawLine`, because a `ctx.stroke()`
 * is a path with a constant `lineWidth` and has nowhere to put a per-dab falloff; the tip path
 * below is the only route that can.
 */
export const buildEraseArgs = (args: ToolArgs): DrawToolArgs => {
  const { mode, alpha, color, lineWidth, points } = args as unknown as EraserToolArgs;

  return {
    alpha,
    blockStamp: mode === 'block',
    color,
    composite: 'destination-out',
    lineWidth,
    penType: 'pen',
    points,
    toolName: 'draw',
  };
};

/** The `brush` mode's args as the shared tip engine's settings, clamped once per stroke. */
const buildTipSettings = (args: ToolArgs): BrushTipSettings => {
  const { alpha, hardness, lineWidth, spacing } = args as unknown as EraserToolArgs;

  return clampBrushTipSettings({ hardness, opacity: alpha, size: lineWidth, spacing });
};

/** A `Size` reduced to the integer extents a pixel buffer can address. */
const extent = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

/**
 * Stops a dab from writing outside the raster, as an INCLUSIVE pixel span, or `null` when the
 * whole disc is off the buffer — a stroke routinely leaves the canvas and must not throw there.
 *
 * A disc's bounding box is the cheaper filter, one `tipAlphaAt` per covered pixel rather than
 * one per pixel in the square. This is the same span as the private `dabSpan` in
 * `src/tools/smudge.ts:62-68` and `src/tools/cloneStamp.ts`, spelled out again rather than
 * imported because all of them are private.
 */
type PixelSpan = { left: number; top: number; right: number; bottom: number };

const dabSpan = (center: Point, radius: number, width: number, height: number): PixelSpan | null => {
  const left = Math.max(0, Math.ceil(center.x - radius));
  const right = Math.min(width - 1, Math.floor(center.x + radius));
  const top = Math.max(0, Math.ceil(center.y - radius));
  const bottom = Math.min(height - 1, Math.floor(center.y + radius));

  return left > right || top > bottom ? null : { left, top, right, bottom };
};

/**
 * One dab of the Brush eraser: multiply every alpha the tip covers by `1 - coverage`.
 *
 * THAT MULTIPLICATION IS `destination-out`. The canvas operator is defined as `da' = da * (1 - sa)`
 * on the destination alpha, with colour left alone, and this is that formula applied in the
 * layer's own straight-alpha buffer — the same buffer the rest of the paint family reads and
 * writes (`src/util/pixels.ts`, `src/tools/smudge.ts`). The colour channels are deliberately
 * untouched, which is what keeps an erase from smearing black into the pixels around the hole.
 *
 * `stampBrushDab` cannot do this. It is `blendPixel`, which is source-over and no-ops outright on
 * `src.a <= 0`, so a "zero-alpha colour" stamp is arithmetically a no-op rather than an erase —
 * which is the trap `src/util/brush-engine.ts:281-284` names when it says the eraser is "the same
 * dab with the inverse coverage". The inverse coverage is computed here and shares the engine's
 * `tipAlphaAt`, so a change to the falloff still reaches the eraser and cannot skip it.
 */
const eraseDab = (data: Uint8ClampedArray, raster: Size, center: Point, tip: BrushTipSettings): void => {
  const radius = tip.size / 2;
  const span = dabSpan(center, radius, raster.width, raster.height);
  if (!span) return;

  for (let y = span.top; y <= span.bottom; y++) {
    const distanceY = y - center.y;
    for (let x = span.left; x <= span.right; x++) {
      const distanceX = x - center.x;
      const weight =
        tipAlphaAt(Math.sqrt(distanceX * distanceX + distanceY * distanceY), radius, tip.hardness) * tip.opacity;
      if (!(weight > 0)) continue;

      const offset = pixelIndex(x, y, raster.width);
      if (offset < 0 || offset + 3 >= data.length) continue;
      data[offset + 3] = data[offset + 3] * (1 - weight);
    }
  }
};

/**
 * The whole `brush` stroke: `brushDabCenters` over the path, then one erased dab per centre,
 * straight into the layer raster the source was already drawn into.
 *
 * A single-point stroke is a click and it still lays down one dab, which is the one thing the
 * legacy path cannot do at all — a zero-length `ctx.stroke()` draws nothing unless it is given a
 * line cap.
 *
 * The floor matters: the document size reduced to whole pixels, because a fractional bound
 * addresses a byte offset the buffer does not have. `raster.width === 0` is the arm a zero-size
 * layer takes, and it is a no-op rather than a throw for the same reason `dabSpan` returns null.
 */
const eraseWithTip = (ctx: OffscreenCanvasRenderingContext2D, size: Size, points: Point[], tip: BrushTipSettings) => {
  if (points.length === 0 || !(tip.opacity > 0)) return;

  const raster: Size = { width: extent(size.width), height: extent(size.height) };
  if (raster.width === 0 || raster.height === 0) return;

  const image = ctx.getImageData(0, 0, raster.width, raster.height);
  for (const center of brushDabCenters(points, tip.size, tip.spacing)) {
    eraseDab(image.data, raster, center, tip);
  }
  ctx.putImageData(image, 0, 0);
};

/**
 * One eraser stroke, as a layer-sized raster. The source is drawn back in first whenever the caller
 * supplied one: `commit: 'raster'` replaces the layer's pixels with this canvas
 * (`src/contexts/materialization.ts:282-284`), so a stroke that skipped it would blank the layer
 * instead of cutting a hole in it. The `createLayerFromTool` path hands over `{ size }` with no
 * bitmap, and there the stroke correctly punches a hole in a fresh empty layer.
 *
 * There is no live overlay for any of the three modes. `EraserToolArea.tsx` previews by writing
 * through `tempUpdateLayer`, because an overlay starts every frame empty and `destination-out`
 * computes `da' = da * (1 - sa)`, which with `da = 0` is 0 for every pixel — so the tip path and
 * the stroke path are previewed by the same call, and there is nothing for them to disagree with.
 */
export const eraser =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult => {
    const { size } = params;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    // Use previousCanvas for incremental eraser brush-mode, otherwise fall back to bitmap
    const sourceBitmap =
      'previousCanvas' in params && params.previousCanvas
        ? params.previousCanvas
        : 'bitmap' in params
          ? params.bitmap
          : null;
    if (sourceBitmap) ctx.drawImage(sourceBitmap, 0, 0, size.width, size.height);

    const eraserArgs = args as unknown as EraserToolArgs;
    const { mode } = eraserArgs;
    const selectionMask = eraserArgs.selection
      ? createSelectionAlphaMask(eraserArgs.selection.points, size, eraserArgs.selection)
      : null;
    const original = selectionMask ? ctx.getImageData(0, 0, size.width, size.height) : null;

    // `setupDrawCtx` writes the composite operator, stroke and alpha and deliberately leaves them on
    // the context, so the caller owns the bracket — the same contract `draw()` and `shape()` honour.
    // It cannot live inside `setupDrawCtx`: `drawLine` reads exactly the values it wrote. The alpha
    // is written at the tool's own value and never forced to 1, so a fresh canvas here still commits
    // a faded stroke. Only the two hard modes need it: the tip path writes the destination alpha
    // itself, so a context left carrying `destination-out` would be the only thing a later
    // `drawImage` on the same canvas could pick up.
    ctx.save();
    try {
      if (mode === 'brush') {
        eraseWithTip(
          ctx as OffscreenCanvasRenderingContext2D,
          size,
          (args as unknown as EraserToolArgs).points,
          buildTipSettings(args)
        );
      } else {
        const strokeArgs = buildEraseArgs(args);
        setupDrawCtx(ctx, strokeArgs);
        drawLine({ args: strokeArgs, ctx });
      }

      if (selectionMask && original) {
        const image = ctx.getImageData(0, 0, size.width, size.height);
        for (let index = 0; index < selectionMask.length; index++) {
          const offset = index * 4;
          const coverage = selectionMask[index] / 255;
          const erasedAlpha = original.data[offset + 3] - image.data[offset + 3];
          image.data[offset + 3] = Math.round(original.data[offset + 3] - erasedAlpha * coverage);
          image.data[offset] = original.data[offset];
          image.data[offset + 1] = original.data[offset + 1];
          image.data[offset + 2] = original.data[offset + 2];
        }
        ctx.putImageData(image, 0, 0);
      }
    } finally {
      ctx.restore();
    }

    return [canvas];
  };
