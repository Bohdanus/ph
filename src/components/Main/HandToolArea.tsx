import { useEffect, useRef, type PointerEvent } from 'react';

import { lockDragCursor, unlockDragCursor } from '../../hooks/dragCursorLock.ts';
import { panBy } from '../../hooks/document-view.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';

type HandToolAreaProps = {
  className?: string;
};

/**
 * The Hand tool: drag to move the view.
 *
 * It writes NO pixel and claims NO document gesture. Both facts are load-bearing rather than
 * incidental:
 *
 * - No `claimDocumentGesture()`. The gesture slot in `document-gesture.ts` exists to protect a
 *   drag that will mutate the document on release, and the Hand mutates nothing. Claiming it
 *   would make the tool refuse its own gesture, and it would break the "one document owner at a
 *   time" invariant for no benefit. The Hand is in `PIXEL_FREE_TOOLS` for the same reason the
 *   Eyedropper is: no history state, no durable operation, nothing to replay.
 * - No `getLocalCoords`. A pan needs the RAW client-space delta. `getLocalCoords` divides by
 *   the effective scale to land in document pixels, which is exactly wrong here: dividing the
 *   delta would make the document track the pointer at a different rate than it moves, and at
 *   high magnification the view would crawl. The delta is taken from `clientX`/`clientY`
 *   directly, which is also why the pan is the same speed in CSS px at every zoom.
 *
 * The clamping is not done here. `panBy` clamps against the current fit, so the drag cannot
 * leave the document off-screen and cannot move an axis where the document is smaller than the
 * container — which at Fit on Screen means it cannot move at all. That is correct, and it is the
 * same precondition Adobe states for the tool.
 *
 * `pointercancel` is handled through `isPointerUpValid`, which the hook already wires to the
 * container's cancel listener. The offset reached is kept: a cancelled pan is still the user
 * having moved the view, and snapping it back would be a correction nobody asked for.
 */
export const HandToolArea = ({ className }: HandToolAreaProps) => {
  const [{ containerRef, totalSize }] = useStore();

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  /** The last client position seen, so a move can be expressed as a delta. */
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const lockedRef = useRef(false);

  const unlock = () => {
    if (!lockedRef.current) return;
    lockedRef.current = false;
    unlockDragCursor();
  };

  // Every exit route releases the pointer capture and the cursor lock, including the one this
  // component cannot observe: a tool switch while a drag is in flight unmounts this area
  // without a `pointerup`, and a leaked `cursor-grabbing` on `document.body` would then apply
  // to the whole app for the rest of the session. `releasePointer` is the hook's own route and
  // is safe to call with no capture taken.
  useEffect(() => {
    return () => {
      releasePointer();
      unlock();
    };
  }, [releasePointer]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // NO `toolName` GUARD, and its absence is the point.
    //
    // This area is mounted for exactly two reasons — `interactionMode === 'hand'` — and that is
    // reached only when `toolName === 'hand'` OR `isSpaceHeld()`. Under the spring-loaded route
    // the selected tool is something else by definition, so a guard reading `toolName` would
    // reject every event of the very gesture the tool exists for: holding Space over the Move
    // tool and dragging pans nothing.
    //
    // A guard used to be here, added while the unhandled-tool fallthrough still routed to this
    // area. That routing was reverted — those tools have no gesture surface — which is what
    // `Main`'s `UNHANDLED_TOOL_MODE` comment now records, and the guard outlived its reason.
    if (!isPointerDownValid(event)) return;

    event.preventDefault();
    lastRef.current = { x: event.clientX, y: event.clientY };
    lockDragCursor();
    lockedRef.current = true;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerMoveValid(event)) return;

    const last = lastRef.current;
    if (!last) return;

    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (dx === 0 && dy === 0) return;

    lastRef.current = { x: event.clientX, y: event.clientY };
    panBy(dx, dy);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    lastRef.current = null;
    unlock();
  };

  return (
    <div
      className={`${className ?? ''} cursor-hand`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      // The hook installs its own `pointercancel` listener on this element and routes it
      // through `isPointerUpValid`, so a cancelled pan releases the same way a completed one
      // does without a second handler here.
      style={{ userSelect: 'none' }}
    />
  );
};
