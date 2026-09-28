import { type RefObject } from 'react';
import { useRect } from '../../hooks/useRect.ts';
import { trimRect } from '../../util/rect.ts';
import type { CropToolArgs } from '../../tools/crop.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectXYSorted } from '../../contexts/general-types.ts';

type cropToolAreaProps = {
  className?: string;
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
    onChangeEnd: (newRect: RectXYSorted) => {
      const newRectTrimmed = trimRect(newRect, totalSize);

      // `preRatioRect` is cleared on both paths. The panel clears it on its own writes, and this
      // writer is the one a drag goes through: a drag while a ratio is set refits the rect, so the
      // framing recorded before that ratio is no longer what the next `Free`/`Original` should
      // restore. Left in place, it survives into the next ratio change as a stale framing.
      if (newRectTrimmed.width === 0 || newRectTrimmed.height === 0) {
        // return null if nothing selected or if selection is outside
        setToolArgs({ ...args, rect: null, preRatioRect: null });
      } else {
        setToolArgs({ ...args, rect: newRect, preRatioRect: null });
      }
    },
  });

  return <div className={`${className} cursor-crop`} {...pointerEvents}></div>;
};
