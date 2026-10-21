import React, { type ChangeEvent } from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { getActiveRectangularSelection, getSelectionRect } from '../../../util/selection.ts';
import {
  MARQUEE_RATIO_MAX,
  MARQUEE_RATIO_MIN,
  MARQUEE_RATIO_STEP,
  MARQUEE_SIZE_MAX,
  MARQUEE_SIZE_MIN,
  MARQUEE_SIZE_STEP,
  MARQUEE_STYLES,
  isMarqueeStyle,
} from '../../../tools/rectangularSelection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const NUMBER_CLASS =
  'h-7 w-24 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';
const HINT_CLASS =
  'min-w-60 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300';

const RectangularSelection: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const [{ selections, activeSelectionId }] = useStore();
  const { copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } = useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();
  const args = getToolArgs('rectangular-selection');
  const activeSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRect = activeSelection ? getSelectionRect(activeSelection) : null;

  if (!args) return null;

  const style = args.style ?? 'normal';
  const fixedRatio = args.fixedRatio ?? 1;
  const fixedWidth = args.fixedWidth ?? 100;
  const fixedHeight = args.fixedHeight ?? 100;

  const handleStyleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextStyle = event.target.value;
    if (isMarqueeStyle(nextStyle)) patchToolArgs('rectangular-selection', { style: nextStyle });
  };

  const handleNumberChange = (key: 'fixedRatio' | 'fixedWidth' | 'fixedHeight', value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) return;
    patchToolArgs('rectangular-selection', { [key]: next });
  };

  const handleCopy = () => {
    if (activeSelection && activeRect && !copyActiveSelection(activeSelection)) {
      console.error('Failed to copy rectangular selection');
    }
  };

  const hint =
    style === 'fixed-size'
      ? `Click to place a ${Math.round(fixedWidth)} x ${Math.round(fixedHeight)} rectangle.`
      : style === 'fixed-ratio'
        ? `Drag at ${fixedRatio}:1. Hold Shift for a square, Alt to draw from the centre.`
        : 'Drag to draw a rectangle. Hold Shift for a square, Alt to draw from the centre.';

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label htmlFor="rectangular-selection-style" className={FIELD_CLASS}>
        Style
        <select id="rectangular-selection-style" className={SELECT_CLASS} value={style} onChange={handleStyleChange}>
          {MARQUEE_STYLES.map((marqueeStyle) => (
            <option key={marqueeStyle.value} value={marqueeStyle.value}>
              {marqueeStyle.label}
            </option>
          ))}
        </select>
      </label>

      {style === 'fixed-ratio' && (
        <label htmlFor="rectangular-selection-ratio" className={FIELD_CLASS}>
          Ratio
          <input
            id="rectangular-selection-ratio"
            className={NUMBER_CLASS}
            max={MARQUEE_RATIO_MAX}
            min={MARQUEE_RATIO_MIN}
            step={MARQUEE_RATIO_STEP}
            type="number"
            value={fixedRatio}
            onChange={(event) => handleNumberChange('fixedRatio', event.target.value)}
          />
        </label>
      )}

      {style === 'fixed-size' && (
        <>
          <label htmlFor="rectangular-selection-width" className={FIELD_CLASS}>
            Width
            <input
              id="rectangular-selection-width"
              className={NUMBER_CLASS}
              max={MARQUEE_SIZE_MAX}
              min={MARQUEE_SIZE_MIN}
              step={MARQUEE_SIZE_STEP}
              type="number"
              value={fixedWidth}
              onChange={(event) => handleNumberChange('fixedWidth', event.target.value)}
            />
          </label>
          <label htmlFor="rectangular-selection-height" className={FIELD_CLASS}>
            Height
            <input
              id="rectangular-selection-height"
              className={NUMBER_CLASS}
              max={MARQUEE_SIZE_MAX}
              min={MARQUEE_SIZE_MIN}
              step={MARQUEE_SIZE_STEP}
              type="number"
              value={fixedHeight}
              onChange={(event) => handleNumberChange('fixedHeight', event.target.value)}
            />
          </label>
        </>
      )}

      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!activeRect} onClick={handleCopy}>
          Copy
        </button>
        <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={pasteSelectionClipboard}>
          Paste
        </button>
        <button className={SECONDARY_BUTTON} disabled={!activeRect} onClick={clearSelections}>
          Deselect
        </button>
      </div>
      <div className={HINT_CLASS}>{hint}</div>
    </div>
  );
};

export default RectangularSelection;
