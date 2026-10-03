import { type RefObject, useEffect, useMemo, useRef } from 'react';
import {
  POINT_TYPE_MAX_DRAG_PX,
  renderText,
  resolveTextKind,
  type TextKind,
  type TextToolArgs,
} from '../../tools/text.ts';
import { useRect } from '../../hooks/useRect.ts';
import { calculateNewRect } from '../../util/rect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXY, RectXYSorted } from '../../contexts/general-types.ts';

type TextToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const TextToolArea = ({ className, overlayCtxRef }: TextToolAreaProps) => {
  const [{ containerRef, textareaRef, toolOverlayRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as TextToolArgs;
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  // The press and the release in CLIENT pixels, which is the space `POINT_TYPE_MAX_DRAG_PX` is
  // defined in — CSS px, unscaled by the contain fit. `useRect` reports document px, which
  // `getLocalCoords` has already divided by that fit, so a threshold compared against a rect's
  // extent in document px was in the wrong units by the fit scale: the same 3 travelled 2.92 screen
  // px on an 800x600 document and 0.58 screen px on a 4000x3000 one, where a single pixel of
  // pointer jitter placed paragraph type.
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const releaseRef = useRef<{ x: number; y: number } | null>(null);

  const { rectHandles, pointerHandlers, pointerState } = useRect({
    imageSize: totalSize,
    initialRect: args.rect,
    containerRef,
    overlayRef: toolOverlayRef,
    onRepaint: redrawText,
    onChangeEnd: (rect: RectXYSorted) => {
      // Whether this press PLACED a box or merely acted on one that was already there. A press that
      // began inside an existing draft, or on one of its handles, is a move or a resize — and it must
      // not change what kind of box the draft is. Only `useRect` can answer it, because only
      // `useRect` ran `getEdgeAtPoint`.
      const placing = pointerState.currentEdgeRef.current === null;

      // Adobe distinguishes the two gestures by intent and documents no threshold, no minimum box
      // size and nothing about which way a box grows, so this is the app's own: a press that
      // travelled no more than `POINT_TYPE_MAX_DRAG_PX` on either axis is a click and places point
      // type, and anything further is a drag and places paragraph type.
      //
      // The travel is the POINTER'S, not the box's extent. It used to be the extent, and that was
      // wrong in a way no threshold fixes: a press on an existing draft handed back that draft, so a
      // box holding any text always measured greater than the threshold and was silently
      // RECLASSIFIED — a point draft turned into a paragraph one on the first click inside it, and
      // `calculateNewRect` then re-wrapped the text at the new width inside an unchanged frame.
      const press = pressRef.current;
      const release = releaseRef.current;
      const travelled = press && release ? Math.max(Math.abs(release.x - press.x), Math.abs(release.y - press.y)) : 0;

      const kind: TextKind = placing
        ? travelled <= POINT_TYPE_MAX_DRAG_PX
          ? 'point'
          : 'paragraph'
        : resolveTextKind(args);
      // The click's rect is collapsed onto the press point, which is what `adjustFreePoint` already
      // produces for a press with no movement, so the point-type box is grown from the click by the
      // same code path that always grew it. A press that was NOT a placement passes its rect
      // through untouched: collapsing it would throw away the move or the resize.
      const placed: RectXYSorted =
        kind === 'point' && placing ? { ...rect, x1: rect.x1, x2: rect.x1, y1: rect.y1, y2: rect.y1 } : rect;

      const newRect = calculateNewRect({ ...args, rect: placed, kind }, toolOverlayRef, totalSize);
      if (!newRect) return;

      const newArgs = { ...args, rect: newRect, kind };
      setToolArgs(newArgs);

      textareaRef.current?.focus();
    },
  });

  // The two pointer positions the classification needs, captured around `useRect`'s own handlers.
  // `onChangeEnd` is called synchronously from inside `handlePointerUp`, so the release is recorded
  // before it is read.
  const trackedPointerHandlers = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        pressRef.current = { x: event.clientX, y: event.clientY };
        pointerHandlers.onPointerDown(event);
      },
      onPointerMove: pointerHandlers.onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        releaseRef.current = { x: event.clientX, y: event.clientY };
        pointerHandlers.onPointerUp(event);
      },
    }),
    [pointerHandlers]
  );

  useEffect(() => {
    textareaRef.current?.focus();
  }, [textareaRef, toolArgs.toolName]);

  useEffect(() => {
    if (args.text) {
      rectHandles.redraw();
    }
  }, [args.text, rectHandles.redraw]);

  function redrawText(rect: RectXY) {
    const currentArgs = argsRef.current;
    if (!currentArgs.text) return;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    renderText(ctx, { ...currentArgs, rect }, { overflowIndicator: true });
  }

  return <div className={`${className} cursor-text`} {...trackedPointerHandlers} />;
};
