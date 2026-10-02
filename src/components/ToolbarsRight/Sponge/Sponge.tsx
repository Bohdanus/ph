import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { BRUSH_HARDNESS_MAX, BRUSH_HARDNESS_MIN, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../../util/brush-engine.ts';
import {
  SPONGE_FLOW_MAX,
  SPONGE_FLOW_MIN,
  SPONGE_MODES,
  isSpongeMode,
  type SpongeToolArgs,
} from '../../../tools/sponge.ts';

/**
 * Copied from `src/components/ToolbarsRight/Tonal/Tonal.tsx:24-28` verbatim rather than
 * invented, so the two bars in the same flyout read as one surface. The reason they are
 * two components rather than one is the control set, not the layout: `Tonal` renders
 * `Range` and `Exposure`, which the Sponge does not have, and `Tonal.test.tsx` pins its
 * own control count, so a branch inside one component would break the Dodge's bar
 * description every time the Sponge's grew a control.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const CAPTION_CLASS = 'flex items-baseline justify-between gap-1';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const CHECKBOX_LABEL_CLASS =
  'flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300';

/**
 * The Sponge tool's options bar.
 *
 * **Bar order is Adobe's.** Adobe's Sponge page enumerates the bar as the brush tip, then
 * `Mode`, then `Flow`, then `Vibrance`; `Size` and `Hardness` are the brush preset's two
 * live parameters and ride with it. So this renders `Mode`, `Flow`, `Vibrance`, `Size`,
 * `Hardness` — which is also the order `DODGE_GROUP` lists its own controls in
 * (`src/tools/descriptions/focus.ts`), so the description generator and the bar agree.
 *
 * **The tool identity comes from the store's `toolName`, not from `toolArgs.toolName`**,
 * because `getToolArgs` needs a concrete name to look one up. `toolName === 'sponge'` is
 * the whole gate, so mounting this bar under any other tool renders nothing at all — the
 * same "render nothing when the tool is not this one" contract `Paint.tsx` has.
 *
 * **The value readouts sit OUTSIDE their `<label>`**, as `Tonal.tsx:51-55` explains for
 * the same reason: a `<label>`'s text content IS the control's accessible name, so
 * nesting "Flow 50%" inside it would make the slider's name change on every drag.
 *
 * NOT rendered, and these are real omissions rather than oversights. **Airbrush** is
 * absent because it is a build-up-while-held behaviour, which is the recorded absence on
 * the Dodge, the Burn and the Smudge (`docs/TOOLS-TOO-HARD.md`) — there is no timer in
 * `usePaintStroke` and no args field to carry it. **Brush Preset Picker** is absent
 * because this editor has one tip shape and no presets, so its two live parameters are the
 * two sliders and there is nothing for a dropdown to choose. **Pressure** controls are
 * absent because no tool in this app reads a tablet's pressure; `sponge.ts` has no
 * pressure term and inventing one would be a control whose state is dropped. Every one of
 * the four is named in the tool's description at `missing` so the gap is visible rather
 * than invisible.
 */
const Sponge: React.FC<{}> = () => {
  const [{ toolName }] = useStore();
  const { getToolArgs, setToolArgs } = useCurrentTool();

  const active = toolName === 'sponge';
  const args = active ? (getToolArgs('sponge') as SpongeToolArgs | null) : null;

  const pendingRef = useRef<SpongeToolArgs | null>(null);
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
   * `saveLastSettings` — so an unthrottled slider persists settings on every frame of a
   * drag. The pending payload is replaced wholesale rather than merged, so a value the user
   * never moved cannot survive in the frame that flushes. This is `Tonal.tsx:88-98`,
   * copied rather than shared because the two bars carry different args types and a shared
   * helper would have to be generic over both to save one file.
   *
   * The `Mode` `<select>` and the `Vibrance` checkbox are NOT routed through here. They
   * fire once per interaction rather than once per frame, and a dropdown or a switch whose
   * state lags a frame reads as broken.
   */
  const publishSlider = (next: SpongeToolArgs) => {
    pendingRef.current = next;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingRef.current !== null) setToolArgs(pendingRef.current);
        pendingRef.current = null;
        rafIdRef.current = null;
      });
    }
  };

  if (!args) return null;

  const patch = (next: SpongeToolArgs) => setToolArgs({ ...next, toolName: 'sponge' });

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!isSpongeMode(value)) return;
    patch({ ...args, mode: value });
  };

  const handleVibranceChange = (event: ChangeEvent<HTMLInputElement>) => {
    patch({ ...args, vibrance: event.target.checked });
  };

  const handleFlowChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishSlider({ ...args, flow: Number(event.target.value) });
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
          <label htmlFor="sponge-mode">Mode</label>
        </div>
        <select id="sponge-mode" className={SELECT_CLASS} value={args.mode} onChange={handleModeChange}>
          {SPONGE_MODES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="sponge-flow">Flow</label>
          <span className={VALUE_CLASS}>{Math.round(args.flow)}%</span>
        </div>
        <input
          id="sponge-flow"
          className={SLIDER_CLASS}
          max={SPONGE_FLOW_MAX}
          min={SPONGE_FLOW_MIN}
          step="1"
          type="range"
          value={args.flow}
          onChange={handleFlowChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label className={CHECKBOX_LABEL_CLASS} htmlFor="sponge-vibrance">
            <input id="sponge-vibrance" type="checkbox" checked={args.vibrance} onChange={handleVibranceChange} />
            Vibrance
          </label>
        </div>
      </div>

      <div className={FIELD_CLASS}>
        <div className={CAPTION_CLASS}>
          <label htmlFor="sponge-size">Size</label>
          <span className={VALUE_CLASS}>{Math.round(args.size)}px</span>
        </div>
        <input
          id="sponge-size"
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
          <label htmlFor="sponge-hardness">Hardness</label>
          <span className={VALUE_CLASS}>{Math.round(args.hardness)}%</span>
        </div>
        <input
          id="sponge-hardness"
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

export default Sponge;
