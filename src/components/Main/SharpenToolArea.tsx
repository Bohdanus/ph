import type { RefObject } from 'react';
import { FocusToolArea } from './FocusToolArea.tsx';

type SharpenToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const SharpenToolArea = ({ className, overlayCtxRef }: SharpenToolAreaProps) => (
  <FocusToolArea toolName="sharpen" className={className} overlayCtxRef={overlayCtxRef} />
);
