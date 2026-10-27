import type { Selection } from './general-types.ts';
import { useStore } from './StoreContext.tsx';
import { useLayers } from './useLayer.ts';
import { cloneBitmapToCanvas, copySelectionToCanvas, getActiveSelection } from '../util/selection.ts';
import {
  canvasToDocumentPos,
  documentFrameFromSize,
  documentFrameSize,
  documentToCanvasPos,
} from './document-frame.ts';
import { assertWithinDocumentPixelBudget } from './raster-utils.ts';
import { loadDocumentFile } from './image-load-save-utils.ts';
import { preflightBmpFile } from './bmp-utils.ts';
import { readImageFromClipboard } from '../util/clipboard.ts';

const SELECTION_LAYER_NAME = 'Selection copy';
const BMP_CLIPBOARD_MIME_TYPES = new Set(['image/bmp', 'image/x-bmp', 'image/x-ms-bmp']);
// Clipboard decoding only accepts formats with bounded file-import preflights.
// AVIF and TIFF stay out until their decoders can enforce this budget before allocating pixels.
const PREFLIGHTED_CLIPBOARD_MIME_TYPES = new Set([
  'image/bmp',
  'image/gif',
  'image/ico',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/vnd.microsoft.icon',
  'image/x-bmp',
  'image/x-icon',
  'image/x-ms-bmp',
]);

async function decodePreflightedClipboardImage(blob: Blob, mimeType: string): Promise<ImageBitmap> {
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  if (!PREFLIGHTED_CLIPBOARD_MIME_TYPES.has(normalizedMimeType)) {
    throw new Error(`Clipboard image format cannot be safely preflighted (${normalizedMimeType})`);
  }

  const createBitmap = globalThis.createImageBitmap;
  if (!createBitmap) throw new Error('ImageBitmap decoding is unavailable');

  if (BMP_CLIPBOARD_MIME_TYPES.has(normalizedMimeType)) {
    return createBitmap(await preflightBmpFile(blob, { allowNativeCompression: true }));
  }

  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (signature.length === 4 && new DataView(signature.buffer).getUint32(0, false) === 0x38425053) {
    throw new Error('Photoshop documents cannot be pasted as a single raster image');
  }

  const file = new File([blob], 'clipboard-image', { type: normalizedMimeType });
  const decoded = await loadDocumentFile(file);
  if (!('image' in decoded)) throw new Error('Clipboard content is not a single raster image');

  assertWithinDocumentPixelBudget(
    {
      width: decoded.image.naturalWidth || decoded.image.width,
      height: decoded.image.naturalHeight || decoded.image.height,
    },
    'Clipboard image'
  );
  return createBitmap(decoded.image);
}

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

  function copySelectionSnapshot(selection: Selection) {
    const sourceCanvas = canvasRef.current;
    const imageSize = documentFrameSize(documentFrame);
    const backingScale = Number(sourceCanvas?.getAttribute('data-hidpi-ratio'));
    const sourceScale = {
      x:
        Number.isFinite(backingScale) && backingScale > 0
          ? backingScale
          : sourceCanvas
            ? sourceCanvas.width / imageSize.width
            : 1,
      y:
        Number.isFinite(backingScale) && backingScale > 0
          ? backingScale
          : sourceCanvas
            ? sourceCanvas.height / imageSize.height
            : 1,
    };
    const canvasSelection = { ...selection, pos: documentToCanvasPos(selection.pos, documentFrame) };
    return copySelectionToCanvas(sourceCanvas, canvasSelection, imageSize, sourceScale);
  }

  function copySelection(selection: Selection | null | undefined = activeSelection): boolean {
    if (!selection) return false;

    const snapshot = copySelectionSnapshot(selection);
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
      const created = await createLayerFromBitmap({
        bitmap: cloneBitmapToCanvas(selectionClipboard.bitmap),
        name: getNextLayerName(Object.values(layers)),
        pos: centerPos,
      });
      if (!created) return false;
    } catch (error) {
      console.error('Unable to paste selection clipboard', error);
      return false;
    }

    return true;
  }

  async function pasteSystemClipboardImage(): Promise<boolean> {
    const image = await readImageFromClipboard({ decodeImage: decodePreflightedClipboardImage });
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
      const created = await createLayerFromBitmap({ bitmap, name: getNextLayerName(Object.values(layers)), pos });
      if (!created) {
        bitmap.close();
        return false;
      }
    } catch (error) {
      image.bitmap.close();
      console.error('Unable to paste system clipboard image', error);
      return false;
    }

    return true;
  }

  async function layerViaCopy(): Promise<boolean> {
    if (!activeSelection) return false;

    const snapshot = copySelectionSnapshot(activeSelection);
    if (!snapshot) return false;

    try {
      const created = await createLayerFromBitmap({
        bitmap: cloneBitmapToCanvas(snapshot.bitmap),
        name: getNextLayerName(Object.values(layers)),
        pos: canvasToDocumentPos(snapshot.pos, documentFrame),
      });
      if (!created) return false;
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
