import { type RefObject, useLayoutEffect, useRef } from 'react';
import type { Pos } from '../contexts/general-types.ts';

export function useResizeObserverRAF(ref: RefObject<HTMLElement | null>, onResize: (size: Pos) => void) {
  const frameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      if (entries.length === 0) return;

      // Throttle to 1 per frame
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;

        const entry = entries[0];
        const rect = el.getBoundingClientRect();
        const size = { x: rect.left, y: rect.top, width: entry.contentRect.width, height: entry.contentRect.height };

        onResize(size);
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
