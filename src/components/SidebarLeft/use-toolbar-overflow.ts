import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createToolbarFitStore, planFor } from './toolbar-fit-store.ts';
import type { ToolbarOverflowPlan, ToolbarSlot } from './toolbar-overflow.ts';

export type ToolbarOverflow = {
  /**
   * Ref callbacks for the slot and the tools box.
   *
   * Stable for the life of the rail, which is a requirement rather than a nicety: an inline
   * arrow ref is a NEW function on every render, so React detaches and reattaches it — the
   * store would be handed `null` and then the element again on every commit, publish twice
   * per render, and a publish that changes the version would schedule the next one.
   */
  attachSlot: (element: HTMLElement | null) => void;
  attachTools: (element: HTMLElement | null) => void;
  /** Which groups have to move into the three-dots tile at the rail's current height. */
  plan: ToolbarOverflowPlan;
};

/**
 * Which tool groups the rail cannot show at its current height.
 *
 * `useSyncExternalStore` rather than a `ResizeObserver` in an effect writing to state,
 * because the value is external mutable state — the DOM — and because React re-reads the
 * snapshot in its commit-phase consistency check, so a rail that only learns its height
 * after layout is refitted BEFORE the browser paints. An effect-based `setState` is a
 * passive update, and the first paint would show an overflowing rail that the next frame
 * collapses: a visible jump on every page load, on the screen the user looks at first.
 *
 * The snapshot is a version number and the plan is memoised on it, so the rail re-renders
 * when the MEASUREMENT changes and not on a per-frame basis while a window is being dragged:
 * `publish` refuses to bump the version for a re-measure that reads the same, and a
 * drag that does not change the slot height does not change the fit.
 */
export const useToolbarOverflow = (slots: readonly ToolbarSlot[]): ToolbarOverflow => {
  const [store] = useState(createToolbarFitStore);

  const attachSlot = useCallback(
    (element: HTMLElement | null) => {
      store.attach('slot', element);
    },
    [store]
  );
  const attachTools = useCallback(
    (element: HTMLElement | null) => {
      store.attach('tools', element);
    },
    [store]
  );

  const version = useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0);
  // `metricsFor` hands back the SAME object for a given version, which is what makes this
  // memo hold across renders that did not move the measurement.
  const plan = useMemo(() => planFor(slots, store.metricsFor(version)), [store, slots, version]);

  return { attachSlot, attachTools, plan };
};
