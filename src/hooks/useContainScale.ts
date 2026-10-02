import { type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { useResizeObserverRAF } from './useResizeObserver.ts';
import { containFit } from '../util/contain-fit.ts';
import type { Size } from '../contexts/general-types.ts';

/**
 * The contain fit as a REF, for painters that need it inside a per-frame loop.
 *
 * `usePointerPosition` already computes this number, but through the pointer pipeline: it hands it
 * out in an `onResize` callback and re-runs a layout read on every `pointermove`. The marching ants
 * need the same divisor while animating at 60fps, and calling `getBoundingClientRect()` on every one
 * of those frames would force a synchronous layout per frame — so this hook measures once in a
 * layout effect and then only when the container actually resizes, and publishes the result through
 * a ref so reading it never schedules a render.
 *
 * The ref reads `1` until the first measurement lands, and `1` is the identity divisor: a painter
 * that divides by it draws exactly what it drew before this hook existed. That is deliberate, so an
 * unmeasured container degrades to the previous behaviour rather than to a divide-by-zero.
 */
export function useContainScale(ref: RefObject<HTMLElement | null>, imageSize: Size): RefObject<number> {
  const scaleRef = useRef(1);

  const measure = useCallback(
    (observed?: { width: number; height: number }) => {
      const rect = observed ?? ref.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height || !imageSize.width || !imageSize.height) return;

      scaleRef.current = containFit(
        { width: rect.width, height: rect.height },
        { width: imageSize.width, height: imageSize.height }
      ).scale;
    },
    [ref, imageSize]
  );

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useResizeObserverRAF(ref, (rect) => measure({ width: rect.width, height: rect.height }));

  return scaleRef;
}
