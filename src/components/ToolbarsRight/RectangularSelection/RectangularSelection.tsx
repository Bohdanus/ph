import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { copyRectToClipboard } from '../../../util/clipboard.ts';
import { getActiveRectangularSelection, getSelectionRect } from '../../../util/selection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const RectangularSelection: React.FC<{}> = () => {
  const [{ canvasRef, totalSize, selections, activeSelectionId }, dispatch] = useStore();

  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = activeRectangleSelection ? getSelectionRect(activeRectangleSelection) : null;
  const hasRect = !!activeRectangleRect;

  const handleCopy = async () => {
    if (!activeRectangleSelection || !activeRectangleRect) return;

    const didCopy = await copyRectToClipboard({
      sourceCanvas: canvasRef.current,
      rect: activeRectangleRect,
      imageSize: totalSize,
    });

    if (didCopy) {
      dispatch({ type: 'MARK_SELECTION_COPIED', payload: { id: activeRectangleSelection.id } });
    }
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
        <button className={SECONDARY_BUTTON} disabled={!hasRect} onClick={handleClear}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default RectangularSelection;
