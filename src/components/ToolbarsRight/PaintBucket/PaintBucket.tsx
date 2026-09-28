import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { PaintBucketToolArgs } from '../../../tools/paintBucket.ts';
import { ICON_BUTTON } from '../buttonStyles.ts';

/** Layout and control classes, copied from `Paint/Paint.tsx:23-26` so the bars read as one row of fields. */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const toPercent = (alpha: number): number => Math.round(alpha * 100);

/**
 * The Photoshop Paint Bucket options bar: Tolerance, Contiguous, Opacity and the fill colour.
 *
 * ## The fill colour is the store's foreground colour
 *
 * The bucket fills with the foreground colour, and the repo already has one: `SET_COLOR` in
 * `src/contexts/StoreContext.tsx:501`, written by the SidebarLeft swatch that
 * `e2e/helpers/color-helpers.ts` drives through `[data-testid="foreground-color-input"]`. A
 * second colour source in this bar would mean the swatch the e2e helpers set and the colour the
 * bucket fills with could disagree, so the input here dispatches `SET_COLOR` — the same store
 * field the SidebarLeft writes — and the effect below carries it into the tool args, which is the
 * same arrangement `Paint/Paint.tsx:63-66` uses to stop the brush being frozen on its default.
 * `args.color` is therefore a projection of the store, never the other way round, and the input's
 * value is bound to the store colour so it does not render one frame behind on mount.
 *
 * ## Why `label` text alone, with the value beside it
 *
 * `<label htmlFor>` carries the control's accessible name, and the value readout is a sibling of
 * the label rather than a child of it. Nesting the readout inside the label — as
 * `Levels/Levels.tsx:105` does — makes the name "Tolerance 32%", which changes with every drag;
 * keeping the name to the static word is what lets a test locate the control by role and name
 * and have that lookup keep working.
 *
 * ## No `data-testid`
 *
 * House rule for the options bars, and the reason the labels above are written the way they are.
 *
 * ## Not rendered
 *
 * Photoshop's bucket also has **All Layers** and **Blend Mode**. Neither has a home in
 * `PaintBucketToolArgs`, and a control that silently drops its value is worse than an absent one.
 *
 * ## The sliders do not re-preview the last fill
 *
 * `Levels/Levels.tsx:33` calls `tempUpdateLayer` on every slider frame, which re-runs the
 * processor over the live layer and gives Photoshop's live-adjust behaviour for free. A bucket
 * cannot do that from here: a re-preview needs the seed of the last click, the seed lives in
 * `PaintBucketToolArea`'s gesture closure, and there is no channel from this bar to it — the same
 * gap documented in `src/tools/paintBucket.ts`. So the sliders stage the setting and the next
 * click uses it. That is a real behavioural difference from Photoshop and it is a consequence of
 * the missing seed field, not a choice made here.
 */
const PaintBucket: React.FC<{}> = () => {
  const [{ color }, dispatch] = useStore();
  const { getToolArgs, patchToolArgs, setToolArgs } = useCurrentTool();

  const args = getToolArgs('paint-bucket');
  const pendingRef = useRef<PaintBucketToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!args || args.color === color) return;
    setToolArgs({ ...args, color });
  }, [args, color, setToolArgs]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * One write per frame while a slider is dragged, not one per input event: `patchToolArgs`
   * publishes to React state and to `saveLastSettings`, and a range control emits an event per
   * pointer move. The pending value is kept in a ref so the frame that lands always carries the
   * newest one rather than the value the drag started on.
   */
  const throttledPatch = (patch: Partial<PaintBucketToolArgs>) => {
    if (!args) return;

    pendingRef.current = { ...args, ...patch };
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (pendingRef.current === null) return;

      patchToolArgs('paint-bucket', pendingRef.current);
      pendingRef.current = null;
    });
  };

  if (!args) return null;

  const handleToleranceChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ tolerance: Number(event.target.value) });
  };

  const handleContiguousChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('paint-bucket', { contiguous: event.target.checked });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ alpha: Number(event.target.value) / 100 });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="paint-bucket-tolerance">Tolerance</label>
          <span className={VALUE_CLASS}>{args.tolerance}%</span>
        </div>
        <input
          id="paint-bucket-tolerance"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={args.tolerance}
          onChange={handleToleranceChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="paint-bucket-contiguous">Contiguous</label>
        </div>
        <input
          id="paint-bucket-contiguous"
          type="checkbox"
          checked={args.contiguous}
          onChange={handleContiguousChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="paint-bucket-opacity">Opacity</label>
          <span className={VALUE_CLASS}>{toPercent(args.alpha)}%</span>
        </div>
        <input
          id="paint-bucket-opacity"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={toPercent(args.alpha)}
          onChange={handleOpacityChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="paint-bucket-color">Fill colour</label>
        </div>
        <input
          id="paint-bucket-color"
          className={ICON_BUTTON}
          type="color"
          value={color}
          onChange={(event) => dispatch({ type: 'SET_COLOR', payload: event.target.value })}
        />
      </div>
    </div>
  );
};

export default PaintBucket;
