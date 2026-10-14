import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Selection } from '../contexts/general-types.ts';
import { type DocumentFrame, documentFrameSize, documentToCanvasPoint } from '../contexts/document-frame.ts';
import { getSelectionAbsolutePoints } from '../util/selection.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import { DASH_LENGTH, GAP_LENGTH, LINE_WIDTH, SPEED } from './useAnts.ts';
import { readSelectionDragPreview } from './selection-drag-preview.ts';

/**
 * The two strokes that make the classic marching-ants border: a black dash and a
 * white dash half a dash-length apart. Two passes rather than one solid colour is
 * what keeps the border legible over both light and dark artwork, and it is the
 * same pair `useAnts` paints for a hovered layer.
 */
export const ANT_STROKE_COLOR = 'black';
export const ANT_GAP_COLOR = 'white';

export type SelectionMarchingAntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  selections: Selection[];
  documentFrame: DocumentFrame;
  enabled?: boolean;
  /**
   * CSS px per document px, as a ref — the contain fit. See `useContainScale`.
   *
   * The constants imported above are CSS px, but this canvas is sized to the DOCUMENT and displayed
   * with `object-contain`, so a context draws in document px and every one of them has to be divided
   * by this to stay constant on screen. Omitting it leaves the divisor at 1, which is what this hook
   * did before the divisor existed: correct at scale 1, sub-pixel below it, and proportionally heavy
   * above it, with a crawl rate that varies with zoom. It is a REF rather than a number because this
   * reads it inside a 60fps loop.
   */
  scaleRef?: RefObject<number>;
};

type AntsShape = { id: string; path: Path2D };

/** A closed contour through a selection's absolute points, or `null` when there is nothing to stroke. */
function shapePath(selection: Selection, frame: DocumentFrame): Path2D | null {
  const points = getSelectionAbsolutePoints(selection).map((point) => documentToCanvasPoint(point, frame));
  if (points.length < 3) return null;

  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();

  return path;
}

/**
 * Marching ants for committed selections — every one of them.
 *
 * Adobe documents the border as the universal display of a pixel selection rather than a per-tool
 * feature: its selection-tools table lists all nine marquee and lasso tools as making selections,
 * and nothing in any of them is documented as producing a different kind of border. So this hook
 * takes every active selection, whatever made it, and the tool areas that used to draw their own
 * dashed outline no longer do.
 *
 * The border gets a canvas of its own instead of sharing `toolOverlayRef` with the
 * tool areas, because all three polygon tool areas full-clear that canvas before
 * every repaint (`PolygonClickToolArea.tsx:84`, `MagicWandToolArea.tsx:38`,
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
  scaleRef,
}: SelectionMarchingAntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const shapesRef = useRef<AntsShape[]>([]);
  const documentFrameRef = useRef(documentFrame);

  const shapes = useMemo<AntsShape[]>(() => {
    if (!enabled) return [];

    return selections.flatMap((selection) => {
      if (!selection.isActive) return [];

      const path = shapePath(selection, documentFrame);

      return path ? [{ id: selection.id, path }] : [];
    });
  }, [documentFrame, enabled, selections]);

  const clearCanvas = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = documentFrameSize(documentFrameRef.current);
    ctx.clearRect(0, 0, width, height);
  }, [overlayRef]);

  // Reads the latest shapes and frame through refs rather than closing over them, so that
  // replacing one selection with another repaints on the next frame instead of
  // cancelling and restarting the loop.
  const step = useCallback(
    function frame() {
      animationIdRef.current = null;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      const committed = shapesRef.current;

      // Nothing to restore once every selection is gone, so the loop parks itself here and the
      // effect below starts it again when shapes come back.
      if (!canvas || !ctx || committed.length === 0) {
        clearCanvas();
        return;
      }

      // Rescheduled before anything that can return. Every branch below leaves a live loop
      // behind on purpose: what to paint is read fresh from outside React every frame, so a
      // loop that stopped would need a re-render to start again — and the one state that
      // paints nothing (a marquee in flight) is exactly the state that has to be escapable.
      animationIdRef.current = requestAnimationFrame(frame);

      const drag = readSelectionDragPreview();

      // A marquee in flight is already painted on the tool overlay, which sits above this
      // canvas. Painting the committed border beside it would show two outlines of one
      // selection, one of them stale. The dash offset is deliberately left where it is rather
      // than advanced, so the ants resume on the phase they left rather than jumping.
      if (drag?.kind === 'marquee') {
        clearCanvas();
        return;
      }

      const { width, height } = documentFrameSize(documentFrameRef.current);
      ctx.clearRect(0, 0, width, height);
      const offset = dashOffsetRef.current;

      ctx.save();
      // This canvas is its own 2D context, but nothing else in this repository skips the reset
      // before painting an overlay: `useAnts.ts` resets for the layer outline it draws on the
      // tool overlay, and `drawSelectionAnchors` resets for the anchors that share the canvas with
      // it. A stroke with no `globalAlpha` of its own renders at whatever the last painter left
      // behind, and the ants are two thin strokes — the first thing that would show it.
      resetOverlayAlpha(ctx);
      // The divide is per frame rather than once at mount, because the ref is read inside the loop
      // and the fit changes when the window does. The cycle is recomputed rather than read from a
      // module constant: the undivided cycle is the WRONG modulus here, because at a scale below 1
      // the dashes are longer in document px than that, so offsetting by it would make the modulo a
      // no-op and let the offset grow without bound.
      const scale = scaleRef?.current ?? 1;
      const lineWidth = LINE_WIDTH / scale;
      const dashLength = DASH_LENGTH / scale;
      const gapLength = GAP_LENGTH / scale;
      const dashCycle = dashLength + gapLength;

      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.setLineDash([dashLength, gapLength]);

      // A selection being dragged replaces its own committed shape rather than joining it: the
      // committed one is the pre-drag geometry, and both together would be two borders of one
      // selection, the stale one anchored where the pointer left.
      const dragged = drag?.kind === 'follow' ? drag.selection : null;
      const paths: Path2D[] = (dragged ? committed.filter(({ id }) => id !== dragged.id) : committed).map(
        ({ path }) => path
      );
      if (dragged) {
        const path = shapePath(dragged, documentFrameRef.current);
        if (path) paths.push(path);
      }

      for (const path of paths) {
        ctx.strokeStyle = ANT_STROKE_COLOR;
        ctx.lineDashOffset = offset;
        ctx.stroke(path);
        ctx.strokeStyle = ANT_GAP_COLOR;
        ctx.lineDashOffset = offset + dashLength;
        ctx.stroke(path);
      }

      ctx.restore();

      // A per-frame distance, so it is divided by the same factor as the dash it walks along: at
      // scale 1 this is `SPEED`, and below it the ants keep the same apparent pace instead of
      // crawling in slow motion.
      //
      // Skipped while a selection is being dragged. The dash is still PAINTED on every one of
      // those frames — a border that stopped crawling but stopped showing would be worse than
      // one that crawls — so the hold is here and not in a cancelled frame: a stopped loop
      // would need a re-render to restart, and the drag itself produces none.
      if (!dragged) dashOffsetRef.current = (offset - SPEED / scale) % dashCycle;
    },
    [clearCanvas, overlayRef]
  );

  // Every render, no dependency list: `shapes` is a fresh array whenever the store
  // or the frame changes identity, and the frames must follow it without the loop
  // being torn down. Declared before the effect below so a re-render's shapes are
  // already in the ref when that effect decides whether a loop is needed. The frame is
  // mirrored for the same reason: a dragged preview is rebuilt per pointermove without a
  // re-render, so `shapePath` inside the loop cannot close over the value from render.
  useEffect(() => {
    shapesRef.current = shapes;
    documentFrameRef.current = documentFrame;
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
