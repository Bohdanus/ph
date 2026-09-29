import type { RefObject } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { documentFrameFromSize } from '../../contexts/document-frame.ts';
import { useSelectionMarchingAnts } from '../../hooks/useSelectionAnts.ts';

type SelectionMarchingAntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  enabled: boolean;
};

/**
 * Drives the marching-ants border around committed polygon selections.
 *
 * Renders nothing: `Main` owns the canvas and this only keeps the animation in
 * step with the store, so a selection committed by any of the four polygon tools
 * animates without each of them having to know the border exists.
 */
export const SelectionMarchingAnts = ({ overlayRef, enabled }: SelectionMarchingAntsProps) => {
  const [{ selections, totalSize, documentFrame: currentFrame }] = useStore();

  useSelectionMarchingAnts({
    overlayRef,
    selections,
    documentFrame: currentFrame ?? documentFrameFromSize(totalSize),
    enabled,
  });

  return null;
};
