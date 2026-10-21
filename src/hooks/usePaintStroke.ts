import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useStore } from '../contexts/StoreContext.tsx';
import { canvasToDocumentPoint, documentFrameFromSize } from '../contexts/document-frame.ts';
import type { Point, Size } from '../contexts/general-types.ts';
import { claimDocumentGesture, isDocumentGestureOpen, releaseDocumentGesture } from './document-gesture.ts';
import { usePointerPosition } from './usePointerPosition.ts';

/**
 * The one pointer-gesture hook every paint-like tool is built on: Smudge, Dodge,
 * Burn, Clone Stamp, Gradient, Spot Healing and Healing Brush. Eraser has a
 * specialized implementation because of its Shift-click line gesture. The hook
 * owns the gesture and nothing else —
 * the pixels stay with the tool, this only turns a press/move/release
 * sequence into `onStart` / `onMove` / `onCommit`.
 *
 * Why the split is `onMove` + `onCommit` and not one callback: `onMove` is the
 * live preview and MUST reach the layer through `tempUpdateLayer()`, the only
 * writer of `previewLayersRef`. `onCommit` is the undo boundary and MUST reach
 * it through `updateLayerByTool()`, which dispatches the `TOOL_ACTION` history
 * item. A tool that paints straight into its own canvas instead produces pixels
 * with zero history entries: the strokes are silently, permanently
 * un-undoable, and `commitDirtyTool()` takes its
 * `PUBLISH_RUNTIME_PRESENTATION` branch and never warns, because from its point
 * of view nothing is missing. So the two callbacks are the entire surface a
 * tool touches, and the only thing this hook cannot do is touch a canvas.
 *
 * Every point handed to a callback is in DOCUMENT space, not canvas space:
 * `getLocalCoords` returns canvas coordinates, and after a crop the canvas
 * origin is the frame offset, so passing canvas coordinates on would shift
 * every stroke by the crop and land it outside the layer. `updateLayerByTool`
 * and the history args both speak document space, so the conversion happens
 * here once instead of in each of the five tools.
 */
export type PaintStrokeCallbacks = {
  /**
   * Fired once on a valid pointer-down, before any move. `points` holds the
   * first point and is already a fresh array, so it is safe to retain.
   *
   * The usual use is the layer-relative bookkeeping a stroke needs before any
   * pixels exist — stamping the clone source, sampling the first colour for
   * Dodge/Burn.
   */
  onStart?: (points: Point[]) => void;
  /**
   * Fired on every valid move while held, with the whole gesture so far in
   * document space.
   *
   * This is the live preview: it must write through `tempUpdateLayer`
   * through `tempUpdateLayer()` so the repainted pixels are recorded in
   * `previewLayersRef` and `commitDirtyTool` can promote them with a history
   * entry. Painting into a private canvas here is the documented way to make a
   * stroke un-undoable.
   *
   * `points` is the live accumulating array, valid for the duration of the
   * call only — it is the same array every subsequent move appends to. Read it
   * synchronously; copy it if the tool needs it later.
   */
  onMove: (points: Point[]) => void;
  /**
   * Fired exactly once on a valid pointer-up, with the final point appended
   * when it differs from the last accumulated one.
   *
   * This is the gesture's real end, and the only place a stroke is allowed to
   * become permanent: it must go through `updateLayerByTool()` so exactly one `TOOL_ACTION` history item
   * is written per completed stroke. The same rule is what
   * `RectangularSelectionToolArea` states for a
   * rectangle drag — the store is untouched by any intermediate move, so one
   * call per completed gesture is the whole story, and it cannot be moved up
   * into the move handler without writing a history item per pointer event.
   *
   * `points` is a fresh copy, so the tool may retain it (it becomes tool args
   * that history keeps).
   */
  onCommit: (points: Point[]) => void;
  /**
   * Fired on pointer-leave or pointer-cancel mid-gesture, and by `cancel()`,
   * when a gesture is in flight. Clears without committing, which is what lets
   * a tool drop a partial preview instead of leaving it on screen.
   */
  onCancel?: () => void;
};

export type UsePaintStrokeOptions = {
  /** The canvas size the container renders, as `usePointerPosition` wants it. */
  imageSize: Size;
  /** The element carrying the pointer handlers; also where `pointercancel` is observed. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * Kept in the hook so a tool can draw a live overlay preview without
   * re-deriving it.
   *
   * Supplying it opts the tool into a re-render per pointer move: `points` is
   * mirrored into React state so a component can render the stroke. Without it
   * the state is only written at gesture boundaries, because the cheaper shape
   * is the one `DrawToolArea` uses — repaint a canvas from the
   * callback on every move and never re-render. Across five tools that
   * difference is felt on every drag, so the default is the cheap one.
   */
  onPreview?: (points: Point[]) => void;
  /**
   * Set false to make the tool ignore the gesture entirely (e.g. no active
   * layer). Every handler becomes a no-op and `isMouseDown` stays false.
   *
   * Read at gesture boundaries only, so flipping it mid-gesture abandons that
   * gesture: a tool whose active layer can disappear under the pointer (a
   * delete) should call `cancel()` rather than rely on this.
   */
  enabled?: boolean;
};

export type PaintStroke = {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  /** True while a gesture is in flight. */
  isMouseDown: boolean;
  /** Current gesture in DOCUMENT space; empty when idle. */
  points: Point[];
  /** Drop the in-flight gesture without committing. */
  cancel: () => void;
};

/**
 * Shared identity for the idle `points` state, so clearing a gesture reuses the
 * same array React already holds and the update bails out of the render
 * instead of scheduling one for a change nobody can observe.
 */
const IDLE_POINTS: Point[] = [];

/**
 * Turns a press/move/release sequence over `containerRef` into one paint
 * gesture, in document space, with exactly one `onCommit` per completed stroke.
 *
 * See the module comment for the `tempUpdateLayer` / `updateLayerByTool`
 * contract the callbacks are built around.
 */
export const usePaintStroke = (
  { imageSize, containerRef, onPreview, enabled = true }: UsePaintStrokeOptions,
  { onStart, onMove, onCommit, onCancel }: PaintStrokeCallbacks
): PaintStroke => {
  const [{ totalSize, documentFrame: currentFrame }] = useStore();
  // Before the first crop there is no frame, and the frame IS the canvas
  // origin. Resolving it the way `DrawToolArea` does is what keeps the
  // fallback from silently disagreeing with the coordinate maths.
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize,
  });

  // The accumulating array lives in a ref, not in state. A stroke produces a
  // pointer event per frame and every one of them would otherwise re-render the
  // tool; the reference implementation repaints a canvas from a ref on each
  // move and never re-renders at all (`DrawToolArea`).
  const gesturePointsRef = useRef<Point[]>([]);
  // Authoritative "a gesture is in flight" flag, kept here rather than read
  // from `usePointerPosition`'s `isMouseDown` ref: that ref is also cleared by
  // its own `pointercancel` listener before this hook's copy of the same
  // listener runs, so gating on it would skip the abort.
  const isGestureActiveRef = useRef(false);
  const claimedPointerIdRef = useRef<number | null>(null);

  const [isMouseDown, setIsMouseDown] = useState(false);
  const [points, setPoints] = useState<Point[]>(IDLE_POINTS);

  const releaseDocumentClaim = () => {
    releaseDocumentGesture('paint-stroke', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  };

  const toDocumentPoint = (event: PointerEvent<HTMLElement>): Point =>
    canvasToDocumentPoint(getLocalCoords(event), documentFrame);

  const clearGesture = () => {
    releaseDocumentClaim();
    isGestureActiveRef.current = false;
    gesturePointsRef.current = [];
    setIsMouseDown(false);
    setPoints(IDLE_POINTS);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (isDocumentGestureOpen()) return;
    if (!isPointerDownValid(event)) return;

    // The shared claim is taken only after pointer validation, so a rejected
    // secondary button or pointer does not block the document. JavaScript runs
    // this handler synchronously, so a successful validation cannot race another
    // claimant between the check above and this claim.
    if (!claimDocumentGesture('paint-stroke', event.pointerId)) return;
    claimedPointerIdRef.current = event.pointerId;

    gesturePointsRef.current = [toDocumentPoint(event)];
    isGestureActiveRef.current = true;

    setIsMouseDown(true);
    // Copies here and on commit, live array on move. `gesturePointsRef.current`
    // keeps growing for the rest of the gesture, so anything that outlives the
    // call has to leave it: the live array is the one thing a tool must not
    // retain, and a tool that does would see its history args mutate under it.
    onStart?.([...gesturePointsRef.current]);

    if (onPreview) {
      const snapshot = [...gesturePointsRef.current];
      onPreview(snapshot);
      setPoints(snapshot);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (!isPointerMoveValid(event)) return;

    const gesture = gesturePointsRef.current;
    gesture.push(toDocumentPoint(event));

    onMove(gesture);

    if (onPreview) {
      // The live array keeps growing for the rest of the gesture, so state gets
      // a snapshot: two moves handing React the same identity would leave the
      // second one without a reason to re-render.
      const snapshot = [...gesture];
      onPreview(snapshot);
      setPoints(snapshot);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (!isPointerUpValid(event)) return;

    const gesture = gesturePointsRef.current;
    // A release that lands where the stroke already is adds nothing, and a
    // duplicated point doubles the width of a pressure- or size-varying tip.
    // Same rule as `DrawToolArea`, applied in document space: the
    // frame offset is constant for the whole gesture, so it cannot turn two
    // different canvas points into one document point.
    const finalPoint = toDocumentPoint(event);
    const lastPoint = gesture[gesture.length - 1];
    if (!lastPoint || lastPoint.x !== finalPoint.x || lastPoint.y !== finalPoint.y) {
      gesture.push(finalPoint);
    }

    // A copy, because this array is the tool args the history entry retains and
    // the ref is about to be reset under it.
    const committed = [...gesture];

    clearGesture();
    onCommit(committed);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    if (!isGestureActiveRef.current) return;
    // `isPointerUpValid` is the only exposed way to release the capture
    // `usePointerPosition` took on pointer-down, and it is what stops a
    // half-finished gesture from blocking every later pointer-down: the hook
    // refuses a new one while `activePointerId` is still set. It reports
    // whether the leave belongs to the pointer that owns the gesture, so a
    // second pointer leaving the surface does not cancel the first one's work.
    if (!isPointerUpValid(event)) return;

    clearGesture();
    onCancel?.();
  };

  // `pointercancel` is a native listener on the container, so it is attached
  // once and the values it reads have to be mirrored into a ref: the closure it
  // captured on the first render would be a render stale, and a tool that
  // mounts enabled and loses its active layer mid-stroke would still report an
  // abort for a gesture it has stopped tracking. Same pattern as the
  // `drawMaskRef` in `useRect`.
  const abortStateRef = useRef({ enabled, onCancel });
  useEffect(() => {
    abortStateRef.current = { enabled, onCancel };
  });

  useEffect(() => {
    const node = containerRef.current;
    const handlePointerCancel = () => {
      const { enabled: isAbortEnabled, onCancel: abort } = abortStateRef.current;
      if (!isAbortEnabled) return;
      if (!isGestureActiveRef.current) return;

      clearGesture();
      abort?.();
    };

    node?.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      node?.removeEventListener('pointercancel', handlePointerCancel);
    };
    // `clearGesture` is intentionally not a dependency: it closes only over
    // refs, module constants and setters, all of which are stable, so the copy
    // this listener holds is equivalent to the one from the latest render.
  }, [containerRef]);

  useEffect(() => {
    return () => {
      // A tool switch can unmount the surface before a pointer-up arrives. The
      // gesture is abandoned, but its document claim must not survive the
      // component that owned it. Keep this cleanup separate from the listener
      // effect so an unstable ref object cannot abort a live stroke on rerender.
      releaseDocumentClaim();
      isGestureActiveRef.current = false;
      gesturePointsRef.current = [];
    };
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerLeave: handlePointerLeave,
    isMouseDown,
    points,
    cancel: () => {
      const wasInFlight = isGestureActiveRef.current;
      // The imperative cancel has no event, so it cannot release the pointer
      // capture `usePointerPosition` is holding the way a pointer-up or a
      // pointer-leave does. It is the tool-switch path, where the capture is
      // about to be dropped with the container anyway.
      clearGesture();
      if (wasInFlight) onCancel?.();
    },
  };
};
