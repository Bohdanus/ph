import type { BitmapSource, Size } from '../contexts/general-types.ts';
import { useStore, type StoreMetadataUpdates } from '../contexts/StoreContext.tsx';
import type { Layer, LayersRecord } from '../contexts/layer-types.ts';
import type { BlankImageParams, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';
import { v4 as uuidv4 } from 'uuid';
import { OPEN_DOCUMENT_ACTION, SELECTION_ACTION } from '../util/constants.ts';
import { resizeCanvas } from '../util/canvas.ts';
import { setRefValue } from '../util/ref.ts';
import { createHistoryItem } from '../contexts/history-utils.ts';
import { documentFrameFromSize } from '../contexts/document-frame.ts';

export interface UseAppType {
  setBlankImage: (data: BlankImageParams) => void;
  setImageFromUpload: (data: ImageUploadResponse) => Promise<void>;

  handleImageSave: (data: ImageSaveResponse) => void;

  goToTool: (toolName: ToolName) => void;
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
      clearPreviewLayers,
    },
    dispatch,
  ] = useStore();
  const { createBlankLayer, createLayerFromBitmap, commitDirtyTool } = useLayers();

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

  function setBlankImage(params: BlankImageParams) {
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
            isToolDirty: false,
            toolName: 'reposition',
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: null,
            selectionClipboard: null,
          },
        },
      });
      return;
    }
    const { image } = data;
    const size = { width: image.width, height: image.height };
    handleImageCreate(size);
    await createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true }, true);
    _setFileName(fileName);
  }

  function goToTool(nextToolName: ToolName) {
    // commit any dirty tool changes before switching
    commitDirtyTool();

    if (nextToolName !== toolName && activeSelectionId) {
      const previousSelectionState = {
        selections,
        activeSelectionId,
      };

      dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: { status: 'cleared', version: (selectionCleared?.version ?? 0) + 1 },
          },
          historyItem: createHistoryItem({
            actionName: SELECTION_ACTION,
            layerId: 'selection',
            args: {
              previousSelectionState,
              nextSelectionState: { selections: [], activeSelectionId: null },
            },
          }),
        },
      });
    }

    dispatch({ type: 'SET_TOOL_NAME', payload: nextToolName });
  }

  return {
    setBlankImage,
    setImageFromUpload,
    handleImageSave,

    goToTool,
  };
};
