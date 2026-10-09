import type { Ctx2D, Point, Pos } from '../contexts/general-types.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import { AIRBRUSH_INTERVAL_MS, PAINT_FLOW_DEFAULT, PAINT_FLOW_MAX, PAINT_FLOW_MIN } from './brush-airbrush.ts';
import { smoothStrokePoints } from '../tools/brush.ts';
import { hexToRgb } from './rect.ts';

function getPointExtents(points: Point[]) {
  const pp = points!;
  let minX = pp[0].x;
  let minY = pp[0].y;
  let maxX = pp[0].x;
  let maxY = pp[0].y;

  for (let i = 1; i < pp.length; i++) {
    const p = pp[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, minY, maxX, maxY };
}

export function pointsBoundingPos({ lineWidth = 1, points }: { lineWidth?: number; points: Point[] }): Pos {
  const { minX, minY, maxX, maxY } = getPointExtents(points);

  return {
    x: minX - lineWidth,
    y: minY - lineWidth,
    width: maxX - minX + 2 * lineWidth,
    height: maxY - minY + 2 * lineWidth,
  };
}

/** Aligns padded stroke bounds to whole-pixel raster dimensions without narrowing them. */
export function pointsBoundingPosOutward({ lineWidth = 1, points }: { lineWidth?: number; points: Point[] }): Pos {
  const { minX, minY, maxX, maxY } = getPointExtents(points);
  const x = Math.floor(minX - lineWidth);
  const y = Math.floor(minY - lineWidth);

  return {
    x,
    y,
    width: Math.ceil(maxX + lineWidth) - x,
    height: Math.ceil(maxY + lineWidth) - y,
  };
}

export function bezierSmoothedLine(ctx: Ctx2D, points: Point[]) {
  const lengthBy2 = Math.ceil(points.length / 2);
  let firstFreePoint = 0;

  for (let i = 0; i < lengthBy2; i++) {
    const j = i * 2;
    if (j + 2 < points.length) {
      const p1 = points[j];
      const p2 = points[j + 1];
      const p3 = points[j + 2];
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      firstFreePoint = j + 3;
    } else {
      for (let k = firstFreePoint; k < points.length; k++) {
        ctx.lineTo(points[k].x, points[k].y);
      }
    }
  }
}

export function drawSmoothLine(ctx: Ctx2D, points: Point[]) {
  if (points.length < 1) return;
  if (points.length < 2) {
    ctx.lineTo(points[0].x, points[0].y);
    return;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;

    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
}

export function catmullRomToBezier(ctx: CanvasRenderingContext2D, pts: Point[], tension = 0.5) {
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;

    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

export type DrawStrokeParams = {
  args: DrawToolArgs;
  ctx: Ctx2D; // overlay ctx
};

export const drawLine = (params: DrawStrokeParams) => {
  const {
    args: { penType },
  } = params;

  // Smoothing is a filter over the sampled path, applied once here so the live
  // overlay (src/components/Main/DrawToolArea.tsx:39-43), the committed stroke and
  // every replay of it all smooth identically. It runs before the renderer choice
  // because both renderers consume the same point list, and it leaves the call
  // counts of a single-path pen stroke untouched.
  const sampled = params.args.points ?? [];
  const points = smoothStrokePoints(sampled, params.args.smoothing ?? 0);
  const stroke = points === sampled ? params : { ...params, args: { ...params.args, points } };

  if (penType === 'pen' || penType === 'pen-dashed') {
    drawPen(stroke);
  } else if (penType === 'spray') {
    drawSpray(stroke);
  }
};

/**
 * Block mode's renderer: a hard, axis-aligned, fully opaque square of side `lineWidth`, stamped
 * every `lineWidth` along the path. One `stroke()` cannot produce a block tip, and Adobe gives
 * Block mode neither falloff nor an Opacity control, so the stamp ignores `args.alpha`: the
 * Options bar hides the slider for this mode, and honouring its last value would silently fade
 * the block. Drawn as `fillRect` rather than a path, so no `beginPath`/`stroke` is issued.
 */
const drawBlockStamps = ({ args, ctx }: DrawStrokeParams) => {
  const points = args.points ?? [];
  if (points.length === 0) return;

  const size = Math.max(1, args.lineWidth);
  const half = size / 2;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = args.color;
  ctx.fillRect(points[0].x - half, points[0].y - half, size, size);

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    // One stamp per `size` of travel, so a fast pointer cannot leave gaps the stroke path would
    // have bridged. `Math.hypot` keeps a 0-length segment at 0 steps rather than dividing by NaN.
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / size));
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      ctx.fillRect(x - half, y - half, size, size);
    }
  }

  ctx.restore();
};

export const drawPen = ({ args, ctx }: DrawStrokeParams) => {
  const points = args.points ?? [];
  if (points.length === 0) return;

  if (args.blockStamp) {
    drawBlockStamps({ args, ctx });
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  bezierSmoothedLine(ctx, points);
  ctx.stroke();
};

/**
 * Peak alpha of one dab, as a fraction of the tool's Opacity setting.
 *
 * This used to be a bare `alpha / 4`, which put the spray preset's own default (Opacity 0.5)
 * at a peak of 0.125. Measured on the default 800x600 white document, Size 100 / Opacity 50%:
 * a single dab reached rgb(223,223,223) — 32 levels of darkening out of 255 — while a 20-step
 * 250px drag already reached luminance 69. The stroke was therefore dark and the tap invisible,
 * which is the opposite of the order an airbrush is used in.
 *
 * 0.4 puts the default peak at 0.2, so one dab deposits rgb(204,204,204) (measured): clearly
 * visible, still a soft deposit, and no single dab can ever be a flat fill even at Opacity 100%
 * (peak 0.4). Repeated passes still build towards saturation — the same drag measures 67 — instead
 * of arriving flattened, which is what an airbrush is for; that is why the peak is not `alpha`.
 */
const SPRAY_PEAK_ALPHA = 0.4;

/**
 * The Size slider is a diameter on every other pen — `lineWidth` is the stroked width — but the
 * spray path spent all of it as the gradient RADIUS, so Size 100 painted a 200px-wide blot
 * (measured ink bounding box: 395x196 for a 250px drag, i.e. the full 2x radius). Halving it
 * makes Size mean the same thing across pens and keeps the dab inside the `lineWidth` padding
 * `pointsBoundingPos` reserves for the layer crop, which a larger radius would overflow.
 */
const SPRAY_RADIUS_SCALE = 0.5;

/**
 * Fraction of the radius held at the peak. A ramp that starts at the centre spends the whole
 * dab as falloff, which is a blur with no core and no density; holding the peak over the inner
 * quarter gives the dab a body and leaves the outer three quarters as the soft rim that makes
 * consecutive dabs merge into a stroke.
 */
const SPRAY_CORE_FRACTION = 0.25;

export const drawSpray = ({ args, ctx }: DrawStrokeParams) => {
  const points = args.points ?? [];
  if (points.length === 0) return;

  const color = hexToRgb(args.color);
  // Rounded because the product carries binary-float noise into the colour string
  // (`0.8 * 0.4` is 0.32000000000000006); 8-bit output cannot resolve the difference.
  const peak = args.alpha * SPRAY_PEAK_ALPHA;
  const flowPercent = Number.isFinite(args.flow) ? (args.flow ?? PAINT_FLOW_DEFAULT) : PAINT_FLOW_DEFAULT;
  const flow = Math.min(PAINT_FLOW_MAX, Math.max(PAINT_FLOW_MIN, flowPercent)) / 100;
  const radius = args.lineWidth * SPRAY_RADIUS_SCALE;

  for (let i = 0; i < points.length; i++) {
    let dabPeak = peak;
    if (args.pointTimes && i > 0) {
      const previousTime = args.pointTimes[i - 1];
      const currentTime = args.pointTimes[i];
      if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) continue;

      // A dab at the base opacity every AIRBRUSH_INTERVAL_MS builds exponentially. Scaling
      // elapsed time this way makes the deposited alpha independent of pointer/refresh rate.
      dabPeak = 1 - Math.pow(1 - peak * flow, (currentTime - previousTime) / AIRBRUSH_INTERVAL_MS);
    }
    const roundedPeak = Math.round(dabPeak * 1e4) / 1e4;
    const colorStart = `rgba(${color}, ${roundedPeak})`;
    const colorStop = `rgba(${color}, 0)`;
    const g = ctx.createRadialGradient(points[i].x, points[i].y, 0, points[i].x, points[i].y, radius);
    g.addColorStop(0, colorStart);
    g.addColorStop(SPRAY_CORE_FRACTION, colorStart);
    g.addColorStop(1, colorStop);

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(points[i].x, points[i].y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
};
