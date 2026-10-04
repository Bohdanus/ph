import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import {
  SHARPEN_AMOUNT_MAX,
  SHARPEN_AMOUNT_MIN,
  SHARPEN_RADIUS_MAX,
  SHARPEN_RADIUS_MIN,
  type SharpenToolArgs,
} from '../../../tools/sharpen.ts';

/**
 * Layout copied from `Blur/Blur.tsx:95-113`, which is the house shape for a one-shot
 * filter's options bar: a row of label-over-slider columns.
 *
 * There is no `buttonStyles.ts` constant here because this bar has no buttons. Blur carries an
 * `Undo Blur` button that discards the live preview, and the Sharpen deliberately does not: a
 * discard control is only meaningful when the panel owns something to discard, and this one
 * inherits Blur's `commitDirtyTool` route wholesale, so anything it baked is already a
 * committed layer with a real history entry and undoing it is `Cmd+Z`'s job, not this panel's.
 * A second way to reach the same history would be a second thing to get wrong.
 */
const FIELD_CLASS = 'flex flex-col';
const LABEL_CLASS = 'flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-48 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

/** One slider value clamped into its Photoshop range, for display. */
const clampPercent = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;

/**
 * The Photoshop Sharpen options bar: `Amount` and `Radius`.
 *
 * Both sliders drive the SAME interaction Blur's single Radius slider drives, and the
 * rAF-throttled write coalesces the frame the same way: one frame, then `tempUpdateLayer`
 * the pending args and `setToolArgs` them together, in that order. The order
 * is load-bearing — `previewLayers` is a mutable ref rather than state, so a render that
 * observed the args before the preview landed would be showing the previous radius's pixels
 * under the new radius's thumb. What is NOT the same as Blur's is the merge inside the frame:
 * Blur has one control and needs no base to merge onto, so the merge follows Levels.
 *
 * THE ROUTE IS THE WHOLE ARGUMENT FOR THIS BAR. `tempUpdateLayer`
 * (`src/contexts/useLayer.ts:473`) is the only writer of `previewLayersRef`, and
 * `commitDirtyTool` (`:323`) bakes that preview into a real layer plus a `TOOL_ACTION` entry —
 * on tool switch, on export and in `mergeAllLayers`. A Sharpen that convolved into a canvas of
 * its own instead would produce pixels with no history entry at all, and `commitDirtyTool`
 * would then take its `PUBLISH_RUNTIME_PRESENTATION` branch and never warn: the sharpen would
 * be permanently un-undoable, with no error and no visible sign of it. So the Sharpen applies
 * when the user drags, exactly as the Blur applies when the user drags, and there is no Apply
 * button — inventing one would be inventing a second interaction this bar does not need.
 *
 * The third Photoshop control, `Sample All Layers`, is omitted because `SharpenToolArgs` has
 * nowhere to put it: the processor receives one layer's raster as its `bitmap` and cannot see
 * the rest of the stack, so a checkbox here would render a value the filter never read. It
 * also wants a different commit shape — a single raster entry over the composite rather than
 * over one layer — which is a change to `tempUpdateLayer`'s call site rather than to this bar.
 *
 * `aria-label` carries the accessible name on each input, because the visible `<label>` also
 * holds a live numeric readout — without it the computed name would change as the user drags
 * ("Radius 4px" becoming "Radius 5px"), and a control whose name moves under the pointer
 * cannot be found by one.
 */
const Sharpen: React.FC<{}> = () => {
  const { tempUpdateLayer } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as SharpenToolArgs;
  const pendingUpdateRef = useRef<SharpenToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingUpdateRef.current = null;
    };
  }, []);

  /**
   * Each handler hands over ONE field, and the frame is the unit of coalescing — so the
   * merge has to be against the PENDING args, not `args`. `args` is the render-time object
   * and nothing republishes it until the frame runs, so two controls moved inside one frame
   * would otherwise both be spread off the same stale base and the second spread would put
   * the first control's field back to its pre-frame value. This is the merge `Levels.tsx` —
   * `throttledOnChange()` — already uses for its two sliders.
   */
  const throttledOnChange = (newArgs: Partial<SharpenToolArgs>) => {
    pendingUpdateRef.current = { ...(pendingUpdateRef.current ?? args), ...newArgs };

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        const pending = pendingUpdateRef.current;
        pendingUpdateRef.current = null;
        if (pending) {
          // No `id`: `tempUpdateLayer` defaults to `activeLayerId` and returns early without
          // one, which is exactly the no-layer case. Naming it here would only add a
          // non-null assertion that the function already does not need.
          tempUpdateLayer({ toolArgs: pending });
          setToolArgs(pending);
        }
        rafIdRef.current = null;
      });
    }
  };

  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ amount: Number(event.target.value) });
  };

  const handleRadiusChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ radius: Number(event.target.value) });
  };

  /**
   * What the sliders RENDER is the clamped value, not `args` verbatim.
   *
   * A persisted args object can hold a value outside Photoshop's range — settings are
   * round-tripped through `localStorage` and restored before anything clamps them — and a
   * controlled `<input type="range">` whose `value` is out of its own `min`/`max` pins the
   * thumb to the bound while reporting the raw value, so the readout and the thumb disagree.
   * The clamp here is the same one `src/tools/sharpen.ts` applies before the kernel runs, so
   * the bar and the filter agree on what is about to be computed.
   */
  const amount = clampPercent(args.amount, SHARPEN_AMOUNT_MIN, SHARPEN_AMOUNT_MAX, SHARPEN_AMOUNT_MIN);
  const radius = clampPercent(args.radius, SHARPEN_RADIUS_MIN, SHARPEN_RADIUS_MAX, SHARPEN_RADIUS_MIN);

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className={FIELD_CLASS}>
        <label htmlFor="sharpen-amount" className={LABEL_CLASS}>
          Amount
          <span className={VALUE_CLASS}>{amount}%</span>
        </label>
        <input
          id="sharpen-amount"
          aria-label="Amount"
          className={SLIDER_CLASS}
          max={SHARPEN_AMOUNT_MAX}
          min={SHARPEN_AMOUNT_MIN}
          step="1"
          type="range"
          value={amount}
          onChange={handleAmountChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <label htmlFor="sharpen-radius" className={LABEL_CLASS}>
          Radius
          <span className={VALUE_CLASS}>{radius}px</span>
        </label>
        <input
          id="sharpen-radius"
          aria-label="Radius"
          className={SLIDER_CLASS}
          max={SHARPEN_RADIUS_MAX}
          min={SHARPEN_RADIUS_MIN}
          step="1"
          type="range"
          value={radius}
          onChange={handleRadiusChange}
        />
      </div>
    </div>
  );
};

export default Sharpen;
