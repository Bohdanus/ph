import { type PointerEvent, type RefObject, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useRect } from '../../hooks/useRect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import type { RectXYSorted } from '../../contexts/general-types.ts';
import {
  createCommittedRectangleSelection,
  getActiveRectangularSelection,
  getSelectionRect,
} from '../../util/selection.ts';
import { documentFrameFromSize, documentToCanvasPos } from '../../contexts/document-frame.ts';

type rectangularSelectionToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

export const RectangularSelectionToolArea = ({ className }: rectangularSelectionToolAreaProps) => {
  const [
    { containerRef, toolOverlayRef, totalSize, documentFrame: currentFrame, selections, activeSelectionId },
    dispatch,
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const isEditingCommittedSelectionRef = useRef(false);
  const { commitSelection } = useSelectionHistory();

  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = useMemo(
    () =>
      activeRectangleSelection
        ? getSelectionRect({
            ...activeRectangleSelection,
            pos: documentToCanvasPos(activeRectangleSelection.pos, documentFrame),
          })
        : null,
    [activeRectangleSelection, documentFrame]
  );

  const pointerEvents = useRect({
    imageSize: totalSize,
    initialRect: activeRectangleRect,
    containerRef,
    overlayRef: toolOverlayRef,
    onChangeEnd: (rect: RectXYSorted) => {
      const existingSelection = isEditingCommittedSelectionRef.current ? activeRectangleSelection : null;
      const metadata = existingSelection
        ? {
            ...existingSelection.metadata,
            movedAtVersion: (existingSelection.metadata?.movedAtVersion ?? 0) + 1,
          }
        : undefined;
      const localSelection = createCommittedRectangleSelection({
        id: existingSelection?.id ?? uuidv4(),
        rect,
        imageSize: totalSize,
        metadata,
      });

      isEditingCommittedSelectionRef.current = false;

      if (!localSelection) {
        dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
        return;
      }

      const selection = {
        ...localSelection,
        pos: {
          ...localSelection.pos,
          x: localSelection.pos.x + documentFrame.x,
          y: localSelection.pos.y + documentFrame.y,
        },
      };
      // `onChangeEnd` is the gesture's real end: `useRect` calls it from its
      // pointer-up handler, after the RAF-throttled drag has finished
      // (`useRect.ts:392`). No `onChange`/`onRepaint` is wired up, so every
      // intermediate pointer move stayed a canvas overlay draw and dispatched
      // nothing — the store was untouched until this line. That is what makes one
      // call per completed gesture the whole story for a rectangle drag, and the
      // load-bearing reason this cannot be moved up into the move handler.
      commitSelection(selection, existingSelection ? 'move' : 'create');
    },
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const isEditingCommittedSelection = pointerEvents.onPointerDown(event);
    isEditingCommittedSelectionRef.current = isEditingCommittedSelection;

    if (!isEditingCommittedSelection) {
      dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'rectangular-selection' } });
    }
  };

  return <div className={`${className} cursor-crosshair`} {...pointerEvents} onPointerDown={handlePointerDown}></div>;
};
