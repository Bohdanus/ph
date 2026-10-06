import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { getActiveRectangularSelection, getSelectionRect } from '../../../util/selection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const RectangularSelection: React.FC<{}> = () => {
  const [{ selections, activeSelectionId }] = useStore();
  const { copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } = useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();

  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = activeRectangleSelection ? getSelectionRect(activeRectangleSelection) : null;
  const hasRect = !!activeRectangleRect;

  const handleCopy = async () => {
    if (!activeRectangleSelection || !activeRectangleRect) return;

    if (!copyActiveSelection(activeRectangleSelection)) {
      console.error('Failed to copy rectangular selection');
    }
  };

  const handlePaste = () => {
    pasteSelectionClipboard();
  };

  const handleClear = () => {
    clearSelections();
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="text-[10px] text-gray-700 dark:text-gray-300">
        Draw a rectangle and copy selected bitmap area.
      </div>
      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!hasRect} onClick={handleCopy}>
          Copy
        </button>
        <button className={PRIMARY_BUTTON} disabled={!hasSelectionClipboard} onClick={handlePaste}>
          Paste
        </button>
        <button className={SECONDARY_BUTTON} disabled={!hasRect} onClick={handleClear}>
          Deselect
        </button>
      </div>
    </div>
  );
};

export default RectangularSelection;
