import { type RefObject } from 'react';
import { useRect } from '../../hooks/useRect.ts';
import { trimRect } from '../../util/rect.ts';
import type { CropToolArgs } from '../../tools/crop.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXYSorted } from '../../contexts/general-types.ts';

type cropToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const CropToolArea = ({ className }: cropToolAreaProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as CropToolArgs;
  const { aspectRatio, rect } = args;

  const pointerEvents = useRect({
    imageSize: totalSize,
    initialRect: rect,
    containerRef,
    overlayRef: toolOverlayRef,
    aspectRatio,
    onChangeEnd: (rect: RectXYSorted) => {
      const newRectTrimmed = trimRect(rect, totalSize);

      if (newRectTrimmed.width === 0 || newRectTrimmed.height === 0) {
        // return null if nothing selected or if selection is outside
        setToolArgs({ ...args, rect: null });
      } else {
        setToolArgs({ ...args, rect });
      }
    },
  });

  return <div className={`${className} cursor-crop`} {...pointerEvents}></div>;
};
