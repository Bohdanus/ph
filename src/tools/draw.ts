import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';
import type { PaintBlendMode, PaintSettings, PaintToolName } from './brush.ts';
import { drawLine } from '../util/draw.ts';
import { decodeRasterSelectionMask, isRasterSelectionPixelSelected } from '../util/selection-mask.ts';
import type { Ctx2D, Point, PositionedRasterSelectionMask, Selection, Size } from '../contexts/general-types.ts';
import { createSelectionAlphaMask, getSelectionProcessorSnapshot } from '../util/selection.ts';

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
   * in `DrawToolArea` and the committed raster (`draw`, below), so this
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
   * (`savedDrawPerPen`) predate it; an absent value is no smoothing,
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
 * one member of the `PaintToolName` union in `src/tools/brush.ts`.
 */
export type { PaintToolName };

/** Active selection coverage captured in the local coordinates of a paint raster. */
export type PaintSelectionSnapshot = {
  points: Point[][];
  rasterMask?: PositionedRasterSelectionMask;
  featherRadius: number;
  antiAlias: boolean;
};

/**
 * A paint tool carries the Photoshop options-bar settings as required, so the bar
 * can read them without a guard and a `draw`-era args object can never satisfy the
 * type by omission.
 */
export type PaintToolArgs = Omit<DrawToolArgs, 'toolName' | 'smoothing' | 'blendMode'> &
  PaintSettings & {
    toolName: PaintToolName;
    /** History snapshot used to constrain this stroke and deterministic replay. */
    selection?: PaintSelectionSnapshot;
  };

export type DrawToolSettings = Omit<DrawToolArgs, 'color' | 'points' | 'pointTimes'>;

/** Capture selection geometry and options so later store changes cannot alter this stroke. */
export function capturePaintSelectionSnapshot(selection: Selection): PaintSelectionSnapshot {
  return getSelectionProcessorSnapshot(selection, { x: 0, y: 0 });
}

/** Rebase a captured document-space selection snapshot into a raster-local coordinate space. */
export function rebasePaintSelectionSnapshot(
  selection: PaintSelectionSnapshot,
  rasterOrigin: Point
): PaintSelectionSnapshot {
  return {
    points: selection.points.map((contour) =>
      contour.map((point) => ({ x: point.x - rasterOrigin.x, y: point.y - rasterOrigin.y }))
    ),
    ...(selection.rasterMask
      ? {
          rasterMask: {
            ...selection.rasterMask,
            x: selection.rasterMask.x - rasterOrigin.x,
            y: selection.rasterMask.y - rasterOrigin.y,
          },
        }
      : {}),
    featherRadius: selection.featherRadius,
    antiAlias: selection.antiAlias,
  };
}

function rasterMaskHasSelectedPixelNearRaster(
  rasterMask: PositionedRasterSelectionMask,
  packed: Uint8Array,
  width: number,
  height: number,
  featherRadius: number,
  antiAlias: boolean
): boolean {
  if (!Number.isFinite(rasterMask.x) || !Number.isFinite(rasterMask.y)) return false;

  // With integer-aligned raster selections, outside pixels receive feather alpha only when their
  // chamfer distance to a selected pixel is strictly less than the feather radius. Anti-aliasing
  // preserves the rasterizer's existing pixel coverage; it does not grow a binary raster mask.
  const integerOrigin = Number.isInteger(rasterMask.x) && Number.isInteger(rasterMask.y);
  if (!integerOrigin) {
    // A moved raster mask can contribute only fractional coverage at a destination pixel. A
    // selected source pixel inside a ceil(featherRadius) bounding box may still be exactly at the
    // feather's zero-alpha limit, so use the same padded alpha raster as the commit path before
    // deciding whether this stroke would create a visible layer.
    const padding = Math.max(antiAlias ? 1 : 0, Math.ceil(featherRadius));
    const expandedWidth = width + padding * 2;
    const expandedHeight = height + padding * 2;
    const expandedSelection = {
      points: [],
      rasterMask: {
        ...rasterMask,
        x: rasterMask.x + padding,
        y: rasterMask.y + padding,
      },
    };
    const expandedAlpha = createSelectionAlphaMask(
      expandedSelection,
      { width: expandedWidth, height: expandedHeight },
      { featherRadius, antiAlias }
    );

    for (let y = 0; y < height; y += 1) {
      const rowOffset = (y + padding) * expandedWidth + padding;
      for (let x = 0; x < width; x += 1) {
        if (expandedAlpha[rowOffset + x] > 0) return true;
      }
    }

    return false;
  }

  const padding = Math.max(0, Math.ceil(featherRadius) - 1);
  const firstX = Math.max(0, Math.floor(-padding - rasterMask.x));
  const firstY = Math.max(0, Math.floor(-padding - rasterMask.y));
  const lastX = Math.min(rasterMask.width, Math.ceil(width + padding - rasterMask.x));
  const lastY = Math.min(rasterMask.height, Math.ceil(height + padding - rasterMask.y));
  if (firstX >= lastX || firstY >= lastY) return false;

  for (let y = firstY; y < lastY; y += 1) {
    for (let x = firstX; x < lastX; x += 1) {
      if (!isRasterSelectionPixelSelected(rasterMask, packed, x, y)) continue;
      if (!integerOrigin) return true;

      const pixelX = rasterMask.x + x;
      const pixelY = rasterMask.y + y;
      const distanceX = pixelX < 0 ? -pixelX : pixelX >= width ? pixelX - (width - 1) : 0;
      const distanceY = pixelY < 0 ? -pixelY : pixelY >= height ? pixelY - (height - 1) : 0;
      if (distanceX === 0 && distanceY === 0) return true;

      const nearest = Math.max(distanceX, distanceY) + (Math.SQRT2 - 1) * Math.min(distanceX, distanceY);
      if (nearest < featherRadius) return true;
    }
  }

  return false;
}

/** Whether the captured selection can affect any pixel in a raster-sized paint stroke. */
export function paintSelectionOverlapsRaster(selection: PaintSelectionSnapshot, size: Size): boolean {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  if (width === 0 || height === 0) return false;

  const featherRadius = Number.isFinite(selection.featherRadius) ? Math.max(0, selection.featherRadius) : 0;
  const edgePadding = Math.max(selection.antiAlias ? 1 : 0, Math.ceil(featherRadius));

  if (selection.rasterMask) {
    const { width: maskWidth, height: maskHeight, data } = selection.rasterMask;
    const packed = decodeRasterSelectionMask({ width: maskWidth, height: maskHeight, data });
    if (packed) {
      return rasterMaskHasSelectedPixelNearRaster(
        selection.rasterMask,
        packed,
        width,
        height,
        featherRadius,
        selection.antiAlias
      );
    }
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const contour of selection.points) {
    if (contour.length < 3) continue;
    for (const point of contour) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return false;
  }

  const left = Math.max(0, Math.floor(minX - edgePadding));
  const top = Math.max(0, Math.floor(minY - edgePadding));
  const right = Math.min(width, Math.ceil(maxX + edgePadding));
  const bottom = Math.min(height, Math.ceil(maxY + edgePadding));
  if (left >= right || top >= bottom) return false;

  // Bounds reject distant polygons cheaply, but a concave contour (or a thin diagonal one) can
  // enclose empty pixels inside its bounding box. Check the exact alpha raster used by commit so
  // a stroke in one of those holes does not create an invisible history layer.
  const expandedWidth = right - left + edgePadding * 2;
  const expandedHeight = bottom - top + edgePadding * 2;
  const expandedSelection = rebasePaintSelectionSnapshot(selection, {
    x: left - edgePadding,
    y: top - edgePadding,
  });
  const expandedAlpha = createSelectionAlphaMask(
    expandedSelection,
    { width: expandedWidth, height: expandedHeight },
    { featherRadius, antiAlias: selection.antiAlias }
  );

  for (let y = 0; y < bottom - top; y += 1) {
    const rowOffset = (y + edgePadding) * expandedWidth + edgePadding;
    for (let x = 0; x < right - left; x += 1) {
      if (expandedAlpha[rowOffset + x] > 0) return true;
    }
  }

  return false;
}

export const setupDrawCtx = (ctx: Ctx2D, args: DrawToolArgs) => {
  const { alpha, color, penType, lineDash, lineWidth } = args;

  // Match the committed rendering path (draw function, presentation-evaluator) which uses
  // imageSmoothingEnabled = false. Without this, the live tool overlay stroke has
  // anti-aliasing (smoothing enabled by default) while the committed layer does not,
  // causing a pixel mismatch in the HiDPI Draw preview/commit test.
  ctx.imageSmoothingEnabled = false;

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

/** Build a raster-sized alpha canvas from a stored selection snapshot. */
export function createSelectionMaskCanvas(selection: PaintSelectionSnapshot, size: Size): OffscreenCanvas {
  const width = Math.max(0, Math.floor(size.width));
  const height = Math.max(0, Math.floor(size.height));
  const canvas = new OffscreenCanvas(width, height);
  if (width === 0 || height === 0) return canvas;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Paint selection mask could not create a 2D canvas context');

  // Feathering needs the selection neighborhood outside a stroke tile or cropped raster.
  // Rasterize a padded snapshot, then crop it back so tiled preview and committed output use
  // the same global edge coverage without introducing seams at tile/raster boundaries.
  const featherRadius = Number.isFinite(selection.featherRadius) ? Math.max(0, selection.featherRadius) : 0;
  const padding = Math.max(selection.antiAlias ? 1 : 0, Math.ceil(featherRadius));
  const expandedSize = { width: width + padding * 2, height: height + padding * 2 };
  const expandedSelection = rebasePaintSelectionSnapshot(selection, { x: -padding, y: -padding });
  const expandedCoverage = createSelectionAlphaMask(expandedSelection, expandedSize, expandedSelection);
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = (y + padding) * expandedSize.width + x + padding;
      const targetIndex = (y * width + x) * 4;
      image.data[targetIndex] = 255;
      image.data[targetIndex + 1] = 255;
      image.data[targetIndex + 2] = 255;
      image.data[targetIndex + 3] = expandedCoverage[sourceIndex];
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export const draw = (params: CreatorToolParams | ProcessorToolParams) => (args: DrawToolArgs) => {
  const { size, backingScale = 1 } = params;
  const canvas = new OffscreenCanvas(size.width * backingScale, size.height * backingScale);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
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

/** Render a paint stroke and constrain only the stroke pixels to its captured selection. */
export function drawPaintWithSelection(
  params: CreatorToolParams | ProcessorToolParams,
  args: DrawToolArgs,
  selection?: PaintSelectionSnapshot
): ToolResult {
  if (!selection) return [draw(params)(args)[0]];

  const { size, backingScale = 1 } = params;
  const stroke = draw({ size, backingScale })(args)[0] as OffscreenCanvas;
  const selectionMask = createSelectionMaskCanvas(selection, size);
  const strokeContext = stroke.getContext('2d');
  if (!strokeContext) throw new Error('Paint selection could not access the stroke canvas context');

  strokeContext.save();
  try {
    strokeContext.setTransform(backingScale, 0, 0, backingScale, 0, 0);
    strokeContext.globalAlpha = 1;
    strokeContext.globalCompositeOperation = 'destination-in';
    strokeContext.drawImage(selectionMask, 0, 0, size.width, size.height);
  } finally {
    strokeContext.restore();
  }

  if (!('bitmap' in params)) return [stroke];

  // A processor can be replayed over an existing raster. Keep that source untouched outside
  // the selection by masking an isolated stroke first, then compositing it over the source.
  const canvas = new OffscreenCanvas(size.width * backingScale, size.height * backingScale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Paint selection could not create the destination canvas context');
  context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  context.imageSmoothingEnabled = false;
  context.drawImage(params.bitmap, 0, 0, size.width, size.height);
  context.drawImage(stroke, 0, 0, size.width, size.height);
  return [canvas];
}
