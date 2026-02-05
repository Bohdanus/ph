import { type RefObject, useContext, useEffect } from 'react';
import { ImageContext, type RectXYSorted } from '../../contexts/ImageContext';
import { useRect } from '../../hooks/useRect.ts';
import { trimRect } from '../../util/rect.ts';

type cropToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export const CropToolArea = ({ className, overlayCtxRef, overlayRef }: cropToolAreaProps) => {
  const { containerRef, crop, toolName, setCrop, size, cropAspectRatio } = useContext(ImageContext);

  // cleanup when leaving the tool, this is particularly needed for poor history, I mean double interaction with transform!
  useEffect(() => {
    setCrop(null);
  }, [toolName]);

  const pointerEvents = useRect({
    imageSize: size,
    initialRect: crop,
    containerRef,
    overlayRef,
    overlayCtxRef,
    aspectRatio: cropAspectRatio,
    onChangeEnd: (rect: RectXYSorted) => {
      const newRectTrimmed = trimRect(rect, size);

      if (newRectTrimmed.width === 0 || newRectTrimmed.height === 0) {
        // return null if nothing selected or if selection is outside
        setCrop(null);
      } else {
        setCrop(rect);
      }
    },
  });

  return <div className={`${className} cursor-crop`} {...pointerEvents}></div>;
};
