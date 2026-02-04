import type { RefObject } from 'react';

type DummyToolAreaProps = {
  className?: string;

  // keep these so Main can pass the same props as for real tool areas
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
};

export function DummyToolArea({ className }: DummyToolAreaProps) {
  return (
    <div
      className={className}
      style={{
        display: 'none',
      }}
    />
  );
}
