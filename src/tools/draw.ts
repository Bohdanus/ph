import type { CreatorToolParams, ProcessorToolParams } from './toolProcessors.ts';
import type { PaintBlendMode, PaintSettings, PaintToolName } from './brush.ts';
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
   * Relative elapsed time in milliseconds for each Spray sample. Absent on older strokes,
   * which retain their original one-dab-per-point rendering.
   */
  pointTimes?: number[];
  /** Spray build rate, as a percentage. */
  flow?: number;
  /**
   * Erase instead of paint: the stroke subtracts alpha from whatever is already there.
   *
   * `setupDrawCtx` is the only function that configures both the live preview overlay
   * (`src/components/Main/DrawToolArea.tsx:95`) and the committed raster (`draw`, below), so this
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
  /**
   * Photoshop `Smoothing`, 0-100, applied to the sampled path by
   * `smoothStrokePoints`. Optional because the legacy `draw` tool's per-pen presets
   * (`src/tools/settings.ts:53`) predate it; an absent value is no smoothing,
   * which is exactly what those presets render today.
   */
  smoothing?: number;
  /**
   * Photoshop `Mode`, applied when a paint stroke's layer is created. Optional for
   * the same reason as `smoothing`; an absent value composites as Normal.
   */
  blendMode?: PaintBlendMode;

  toolName: 'draw';
};

/**
 * The paint tools, re-exported from `./brush.ts`, which is where the union is DECLARED.
 *
 * `color-replacement` used to be a member of that union and is not any more: it is not a paint,
 * it is a substitution, and the two cannot share a processor or a settings shape. The old entry
 * made that visible in the worst place — `PaintToolArgs` carried a `penType` the Color
 * Replacement processor forced to `'spray'` and ignored every other control, so Tolerance and
 * Limits had nowhere to live. Its own args live in `src/tools/colorReplacement.ts`.
 *
 * The narrowing is deliberately NOT a second declaration here. `brush.ts` owns the union, and
 * redeclaring it in this file would leave two types with one name and different members — the
 * exact class of bug the removal is fixing, re-created silently and one file over. The edit is
 * one member of `src/tools/brush.ts:9`.
 */
export type { PaintToolName };

/**
 * A paint tool carries the Photoshop options-bar settings as required, so the bar
 * can read them without a guard and a `draw`-era args object can never satisfy the
 * type by omission.
 */
export type PaintToolArgs = Omit<DrawToolArgs, 'toolName' | 'smoothing' | 'blendMode'> &
  PaintSettings & {
    toolName: PaintToolName;
  };

export type DrawToolSettings = Omit<DrawToolArgs, 'color' | 'points' | 'pointTimes'>;

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

export const draw = (params: CreatorToolParams | ProcessorToolParams) => (args: DrawToolArgs) => {
  const { size } = params;
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  if ('bitmap' in params) ctx.drawImage(params.bitmap, 0, 0, size.width, size.height);

  // `setupDrawCtx` writes the composite operator for every pen type and, for the two stroked
  // ones, stroke and alpha too — and it deliberately leaves all of it on the context, so every
  // caller has to bracket it. The bracket cannot live INSIDE `setupDrawCtx`: `drawLine` reads
  // exactly the values it wrote, and the overlay paints many times per one `setupDrawCtx`, so a
  // `restore()` there would either discard the settings the next `drawLine` needs or unbalance
  // the stack.
  //
  // For the two stroked pen types `globalAlpha` is written at the tool's own alpha and never
  // forced to 1, so a fresh `OffscreenCanvas` here still commits a faded layer. `spray` returns
  // before that write: `drawSpray` carries the tool's alpha in its gradient colour stops
  // (its peak of `alpha * SPRAY_PEAK_ALPHA`, held over the inner quarter of the radius, then
  // `0` at the rim) and so needs no `globalAlpha` and leaves none behind — the composite
  // operator is the only state it writes, and this bracket covers that.
  // The visible consequence of the overlay being bracketed: a spray preview drawn after a stroke
  // at less than full alpha used to be DIMMER than the commit it previewed, because it
  // multiplied its own gradient by the alpha that stroke had leaked. The bracketed overlay
  // paints at the strength a fresh `OffscreenCanvas` gives the commit, so it is brighter in
  // exactly that case.
  ctx.save();
  try {
    setupDrawCtx(ctx, args);

    drawLine({
      args,
      ctx,
    });
  } finally {
    ctx.restore();
  }

  return [canvas];
};
