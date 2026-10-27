import { type RefObject, useCallback, useEffect, useRef } from 'react';
import type { Point, Pos } from '../contexts/general-types.ts';
import type { Layer } from '../contexts/layer-types.ts';
import {
  getLayerAffineTransform,
  getLayerPresentationCorners,
  isIdentityAffineTransform,
} from '../contexts/affine-transform.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';

export const DASH_LENGTH = 6;
export const GAP_LENGTH = 6;
export const LINE_WIDTH = 1;

/**
 * CSS px per frame the dash offset advances, so one 12px cycle takes 30 frames.
 *
 * Adobe documents no rate for the ants — `helpx.adobe.com` characterises the border only as
 * "animated"/"marching", and the Guides/Grid/Slices preferences that expose guides colour and
 * line style expose nothing for a selection edge — so this is a judgement call and not a
 * derived constant. It was 1 CSS px per frame, which at 60fps walks a full 6/6 dash cycle in
 * 0.2s: fast enough to read as noise rather than as a border, and fast enough that the eye
 * cannot follow which dash moved. 0.4 is the operator's 2.5x reduction, which puts a cycle at
 * half a second.
 *
 * Every consumer divides this by the contain fit in the same place it divides the dash length,
 * so the rate is a screen speed and does not vary with zoom.
 */
export const SPEED = 0.4;

export type AntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef?: RefObject<HTMLDivElement | null>;
  /**
   * CSS px per document px, as a ref — the contain fit. See `useContainScale`.
   *
   * The constants above are CSS px, but the overlay canvas is sized to the DOCUMENT and displayed
   * with `object-contain`, so a context draws in document px and every one of them has to be
   * divided by this to stay constant on screen. Omitting it leaves the divisor at 1, which is
   * exactly what this hook did before the divisor existed: correct at scale 1, sub-pixel below it.
   */
  scaleRef?: RefObject<number>;
};

type Outline = { bounds: Pos; path?: Path2D };

// Use an overlay owned by this hook: clearing an outline also clears its interior.
export function useMarchingAnts({ overlayRef, containerRef, scaleRef }: AntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const outlineRef = useRef<Outline | null>(null);
  const paintedRef = useRef<{ ctx: CanvasRenderingContext2D; bounds: Pos; lineWidth: number } | null>(null);
  const cursorContainerRef = useRef<HTMLDivElement | null>(null);

  const erase = useCallback(() => {
    const painted = paintedRef.current;
    if (!painted) return;
    const { x, y, width, height } = painted.bounds;
    const { lineWidth } = painted;
    painted.ctx.clearRect(x - lineWidth, y - lineWidth, width + lineWidth * 2, height + lineWidth * 2);
    paintedRef.current = null;
  }, []);

  const clear = useCallback(() => {
    if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
    animationIdRef.current = null;
    outlineRef.current = null;
    cursorContainerRef.current?.classList.remove('cursor-grab');
    cursorContainerRef.current = null;
    erase();
  }, [erase]);

  const animate = () => {
    animationIdRef.current = null;
    const outline = outlineRef.current;
    const ctx = overlayRef.current?.getContext('2d');
    erase();
    if (!outline || !ctx) return;

    const scale = scaleRef?.current ?? 1;
    const lineWidth = LINE_WIDTH / scale;
    const dashLength = DASH_LENGTH / scale;
    const gapLength = GAP_LENGTH / scale;

    const { x, y, width, height } = outline.bounds;
    ctx.save();
    resetOverlayAlpha(ctx);
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.setLineDash([dashLength, gapLength]);
    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = dashOffsetRef.current;
    if (outline.path) ctx.stroke(outline.path);
    else ctx.strokeRect(x, y, width, height);
    ctx.strokeStyle = 'white';
    ctx.lineDashOffset = dashOffsetRef.current + dashLength;
    if (outline.path) ctx.stroke(outline.path);
    else ctx.strokeRect(x, y, width, height);
    ctx.restore();

    paintedRef.current = { ctx, bounds: outline.bounds, lineWidth };
    // The crawl rate is a screen speed, so it is divided by the same factor as the dash it walks
    // along. At scale 1 this is the original `SPEED`; below it the ants keep the same apparent pace
    // instead of crawling in slow motion.
    dashOffsetRef.current = (dashOffsetRef.current - SPEED / scale) % (dashLength + gapLength);
    animationIdRef.current = requestAnimationFrame(animate);
  };

  const schedule = (outline: Outline, grabCursor = false) => {
    outlineRef.current = outline;
    cursorContainerRef.current?.classList.remove('cursor-grab');
    cursorContainerRef.current = grabCursor ? (containerRef?.current ?? null) : null;
    cursorContainerRef.current?.classList.add('cursor-grab');
    if (animationIdRef.current === null) {
      animationIdRef.current = requestAnimationFrame(animate);
    }
  };

  const draw = (layer: Layer, posPatch?: Partial<Pos>) => {
    const position = { ...layer.pos, ...posPatch };
    if (isIdentityAffineTransform(getLayerAffineTransform(layer))) {
      schedule({ bounds: position }, true);
      return;
    }

    const corners = getLayerPresentationCorners(layer, position);
    const path = new Path2D();
    path.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) path.lineTo(corner.x, corner.y);
    path.closePath();
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    schedule(
      {
        path,
        bounds: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
      },
      true
    );
  };

  // Path and bounds use overlay coordinates. Bounds must enclose all subpaths/curves.
  const drawPath = (path: Path2D, bounds: Pos) => {
    schedule({ path, bounds: { ...bounds } });
  };

  // Closed by default for polygon/freehand selections; open paths support drafts.
  const drawPoints = (points: readonly Point[], closed = true) => {
    if (points.length < 2) {
      clear();
      return;
    }
    const path = new Path2D();
    let minX = points[0].x;
    let maxX = minX;
    let minY = points[0].y;
    let maxY = minY;
    path.moveTo(minX, minY);
    for (let i = 1; i < points.length; i++) {
      const { x, y } = points[i];
      path.lineTo(x, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (closed) path.closePath();
    drawPath(path, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  };

  useEffect(() => {
    return () => clear();
  }, [clear]);

  return { draw, drawPoints, drawPath, clear };
}
