import { type PointerEvent, type RefObject, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useRect } from '../../hooks/useRect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
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
      dispatch({ type: existingSelection ? 'MOVE_SELECTION' : 'COMMIT_SELECTION', payload: selection });
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
