import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  BRUSH_SPACING_MAX,
  BRUSH_SPACING_MIN,
  clampBrushTipSettings,
} from '../../../util/brush-engine.ts';
import type { ToolPatch } from '../../../contexts/tool-types.ts';

/**
 * Layout copied from `Paint/Paint.tsx:23-26`, which is the house shape for a paint
 * family's options bar: a column per control, the label and its live readout in the
 * same line, and the slider underneath.
 *
 * There is no `buttonStyles.ts` constant here because this bar has no buttons —
 * every control the Eraser's args can hold is a slider, and a Mode button would have
 * to be a control the args cannot store. Inventing one is the failure this bar is
 * written against: a control that looks live and silently drops the setting.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

/**
 * The one 0-1 coverage the Eraser has, expressed as a slider percentage.
 *
 * `EraserToolArgs.alpha` is the ERASE AMOUNT (Photoshop calls it `Flow`), stored 0-1
 * the way every tool's `alpha` is in this editor — `defaultSettings.eraser.alpha` is
 * 1, and `tool-settings.test.ts` pins that convention across the roster. A
 * non-finite value falls back to 1 rather than to a range end, for the reason
 * `clampBrushTipSettings` gives: `NaN` reaching either end of a range is the
 * dangerous case, because it propagates.
 */
const toPercent = (value: number): number =>
  Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) : 100;

/** Inverse of `toPercent`: the slider's 0-100 scale back onto the args' 0-1 coverage. */
const fromPercent = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 1);

/**
 * The Photoshop Eraser options bar: `Size`, `Hardness`, `Opacity`, `Spacing`.
 *
 * Every control writes a field `EraserToolArgs` actually carries, and every field it
 * carries has a control. There is no `Mode` select, and the omission is deliberate
 * rather than a gap: the Eraser's blend mode is a LAYER property in this editor
 * (the layers panel owns it), and `EraserToolArgs` has nowhere to put one, so a
 * `<select>` here would render a value the tool then ignored. Likewise the fourth
 * control is named `Spacing` and not `Flow`: `Flow` is the per-dab erase amount,
 * which is what `alpha` holds here and what the `Opacity` slider edits, so labelling
 * `spacing` "Flow" would show the user one number and erase with another.
 *
 * `aria-label` carries the accessible name on each input, because the visible
 * `<label>` also holds a live numeric readout — without it the computed name would
 * change as the user drags ("Size 40px" becoming "Size 41px"), and a control whose
 * name moves under the pointer cannot be found by one.
 */
const Eraser: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const pendingPatchRef = useRef<ToolPatch<'eraser'> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  /**
   * Coalesce the frame's writes into one `patchToolArgs`, the shape `Levels.tsx`
   * uses for the same reason. A drag emits an event per pointer sample, and each
   * `setToolArgs` re-renders the panel and calls `saveLastSettings`, so unthrottled
   * a single drag is hundreds of renders and hundreds of localStorage writes.
   *
   * Patches MERGE rather than replace: each control writes a disjoint field, so the
   * last write per field in a frame is the one that must survive, and merging is what
   * lets two sliders dragged in the same frame both land.
   */
  const throttledPatch = (patch: ToolPatch<'eraser'>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingPatchRef.current;
        pendingPatchRef.current = null;
        if (pending) patchToolArgs('eraser', pending);
      });
    }
  };

  // A frame scheduled by a drag that unmounted mid-drag would call `patchToolArgs`
  // on a tool that is no longer showing, re-seeding the args for a different tool.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingPatchRef.current = null;
    };
  }, []);

  const args = getToolArgs('eraser');
  if (!args) return null;

  /**
   * What the sliders RENDER is the clamped value, not `args` verbatim.
   *
   * A persisted args object can hold a value outside Photoshop's range — settings
   * are round-tripped through `localStorage` and restored before anything clamps
   * them — and a controlled `<input type="range">` whose `value` is out of its own
   * `min`/`max` pins the thumb to the bound while reporting the raw value, so the
   * readout and the thumb disagree. Clamping once, here, and deriving every control
   * from that one copy also means the processor and the bar agree on what the tip is
   * without each re-deriving it.
   */
  const tip = clampBrushTipSettings({
    size: args.size,
    hardness: args.hardness,
    opacity: args.alpha,
    spacing: args.spacing,
  });

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ size: Number(event.target.value) });
  };

  const handleHardnessChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ hardness: Number(event.target.value) });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ alpha: fromPercent(Number(event.target.value)) });
  };

  const handleSpacingChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ spacing: Number(event.target.value) });
  };

  const { size, hardness, opacity, spacing } = tip;

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label htmlFor="eraser-size" className={FIELD_CLASS}>
        Size <span className={VALUE_CLASS}>{size}px</span>
        <input
          id="eraser-size"
          aria-label="Size"
          className={SLIDER_CLASS}
          max={BRUSH_SIZE_MAX}
          min={BRUSH_SIZE_MIN}
          step="1"
          type="range"
          value={size}
          onChange={handleSizeChange}
        />
      </label>

      <label htmlFor="eraser-hardness" className={FIELD_CLASS}>
        Hardness <span className={VALUE_CLASS}>{hardness}%</span>
        <input
          id="eraser-hardness"
          aria-label="Hardness"
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          step="1"
          type="range"
          value={hardness}
          onChange={handleHardnessChange}
        />
      </label>

      <label htmlFor="eraser-opacity" className={FIELD_CLASS}>
        Opacity <span className={VALUE_CLASS}>{toPercent(opacity)}%</span>
        <input
          id="eraser-opacity"
          aria-label="Opacity"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={toPercent(opacity)}
          onChange={handleOpacityChange}
        />
      </label>

      <label htmlFor="eraser-spacing" className={FIELD_CLASS}>
        Spacing <span className={VALUE_CLASS}>{spacing}%</span>
        <input
          id="eraser-spacing"
          aria-label="Spacing"
          className={SLIDER_CLASS}
          max={BRUSH_SPACING_MAX}
          min={BRUSH_SPACING_MIN}
          step="1"
          type="range"
          value={spacing}
          onChange={handleSpacingChange}
        />
      </label>
    </div>
  );
};

export default Eraser;
