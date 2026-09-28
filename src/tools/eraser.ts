import { drawLine } from '../util/draw.ts';
import { setupDrawCtx, type DrawToolArgs } from './draw.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';
import type { Point } from '../contexts/general-types.ts';
import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * The two eraser modes this renderer can honestly produce.
 *
 * Photoshop's third mode, Brush, is a soft tip, and the painter here issues one `beginPath`, one
 * `moveTo` and one `stroke()` per stroke (`src/util/draw.ts`), which has no falloff — so a Brush
 * eraser would silently render as Pencil. The Options bar still renders Photoshop's `Brush`
 * option, `disabled`, and the seeded default is `Pencil`, so the bar is Photoshop-shaped without
 * ever offering a mode that lies.
 */
export type EraserMode = 'pencil' | 'block';

export type EraserToolArgs = {
  mode: EraserMode;
  /**
   * Tip size in pixels, the same scalar `DrawToolArgs.lineWidth` carries. Not the `Size` type: an
   * eraser tip is a single edge length, and the Options bar caps it — see `ERASER_SIZE_MAX`.
   */
  lineWidth: number;
  /** 0..1, the convention `DrawToolArgs.alpha` already uses. Ignored by `block` mode. */
  alpha: number;
  /**
   * The store's foreground colour. An eraser subtracts alpha, so this never reaches the pixels; it
   * is carried so the Block stamp and the options-bar swatch agree on one value, and so a stroke
   * handed to the shared painter always has a `fillStyle`/`strokeStyle` to write.
   */
  color: string;
  points: Point[];

  toolName: 'eraser';
};

/** `EraserToolArgs` as the shared stroke painter's args: alpha subtraction, hard edge, no dash. */
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

/**
 * One eraser stroke, as a layer-sized raster. The source is drawn back in first whenever the caller
 * supplied one: `commit: 'raster'` replaces the layer's pixels with this canvas
 * (`src/contexts/materialization.ts:282-284`), so a stroke that skipped it would blank the layer
 * instead of cutting a hole in it. The `createLayerFromTool` path hands over `{ size }` with no
 * bitmap, and there the stroke correctly punches a hole in a fresh empty layer.
 */
export const eraser =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult => {
    const { size } = params;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    if ('bitmap' in params) ctx.drawImage(params.bitmap, 0, 0, size.width, size.height);

    const strokeArgs = buildEraseArgs(args);

    // `setupDrawCtx` writes the composite operator, stroke and alpha and deliberately leaves them on
    // the context, so the caller owns the bracket — the same contract `draw()` and `shape()` honour.
    // It cannot live inside `setupDrawCtx`: `drawLine` reads exactly the values it wrote. The alpha
    // is written at the tool's own value and never forced to 1, so a fresh canvas here still commits
    // a faded stroke.
    ctx.save();
    try {
      setupDrawCtx(ctx, strokeArgs);

      drawLine({ args: strokeArgs, ctx });
    } finally {
      ctx.restore();
    }

    return [canvas];
  };
