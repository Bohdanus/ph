import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { getActiveRectangularSelection, getSelectionRect } from '../../../util/selection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const RectangularSelection: React.FC<{}> = () => {
  const [{ selections, activeSelectionId }, dispatch] = useStore();
  const { copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } = useSelectionClipboard();

  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = activeRectangleSelection ? getSelectionRect(activeRectangleSelection) : null;
  const hasRect = !!activeRectangleRect;

  const handleCopy = async () => {
    if (!activeRectangleSelection || !activeRectangleRect) return;

    copyActiveSelection(activeRectangleSelection);
  };

  const handlePaste = () => {
    pasteSelectionClipboard();
  };

  const handleClear = () => {
    dispatch({ type: 'CLEAR_SELECTIONS' });
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
          Clear
        </button>
      </div>
    </div>
  );
};

export default RectangularSelection;
