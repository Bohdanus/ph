import React, { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react';
import { calculateNewRect, canvasRectToLocal as toLocal, sortRect, sortedRectToPos } from '../../../util/rect.ts';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { canvasToDocumentPos, documentFrameFromSize } from '../../../contexts/document-frame.ts';
import { isValidTextLayerGeometry, isValidTextRect } from '../../../contexts/text-layer-edit.ts';
import { isTextToolArgs } from '../../../util/typeGuards.ts';
import FontSelect from './FontSelect.tsx';
import {
  AUTO_LEADING,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  clearTextDraftArgs,
  TRACKING_MAX,
  TRACKING_MIN,
  resolveTextKind,
  resolveTextStyle,
} from '../../../tools/text.ts';
import {
  ICON_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TOGGLE_BUTTON_ACTIVE,
  TOGGLE_BUTTON_INACTIVE,
} from '../buttonStyles.ts';

const Text: React.FC<{}> = () => {
  const [{ canvasRef, totalSize, documentFrame: currentDocumentFrame, activeLayerId, layers }] = useStore();
  const { createLayerFromTool, replaceLayerSource, cancelLayerPreview } = useLayers();
  const { toolArgs, setToolArgs: onChange } = useCurrentTool();
  const appliedArgsRef = useRef<typeof toolArgs | null>(null);
  /**
   * The size the user is part-way through typing, or `null` when they are not editing.
   *
   * `null` is load-bearing rather than a convenience, and it is the same seam the polygon tool's
   * `sides` field uses. It is how the input knows to show the PUBLISHED size instead of a draft, so
   * every external change to `toolArgs.fontSize` — a tool switch, a settings reload, another control
   * publishing the style — still repaints the field correctly, and how a blur with nothing typed is
   * skipped instead of republishing the size the bar already had.
   */
  const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);

  if (!isTextToolArgs(toolArgs)) {
    return null;
  }

  const style = resolveTextStyle(toolArgs);
  const alignmentEnabled = resolveTextKind(toolArgs) === 'paragraph';
  const { text = '', rect = null, color } = toolArgs;
  /** A placed box remains an edit session even after the user deletes every character. */
  const editing = Boolean(rect);
  const emptyEditLayer = toolArgs.editingLayerId ? layers[toolArgs.editingLayerId] : undefined;
  const emptyEditArgs =
    emptyEditLayer?.source?.kind === 'tool' && isTextToolArgs(emptyEditLayer.source.args)
      ? emptyEditLayer.source.args
      : null;
  const emptyEditRect = emptyEditArgs?.rect ?? null;
  const canCommitEmptyEdit = Boolean(
    editing &&
    toolArgs.editingLayerId &&
    !text &&
    emptyEditLayer &&
    isValidTextLayerGeometry(emptyEditRect, emptyEditLayer.pos)
  );

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

  /**
   * Publish the draft as a size — once the user is done with it, not on every keystroke.
   *
   * **A keystroke is not an edit.** Publishing from `onChange` meant the controlled field repainted
   * itself mid-word, because every published value came straight back through `style.fontSize`:
   * typing `64` over a `32` has to pass through `6`, `6` is in range, so `6` was published and the
   * `4` landed in a field showing `6`. A leading `0` was worse — `0` clamps up to `FONT_SIZE_MIN`, so
   * the field became `0.01` before the second digit arrived, and that digit landed after it. Nothing
   * on screen said a keystroke had been rewritten, and the wrong size is what got published, drawn
   * and committed.
   *
   * So the field holds the USER's string while they type and publishes the number only when they
   * commit, which is how Photoshop's own Size field behaves: the size applies when you commit it,
   * not as you cross a threshold on the way. `min`/`max` cannot do this job either — they are
   * constraint-validation metadata, so the browser dispatches the change for an out-of-range value
   * and marks the field `:invalid` rather than refusing the keystroke.
   */
  const handleFontSizeCommit = () => {
    if (fontSizeDraft === null) return;
    const draft = fontSizeDraft;
    setFontSizeDraft(null);
    // An EMPTY draft publishes NOTHING, and the reason is an operator, not a type: `Number('')` is
    // `0`, which is finite, so a finiteness guard admits it and the clamp below turns a size the user
    // was halfway through retyping into `FONT_SIZE_MIN`. `fill` cannot produce an empty value on its
    // own, but BACKSPACE can, and a two-digit size cannot be typed without passing through one.
    //
    // The old size comes back because dropping the draft puts the published one back in the field —
    // the controlled restore that used to be the whole of the mechanism, and that
    // `e2e/text-tool.spec.ts` pins. It now happens on the way OUT of the edit rather than on every
    // keystroke of it.
    if (draft === '') return;
    const requested = Number(draft);
    if (!Number.isFinite(requested)) return;
    // Clamped at COMMIT, so the store never holds a value `resolveTextStyle` would have to defend
    // against a second time, and the field's next render shows what was actually published.
    publishStyle({ fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, requested)) });
  };

  /**
   * RAW, unclamped, and the empty string kept as-is — resolving it here is what repaints the field
   * out from under the cursor mid-edit. See `handleFontSizeCommit`.
   */
  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFontSizeDraft(event.target.value);
  };

  const handleFontSizeKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleFontSizeCommit();
    } else if (event.key === 'Escape') {
      // Abandon the draft and leave the published size exactly as it was, which is only possible
      // because nothing was published while the user was typing.
      event.preventDefault();
      setFontSizeDraft(null);
    }
  };

  const handleLineHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishStyle({ lineHeight: Number(event.target.value) });
  };

  /**
   * Reset line height to Adobe's auto-leading default (120% of the type size).
   *
   * Adobe's `CharacterStyle.leading` is `null` for Auto, and `JustificationProperties.autoLeadingAmount`
   * defaults to `120`. This app's `lineHeight` is a ratio rather than a length (§5 of
   * `TEXT_TOOL_REQUIREMENTS.md` records the divergence), so `AUTO_LEADING = 1.2` is the
   * closest faithful reproduction. The button gives the user one click back to the default
   * the way Photoshop's Character panel does when leading is cleared.
   */
  const handleAutoLeading = () => {
    publishStyle({ lineHeight: AUTO_LEADING });
  };

  const handleFontFamilyChange = (fontFamilyValue: string) => {
    publishStyle({ fontFamily: fontFamilyValue });
  };

  const handleTrackingChange = (event: ChangeEvent<HTMLInputElement>) => {
    publishStyle({ tracking: Number(event.target.value) });
  };

  const handleAlignChange = (event: ChangeEvent<HTMLSelectElement>) => {
    // Through `publishStyle`, unlike colour and the two decorations. `calculateNewRect` has no
    // alignment arm at all now — a POINT box hugs its ink and keeps its left edge for all three
    // settings, because Adobe scopes alignment to paragraph type — but a PARAGRAPH box's width is
    // the width the user dragged and alignment redistributes the ink inside it, so a box re-placed
    // by left and then switched to right is one the next measurement would move again.
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

  /**
   * Commit the draft as a layer, and clear it only once the layer exists.
   *
   * **The order is the whole point, and it used to be the other way round.** `onChange` writes the
   * args both imperatively (`_setToolArgs` sets `currentArgsRef`) and into React state, so a clear
   * that runs first has already destroyed the draft by the time the create is attempted — and
   * `createLayerFromTool` can throw. `layer-utils`' `createLayerSource` refuses a zero extent with
   * `Layer width and height must be greater than 0`, and the tool area is `absolute inset-0` over
   * the whole centred container, so a click in the letterbox margin around the canvas could reach
   * it. A throw from a React event handler is routed to `window.onerror` and not to an error
   * boundary — `ToolbarHorizontal` is outside every boundary in the tree — so the failure was
   * SILENT: the textarea emptied, no layer appeared, Apply disabled itself, and nothing said why.
   *
   * Worse on the other route: `useApp`'s `goToTool` calls `commitDirtyTool` and then dispatches
   * `SET_TOOL_NAME`, so a throw from here escaped before the tool switch and left the app on the
   * Type tool, where every subsequent switch attempt threw the same way. The user was stuck.
   *
   * `commitDirtyTool` in `useLayer` already had this order right — create, then clear — which is why
   * this function was the odd one out rather than the rule being wrong somewhere.
   */
  const applyText = () => {
    if (!editing || !rect || (!text && !canCommitEmptyEdit)) return;
    if (appliedArgsRef.current === toolArgs) return;
    const editingLayerId = toolArgs.editingLayerId;
    const activeLayer = editingLayerId ? layers[editingLayerId] : activeLayerId ? layers[activeLayerId] : undefined;
    if (
      editingLayerId &&
      (!activeLayer || activeLayer.source?.kind !== 'tool' || activeLayer.source.args.toolName !== 'text')
    ) {
      clear();
      return;
    }
    const activeTextArgs =
      activeLayer?.source?.kind === 'tool' && isTextToolArgs(activeLayer.source.args) ? activeLayer.source.args : null;
    const activeTextLayer = activeTextArgs && activeLayer ? activeLayer : null;
    const originalRect = canCommitEmptyEdit ? (activeTextArgs?.rect ?? null) : null;
    if (canCommitEmptyEdit && (!activeTextLayer || !isValidTextLayerGeometry(originalRect, activeTextLayer.pos))) {
      return;
    }

    const measuredRect = canCommitEmptyEdit ? originalRect : (calculateNewRect(toolArgs, canvasRef, totalSize) ?? rect);
    if (!isValidTextRect(measuredRect)) return;
    const localPos = sortedRectToPos(sortRect(measuredRect));
    const pos =
      canCommitEmptyEdit && activeTextLayer
        ? activeTextLayer.pos
        : canvasToDocumentPos(localPos, currentDocumentFrame ?? documentFrameFromSize(totalSize));
    const { editingLayerId: _editingLayerId, ...persistedArgs } = toolArgs;
    const committedArgs = { ...persistedArgs, placeholderUntouched: false, rect: measuredRect };
    const editsActiveLayer =
      activeTextLayer !== null &&
      (Boolean(editingLayerId) || (pos.x === activeTextLayer.pos.x && pos.y === activeTextLayer.pos.y));
    if (editsActiveLayer && activeLayer && activeTextLayer) {
      // Layer-LOCAL rect, as the create arm stores it and as the creator renders it: the raster is
      // built at `pos` size and the type is drawn at the rect's own coordinates. An unreduced
      // canvas-space rect therefore renders an EMPTY layer as soon as the document frame is not the
      // origin. Existing empty edits are the exception: their source rect is already layer-local,
      // so preserve it with the original position rather than reducing it a second time.
      const replacementRect = canCommitEmptyEdit ? originalRect : toLocal(measuredRect, pos, currentDocumentFrame);
      if (!isValidTextLayerGeometry(replacementRect, pos)) return;
      const replaced = replaceLayerSource(activeLayer.id, {
        kind: 'tool',
        args: { ...persistedArgs, ...committedArgs, rect: replacementRect },
        pos,
      });
      if (replaced === null) return;
    } else {
      // The re-entrancy guard is armed AFTER the create, not before it. Armed before, a throw from
      // `createLayerFromTool` left it armed against a `toolArgs` identity nothing has changed, so
      // every later Apply returned here and did nothing — the draft survived, but the control was
      // bricked, and no second attempt could recover it. Arming it after the create keeps the guard
      // doing its real job, which is a repeated invocation of THIS handler within one tick, without
      // letting a failure consume the user's next try.
      createLayerFromTool({ args: committedArgs });
    }
    appliedArgsRef.current = toolArgs;
    onChange(clearTextDraftArgs(persistedArgs));
  };

  const clear = () => {
    if (toolArgs.editingLayerId) cancelLayerPreview(toolArgs.editingLayerId);
    const { editingLayerId: _editingLayerId, ...persistedArgs } = toolArgs;
    onChange(clearTextDraftArgs(persistedArgs));
  };

  return (
    <div className="flex flex-row items-center gap-4 h-full min-w-[1100px]">
      {/*
       * Adobe's ONE visible tell for edit mode, and the reason there is no text field here any more.
       *
       * "To determine whether a type tool is in edit mode, look in the options bar — if you see the
       * Commit button and the Cancel button, the type tool is in edit mode"
       * (https://helpx.adobe.com/photoshop/using/creating-type.html). The pair is the whole of it,
       * and it is only rendered while a placed box is open: the rectangle remains the edit-session
       * signal even when the user deletes all characters, so the bar and canvas keep the caret alive.
       *
       * The textarea this replaces was the app's answer to having no edit mode — "type into a field
       * on the right, press Apply, get a raster layer" — and it was the largest fidelity gap in the
       * tool: no caret, no placeholder, and a second place to look for the text. It is gone rather
       * than hidden because a hidden field that still holds the draft's text is a second source of
       * truth, and two inputs bound to one string fight over the focus.
       */}
      {editing && (
        <div className="flex flex-col">
          <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">Editing type layer</span>
        </div>
      )}

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
          className="flex mb-1 justify-between text-[10px] leading-none font-medium text-gray-700 dark:text-gray-300"
        >
          Font Size
          <span className="text-gray-500 dark:text-gray-400">
            {FONT_SIZE_MIN}–{FONT_SIZE_MAX}
          </span>
        </label>
        <input
          id="font-size-input"
          data-testid="font-size-input"
          type="number"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          // `any`, and NOT `1`. Per the HTML step algorithm the base is `min`, so `step={1}` over
          // `min={0.01}` yields the grid 0.01, 1.01, 2.01 … and two consequences followed from that:
          // the seeded 64 sat OFF-grid on first paint, so the spinner took two presses to reach 65,
          // and the last landable value under the maximum was 1295.01 — Adobe's own 1296 could not
          // be reached by the spinner or an arrow key at all. `any` is the honest answer for a
          // continuous quantity typed as a number, and it is what the value itself already was.
          step="any"
          // The published size, unless a draft is in progress — see `handleFontSizeCommit`. Both
          // halves are the control: `String(style.fontSize)` is what an external change to
          // `toolArgs.fontSize` repaints through, and the draft is what a typist is looking at.
          value={fontSizeDraft ?? String(style.fontSize)}
          onChange={handleFontSizeChange}
          onBlur={handleFontSizeCommit}
          onKeyDown={handleFontSizeKeyDown}
          className="w-24 h-8 rounded border border-gray-300 bg-white px-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        />
      </div>

      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-2" aria-hidden="true" />

      <div className="flex flex-col">
        <label htmlFor="line-height-slider" className="text-[10px] font-medium text-gray-700 dark:text-gray-300 mb-2">
          Line Height
        </label>
        <div className="flex items-center gap-2">
          <input
            id="line-height-slider"
            data-testid="line-height-slider"
            type="range"
            min={MIN_LINE_HEIGHT}
            max={MAX_LINE_HEIGHT}
            step="0.05"
            value={style.lineHeight}
            onChange={handleLineHeightChange}
            className="h-1.5 w-40 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span
            data-testid="line-height-readout"
            aria-hidden="true"
            className="text-xs font-mono font-bold text-gray-900 dark:text-gray-200 min-w-[2.5rem] text-right"
          >
            {style.lineHeight.toFixed(1)}
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Reset line height to Auto (1.2)"
            title="Reset to Auto leading (120% of type size)"
            onClick={handleAutoLeading}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
          >
            Auto
          </button>
        </div>
      </div>

      {/*
       * Tracking is 1/1000 em of the current type size and Adobe's field runs -1000..1000, so
       * the readout is in the unit Adobe uses and the bar's own value is not scaled on the way
       * out — `trackingPx` in `src/tools/text.ts` is the one place that converts it to px.
       */}
      <div className="flex flex-col">
        <label htmlFor="tracking-slider" className="text-[10px] font-medium text-gray-700 dark:text-gray-300 mb-2">
          Tracking
        </label>
        <div className="flex items-center gap-2">
          <input
            id="tracking-slider"
            data-testid="tracking-slider"
            type="range"
            min={TRACKING_MIN}
            max={TRACKING_MAX}
            step={1}
            value={style.tracking}
            onChange={handleTrackingChange}
            className="h-1.5 w-40 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span
            data-testid="tracking-readout"
            aria-hidden="true"
            className="text-xs font-mono font-bold text-gray-900 dark:text-gray-200 min-w-[3rem] text-right"
          >
            {style.tracking}
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-2" aria-hidden="true" />

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
            disabled={!alignmentEnabled}
            aria-describedby={!alignmentEnabled ? 'align-help' : undefined}
            className="rounded border border-gray-300 bg-white px-1 h-9 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        {!alignmentEnabled && (
          <span id="align-help" className="sr-only">
            Alignment is available for paragraph text only
          </span>
        )}
      </div>

      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-2" aria-hidden="true" />

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

      <div className="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-2" aria-hidden="true" />

      {editing && (
        <div className="flex gap-2 ml-2">
          {/*
           * `Commit` and `Cancel`, in that order and both only in edit mode.
           *
           * `Cancel` is a discard, which is what Adobe's is: "To cancel the changes, click the Cancel
           * button in the options bar" (https://helpx.adobe.com/photoshop/using/editing-text.html).
           * Neither is `disabled` while a draft is open, because `editing` already means a draft is
           * open — the `disabled={!text || !rect}` this replaces was the old half-gate, and it was
           * reachable only because the field could be emptied, which it no longer can.
           */}
          <button className={PRIMARY_BUTTON} disabled={!editing || (!text && !canCommitEmptyEdit)} onClick={applyText}>
            Commit
          </button>
          <button className={SECONDARY_BUTTON} disabled={!editing} onClick={clear}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default Text;
