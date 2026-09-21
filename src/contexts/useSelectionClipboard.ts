import type { Selection } from './general-types.ts';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { cloneBitmapToCanvas, copySelectionToCanvas, getActiveSelection } from '../util/selection.ts';

const SELECTION_LAYER_NAME = 'Selection copy';

const getNextLayerName = (layers: Array<{ name: string }> | undefined) => {
  const items = layers ?? [];
  const usedNumbers = items
    .map((layer) => layer.name)
    .map((name) => {
      const match = /^Layer (\d+)$/.exec(name);
      return match ? Number(match[1]) : null;
    })
    .filter((value): value is number => value !== null);

  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  return `Layer ${nextNumber}`;
};

export const useSelectionClipboard = () => {
  const [{ activeSelectionId, canvasRef, layers = [], selectionClipboard, selections, totalSize }, dispatch] =
    useStore();
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

    const width = selectionClipboard.pos.width || selectionClipboard.bitmap.width;
    const height = selectionClipboard.pos.height || selectionClipboard.bitmap.height;
    const centerPos = {
      x: Math.max(0, Math.round((totalSize.width - width) / 2)),
      y: Math.max(0, Math.round((totalSize.height - height) / 2)),
      width,
      height,
    };

    createLayerFromBitmap({
      bitmap: cloneBitmapToCanvas(selectionClipboard.bitmap),
      name: getNextLayerName(Object.values(layers)),
      pos: centerPos,
    });

    return true;
  }

  function layerViaCopy(): boolean {
    if (!activeSelection) return false;

    const snapshot = copySelectionToCanvas(canvasRef.current, activeSelection, totalSize);
    if (!snapshot) return false;

    createLayerFromBitmap({
      bitmap: cloneBitmapToCanvas(snapshot.bitmap),
      name: getNextLayerName(Object.values(layers)),
      pos: { ...snapshot.pos },
    });

    return true;
  }

  return {
    activeSelection,
    copyActiveSelection: copySelection,
    hasActiveSelection: !!activeSelection,
    hasSelectionClipboard: !!selectionClipboard,
    layerViaCopy,
    pasteSelectionClipboard,
    selectionClipboard,
  };
};
