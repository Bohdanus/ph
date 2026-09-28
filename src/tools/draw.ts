import type { CreatorToolParams } from './toolProcessors.ts';
import { drawLine } from '../util/draw.ts';
import type { Ctx2D, Point } from '../contexts/general-types.ts';

export type PenType = 'pen' | 'pen-dashed' | 'spray';

export type DrawToolArgs = {
  alpha: number;
  color: string;
  penType: PenType;
  lineWidth: number;
  lineDash?: null | number[];
  points?: Point[];
  /**
   * Erase instead of paint: the stroke subtracts alpha from whatever is already there.
   *
   * `setupDrawCtx` is the only function that configures both the live preview overlay
   * (`src/components/Main/DrawToolArea.tsx:51`) and the committed raster (`draw`, below), so this
   * is the only place both paths can read. Absent on every args object that predates the eraser,
   * and the absent case writes `source-over` — the canvas default — so a legacy stroke renders
   * exactly as it did before, which is what keeps the `e2e/export/visual-regression.spec.ts`
   * baselines recorded through the legacy `draw` tool valid.
   */
  composite?: 'destination-out';
  /**
   * Block mode: stamp a hard square along the path instead of stroking it. Read by `drawPen`,
   * the single renderer every stroke reaches. Absent means the stroked path, unchanged.
   */
  blockStamp?: boolean;

  toolName: 'draw';
};

/**
 * The two tools that paint by STAMPING THE FOREGROUND COLOUR.
 *
 * `color-replacement` used to be a member of this union and is not any more: it is not a paint, it
 * is a substitution, and the two cannot share a processor or a settings shape. The old entry made
 * that visible in the worst place — `PaintToolArgs` carried a `penType` the Color Replacement
 * processor forced to `'spray'` and ignored every other control, so Tolerance and Limits had
 * nowhere to live. Its own args live in `src/tools/colorReplacement.ts`.
 */
export type PaintToolName = 'brush' | 'pencil';

export type PaintToolArgs = Omit<DrawToolArgs, 'toolName'> & {
  toolName: PaintToolName;
};

export type DrawToolSettings = Omit<DrawToolArgs, 'color' | 'points'>;

export const setupDrawCtx = (ctx: Ctx2D, args: DrawToolArgs) => {
  const { alpha, color, penType, lineDash, lineWidth } = args;

  // Assigned unconditionally rather than only when erasing: the overlay context is shared between
  // strokes and between tools, so an eraser that left `destination-out` behind would silently turn
  // the next tool's stroke into an eraser. `source-over` is the canvas default, so for every tool
  // that does not erase this writes back the value the context already held.
  ctx.globalCompositeOperation = args.composite === 'destination-out' ? 'destination-out' : 'source-over';

  if (penType === 'spray') return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = penType === 'pen' ? 'round' : 'square';
  ctx.globalAlpha = alpha;

  // The overlay context is shared between strokes and between tools, so the pattern is always
  // set, never merely appended: an undashed pen must clear the previous stroke's dash.
  if (penType === 'pen-dashed' && lineDash) ctx.setLineDash(lineDash);
  else ctx.setLineDash([]);
};

export const draw =
  ({ size }: CreatorToolParams) =>
  (args: DrawToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    setupDrawCtx(ctx, args);

    drawLine({
      args,
      ctx,
    });

    return [canvas];
  };
