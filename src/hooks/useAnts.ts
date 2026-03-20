import { useEffect, useRef } from 'react';
import type { Pos } from '../contexts/general-types.ts';
import type { Layer } from '../contexts/layer-types.ts';

const DASH_LENGTH = 6;
const GAP_LENGTH = 6;
const LINE_WIDTH = 1;
const SPEED = 1; // pixels per frame

export type AntsProps = {
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

export function useMarchingAnts({ overlayRef, containerRef }: AntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const currentLayerRef = useRef<Layer | null>(null);
  const oldPosRef = useRef<Pos | null>(null);
  const posRef = useRef<Pos | null>(null);

  const ctx = overlayRef.current!.getContext('2d')!;

  // todo more fancy optimisation can be done here. for example if pos has not changed
  // than there is no need for cleraring the area. Think on this some day.
  // TODO so yes, i think the crutial part is to compare previous pos with the new on no know if any painting is needed!
  const isClearedRef = useRef(true);

  const clear = () => {
    if (isClearedRef.current || !posRef.current) return;

    containerRef.current!.classList.remove('cursor-grab');

    const { x, y, width, height } = posRef.current;
    ctx.clearRect(x - LINE_WIDTH, y - LINE_WIDTH, width + LINE_WIDTH * 2, height + LINE_WIDTH * 2);

    oldPosRef.current = null;
    posRef.current = null;
    currentLayerRef.current = null;
    isClearedRef.current = true;

    cancelAnimationFrame(animationIdRef.current!);
  };

  const animate = () => {
    if (oldPosRef.current && posRef.current !== oldPosRef.current) {
      const { x, y, width, height } = oldPosRef.current!;
      ctx.clearRect(x - LINE_WIDTH, y - LINE_WIDTH, width + LINE_WIDTH * 2, height + LINE_WIDTH * 2);
    }

    oldPosRef.current = posRef.current;
    const { x, y, width, height } = posRef.current!;

    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([DASH_LENGTH, GAP_LENGTH]);

    // Black stroke
    ctx.strokeStyle = 'black';
    ctx.lineDashOffset = dashOffsetRef.current;
    ctx.strokeRect(x, y, width, height);

    // White stroke (offset half pattern)
    ctx.strokeStyle = 'white';
    ctx.lineDashOffset = dashOffsetRef.current + DASH_LENGTH;
    ctx.strokeRect(x, y, width, height);

    dashOffsetRef.current -= SPEED;
    isClearedRef.current = false;

    animationIdRef.current = requestAnimationFrame(animate);
  };

  const draw = (layer: Layer, posPatch?: Partial<Pos>) => {
    if (currentLayerRef.current === layer && !posPatch) {
      // ignore such update, dont draw anything
      return;
    }

    containerRef.current!.classList.add('cursor-grab');

    posRef.current = { ...layer.pos, ...posPatch };
    cancelAnimationFrame(animationIdRef.current!);

    animationIdRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => clear();
  }, []);

  return { draw, clear };
}
