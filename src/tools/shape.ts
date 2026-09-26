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

/**
 * Single source of truth for shape drag geometry.
 *
 * Shift mirrors Photoshop's aspect-ratio constraint: Rectangle and Ellipse
 * snap to the larger absolute drag dimension while keeping the drag quadrant.
 * Line keeps its free angle, because constraining it would forbid shallow
 * angles. Alt/Option draws from the center, so `anchor` becomes the midpoint
 * of the resulting box; combined with Shift this yields a centered square or
 * circle with equal half-extents.
 */
export const normalizeShapeGeometry = (
  anchor: Point,
  pointer: Point,
  figure: FigureType,
  constraints: ShapeGeometryConstraints
): ShapeGeometry => {
  const { shiftKey, altKey } = constraints;

  if (shiftKey && figure !== 'line') {
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
 */
export const shapeGeometryBounds = (
  { start, end }: ShapeGeometry,
  lineWidth: number
): { x: number; y: number; width: number; height: number } => {
  const halfLineWidth = lineWidth / 2;
  return {
    x: Math.min(start.x, end.x) - halfLineWidth - 1,
    y: Math.min(start.y, end.y) - halfLineWidth - 1,
    width: Math.abs(end.x - start.x) + lineWidth + 2,
    height: Math.abs(end.y - start.y) + lineWidth + 2,
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
    const w = end.x - start.x;
    const h = end.y - start.y;
    const radius = args.cornerRadius ?? 0;
    if (radius > 0) {
      roundedRectPath(ctx, start.x, start.y, w, h, radius);
      if (hasFill) ctx.fill();
      ctx.stroke();
    } else {
      if (hasFill) ctx.fillRect(start.x, start.y, w, h);
      ctx.strokeRect(start.x, start.y, w, h);
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

    setShapeCtx(ctx, shapeArgs);

    drawShape(ctx, shapeArgs);

    return [canvas];
  };
