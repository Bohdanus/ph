import { type RefObject, useEffect, useRef } from 'react';
import { DASH_LENGTH, GAP_LENGTH, LINE_WIDTH, SPEED } from './useAnts.ts';
import type { Point } from '../contexts/general-types.ts';

type UseMarchingPathProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;

  dashLength?: number;
  gapLength?: number;
  lineWidth?: number;

  isPaused?: boolean;

  points: Point[];
  speed?: number;
};

export function useMarchingPath({
  canvasRef,
  dashLength = DASH_LENGTH,
  gapLength = GAP_LENGTH,
  lineWidth = LINE_WIDTH,
  isPaused,

  points,
  speed = SPEED,
}: UseMarchingPathProps) {
  const animationIdRef = useRef<number | null>(null);

  const dashOffsetRef = useRef(0);
  // Keep latest values in refs so the animation loop (which is a stable callback scheduled via requestAnimationFrame)
  // always reads up-to-date values even if props change between renders.
  // This is better than resetting animation on props change.
  const pathRef = useRef<Path2D | null>(null);
  const isPausedRef = useRef(Boolean(isPaused));
  const speedRef = useRef(speed);
  const dashLengthRef = useRef(dashLength);
  const gapLengthRef = useRef(gapLength);
  const lineWidthRef = useRef(lineWidth);
  // Fixed cycle length for dash offset normalization. Kept as a large
  // constant to preserve negative-offset convention (0 or negative values).
  const DASH_OFFSET_CYCLE = 1000;

  useEffect(() => {
    // rebuild cached Path2D when points change to avoid re-traversing the points array twice per frame.
    if (points && points.length >= 2) {
      const p = new Path2D();
      p.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        p.lineTo(points[i].x, points[i].y);
      }
      pathRef.current = p;
    } else {
      pathRef.current = null;
    }
  }, [points]);

  useEffect(() => {
    isPausedRef.current = !!isPaused;
  }, [isPaused]);

  // these props never change in practice, so packed them in to a single effect
  useEffect(() => {
    dashLengthRef.current = dashLength;
    gapLengthRef.current = gapLength;
    lineWidthRef.current = lineWidth;
    speedRef.current = speed;
  }, [dashLength, gapLength, lineWidth, speed]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
  };

  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = lineWidthRef.current;
    ctx.setLineDash([dashLengthRef.current, gapLengthRef.current]);

    // black ants
    const path = pathRef.current;
    if (path) {
      ctx.strokeStyle = 'black';
      ctx.lineDashOffset = dashOffsetRef.current;
      ctx.stroke(path);

      // white ants (half-shifted)
      ctx.strokeStyle = 'white';
      ctx.lineDashOffset = dashOffsetRef.current + dashLengthRef.current;
      ctx.stroke(path);
    }

    if (!isPausedRef.current) {
      dashOffsetRef.current -= speedRef.current;
      // Keep dash offset bounded to avoid unbounded growth. Use a fixed
      // cycle length and keep the offset in the range [ -TOTAL+1 .. 0 ].
      // This preserves the original convention where dashOffset was 0 or
      // negative while preventing unbounded negative growth.
      dashOffsetRef.current = -(Math.abs(dashOffsetRef.current) % DASH_OFFSET_CYCLE);
    }

    animationIdRef.current = requestAnimationFrame(animate);
  };

  const draw = () => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
    }

    animationIdRef.current = requestAnimationFrame(animate);
  };

  // Start/stop animation when `isPaused` changes and clean up on unmount.
  useEffect(() => {
    if (isPaused) {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    } else {
      // Start animation loop (will be a no-op if already running because
      // draw cancels any previous frame before scheduling a new one).
      draw();
    }

    return () => {
      // Only cancel the running animation when the pause state changes or
      // the effect is cleaned up; do not clear the canvas here because we
      // only want to clear on unmount (handled by a separate effect).
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    };
    // We intentionally depend on `isPaused` here so the effect will run when
    // pause state toggles. Other values used by the animation are read from
    // refs so they don't need to be listed as dependencies.
  }, [isPaused]);

  // Ensure we clear the overlay and cancel animation frames on unmount only.
  useEffect(() => {
    return () => clear();
  }, []);

  return {
    draw,
    clear,
  };
}

/**
 * useMarchingPath
 *
 * Hook to draw an animated dashed polyline ("marching ants") onto a canvas.
 *
 * Features:
 * - Accepts an array of `points` to build the polyline.
 * - Animates the dashed line by default. Pass `isPaused` to pause the
 *   animation; toggling `isPaused` will stop/start the animation automatically.
 * - Exposes `draw()` to (re)start the animation loop and `clear()` to stop and
 *   clear the canvas manually.
 * - Cleans up (cancels animation frame and clears canvas) when the component
 *   using the hook unmounts.
 *
 * Notes on implementation:
 * - The animation loop reads mutable refs for `points`, `isPaused`, and
 *   configuration values so the loop always uses the latest values even when
 *   props change between renders.
 */
