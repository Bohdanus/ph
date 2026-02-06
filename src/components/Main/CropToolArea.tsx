import { type RefObject, useContext } from 'react';
import { ImageContext, type RectXYSorted } from '../../contexts/ImageContext';
import { useRect } from '../../hooks/useRect.ts';
import { trimRect } from '../../util/rect.ts';
import type { CropToolArgs } from '../../tools/crop.ts';

type cropToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export const CropToolArea = ({ className, overlayCtxRef, overlayRef }: cropToolAreaProps) => {
  const { containerRef, size, toolArgs, setToolArgs } = useContext(ImageContext);
  const args = toolArgs as CropToolArgs;
  const { aspectRatio, rect } = args;

  const pointerEvents = useRect({
    imageSize: size,
    initialRect: rect,
    containerRef,
    overlayRef,
    overlayCtxRef,
    aspectRatio,
    onChangeEnd: (rect: RectXYSorted) => {
      const newRectTrimmed = trimRect(rect, size);

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
