import type { RefObject } from 'react';
import { FocusToolArea } from './FocusToolArea.tsx';

type BlurToolAreaProps = {
  className?: string;
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const BlurToolArea = (props: BlurToolAreaProps) => <FocusToolArea {...props} toolName="blur" />;
