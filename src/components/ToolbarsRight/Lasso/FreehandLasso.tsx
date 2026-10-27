import React, { useState } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const FreehandLasso: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();
  const { activeSelection, copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } =
    useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();
  const [isCopying, setIsCopying] = useState(false);

  const args = getToolArgs('freehand-lasso');
  if (!args) return null;

  const isFill = args.fill;
  const lineWidth = args.lineWidth ?? 3;
  const alpha = args.alpha ?? 1;
  const featherRadius = args.featherRadius ?? 0;
  const antiAlias = args.antiAlias ?? true;
  const hasActivePolygonSelection = !!activeSelection && activeSelection.geometry !== 'rectangle';

  const handleFillToggle = () => {
    patchToolArgs('freehand-lasso', { fill: !isFill });
  };

  const handleNumberChange = (key: 'lineWidth' | 'alpha' | 'featherRadius', value: number) => {
    patchToolArgs('freehand-lasso', { [key]: value });
  };

  const handleCopySelection = async () => {
    if (!activeSelection || activeSelection.geometry === 'rectangle') return;

    try {
      setIsCopying(true);
      if (!copyActiveSelection(activeSelection)) {
        console.error('Failed to copy freehand lasso selection');
      }
    } catch (error) {
      console.error('Error copying freehand lasso selection:', error);
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
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mode</span>
        <button
          onClick={handleFillToggle}
          className={`px-3 py-1 rounded border text-sm transition-colors ${
            isFill
              ? 'bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-700'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600'
          }`}
        >
          {isFill ? 'Fill' : 'Outline'}
        </button>
      </div>

      <label
        htmlFor="freehand-lasso-size"
        className="flex flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Size <span>{lineWidth}px</span>
        <input
          id="freehand-lasso-size"
          type="range"
          min="1"
          max="100"
          value={lineWidth}
          onChange={(event) => handleNumberChange('lineWidth', Number(event.target.value))}
        />
      </label>

      <label
        htmlFor="freehand-lasso-opacity"
        className="flex flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Opacity <span>{Math.round(alpha * 100)}%</span>
        <input
          id="freehand-lasso-opacity"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={(event) => handleNumberChange('alpha', Number(event.target.value))}
        />
      </label>

      <label
        htmlFor="freehand-lasso-feather"
        className="flex flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        Feather <span>{featherRadius}px</span>
        <input
          id="freehand-lasso-feather"
          type="range"
          min="0"
          max="250"
          value={featherRadius}
          onChange={(event) => handleNumberChange('featherRadius', Number(event.target.value))}
        />
      </label>

      <label
        htmlFor="freehand-lasso-antialias"
        className="flex items-center gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
      >
        <input
          id="freehand-lasso-antialias"
          type="checkbox"
          checked={antiAlias}
          onChange={(event) => patchToolArgs('freehand-lasso', { antiAlias: event.target.checked })}
        />
        Anti-alias
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

      <div className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 max-w-xs">
        <div>Click and drag to draw • Release to finish</div>
        <div className="text-[9px] mt-1 opacity-75">Backspace removes anchor • Enter finishes • Esc cancels</div>
        <div className="text-[9px] mt-1 opacity-75">Drag around the object; the path closes automatically.</div>
      </div>
    </div>
  );
};

export default FreehandLasso;
