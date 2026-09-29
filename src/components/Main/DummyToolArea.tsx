import type { RefObject } from 'react';

type DummyToolAreaProps = {
  className?: string;

  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  toolOverlayRef?: RefObject<HTMLCanvasElement | null>;
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
