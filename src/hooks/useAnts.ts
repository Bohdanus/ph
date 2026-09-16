import { type RefObject, useEffect, useRef } from 'react';
import type { Point, Pos } from '../contexts/general-types.ts';
import type { Layer } from '../contexts/layer-types.ts';

export const DASH_LENGTH = 6;
export const GAP_LENGTH = 6;
export const LINE_WIDTH = 1;
export const SPEED = 1; // pixels per frame

export type AntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef?: RefObject<HTMLDivElement | null>;
};

type Outline = { bounds: Pos; path?: Path2D };

// Use an overlay owned by this hook: clearing an outline also clears its interior.
export function useMarchingAnts({ overlayRef, containerRef }: AntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const outlineRef = useRef<Outline | null>(null);
  const paintedRef = useRef<{ ctx: CanvasRenderingContext2D; bounds: Pos } | null>(null);
  const cursorContainerRef = useRef<HTMLDivElement | null>(null);

  const erase = () => {
    const painted = paintedRef.current;
    if (!painted) return;
    const { x, y, width, height } = painted.bounds;
    painted.ctx.clearRect(x - LINE_WIDTH, y - LINE_WIDTH, width + LINE_WIDTH * 2, height + LINE_WIDTH * 2);
    paintedRef.current = null;
  };

  const clear = () => {
    if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
    animationIdRef.current = null;
    outlineRef.current = null;
    cursorContainerRef.current?.classList.remove('cursor-grab');
    cursorContainerRef.current = null;
    erase();
  };

  const animate = () => {
    animationIdRef.current = null;
    const outline = outlineRef.current;
    const ctx = overlayRef.current?.getContext('2d');
    erase();
    if (!outline || !ctx) return;

    const { x, y, width, height } = outline.bounds;
    ctx.save();
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.setLineDash([DASH_LENGTH, GAP_LENGTH]);
    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = dashOffsetRef.current;
    if (outline.path) ctx.stroke(outline.path);
    else ctx.strokeRect(x, y, width, height);
    ctx.strokeStyle = 'white';
    ctx.lineDashOffset = dashOffsetRef.current + DASH_LENGTH;
    if (outline.path) ctx.stroke(outline.path);
    else ctx.strokeRect(x, y, width, height);
    ctx.restore();

    paintedRef.current = { ctx, bounds: outline.bounds };
    dashOffsetRef.current = (dashOffsetRef.current - SPEED) % (DASH_LENGTH + GAP_LENGTH);
    animationIdRef.current = requestAnimationFrame(animate);
  };

  const schedule = (outline: Outline, grabCursor = false) => {
    outlineRef.current = outline;
    cursorContainerRef.current?.classList.remove('cursor-grab');
    cursorContainerRef.current = grabCursor ? containerRef?.current ?? null : null;
    cursorContainerRef.current?.classList.add('cursor-grab');
    if (animationIdRef.current === null) {
      animationIdRef.current = requestAnimationFrame(animate);
    }
  };

  const draw = (layer: Layer, posPatch?: Partial<Pos>) => {
    schedule({ bounds: { ...layer.pos, ...posPatch } }, true);
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
  }, []);

  return { draw, drawPoints, drawPath, clear };
}
