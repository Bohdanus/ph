import { type RefObject, useLayoutEffect, useRef } from 'react';
import type { Rect } from '../contexts/ImageContext.tsx';

export function useResizeObserverRAF(ref: RefObject<HTMLElement | null>, onResize: (size: Rect) => void) {
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    // expect position not change on subsequent resizes, only width and height
    const positon = el.getBoundingClientRect();

    const observer = new ResizeObserver((entries) => {
      // Throttle to 1 per frame
      if (frameRef.current !== null) {
        // cancelling animation frame here will cause more sparse events on high load, which is by design => more debounce like !
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;

        const entry = entries[0];
        const { width, height } = entry.contentRect;
        const rect = { x: positon.left, y: positon.top, width, height };

        onResize(rect);
      });
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [ref, onResize]);
}
