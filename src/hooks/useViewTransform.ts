import { useEffect, type RefObject } from 'react';

import { getView, subscribeView } from './document-view.ts';
import { composeTransform } from '../util/view-transform.ts';

/**
 * Bind a DOM node to the document view, writing `style.transform` imperatively.
 *
 * WHY IMPERATIVE AND NOT A REACT STYLE PROP. A pan arrives at pointer-move rate. Rendering it
 * through state would re-render every subscriber of the component owning the node once per
 * frame, and `Main` sits above the whole canvas — the layer tree, the overlay and every tool
 * area with it. The original commented-out code in `Main.tsx` put the transform in a `style`
 * prop, and this is the reason that shape does not scale: it is fine for a zoom step and
 * wrong for a drag.
 *
 * WHY rAF-COALESCED. Several `pointermove` events can arrive inside one frame, and a wheel
 * gesture can arrive faster. Each write forces a style recalculation, so they are collapsed
 * into one per frame. `useResizeObserverRAF` is the existing precedent for rAF-batched DOM
 * measurement in this app.
 *
 * WHY THE IDENTITY WRITES NOTHING. See `isIdentityView`: `scale(1)` can promote the element to
 * a composited layer and change how the canvas rasterises, which would move every
 * visual-regression baseline for no visible reason. At Fit on Screen this hook writes `''`, so
 * the default rendering is exactly what it was before this feature existed.
 */
/**
 * Write the transform onto a node.
 *
 * A named function rather than an inline assignment because the node is reached through
 * `ref.current`, and the react-compiler lint reads a mutation on a value derived from a hook
 * argument as mutating the argument itself. Passing it as a plain parameter says what is
 * actually true: this touches a DOM element the hook was handed, not the argument.
 */
function applyTransform(element: HTMLElement, value: string): void {
  element.style.transform = value;
}

export function useViewTransform(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;
    let lastWritten: string | null = null;

    const write = () => {
      frame = 0;
      // Re-read rather than closing over the effect's own `node`: the frame this runs in is
      // the one AFTER the notification, so the ref may have been reassigned in between.
      const target = ref.current;
      if (!target) return;

      const transform = composeTransform(getView());
      // The `lastWritten` guard is what makes a no-op write free. `commit` notifies on a pan,
      // so without it a drag would assign the identical string to `style.transform` sixty
      // times a second and each assignment would schedule a recalculation.
      if (transform === lastWritten) return;
      lastWritten = transform;
      applyTransform(target, transform);
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(write);
    };

    write();
    const unsubscribe = subscribeView(schedule);

    return () => {
      unsubscribe();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      // Restore the node on unmount rather than leaving a transform on a detached element:
      // the workspace canvas is hidden rather than destroyed when a document closes, and a
      // stale transform on the next document's first paint would be a wrong-looking frame.
      node.style.transform = '';
      lastWritten = null;
    };
  }, [ref]);
}
