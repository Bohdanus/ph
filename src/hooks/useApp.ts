import type { BitmapSource, Size } from '../contexts/general-types.ts';
import { useStore, type StoreMetadataUpdates } from '../contexts/StoreContext.tsx';
import type { Layer, LayersRecord } from '../contexts/layer-types.ts';
import type { NewDocumentBlankParams, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';
import { v4 as uuidv4 } from 'uuid';
import { OPEN_DOCUMENT_ACTION } from '../util/constants.ts';
import { resizeCanvas } from '../util/canvas.ts';
import { assertWithinDocumentPixelBudget } from '../contexts/raster-utils.ts';
import { setRefValue } from '../util/ref.ts';
import { createHistoryItem } from '../contexts/history-utils.ts';
import { documentFrameFromSize } from '../contexts/document-frame.ts';
import { appendSelectionClear } from '../contexts/useSelectionHistory.ts';
import { isDocumentGestureOpen } from './document-gesture.ts';

export interface UseAppType {
  setBlankImage: (data: NewDocumentBlankParams) => void;
  setImageFromUpload: (data: ImageUploadResponse) => Promise<void>;

  handleImageSave: (data: ImageSaveResponse) => void;

  goToTool: (toolName: ToolName) => boolean;
}

async function immutableRaster(bitmap: BitmapSource): Promise<BitmapSource> {
  if (typeof (bitmap as { close?: unknown }).close === 'function') return bitmap;
  if (!globalThis.createImageBitmap) {
    throw new Error('createImageBitmap is required to import a mutable raster source');
  }
  return globalThis.createImageBitmap(bitmap as CanvasImageSource);
}

/**
 * Custom hook for accessing and managing application-level state and utilities.

  BASIC UI OPERATIONS

 */
export const useApp = (): UseAppType => {
  const [
    {
      canvasRef,
      currentArgs: currentArgsRef,
      toolOverlayRef,
      rectOverlayRef,
      toolName,
      activeSelectionId,
      selections,
      selectionCleared,
      totalSize,
      documentFrame: currentFrame,
      history,
      historyIndex,
      branchRevision = 0,
      clearPreviewLayers,
      adoptLayerBitmaps,
    },
    dispatch,
  ] = useStore();
  const { createBlankLayer, createLayerFromBitmap, commitDirtyTool } = useLayers();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);

  function handleImageCreate(size: Size) {
    if (canvasRef.current) {
      resizeCanvas(canvasRef.current, size.width, size.height);
    }
  }

  function handleImageSave({ fileName }: ImageSaveResponse) {
    // Save state is the only thing a batch is allowed to carry.
    const metadata: StoreMetadataUpdates = { fileName, hasUnsavedChanges: false };
    dispatch({ type: 'BATCH_UPDATES', payload: metadata });
  }

  function _setFileName(fileName: string) {
    dispatch({ type: 'SET_FILE_NAME', payload: fileName });
  }

  function setBlankImage(params: NewDocumentBlankParams) {
    assertWithinDocumentPixelBudget(params.size, 'Document');
    handleImageCreate(params.size);
    createBlankLayer({ ...params }, true);
  }

  async function setImageFromUpload(data: ImageUploadResponse) {
    const { fileName } = data;
    if ('document' in data) {
      const { size, layers, warnings } = data.document;
      if (warnings.length && !window.confirm(`PSD import limitations:\n\n${warnings.join('\n')}\n\nOpen anyway?`))
        return;
      const immutableLayers = Object.fromEntries(
        await Promise.all(
          Object.entries(layers).map(async ([id, layer]): Promise<[string, Layer]> => {
            if (layer.source?.kind !== 'image') return [id, layer];
            const bitmap = await immutableRaster(layer.source.bitmap);
            return [
              id,
              {
                ...layer,
                bitmap,
                tmpCanvas: null,
                source: { ...layer.source, bitmap },
              },
            ];
          })
        )
      ) as LayersRecord;
      const activeLayerId = Object.values(immutableLayers).sort((a, b) => b.order - a.order)[0]?.id ?? null;
      const baseline = Object.fromEntries(
        Object.values(immutableLayers).map((layer) => [layer.id, { ...layer, pos: { ...layer.pos } }])
      );
      setRefValue(currentArgsRef, {} as typeof currentArgsRef.current);
      clearPreviewLayers?.();
      for (const ref of [canvasRef, toolOverlayRef, rectOverlayRef]) {
        if (ref.current) {
          resizeCanvas(ref.current, size.width, size.height);
        }
      }
      dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: uuidv4(),
          history: [
            createHistoryItem({
              actionName: OPEN_DOCUMENT_ACTION,
              layerId: activeLayerId ?? '',
              documentSource: { layers: baseline, size: { ...size }, frame: documentFrameFromSize(size) },
            }),
          ],
          updates: {
            fileName,
            totalSize: size,
            documentFrame: documentFrameFromSize(size),
            layers: immutableLayers,
            activeLayerId,
            deletedLayers: {},
            hasImage: true,
            hasUnsavedChanges: false,
            toolName: 'reposition',
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: null,
            selectionClipboard: null,
          },
        },
      });
      // Every raster this import produced is adopted into the store's presentation
      // scope, exactly as `useLayers().createLayerFromBitmap` does for a single-image
      // import. Called AFTER `REPLACE_DOCUMENT`: the scope is keyed by the owning
      // document, so a registration published before the replacement would be filed
      // under the outgoing document id and closed by its release.
      adoptLayerBitmaps(
        Object.values(immutableLayers)
          .map((layer) => (layer.source?.kind === 'image' ? layer.source.bitmap : null))
          .filter((bitmap): bitmap is BitmapSource => bitmap !== null)
      );
      return;
    }
    const { image } = data;
    const size = { width: image.width, height: image.height };
    await createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true }, true);
    handleImageCreate(size);
    _setFileName(fileName);
  }

  function goToTool(nextToolName: ToolName) {
    const hasOpenDocumentGesture = isDocumentGestureOpen();
    // A live document gesture can have only a transient preview: its owner owns
    // whether that preview commits or rolls back. Committing here runs before
    // the outgoing tool unmounts and would turn a partial stroke into history.
    // Let the owner unmount and cancel it; ordinary dirty edits still commit
    // before the switch.
    if (!hasOpenDocumentGesture && commitDirtyTool() === null) return false;

    // Clearing a selection is itself a document edit, so do not interleave it
    // with a gesture that has not yet been cancelled by its owning tool.
    if (!hasOpenDocumentGesture && nextToolName !== toolName && nextToolName !== 'patch' && activeSelectionId) {
      // The same single writer the Clear/Deselect controls use, so this deselect
      // gains the durable `set-selection` plan and the shadow-failure fallback
      // instead of appending a hand-built entry with no `durableEntry` — which
      // left the store reconverting the whole timeline on every tool switch.
      // `appendSelectionClear` rather than `useSelectionHistory`'s
      // `clearSelections`, because `goToTool` runs from a click handler and a
      // keyboard shortcut through a plain function, and that hook's
      // `useCallback` throws outside a component render.
      //
      // The predicate above is deliberately unchanged: a switch to the tool
      // already active, or a switch with no active selection, still appends
      // nothing and still leaves the document clean.
      appendSelectionClear({
        selections,
        activeSelectionId,
        selectionCleared,
        history,
        historyIndex,
        branchRevision,
        documentFrame,
        dispatch,
      });
    }

    dispatch({ type: 'SET_TOOL_NAME', payload: nextToolName });
    return true;
  }

  return {
    setBlankImage,
    setImageFromUpload,
    handleImageSave,

    goToTool,
  };
};
