import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
 * `useSyncExternalStore` rather than a `ResizeObserver` in an effect writing to state, because
 * the value is external mutable state — the DOM — and because React re-reads the snapshot after
 * every render, so a rail that only learns its height after layout is refitted in the same commit
 * rather than a frame later.
 *
 * **THE FIRST PAINT DEPENDS ON REACT'S PASSIVE-EFFECT SCHEDULING, AND MEASUREMENT SAYS IT HAS
 * NOT FAILED YET.** React subscribes to an external store in a PASSIVE effect, so a ref callback
 * that measures during commit has nobody to notify, and `setSlots` — a layout effect, so still
 * inside the commit — publishes into the same empty listener set. The committed tree therefore
 * holds the plan from BEFORE the measurement, and an unmeasured rail shows every tool: sixteen
 * tiles in a slot that fits eight at 720, corrected on the next commit.
 *
 * That next commit has been arriving before the browser paints. A `MutationObserver` installed
 * before the app's own script, whose callbacks are microtasks and therefore run before the paint
 * the mutation enables, recorded the FIRST rail it ever saw as already fitted — eight tiles at
 * 720 — with no code doing anything about it. Chrome flushes React's passive effects inside the
 * mounting task, so this is what happens in practice rather than what React promises.
 *
 * **It IS NOT PROMISED, AND CLOSING IT IS CURRENTLY BLOCKED.** The obvious fix — a layout effect
 * that re-renders when the snapshot has moved ahead of the render — is refused by
 * `react-hooks/set-state-in-effect` ("Calling setState synchronously within an effect can trigger
 * cascading renders"), which is the repository's rule and not this file's. `HANDOFF.md` carries
 * the finding with the measurement; the rule is not suppressed to make the warning go away.
 *
 * The snapshot is a version number and the plan is memoised on it, so the rail re-renders when the
 * PLAN changes and not on every frame of a window drag: `publish` measures each observation,
 * derives the plan from it, and notifies only when the plan differs from the one on screen. A
 * 900-to-1400px drag is about five hundred observations and about twenty renders, and nothing is
 * skipped — the measurement still runs on every one.
 *
 * `setSlots` is a layout effect rather than a render-phase call because the store publishes
 * synchronously, and a publish during render is a render-phase update.
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

  useLayoutEffect(() => {
    store.setSlots(slots);
  }, [store, slots]);

  const version = useSyncExternalStore(store.subscribe, store.getSnapshot, () => 0);
  // `metricsFor` hands back the SAME object for a given version, which is what makes this
  // memo hold across renders that did not move the measurement.
  const plan = useMemo(() => planFor(slots, store.metricsFor(version)), [store, slots, version]);

  return { attachSlot, attachTools, plan };
};
