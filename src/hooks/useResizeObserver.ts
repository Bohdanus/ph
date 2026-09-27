import { type RefObject, useLayoutEffect, useRef } from 'react';
import type { Pos } from '../contexts/general-types.ts';

export function useResizeObserverRAF(ref: RefObject<HTMLElement | null>, onResize: (rect: Pos) => void) {
  const frameRef = useRef<number | null>(null);
  const onResizeRef = useRef(onResize);

  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

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
        // `x`/`y` are viewport-relative, and only `getBoundingClientRect()` can
        // report them, so the size has to be the BORDER box as well. Reading
        // `contentRect` here mixed the content box size with the border box
        // origin, which disagree by the border and padding of the element. The
        // entry size is in the element's own space, so a CSS transform on the
        // observed element would break the pairing; the container this hook
        // observes (`components/Main/Main.tsx`) is never transformed.
        const rect = el.getBoundingClientRect();
        const borderBox = entry.borderBoxSize[0];
        const size = {
          x: rect.left,
          y: rect.top,
          width: borderBox?.inlineSize ?? rect.width,
          height: borderBox?.blockSize ?? rect.height,
        };

        onResizeRef.current(size);
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
  }, [ref]);
}
