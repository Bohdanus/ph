import React, { type ChangeEvent, useState } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';

const MagicWand: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();
  const [isCopying, setIsCopying] = useState(false);

  const args = getToolArgs('magic-wand');
  if (!args) return null;

  const hasActivePolygonSelection = !!activeSelection && activeSelection.geometry !== 'rectangle';
  const selectedPixelCount = activeSelection?.metadata?.magicWand?.selectedPixelCount;

  const handleToleranceChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('magic-wand', { tolerance: Number(event.target.value) });
  };

  const handleSmoothingChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('magic-wand', { smoothing: Number(event.target.value) });
  };

  const handleContiguousChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('magic-wand', { contiguous: event.target.checked });
  };

  const handleCopySelection = async () => {
    if (!activeSelection || activeSelection.geometry === 'rectangle') return;

    try {
      setIsCopying(true);
      if (!copyActiveSelection(activeSelection)) {
        console.error('Failed to copy magic wand selection');
      }
    } catch (error) {
      console.error('Error copying magic wand selection:', error);
    } finally {
      setIsCopying(false);
    }
  };

  const handlePasteSelection = () => {
    pasteSelectionClipboard();
  };

  const handleClear = () => {
    clearSelections();
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <label
        htmlFor="magic-wand-tolerance"
        className="flex min-w-32 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Tolerance <span className="font-bold text-gray-900 dark:text-gray-200">{args.tolerance}%</span>
        <input
          id="magic-wand-tolerance"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={args.tolerance}
          onChange={handleToleranceChange}
        />
      </label>

      <label className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-gray-700 dark:text-gray-300">
        <input checked={args.contiguous} type="checkbox" onChange={handleContiguousChange} />
        Contiguous
      </label>

      <label
        htmlFor="magic-wand-smoothing"
        className="flex min-w-32 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Smooth <span className="font-bold text-gray-900 dark:text-gray-200">{args.smoothing}px</span>
        <input
          id="magic-wand-smoothing"
          className={SLIDER_CLASS}
          max="8"
          min="0"
          step="0.5"
          type="range"
          value={args.smoothing}
          onChange={handleSmoothingChange}
        />
      </label>

      <div className="flex gap-2">
        <button
          className={PRIMARY_BUTTON}
          disabled={!hasActivePolygonSelection || isCopying}
          onClick={handleCopySelection}
        >
          {isCopying ? 'Copying...' : 'Copy'}
        </button>
        <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={handlePasteSelection}>
          Paste
        </button>
        <button className={SECONDARY_BUTTON} disabled={!hasActivePolygonSelection} onClick={handleClear}>
          Deselect
        </button>
      </div>

      <div className="min-w-60 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        <div>Click a color area to select connected similar pixels.</div>
        <div className="mt-1 text-[9px] opacity-75">
          {selectedPixelCount
            ? `${selectedPixelCount.toLocaleString()} pixels selected`
            : 'Increase tolerance for broader regions.'}
        </div>
      </div>
    </div>
  );
};

export default MagicWand;
