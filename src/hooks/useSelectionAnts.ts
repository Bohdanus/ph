import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Point, Selection } from '../contexts/general-types.ts';
import { type DocumentFrame, documentToCanvasPoint } from '../contexts/document-frame.ts';
import { getSelectionAbsolutePoints } from '../util/selection.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import { DASH_LENGTH, GAP_LENGTH, LINE_WIDTH, SPEED } from './useAnts.ts';

/**
 * The two strokes that make the classic marching-ants border: a black dash and a
 * white dash half a dash-length apart. Two passes rather than one solid colour is
 * what keeps the border legible over both light and dark artwork, and it is the
 * same pair `useAnts` paints for a hovered layer.
 */
export const ANT_STROKE_COLOR = 'black';
export const ANT_GAP_COLOR = 'white';

const DASH_CYCLE = DASH_LENGTH + GAP_LENGTH;

export type SelectionMarchingAntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  selections: Selection[];
  documentFrame: DocumentFrame;
  enabled?: boolean;
};

type AntsShape = { id: string; path: Path2D };

/** A closed contour through `points`, or `null` when there is nothing to stroke. */
function toClosedSelectionPath(points: Point[]): Path2D | null {
  if (points.length < 3) return null;

  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();

  return path;
}

/**
 * Marching ants for committed polygon selections — the lasso, freehand lasso,
 * feather magnetic lasso and magic wand border.
 *
 * The border gets a canvas of its own instead of sharing `toolOverlayRef` with the
 * tool areas, because all three polygon tool areas full-clear that canvas before
 * every repaint (`PolygonClickToolArea.tsx:81`, `MagicWandToolArea.tsx:38`,
 * `FeatherMagneticLassoToolArea.tsx:79`) and a loop painting into it would be
 * erased mid-gesture. Owning the canvas outright is also why each frame clears all
 * of it rather than erasing only the previously painted bounds: two selections can
 * overlap, and a bounds-shaped erase would take the neighbour's dashes with it.
 */
export function useSelectionMarchingAnts({
  overlayRef,
  selections,
  documentFrame,
  enabled = true,
}: SelectionMarchingAntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const shapesRef = useRef<AntsShape[]>([]);

  const shapes = useMemo<AntsShape[]>(() => {
    if (!enabled) return [];

    return selections.flatMap((selection) => {
      if (!selection.isActive) return [];
      // A rectangle already has a border and its own handles from `useRect`, which
      // runs on the tool overlay; marching it here would double the outline.
      if (selection.geometry === 'rectangle') return [];

      const path = toClosedSelectionPath(
        getSelectionAbsolutePoints(selection).map((point) => documentToCanvasPoint(point, documentFrame))
      );

      return path ? [{ id: selection.id, path }] : [];
    });
  }, [documentFrame, enabled, selections]);

  const clearCanvas = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [overlayRef]);

  // Reads the latest shapes through a ref rather than closing over them, so that
  // replacing one selection with another repaints on the next frame instead of
  // cancelling and restarting the loop.
  const step = useCallback(
    function frame() {
      animationIdRef.current = null;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      const current = shapesRef.current;

      if (!canvas || !ctx || current.length === 0) {
        clearCanvas();
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const offset = dashOffsetRef.current;

      ctx.save();
      // This canvas is its own 2D context, but nothing else in this repository skips the reset
      // before painting an overlay: `useAnts.ts` resets for the layer outline it draws on the
      // tool overlay, and `drawSelectionAnchors` resets for the anchors that share the canvas with
      // it. A stroke with no `globalAlpha` of its own renders at whatever the last painter left
      // behind, and the ants are two thin strokes — the first thing that would show it.
      resetOverlayAlpha(ctx);
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.setLineDash([DASH_LENGTH, GAP_LENGTH]);

      for (const shape of current) {
        ctx.strokeStyle = ANT_STROKE_COLOR;
        ctx.lineDashOffset = offset;
        ctx.stroke(shape.path);
        ctx.strokeStyle = ANT_GAP_COLOR;
        ctx.lineDashOffset = offset + DASH_LENGTH;
        ctx.stroke(shape.path);
      }

      ctx.restore();

      dashOffsetRef.current = (offset - SPEED) % DASH_CYCLE;
      animationIdRef.current = requestAnimationFrame(frame);
    },
    [clearCanvas, overlayRef]
  );

  // Every render, no dependency list: `shapes` is a fresh array whenever the store
  // or the frame changes identity, and the frames must follow it without the loop
  // being torn down. Declared before the effect below so a re-render's shapes are
  // already in the ref when that effect decides whether a loop is needed.
  useEffect(() => {
    shapesRef.current = shapes;
  });

  useEffect(() => {
    if (shapes.length === 0) {
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
      clearCanvas();
      return;
    }

    if (animationIdRef.current === null) animationIdRef.current = requestAnimationFrame(step);
  }, [clearCanvas, shapes.length, step]);

  useEffect(
    () => () => {
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
      clearCanvas();
    },
    [clearCanvas]
  );
}
