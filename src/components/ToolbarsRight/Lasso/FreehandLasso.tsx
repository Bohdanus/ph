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
  const hasActivePolygonSelection = !!activeSelection && activeSelection.geometry !== 'rectangle';

  const handleFillToggle = () => {
    patchToolArgs('freehand-lasso', { fill: !isFill });
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

  const handleDeselect = () => {
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
        <button className={SECONDARY_BUTTON} disabled={!hasActivePolygonSelection} onClick={handleDeselect}>
          Deselect
        </button>
      </div>

      <div className="text-[10px] text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 max-w-xs">
        <div>Click and drag to draw • Release to finish</div>
        <div className="text-[9px] mt-1 opacity-75">Drag around the object; the path closes automatically.</div>
      </div>
    </div>
  );
};

export default FreehandLasso;
