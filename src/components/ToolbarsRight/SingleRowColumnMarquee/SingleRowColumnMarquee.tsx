import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useSelectionClipboard } from '../../../contexts/useSelectionClipboard.ts';
import { useSelectionHistory } from '../../../contexts/useSelectionHistory.ts';
import { getActiveRectangularSelection, getSelectionRect } from '../../../util/selection.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

/**
 * The bar for BOTH 1-pixel marquees, and why it is one component.
 *
 * They differ in exactly one thing a bar can show: which word the sentence uses. Their
 * Photoshop option sets are identical to each other (Adobe scopes Anti-alias to the
 * Elliptical Marquee by name, and Style, Fixed Ratio and Fixed Size to the Rectangular and
 * Elliptical Marquees by name — `helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`),
 * so a shared bar is a shared control set rather than a merge of two different ones. This is
 * the same arrangement `toolsMap.ts` already uses for `dodge`/`burn`, which share
 * `Tonal.tsx` and read `useStore().toolName` to tell themselves apart.
 *
 * Nothing is declared as a setting here, and that is a claim about Photoshop rather than a
 * shortcut: the bar below is three buttons and a sentence, exactly as
 * `RectangularSelection.tsx` is, because neither marquee bar renders New/Add/Subtract/Intersect,
 * Feather or Select and Mask. Quick Selection has its own Mode dropdown for Add and Subtract, so
 * these omissions are specific to the single-row/column marquee tools, not universal.
 * `docs/TOOLS-INVENTORY.md` and the family notes record the Photoshop controls for these tools.
 */
const SingleRowColumnMarquee: React.FC<{}> = () => {
  const [{ toolName, selections, activeSelectionId }] = useStore();
  const { copyActiveSelection, hasSelectionClipboard, pasteSelectionClipboard } = useSelectionClipboard();
  const { clearSelections } = useSelectionHistory();

  const isColumn = toolName === 'single-column-marquee';
  const noun = isColumn ? 'column' : 'row';

  // The committed selection is a rectangle (`geometry: 'rectangle'`), so the rectangular
  // lookup is the honest one here and not a stand-in: a single row IS a rectangle, one
  // document pixel tall and as wide as the document.
  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = activeRectangleSelection ? getSelectionRect(activeRectangleSelection) : null;
  const hasRect = !!activeRectangleRect;

  const handleCopy = async () => {
    if (!activeRectangleSelection || !activeRectangleRect) return;

    if (!copyActiveSelection(activeRectangleSelection)) {
      console.error(`Failed to copy single ${noun} selection`);
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
        Click to select one {noun}, drag to aim it, or click the {noun} you already made to move it. Then copy the
        selected bitmap line.
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

export default SingleRowColumnMarquee;
