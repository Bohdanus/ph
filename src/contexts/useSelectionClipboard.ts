import type { Selection } from './general-types.ts';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { cloneBitmapToCanvas, copySelectionToCanvas, getActiveSelection } from '../util/selection.ts';
import { canvasToDocumentPos, documentFrameFromSize, documentToCanvasPos } from './document-frame.ts';
import { assertWithinDocumentPixelBudget } from './raster-utils.ts';
import { readImageFromClipboard } from '../util/clipboard.ts';

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
  const [
    {
      activeSelectionId,
      canvasRef,
      layers = {},
      selectionClipboard,
      selections,
      totalSize,
      documentFrame: currentFrame,
    },
    dispatch,
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { createLayerFromBitmap } = useLayers();

  const activeSelection = getActiveSelection(selections, activeSelectionId);

  function copySelection(selection: Selection | null | undefined = activeSelection): boolean {
    if (!selection) return false;

    const canvasSelection = { ...selection, pos: documentToCanvasPos(selection.pos, documentFrame) };
    const canvasSize = canvasRef.current
      ? { width: canvasRef.current.width, height: canvasRef.current.height }
      : totalSize;
    const snapshot = copySelectionToCanvas(canvasRef.current, canvasSelection, canvasSize);
    if (!snapshot) return false;

    dispatch({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: {
        bitmap: snapshot.bitmap,
        copiedAt: Date.now(),
        name: SELECTION_LAYER_NAME,
        pos: canvasToDocumentPos(snapshot.pos, documentFrame),
        sourceSelectionId: selection.id,
        sourceTool: selection.sourceTool,
      },
    });
    dispatch({ type: 'MARK_SELECTION_COPIED', payload: { id: selection.id } });

    return true;
  }

  async function pasteSelectionClipboard(): Promise<boolean> {
    if (!selectionClipboard) return false;

    try {
      const width = selectionClipboard.pos.width || selectionClipboard.bitmap.width;
      const height = selectionClipboard.pos.height || selectionClipboard.bitmap.height;
      assertWithinDocumentPixelBudget({ width, height }, 'Clipboard image');
      // `createLayerFromBitmap` reaches `createLayerSource` with a non-bedrock source, which
      // copies `pos` onto the layer verbatim — so `pos` is DOCUMENT space and the centre must
      // be computed there. Adding the frame origin here would offset the layer twice, since
      // the renderer already translates document space onto the frame.
      const centerPos = {
        x: Math.max(0, Math.round((totalSize.width - width) / 2)),
        y: Math.max(0, Math.round((totalSize.height - height) / 2)),
        width,
        height,
      };
      await createLayerFromBitmap({
        bitmap: cloneBitmapToCanvas(selectionClipboard.bitmap),
        name: getNextLayerName(Object.values(layers)),
        pos: centerPos,
      });
    } catch (error) {
      console.error('Unable to paste selection clipboard', error);
      return false;
    }

    return true;
  }

  async function pasteSystemClipboardImage(): Promise<boolean> {
    const image = await readImageFromClipboard();
    if (!image) return false;

    try {
      const { bitmap } = image;
      assertWithinDocumentPixelBudget({ width: bitmap.width, height: bitmap.height }, 'Clipboard image');
      const pos = {
        x: Math.max(0, Math.round((totalSize.width - bitmap.width) / 2)),
        y: Math.max(0, Math.round((totalSize.height - bitmap.height) / 2)),
        width: bitmap.width,
        height: bitmap.height,
      };
      await createLayerFromBitmap({ bitmap, name: getNextLayerName(Object.values(layers)), pos });
    } catch (error) {
      image.bitmap.close();
      console.error('Unable to paste system clipboard image', error);
      return false;
    }

    return true;
  }

  async function layerViaCopy(): Promise<boolean> {
    if (!activeSelection) return false;

    const canvasSelection = { ...activeSelection, pos: documentToCanvasPos(activeSelection.pos, documentFrame) };
    const canvasSize = canvasRef.current
      ? { width: canvasRef.current.width, height: canvasRef.current.height }
      : totalSize;
    const snapshot = copySelectionToCanvas(canvasRef.current, canvasSelection, canvasSize);
    if (!snapshot) return false;

    try {
      await createLayerFromBitmap({
        bitmap: cloneBitmapToCanvas(snapshot.bitmap),
        name: getNextLayerName(Object.values(layers)),
        pos: canvasToDocumentPos(snapshot.pos, documentFrame),
      });
    } catch (error) {
      console.error('Unable to create a layer from the active selection', error);
      return false;
    }

    return true;
  }

  return {
    activeSelection,
    copyActiveSelection: copySelection,
    hasActiveSelection: !!activeSelection,
    hasSelectionClipboard: !!selectionClipboard,
    layerViaCopy,
    pasteSelectionClipboard,
    pasteSystemClipboardImage,
    selectionClipboard,
  };
};
