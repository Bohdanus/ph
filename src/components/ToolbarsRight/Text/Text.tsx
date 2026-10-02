import React, { type ChangeEvent, useRef } from 'react';
import { calculateNewRect } from '../../../util/rect.ts';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { isTextToolArgs } from '../../../util/typeGuards.ts';
import FontSelect from './FontSelect.tsx';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, TRACKING_MAX, TRACKING_MIN, resolveTextStyle } from '../../../tools/text.ts';
import {
  ICON_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TOGGLE_BUTTON_ACTIVE,
  TOGGLE_BUTTON_INACTIVE,
} from '../buttonStyles.ts';

const Text: React.FC<{}> = () => {
  const [{ canvasRef, textareaRef, totalSize }] = useStore();
  const { createLayerFromTool } = useLayers();
  const { toolArgs, setToolArgs: onChange } = useCurrentTool();
  const appliedArgsRef = useRef<typeof toolArgs | null>(null);

  if (!isTextToolArgs(toolArgs)) {
    return null;
  }

  const style = resolveTextStyle(toolArgs);
  const { text = '', rect = null, color } = toolArgs;

  /**
   * Publishing a style change and the rectangle it implies as ONE call.
   *
   * Every control that changes how wide the text lays out has to go through here, because
   * `calculateNewRect` measures with the same font the creator will draw with and a box that was
   * computed against the previous one is a box one metric out of date. `ctx.fontVariantCaps` is
   * the reason this cannot stay a per-handler decision: All Caps and Small Caps change every
   * character's advance, and neither is a field `calculateNewRect` knew about before.
   */
  const publishStyle = (changes: Partial<typeof toolArgs>) => {
    const newArgs = { ...toolArgs, ...changes };
    onChange({ ...newArgs, rect: calculateNewRect(newArgs, canvasRef, totalSize) ?? rect });
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    publishStyle({ text: event.target.value });
  };

  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const requested = Number(event.target.value);
    // A cleared field reads as 0, and `min`/`max` on a number input only mark it `:invalid` — they
    // do not stop the value being typed. Adobe's bound is on the FIELD, so clamping here is the
    // same rule rather than a new one; refusing a non-finite value is what keeps an empty field
    // from becoming a 0px font.
    if (!Number.isFinite(requested)) return;
    publishStyle({ fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, requested)) });
  };

  const handleLineHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishStyle({ lineHeight: Number(event.target.value) });
  };

  const handleFontFamilyChange = (fontFamilyValue: string) => {
    publishStyle({ fontFamily: fontFamilyValue });
  };

  const handleTrackingChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishStyle({ tracking: Number(event.target.value) });
  };

  const handleAlignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    // Through `publishStyle`, unlike colour and the two decorations: `calculateNewRect` has an
    // alignment arm that re-centres or re-flushes a box the text outgrew, so a box re-placed by
    // left and then switched to right is one the next measurement would move again.
    publishStyle({ align: event.target.value as 'left' | 'center' | 'right' });
  };

  /**
   * The type colour is the tool's OWN setting, edited here, and the store's foreground no longer
   * writes over it. Photoshop's Type options bar carries this swatch
   * (https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html) and the bar
   * used to mirror the global foreground into `toolArgs.color` on every render instead, so a user
   * who picked a colour here watched it change under their hands.
   *
   * This one does NOT recompute the rect, and neither do underline and strikethrough: none of the
   * three changes a metric. They draw in the type colour and sit inside the box the glyphs already
   * occupy.
   */
  const handleColorChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...toolArgs, color: event.target.value });
  };

  const applyText = () => {
    if (text && rect) {
      if (appliedArgsRef.current === toolArgs) return;
      appliedArgsRef.current = toolArgs;
      onChange({ ...toolArgs, text: '', rect: null });
      createLayerFromTool({ args: toolArgs });
    }
  };

  const clear = () => {
    onChange({ ...toolArgs, text: '', rect: null });
  };

  return (
    <div className="flex flex-row items-center gap-4 h-full">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label htmlFor="text-input" className="text-[10px] mr-[-3px] font-medium text-gray-700 dark:text-gray-300">
            Text
          </label>
          <textarea
            ref={textareaRef}
            id="text-input"
            value={text}
            onChange={handleTextChange}
            placeholder={rect ? 'Enter text...' : 'Drag on the canvas to place text...'}
            rows={2}
            className="rounded border border-gray-400 bg-white px-1 py-0.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-300 dark:bg-white dark:text-gray-900 w-52"
          />
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label
            htmlFor="font-family-select"
            className="text-[10px] mr-[-3px] font-medium text-gray-700 dark:text-gray-300"
          >
            Font
          </label>
          <div className="w-32 flex items-center">
            <FontSelect value={style.fontFamily} onChange={handleFontFamilyChange} />
          </div>
        </div>
      </div>

      {/*
       * Adobe's Character-panel Size field is a number field, not a slider, and its range is
       * `0.01..1296` px at 72ppi. A range input over a 1296-wide span puts one point in about a
       * hundredth of a pixel of track, so the field is the control that can actually reach the
       * range's top end.
       */}
      <div className="flex flex-col">
        <label
          htmlFor="font-size-input"
          className="flex mb-2 justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Font Size
          <span className="text-gray-500 dark:text-gray-400">
            {FONT_SIZE_MIN}–{FONT_SIZE_MAX}
          </span>
        </label>
        <input
          id="font-size-input"
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          value={style.fontSize}
          onChange={handleFontSizeChange}
          className="w-24 h-9 rounded border border-gray-300 bg-white px-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="line-height-slider"
          className="flex mb-2 justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Line Height
          <span className="font-bold text-gray-900 dark:text-gray-200">{style.lineHeight.toFixed(1)}</span>
        </label>
        <input
          id="line-height-slider"
          type="range"
          min="0.5"
          max="2.25"
          step="0.05"
          value={style.lineHeight}
          onChange={handleLineHeightChange}
          className="h-1.5 w-21 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      {/*
       * Tracking is 1/1000 em of the current type size and Adobe's field runs -1000..1000, so
       * the readout is in the unit Adobe uses and the bar's own value is not scaled on the way
       * out — `trackingPx` in `src/tools/text.ts` is the one place that converts it to px.
       */}
      <div className="flex flex-col">
        <label
          htmlFor="tracking-slider"
          className="flex mb-2 justify-between text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Tracking
          <span className="font-bold text-gray-900 dark:text-gray-200">{style.tracking}</span>
        </label>
        <input
          id="tracking-slider"
          type="range"
          min={TRACKING_MIN}
          max={TRACKING_MAX}
          step={1}
          value={style.tracking}
          onChange={handleTrackingChange}
          className="h-1.5 w-21 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label htmlFor="text-color" className="mb-2 text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Color
        </label>
        <input id="text-color" type="color" value={color} onChange={handleColorChange} className={ICON_BUTTON} />
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <label
            htmlFor="align-select"
            className="text-[10px] ml-2 mr-[-3px] font-medium text-gray-700 dark:text-gray-300"
          >
            Align
          </label>
          <select
            id="align-select"
            value={style.align}
            onChange={handleAlignChange}
            className="rounded border border-gray-300 bg-white px-1 h-9 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      </div>

      {/*
       * `aria-label` rather than the glyph, because a control whose accessible name is "B" tells a
       * screen reader nothing. `aria-pressed` is what makes these toggles stateful to assistive
       * technology at all, which the class list does not — the class list is how the state is
       * shown, and it is not an interface.
       */}
      <div className="flex gap-2">
        <button
          id="text-bold"
          aria-label="Bold"
          aria-pressed={style.bold}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            style.bold ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => publishStyle({ bold: !style.bold })}
        >
          B
        </button>
        <button
          id="text-italic"
          aria-label="Italic"
          aria-pressed={style.italic}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            style.italic ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => publishStyle({ italic: !style.italic })}
        >
          I
        </button>
        {/*
         * Adobe documents the caps rules rather than a control set: All Caps renders every
         * character as a capital, and Small Caps "generates faux small caps" when the font has
         * none. They are separate booleans here and Chrome keeps them separate — `small-caps`
         * leaves characters already typed as capitals at full size.
         */}
        <button
          id="text-all-caps"
          aria-label="All Caps"
          aria-pressed={style.allCaps}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[14px] transition-colors focus:outline-none ${
            style.allCaps ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => publishStyle({ allCaps: !style.allCaps })}
        >
          Aa
        </button>
        <button
          id="text-small-caps"
          aria-label="Small Caps"
          aria-pressed={style.smallCaps}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[14px] transition-colors focus:outline-none ${
            style.smallCaps ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => publishStyle({ smallCaps: !style.smallCaps })}
        >
          Aᴀ
        </button>
        <button
          id="text-underline"
          aria-label="Underline"
          aria-pressed={style.underline}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            style.underline ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => onChange({ ...toolArgs, underline: !style.underline })}
        >
          <span className="underline">U</span>
        </button>
        <button
          id="text-strikethrough"
          aria-label="Strikethrough"
          aria-pressed={style.strikethrough}
          className={`w-9 h-9 flex items-center justify-center rounded border text-[20px] transition-colors focus:outline-none ${
            style.strikethrough ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE
          }`}
          onClick={() => onChange({ ...toolArgs, strikethrough: !style.strikethrough })}
        >
          <span className="line-through">S</span>
        </button>
      </div>

      <div className="flex gap-2 ml-2">
        <button className={PRIMARY_BUTTON} disabled={!text || !rect} onClick={applyText}>
          Apply
        </button>
        <button className={SECONDARY_BUTTON} disabled={!text || !rect} onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default Text;
