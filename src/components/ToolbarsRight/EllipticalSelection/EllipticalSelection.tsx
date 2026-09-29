import React, { type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import {
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
  isMarqueeStyle,
} from '../../../tools/ellipticalSelection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const NUMBER_CLASS =
  'h-7 w-24 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const HINT_CLASS =
  'min-w-60 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300';

/**
 * The elliptical marquee's options bar.
 *
 * Which fields exist is the Style dropdown's own doing: `normal` exposes nothing to set,
 * `fixed-ratio` exposes the Ratio the drag is locked to, `fixed-size` exposes the two
 * extents the click is locked to. That is the bar Photoshop shows, and it is why the
 * three numeric fields are not merely disabled outside their style — rendering them
 * greyed out would claim a control the tool is not reading.
 *
 * Feather, Anti-alias and Refine Edge are absent because `EllipticalSelectionToolArgs`
 * has no field to carry them, and a control that writes nowhere is worse than a missing
 * one.
 */
const EllipticalSelection: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();

  const args = getToolArgs('elliptical-selection');
  if (!args) return null;

  const handleStyleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const style = event.target.value;
    if (!isMarqueeStyle(style)) return;

    patchToolArgs('elliptical-selection', { style });
  };

  // A half-typed number reaches here as `0` or `''`, and a locked ratio of zero is not a
  // constraint at all — `resolveEllipseRect` would silently fall back to a free drag while
  // the field claims a ratio, so an incomplete value is not written.
  const handleRatioChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fixedRatio = Number(event.target.value);
    if (!Number.isFinite(fixedRatio) || fixedRatio <= 0) return;

    patchToolArgs('elliptical-selection', { fixedRatio });
  };

  const handleWidthChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fixedWidth = Number(event.target.value);
    if (!Number.isFinite(fixedWidth) || fixedWidth <= 0) return;

    patchToolArgs('elliptical-selection', { fixedWidth });
  };

  const handleHeightChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fixedHeight = Number(event.target.value);
    if (!Number.isFinite(fixedHeight) || fixedHeight <= 0) return;

    patchToolArgs('elliptical-selection', { fixedHeight });
  };

  const handleCopy = () => {
    if (!activeSelection) return;

    copyActiveSelection(activeSelection);
  };

  const hint = (() => {
    if (args.style === 'fixed-size') {
      return `Click to place a ${Math.round(args.fixedWidth)} x ${Math.round(args.fixedHeight)} ellipse.`;
    }
    if (args.style === 'fixed-ratio') {
      return `Drag at ${args.fixedRatio}:1. Hold Shift for a circle, Alt to draw from the centre.`;
    }

    return 'Drag to draw an ellipse. Hold Shift for a circle, Alt to draw from the centre.';
  })();

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label htmlFor="elliptical-selection-style" className={FIELD_CLASS}>
        Style
        <select
          id="elliptical-selection-style"
          className={SELECT_CLASS}
          value={args.style}
          onChange={handleStyleChange}
        >
          {MARQUEE_STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      </label>

      {args.style === 'fixed-ratio' && (
        <label htmlFor="elliptical-selection-ratio" className={FIELD_CLASS}>
          Ratio
          <input
            id="elliptical-selection-ratio"
            className={NUMBER_CLASS}
            max={MARQUEE_RATIO_MAX}
            min={MARQUEE_RATIO_MIN}
            step={MARQUEE_RATIO_STEP}
            type="number"
            value={args.fixedRatio}
            onChange={handleRatioChange}
          />
        </label>
      )}

      {args.style === 'fixed-size' && (
        <>
          <label htmlFor="elliptical-selection-width" className={FIELD_CLASS}>
            Width
            <input
              id="elliptical-selection-width"
              className={NUMBER_CLASS}
              max={MARQUEE_SIZE_MAX}
              min={MARQUEE_SIZE_MIN}
              step={MARQUEE_SIZE_STEP}
              type="number"
              value={args.fixedWidth}
              onChange={handleWidthChange}
            />
          </label>

          <label htmlFor="elliptical-selection-height" className={FIELD_CLASS}>
            Height
            <input
              id="elliptical-selection-height"
              className={NUMBER_CLASS}
              max={MARQUEE_SIZE_MAX}
              min={MARQUEE_SIZE_MIN}
              step={MARQUEE_SIZE_STEP}
              type="number"
              value={args.fixedHeight}
              onChange={handleHeightChange}
            />
          </label>
        </>
      )}

      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!activeSelection} onClick={handleCopy}>
          Copy
        </button>
        <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={pasteSelectionClipboard}>
          Paste
        </button>
        <button className={SECONDARY_BUTTON} disabled={!activeSelection} onClick={clearSelections}>
          Clear
        </button>
      </div>

      <div className={HINT_CLASS}>{hint}</div>
    </div>
  );
};

export default EllipticalSelection;
