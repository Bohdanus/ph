import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  clampBrushTipSettings,
} from '../../../util/brush-engine.ts';
import { SMUDGE_STRENGTH_MAX, SMUDGE_STRENGTH_MIN } from '../../../tools/smudge.ts';
import type { ToolPatch } from '../../../contexts/tool-types.ts';

/**
 * Layout copied from `Paint/Paint.tsx:23-26`, which is the house shape for a paint family's
 * options bar: a column per control, the label and its live readout in the same line, and the
 * slider underneath.
 *
 * There is no `buttonStyles.ts` constant here because this bar has no buttons — every control
 * the Smudge's args can hold is a slider, and a `Mode` button would have to be a control the
 * args cannot store. Inventing one is the failure this bar is written against: a control that
 * looks live and silently drops the setting.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

/**
 * `strength` as the slider percentage it already is, clamped for display.
 *
 * `SmudgeToolArgs.strength` is Photoshop's `Strength`: a PERCENTAGE of the carried colour
 * blended per dab, seeded at 50 by `src/tools/settings.ts:326`. The brush engine takes the
 * same quantity as a 0-1 `opacity`; `SMUDGE_STRENGTH_SCALE` is the divisor the processor uses
 * for that mapping, and the bar keeps the percentage so the number on screen is the number the
 * user picked in Photoshop. A non-finite value falls to the near end, for the reason
 * `clampBrushTipSettings` gives: `NaN` reaching either end of a range is the dangerous case,
 * because it propagates.
 */
const toPercent = (strength: number): number =>
  Number.isFinite(strength) ? Math.round(Math.min(SMUDGE_STRENGTH_MAX, Math.max(SMUDGE_STRENGTH_MIN, strength))) : 0;

/**
 * The Photoshop Smudge options bar: `Size`, `Hardness`, `Strength`.
 *
 * Every control writes a field `SmudgeToolArgs` actually carries, and every field it carries
 * has a control except `points`, which is the stroke rather than a setting and belongs to
 * `SmudgeToolArea`.
 *
 * The two Photoshop controls this bar does NOT show are omitted because the args have nowhere
 * to put them, and a control that renders a value the tool then ignores is worse than a
 * missing one:
 *
 * - `Mode` is the Smudge's blend mode. In this editor a layer's blend mode is a LAYER property
 *   the layers panel owns, so a `<select>` here would render a value the processor would never
 *   read.
 * - `Finger Painting` makes each dab sample a CLEAN canvas rather than the running smear, which
 *   is a per-dab source selection and not a setting on the same axis as the other three. It
 *   needs an args field of its own before it can be a control at all.
 *
 * `Brush Preset Picker` is the same story: this editor has one tip shape and no presets, so
 * there is nothing to pick and `Size`/`Hardness` are the preset's two live parameters.
 *
 * `aria-label` carries the accessible name on each input, because the visible `<label>` also
 * holds a live numeric readout — without it the computed name would change as the user drags
 * ("Size 40px" becoming "Size 41px"), and a control whose name moves under the pointer cannot
 * be found by one.
 */
const Smudge: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const pendingPatchRef = useRef<ToolPatch<'smudge'> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  /**
   * Coalesce the frame's writes into one `patchToolArgs`, the shape `Levels.tsx` uses for the
   * same reason. A drag emits an event per pointer sample, and each `setToolArgs` re-renders
   * the panel and calls `saveLastSettings`, so unthrottled a single drag is hundreds of
   * renders and hundreds of `saveLastSettings` calls.
   *
   * Patches MERGE rather than replace: each control writes a disjoint field, so the last write
   * per field in a frame is the one that must survive, and merging is what lets two sliders
   * dragged in the same frame both land.
   */
  const throttledPatch = (patch: ToolPatch<'smudge'>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingPatchRef.current;
        pendingPatchRef.current = null;
        if (pending) patchToolArgs('smudge', pending);
      });
    }
  };

  // A frame scheduled by a drag that unmounted mid-drag would call `patchToolArgs` on a tool
  // that is no longer showing, re-seeding the args for a different tool.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingPatchRef.current = null;
    };
  }, []);

  const args = getToolArgs('smudge');
  if (!args) return null;

  /**
   * What the sliders RENDER is the clamped value, not `args` verbatim.
   *
   * The args object holds per-session module state — written by
   * `saveLastSettings()` to `lastSavedSettings` in `src/tools/settings.ts`, not
   * serialized to `localStorage` — and a hand-edited default outside Photoshop's
   * range would populate it with an out-of-bounds value, so a
   * controlled `<input type="range">` whose `value` is out of its own `min`/`max`
   * pins the thumb to the bound while reporting the raw value, so the readout
   * and the thumb disagree.
   * Clamping once, here, and deriving every control from that one copy also means the bar and
   * the processor agree on what the tip is without each re-deriving it.
   */
  const tip = clampBrushTipSettings({ size: args.size, hardness: args.hardness });
  const strength = toPercent(args.strength);

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ size: Number(event.target.value) });
  };

  const handleHardnessChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ hardness: Number(event.target.value) });
  };

  const handleStrengthChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ strength: Number(event.target.value) });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label htmlFor="smudge-size" className={FIELD_CLASS}>
        Size <span className={VALUE_CLASS}>{tip.size}px</span>
        <input
          id="smudge-size"
          aria-label="Size"
          className={SLIDER_CLASS}
          max={BRUSH_SIZE_MAX}
          min={BRUSH_SIZE_MIN}
          step="1"
          type="range"
          value={tip.size}
          onChange={handleSizeChange}
        />
      </label>

      <label htmlFor="smudge-hardness" className={FIELD_CLASS}>
        Hardness <span className={VALUE_CLASS}>{tip.hardness}%</span>
        <input
          id="smudge-hardness"
          aria-label="Hardness"
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          step="1"
          type="range"
          value={tip.hardness}
          onChange={handleHardnessChange}
        />
      </label>

      <label htmlFor="smudge-strength" className={FIELD_CLASS}>
        Strength <span className={VALUE_CLASS}>{strength}%</span>
        <input
          id="smudge-strength"
          aria-label="Strength"
          className={SLIDER_CLASS}
          max={SMUDGE_STRENGTH_MAX}
          min={SMUDGE_STRENGTH_MIN}
          step="1"
          type="range"
          value={strength}
          onChange={handleStrengthChange}
        />
      </label>
    </div>
  );
};

export default Smudge;
