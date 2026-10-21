import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import {
  DODGE_BURN_EXPOSURE_MAX,
  DODGE_BURN_EXPOSURE_MIN,
  DODGE_BURN_RANGES,
  isDodgeBurnToolName,
  isTonalRange,
  type DodgeBurnToolArgs,
  type DodgeBurnToolName,
} from '../../../tools/dodgeBurn.ts';

/**
 * Copied from `src/components/ToolbarsRight/Paint/Paint.tsx` rather than invented,
 * so the two options bars read as one surface.
 *
 * `../buttonStyles.ts` is the house home for shared styles, but it holds button and menu
 * classes only — it has nothing for a range input or a select, and the existing sliders
 * (`Levels.tsx`, `Paint.tsx`) each carry their own. These four are the strings the
 * paint bar already ships, reused verbatim.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const CAPTION_CLASS = 'flex items-baseline justify-between gap-1';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';

/**
 * The shared Dodge AND Burn options bar.
 *
 * ONE component serves both tools, because Photoshop's two bars are the same four
 * controls under two names, and the only difference between the args is the `toolName`
 * the writes carry. Rendering whichever is active means a change to the control set
 * cannot land on one tool and miss the other.
 *
 * The tool identity comes from the store's `toolName` rather than from
 * `toolArgs.toolName`, because `getToolArgs` needs a concrete name to look one up and
 * the store is the authority on which tool is active; `getToolArgs` then returns `null`
 * for anything that is not dodge or burn, which is the same "render nothing when the
 * tool is not this one" contract `Paint.tsx` has.
 *
 * NOT rendered, and this is a real omission rather than an oversight:
 * **Protect Skin Tone**. Photoshop ships it on both bars and it is a boolean that
 * changes which pixels the tool will touch. `DodgeBurnToolArgs` has no field for it, so
 * rendering the checkbox would be a control whose state is dropped on the next commit —
 * a switch that reads as on while doing nothing. It needs an args field first, and the
 * args type is owned outside this module.
 *
 * The value readouts sit OUTSIDE their `<label>` rather than inside it as
 * `Paint.tsx` does. A `<label>`'s text content IS the control's accessible
 * name, so nesting "Size 40px" inside the label makes the range input's name "Size
 * 40px" and the name changes on every drag. Keeping the readout a sibling gives the
 * four controls the exact names Range, Exposure, Size and Hardness.
 */
const Tonal: React.FC<{}> = () => {
  const [{ toolName }] = useStore();
  const { getToolArgs, setToolArgs } = useCurrentTool();

  const activeTool: DodgeBurnToolName | null = isDodgeBurnToolName(toolName) ? toolName : null;
  const args = activeTool ? (getToolArgs(activeTool) as DodgeBurnToolArgs | null) : null;

  const pendingRef = useRef<DodgeBurnToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * Coalesce a burst of slider writes into one store write carrying the last value.
   *
   * A drag emits a `change` per step and each one is a `setToolArgs`, which calls
   * `saveLastSettings()` — so an unthrottled slider
   * persists settings on every frame of a drag. The pending payload is replaced
   * wholesale rather than merged, so a value the user never moved cannot survive in the
   * frame that flushes.
   *
   * The Range `<select>` is NOT routed through here. It fires once per choice rather
   * than once per frame, and a dropdown whose readout lags a frame reads as broken.
   */
  const publishSlider = (next: DodgeBurnToolArgs) => {
    pendingRef.current = next;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingRef.current !== null) setToolArgs(pendingRef.current);
        pendingRef.current = null;
        rafIdRef.current = null;
      });
    }
  };

  if (!activeTool || !args) return null;

  const patch = (next: DodgeBurnToolArgs) => setToolArgs({ ...next, toolName: activeTool });

  const handleRangeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!isTonalRange(value)) return;
    patch({ ...args, range: value });
  };

  const handleExposureChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ ...args, exposure: Number(event.target.value) });
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ ...args, size: Number(event.target.value) });
  };

  const handleHardnessChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ ...args, hardness: Number(event.target.value) });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor={`${activeTool}-range`}>Range</label>
        </div>
        <select id={`${activeTool}-range`} className={SELECT_CLASS} value={args.range} onChange={handleRangeChange}>
          {DODGE_BURN_RANGES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor={`${activeTool}-exposure`}>Exposure</label>
          <span className={VALUE_CLASS}>{Math.round(args.exposure)}%</span>
        </div>
        <input
          id={`${activeTool}-exposure`}
          className={SLIDER_CLASS}
          max={DODGE_BURN_EXPOSURE_MAX}
          min={DODGE_BURN_EXPOSURE_MIN}
          step="1"
          type="range"
          value={args.exposure}
          onChange={handleExposureChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor={`${activeTool}-size`}>Size</label>
          <span className={VALUE_CLASS}>{Math.round(args.size)}px</span>
        </div>
        <input
          id={`${activeTool}-size`}
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
          <label htmlFor={`${activeTool}-hardness`}>Hardness</label>
          <span className={VALUE_CLASS}>{Math.round(args.hardness)}%</span>
        </div>
        <input
          id={`${activeTool}-hardness`}
          className={SLIDER_CLASS}
          max={BRUSH_HARDNESS_MAX}
          min={BRUSH_HARDNESS_MIN}
          step="1"
          type="range"
          value={args.hardness}
          onChange={handleHardnessChange}
        />
      </div>
    </div>
  );
};

export default Tonal;
