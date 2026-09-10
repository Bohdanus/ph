import { type RefObject } from 'react';
import { useRect } from '../../hooks/useRect.ts';
import { trimRect } from '../../util/rect.ts';
import type { RectangularSelectionToolArgs } from '../../tools/rectangularSelection.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXYSorted } from '../../contexts/general-types.ts';

type rectangularSelectionToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const RectangularSelectionToolArea = ({ className }: rectangularSelectionToolAreaProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as RectangularSelectionToolArgs;

  const pointerEvents = useRect({
    imageSize: totalSize,
    initialRect: args.rect,
    containerRef,
    overlayRef: toolOverlayRef,
    onChangeEnd: (rect: RectXYSorted) => {
      const trimmedRect = trimRect(rect, totalSize);

      if (trimmedRect.width === 0 || trimmedRect.height === 0) {
        setToolArgs({ ...args, rect: null });
      } else {
        setToolArgs({ ...args, rect });
      }
    },
  });

  return <div className={`${className} cursor-crosshair`} {...pointerEvents}></div>;
};
