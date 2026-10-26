import { useCallback, useLayoutEffect, useState } from 'react';
import { useStore } from '../contexts/StoreContext.tsx';
import { readClientViewportRect } from '../util/client-viewport.ts';
import { useResizeObserverRAF } from './useResizeObserver.ts';
import { containFit } from '../util/contain-fit.ts';

/** Current CSS-pixel fit scale shared by the zoom controls and pointer coordinate mapping. */
export function useWorkspaceFitScale(): number {
  const [{ containerRef, totalSize }] = useStore();
  const [fitScale, setFitScale] = useState(1);
  const measure = useCallback(() => {
    const rect = containerRef.current ? readClientViewportRect(containerRef.current) : null;
    if (!rect || rect.width <= 0 || rect.height <= 0 || totalSize.width <= 0 || totalSize.height <= 0) return;
    const nextScale = containFit({ width: rect.width, height: rect.height }, totalSize).scale;
    setFitScale((current) => (current === nextScale ? current : nextScale));
  }, [containerRef, totalSize]);

  useLayoutEffect(() => measure(), [measure]);
  // The observer is a resize trigger; re-read the client viewport shared with pointer mapping.
  useResizeObserverRAF(containerRef, () => measure());
  return fitScale;
}
