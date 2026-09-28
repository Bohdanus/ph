import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import type { ToolPatch } from '../../../contexts/tool-types.ts';
import type { CloneStampToolArgs } from '../../../tools/cloneStamp.ts';

/**
 * Copied from `src/components/ToolbarsRight/Tonal/Tonal.tsx:24-28` rather than invented, so
 * the two options bars read as one surface, and those four in turn come from
 * `Paint.tsx:23-26`. They are duplicated here for the reason `Tonal.tsx:16-22` documents:
 * `../buttonStyles.ts` is the house home for shared styles but holds button and menu classes
 * only — it has nothing for a range input or a select, and every existing slider
 * (`Levels.tsx:115`, `Paint.tsx:25`, `Tonal.tsx:27`) carries its own.
 *
 * `CHECKBOX_CLASS` is `Figures/Shape.tsx:207` verbatim, the bar's existing checkbox styling.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const CAPTION_CLASS = 'flex items-baseline justify-between gap-1';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const CHECKBOX_CLASS = 'h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500';

const OPACITY_MAX = 100;
const OPACITY_MIN = 0;
const toPercent = (alpha: number): number => Math.round(alpha * 100);

/**
 * The Photoshop Clone Stamp options bar: `Size`, `Hardness`, `Opacity`, `Aligned`.
 *
 * Read through `getToolArgs('clone-stamp')` and not `toolArgs`, so the bar renders nothing
 * at all while another tool is active — the same contract `Paint.tsx:103` and
 * `Tonal.tsx:100` have. `getToolArgs` needs a concrete tool name to look one up, which is
 * why this is a single-tool bar rather than a shared one.
 *
 * ## The value readouts sit OUTSIDE their `<label>`
 *
 * A `<label>`'s text content IS the control's accessible name, so nesting "Size 40px" inside
 * the label — as `Paint.tsx:154-155` does — makes the range input's name "Size 40px", and the
 * name then changes on every drag. Keeping each readout a sibling gives the four controls the
 * exact, stable names `Size`, `Hardness`, `Opacity` and `Aligned`, which is what a test can
 * locate by role and name and what a screen reader announces as the user drags. `Tonal.tsx:47-55`
 * makes the same choice.
 *
 * ## NOT rendered, and these are real omissions rather than oversights
 *
 * **`Mode`** (Photoshop: Normal / Multiply / Screen / …), **`Flow`**,
 * **`Sample: All Layers / Current & Below / Current Layer`** and **`Brush Preset Picker`**.
 * `CloneStampToolArgs` has no field for any of them, so a control for one would be a switch
 * that reads as set and is silently dropped on the next commit — strictly worse than its
 * absence, and the same reason `Tonal.tsx:44-49` refuses to render Protect Skin Tone. `Mode`
 * is the one that would change visible behaviour: the Clone Stamp is a `commit: 'raster'`
 * tool, so a blend mode is a composite against the layer beneath, and the processor's
 * `blendPixel` composite is `source-over` with no mode parameter. Adding any of the four
 * needs an args field first, and the args type is owned outside this module.
 *
 * **A source readout.** Photoshop's bar does not show one either, and this bar does not
 * invent a way to clear it: the source is a document point in the args, so a "clear source"
 * button would be a one-line `patchToolArgs('clone-stamp', { source: null })` that has no
 * `data-testid` and no accessible name to hang a test on. The Alt-click re-sets it, and the
 * tool area's `isEnabled` gate already makes "no source" visible as a refused gesture.
 *
 * ## Sliders are throttled through one animation frame
 *
 * A drag emits a `change` per step and each write is a `patchToolArgs`, which calls
 * `saveLastSettings` (`src/contexts/useCurrentTool.tsx:71`) — so an unthrottled slider
 * persists settings on every frame of a drag. The pending PATCH is replaced wholesale rather
 * than merged with the args object, so a value the user never moved cannot survive in the
 * frame that flushes, and the `Aligned` checkbox deliberately does NOT go through here: it
 * fires once per click, and a checkbox whose tick lags a frame reads as broken.
 */
const CloneStamp: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();

  const args = getToolArgs('clone-stamp') as CloneStampToolArgs | null;

  const pendingPatchRef = useRef<ToolPatch<'clone-stamp'> | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const publishSlider = (patch: ToolPatch<'clone-stamp'>) => {
    pendingPatchRef.current = patch;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingPatchRef.current !== null) patchToolArgs('clone-stamp', pendingPatchRef.current);
        pendingPatchRef.current = null;
        rafIdRef.current = null;
      });
    }
  };

  if (!args) return null;

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ size: Number(event.target.value) });
  };

  const handleHardnessChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ hardness: Number(event.target.value) });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ alpha: Number(event.target.value) / OPACITY_MAX });
  };

  const handleAlignedChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('clone-stamp', { aligned: event.target.checked });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="clone-stamp-size">Size</label>
          <span className={VALUE_CLASS}>{Math.round(args.size)}px</span>
        </div>
        <input
          id="clone-stamp-size"
          className={SLIDER_CLASS}
          max={BRUSH_SIZE_MAX}
          min={BRUSH_SIZE_MIN}
          step="1"
          type="range"
          value={args.size}
          onChange={handleSizeChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="clone-stamp-hardness">Hardness</label>
          <span className={VALUE_CLASS}>{Math.round(args.hardness)}%</span>
        </div>
        <input
          id="clone-stamp-hardness"
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          step="1"
          type="range"
          value={args.hardness}
          onChange={handleHardnessChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="clone-stamp-opacity">Opacity</label>
          <span className={VALUE_CLASS}>{toPercent(args.alpha)}%</span>
        </div>
        <input
          id="clone-stamp-opacity"
          className={SLIDER_CLASS}
          max={OPACITY_MAX}
          min={OPACITY_MIN}
          step="1"
          type="range"
          value={toPercent(args.alpha)}
          onChange={handleOpacityChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="clone-stamp-aligned">Aligned</label>
          <input
            id="clone-stamp-aligned"
            className={CHECKBOX_CLASS}
            type="checkbox"
            checked={args.aligned}
            onChange={handleAlignedChange}
          />
        </div>
      </div>
    </div>
  );
};

export default CloneStamp;
