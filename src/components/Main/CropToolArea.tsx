import { useEffect, useRef, type RefObject } from 'react';
import { useRect } from '../../hooks/useRect.ts';
import { useLayers } from '../../contexts/useLayer.ts';
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
  const { applyDocumentCrop } = useLayers();

  const args = toolArgs as CropToolArgs;
  const { aspectRatio, rect } = args;

  /**
   * Photoshop commits a crop with Enter and abandons it with Escape, so the panel's Apply and Clear
   * are not the only two ways in. The listener lives here rather than in the shared keyboard table
   * because `Main` mounts this component only while the crop tool owns the gesture surface
   * (`src/components/Main/Main.tsx:206`): the binding is scoped to the tool by construction, so no
   * table entry is added and no other tool can reach it.
   *
   * The two actions go through a ref rather than closing over the values because the crop args are
   * replaced on every pointer move and `applyDocumentCrop` is rebuilt on every render; depending on
   * either would tear the window listener down and re-add it on every frame of a drag. The ref is
   * refreshed in an effect, the same shape `TextToolArea` uses for its own args ref.
   */
  const cropKeysRef = useRef({ commit: () => {}, cancel: () => {} });

  useEffect(() => {
    cropKeysRef.current = {
      commit: () => {
        if (args.rect && applyDocumentCrop(args.rect)) {
          setToolArgs({ ...args, rect: null, preRatioRect: null });
        }
      },
      cancel: () => {
        if (!args.rect && !args.preRatioRect) return;
        setToolArgs({ ...args, rect: null, preRatioRect: null });
      },
    };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') cropKeysRef.current.commit();
      else if (event.key === 'Escape') cropKeysRef.current.cancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
