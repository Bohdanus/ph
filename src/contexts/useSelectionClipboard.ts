import type { Selection } from './general-types.ts';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { cloneBitmapToCanvas, copySelectionToCanvas, getActiveSelection } from '../util/selection.ts';

const SELECTION_LAYER_NAME = 'Selection copy';

export const useSelectionClipboard = () => {
  const [{ activeSelectionId, canvasRef, selectionClipboard, selections, totalSize }, dispatch] = useStore();
  const { createLayerFromBitmap } = useLayers();

  const activeSelection = getActiveSelection(selections, activeSelectionId);

  function copySelection(selection: Selection | null | undefined = activeSelection): boolean {
    if (!selection) return false;

    const snapshot = copySelectionToCanvas(canvasRef.current, selection, totalSize);
    if (!snapshot) return false;

    dispatch({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: {
        bitmap: snapshot.bitmap,
        copiedAt: Date.now(),
        name: SELECTION_LAYER_NAME,
        pos: snapshot.pos,
        sourceSelectionId: selection.id,
        sourceTool: selection.sourceTool,
      },
    });
    dispatch({ type: 'MARK_SELECTION_COPIED', payload: { id: selection.id } });

    return true;
  }

  function pasteSelectionClipboard(): boolean {
    if (!selectionClipboard) return false;

    createLayerFromBitmap({
      bitmap: cloneBitmapToCanvas(selectionClipboard.bitmap),
      name: selectionClipboard.name,
      pos: { ...selectionClipboard.pos },
    });

    return true;
  }

  return {
    activeSelection,
    copyActiveSelection: copySelection,
    hasActiveSelection: !!activeSelection,
    hasSelectionClipboard: !!selectionClipboard,
    pasteSelectionClipboard,
    selectionClipboard,
  };
};
