import { useEffect, useRef, type PointerEvent } from 'react';

import { lockDragCursor, unlockDragCursor } from '../../hooks/dragCursorLock.ts';
import { getView, setSnappedRotation } from '../../hooks/document-view.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RotateViewToolArgs } from '../../tools/rotate-view.ts';

type RotateViewToolAreaProps = {
  className?: string;
};

/**
 * Rotate View: drag to turn the view.
 *
 * Adobe's own statement is the whole contract: the tool "changes the angle at which you view the
 * canvas, but it does not rotate or transform the actual image". So this writes one field of the
 * view and touches nothing else — no `claimDocumentGesture()`, no processor, no history entry, no
 * durable operation. `rotate-view` is in `PIXEL_FREE_TOOLS` for that reason, exactly as the Hand
 * is, and the options bar's angle field is a command over the same store rather than a setting
 * on the tool.
 *
 * ## WHY THE DRAG IS RELATIVE
 *
 * The obvious implementation is absolute: `rotation = atan2(pointer - centre)`. It is two lines
 * and it snaps the view to point at the cursor the instant the drag starts, which is a jump the
 * user did not ask for and which throws away any angle already set — by a previous drag, by the
 * `Shift` snap, or by typing a number into the Rotation Angle field.
 *
 * So the pointerdown records where the drag started, both as an angle about the container centre
 * and as the rotation that was showing, and each move applies the DELTA. A second drag continues
 * from the first, and a drag after a typed angle tilts from that angle.
 *
 * ## WHY THE RAW CLIENT DELTA IS NOT USED
 *
 * Unlike the Hand, this needs no delta: it needs the pointer's ANGLE about the container centre,
 * so `getLocalCoords` — which divides by the scale and inverts the whole view transform — would
 * be the wrong quantity twice over. The container rect comes from the pointer event's own target,
 * measured once per gesture rather than per move.
 */
export const RotateViewToolArea = ({ className }: RotateViewToolAreaProps) => {
  const [{ containerRef, totalSize }] = useStore();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as RotateViewToolArgs;

  const { isPointerDownValid, isPointerMoveValid, isPointerUpValid, releasePointer } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  /** The rotation showing when the drag began, and the pointer's angle at that moment. */
  const startRef = useRef<{ rotation: number; angle: number } | null>(null);
  const lockedRef = useRef(false);

  const unlock = () => {
    if (!lockedRef.current) return;
    lockedRef.current = false;
    unlockDragCursor();
  };

  useEffect(() => {
    return () => {
      releasePointer();
      unlock();
    };
  }, [releasePointer]);

  /** The pointer's angle about the container's centre, in degrees clockwise from east. */
  const angleAbout = (event: PointerEvent<HTMLDivElement>, rect: DOMRect): number => {
    const dx = event.clientX - (rect.x + rect.width / 2);
    const dy = event.clientY - (rect.y + rect.height / 2);
    // `atan2` is 0 due EAST and grows clockwise in screen coordinates, which is the same sense
    // CSS `rotate()` grows. Anything else here turns the canvas the wrong way, and only shows it
    // on a drag that is not symmetric.
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (args.toolName !== 'rotate-view') return;
    if (!isPointerDownValid(event)) return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    startRef.current = { rotation: getView().rotation, angle: angleAbout(event, rect) };
    lockDragCursor();
    lockedRef.current = true;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerMoveValid(event)) return;

    const start = startRef.current;
    if (!start) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const delta = angleAbout(event, rect) - start.angle;

    // `event.shiftKey` is read per move rather than captured on the down, so `Shift` can be
    // pressed and released mid-drag — the same flexibility `Shift` has in Photoshop's tool
    // modifiers generally.
    setSnappedRotation(start.rotation + delta, event.shiftKey);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;

    startRef.current = null;
    unlock();
  };

  return (
    <div
      className={`${className ?? ''} cursor-rotate-view`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ userSelect: 'none' }}
    />
  );
};
