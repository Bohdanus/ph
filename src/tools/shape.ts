import type { CreatorToolParams, ToolResult } from './toolProcessors.ts';
import type { Ctx2D, Point } from '../contexts/general-types.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

export type FigureType = 'line' | 'rectangle' | 'oval' | 'triangle' | 'polygon';

export type LegacyFigureType = FigureType | 'circle' | 'square';

const legacyFigureMap: Record<'circle' | 'square', FigureType> = {
  circle: 'oval',
  square: 'rectangle',
};

export const isFigureType = (figure: unknown): figure is FigureType =>
  figure === 'line' || figure === 'rectangle' || figure === 'oval' || figure === 'triangle' || figure === 'polygon';

/**
 * Photoshop exposes Circle and Square as Shift-constrained outcomes of the
 * Ellipse and Rectangle tools rather than as dedicated tools. Persisted state
 * may still carry those legacy figure values, so map them onto their base
 * figure instead of discarding the user's saved shape style.
 */
export const normalizeFigure = (figure: unknown): FigureType => {
  if (isFigureType(figure)) return figure;
  if (figure === 'circle' || figure === 'square') return legacyFigureMap[figure];
  return 'rectangle';
};

export type ShapeToolMode = 'shape' | 'path' | 'pixels';
export type ShapeLineCap = CanvasLineCap;

export type ShapeToolArgs = {
  alpha: number;
  color: string;
  backgroundColor: null | string;
  hasFill?: boolean;
  figure: FigureType;
  lineWidth: number;
  lineDash?: null | number[];
  lineCap?: ShapeLineCap;
  cornerRadius?: number;
  toolMode?: ShapeToolMode;
  start?: Point;
  end?: Point;

  toolName: 'shape';
};

export type ShapeToolSettings = Omit<ShapeToolArgs, 'color' | 'backgroundColor' | 'start' | 'end'>;

export type ShapeGeometryConstraints = {
  shiftKey: boolean;
  altKey: boolean;
};

export type ShapeGeometry = {
  start: Point;
  end: Point;
};

const LINE_ANGLE_STEP = Math.PI / 4;

const snapLineGeometry = (anchor: Point, pointer: Point, altKey: boolean, shiftKey: boolean): ShapeGeometry => {
  if (!shiftKey) {
    return {
      start: altKey ? { x: anchor.x * 2 - pointer.x, y: anchor.y * 2 - pointer.y } : { x: anchor.x, y: anchor.y },
      end: { x: pointer.x, y: pointer.y },
    };
  }

  const end = altKey ? { x: anchor.x * 2 - pointer.x, y: anchor.y * 2 - pointer.y } : pointer;
  const dx = end.x - anchor.x;
  const dy = end.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { start: { x: anchor.x, y: anchor.y }, end };

  const angle = Math.round(Math.atan2(dy, dx) / LINE_ANGLE_STEP) * LINE_ANGLE_STEP;
  return {
    start: { x: anchor.x, y: anchor.y },
    end: { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length },
  };
};

/**
 * Single source of truth for shape drag geometry.
 *
 * Shift mirrors Photoshop's constraints: Rectangle and Ellipse snap to the
 * larger absolute drag dimension while keeping the drag quadrant, and Line
 * quantizes its angle to 45-degree multiples. Alt/Option draws from the
 * center, so `anchor` becomes the midpoint of the resulting box; combined with
 * Shift this yields a centered square or circle with equal half-extents.
 */
export const normalizeShapeGeometry = (
  anchor: Point,
  pointer: Point,
  figure: FigureType,
  constraints: ShapeGeometryConstraints
): ShapeGeometry => {
  const { shiftKey, altKey } = constraints;

  if (figure === 'line') return snapLineGeometry(anchor, pointer, altKey, shiftKey);

  if (shiftKey) {
    // Measure half-extents from the anchor, which is the shape center when
    // Alt/Option is held. Snapping the larger axis keeps the drag quadrant and
    // keeps the anchor exactly centered for Alt+Shift.
    const half = Math.max(Math.abs(pointer.x - anchor.x), Math.abs(pointer.y - anchor.y));
    const directionX = Math.sign(pointer.x - anchor.x) || 1;
    const directionY = Math.sign(pointer.y - anchor.y) || 1;

    return {
      start: altKey
        ? { x: anchor.x - directionX * half, y: anchor.y - directionY * half }
        : { x: anchor.x, y: anchor.y },
      end: { x: anchor.x + directionX * half, y: anchor.y + directionY * half },
    };
  }

  return {
    start: altKey ? { x: anchor.x * 2 - pointer.x, y: anchor.y * 2 - pointer.y } : { x: anchor.x, y: anchor.y },
    end: { x: pointer.x, y: pointer.y },
  };
};

/**
 * Layer bounds for an already-normalized geometry. Derived from the same
 * start/end the preview draws, so the committed layer can never disagree with
 * the live preview. Padding covers half the stroke on each side plus one
 * pixel of antialiasing slack.
 *
 * The box is rounded OUTWARD — the origin down, the far edge up — so all four fields are
 * integers and the box is a valid `OffscreenCanvas` size. That is the whole point: the layer's
 * bitmap is allocated as `new OffscreenCanvas(width, height)`, whose constructor truncates, so a
 * fractional box used to declare an extent its own raster disagreed with by up to a pixel and the
 * right or bottom edge — including half the stroke the padding exists for — was clipped on
 * composite. Rounding inward instead would clip a stroke that the geometry genuinely covers.
 *
 * Outward rounding is the identity ONLY when the padding is integral, i.e. at an even stroke
 * width. The Size slider is `min="0.5" step="0.5"` and every figure preset seeds `5`, so
 * `lineWidth / 2 + 1` is a half-integer for every odd step and the box GROWS: measured on
 * (10,20)-(50,60), width 1 pads to a 43-wide box that rounds to 44, half a pixel further out on
 * each side. The growth is harmless, and the half-integer widths a 0.5 step reaches behave the
 * same way (width 0.5 pads to 42.5 and rounds to 44), because `floor` and `ceil` can only widen
 * the box, never narrow it — the geometry plus the full stroke stays inside the allocation either
 * way. The rebase is exact at any width, and for a different reason: `ShapeToolArea` subtracts
 * this box's INTEGRAL origin from the committed `start`/`end`, so integer geometry rebases to
 * integer coordinates whether or not the stroke width is even.
 */
export const shapeGeometryBounds = (
  { start, end }: ShapeGeometry,
  lineWidth: number
): { x: number; y: number; width: number; height: number } => {
  const pad = lineWidth / 2 + 1;
  const x = Math.floor(Math.min(start.x, end.x) - pad);
  const y = Math.floor(Math.min(start.y, end.y) - pad);
  return {
    x,
    y,
    width: Math.ceil(Math.max(start.x, end.x) + pad) - x,
    height: Math.ceil(Math.max(start.y, end.y) + pad) - y,
  };
};

export const setShapeCtx = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { alpha, color, backgroundColor, hasFill, lineWidth, lineDash, lineCap } = args;

  ctx.strokeStyle = color;
  if (hasFill && backgroundColor) {
    ctx.fillStyle = backgroundColor;
  }
  ctx.lineWidth = lineWidth;
  ctx.lineCap = lineCap ?? 'butt';
  ctx.globalAlpha = alpha;
  ctx.setLineDash(lineDash ?? []);
};

const roundedRectPath = (ctx: Ctx2D, x: number, y: number, width: number, height: number, radius: number) => {
  const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Math.max(0, radius));
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(right - r, y);
  ctx.quadraticCurveTo(right, y, right, y + r);
  ctx.lineTo(right, bottom - r);
  ctx.quadraticCurveTo(right, bottom, right - r, bottom);
  ctx.lineTo(x + r, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const drawShape = (ctx: Ctx2D, args: ShapeToolArgs) => {
  const { figure, start, end } = args;
  const hasFill = args.toolMode !== 'path' && args.hasFill;

  if (!start || !end) return;

  if (figure === 'line') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (figure === 'triangle' || figure === 'polygon') {
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    const sides = figure === 'triangle' ? 3 : 5;

    ctx.beginPath();
    for (let index = 0; index < sides; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
      const point = {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      };
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    if (hasFill) ctx.fill();
    ctx.stroke();
  } else if (figure === 'rectangle') {
    // A rectangle is quadrant-independent, so derive the top-left corner and the
    // positive extents the way shapeGeometryBounds allocates them, not the way
    // the raw drag happened to run. normalizeShapeGeometry keeps the drag
    // quadrant, so a drag up-and-left reaches here with end < start; taking the
    // absolute extents alone would keep the wrong origin and mirror the shape
    // into the opposite quadrant, and a negative extent would also invert which
    // corner each `r` offset in roundedRectPath is measured from -- `r` itself is
    // clamped to `min(|width|/2, |height|/2, radius)`, so a negative extent still
    // cannot widen the radius -- dilating the rounded path by `r` outward on every
    // negative axis and sending it outside the layer bounds.
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    const radius = args.cornerRadius ?? 0;
    if (radius > 0) {
      roundedRectPath(ctx, x, y, w, h, radius);
      if (hasFill) ctx.fill();
      ctx.stroke();
    } else {
      if (hasFill) ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  } else if (figure === 'oval') {
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (hasFill) {
      ctx.fill();
    }
    ctx.stroke();
  }
};

export const shape =
  ({ size }: CreatorToolParams): ((args: ToolArgs) => ToolResult) =>
  (args) => {
    if (!('figure' in args)) {
      throw new Error(`Tool "${args.toolName}" does not provide shape arguments`);
    }

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    const shapeArgs = { ...args, toolName: 'shape', figure: normalizeFigure(args.figure) } as ShapeToolArgs;

    // `setShapeCtx` writes stroke, fill, alpha and the dash and leaves them on the context, so
    // every caller has to bracket it. The bracket cannot live inside `setShapeCtx`: `drawShape`
    // reads exactly the values it wrote, and the overlay paints many times per one `setShapeCtx`.
    ctx.save();
    try {
      setShapeCtx(ctx, shapeArgs);

      drawShape(ctx, shapeArgs);
    } finally {
      ctx.restore();
    }

    return [canvas];
  };
