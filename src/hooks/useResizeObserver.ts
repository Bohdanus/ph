import { useLayoutEffect, useRef } from 'react';

export function useResizeObserverRAF(
  conRef: React.RefObject<HTMLElement | null>,
  onResize: (size: DOMRectReadOnly) => void
) {
  const frameRef = useRef<number | null>(null);
  const lastSizeRef = useRef<DOMRectReadOnly | null>(null);

  useLayoutEffect(() => {
    const el = conRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      lastSizeRef.current = entry.contentRect;

      // Throttle to 1 per frame
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;

          const next = lastSizeRef.current!;

          // Optional bailout (prevents useless work)
          if (next.width === 0 || next.height === 0) {
            return;
          }

          onResize(next);
        });
      }
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [conRef, onResize]);
}
