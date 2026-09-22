import type { Size } from '../contexts/general-types.ts';
import { useStore } from '../contexts/StoreContext.tsx';
import type { BlankImageParams, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';
import { v4 as uuidv4 } from 'uuid';
import { OPEN_DOCUMENT_ACTION, SELECTION_ACTION } from '../util/constants.ts';
import { resizeCanvas } from '../util/canvas.ts';
import { setRefValue } from '../util/ref.ts';
import { createHistoryItem } from '../contexts/history-utils.ts';

export interface UseAppType {
  setBlankImage: (data: BlankImageParams) => void;
  setImageFromUpload: (data: ImageUploadResponse) => void;

  handleImageSave: (data: ImageSaveResponse) => void;

  goToTool: (toolName: ToolName) => void;
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
    dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        fileName,
        hasUnsavedChanges: false,
      },
    });
  }

  function _setFileName(fileName: string) {
    dispatch({ type: 'SET_FILE_NAME', payload: fileName });
  }

  function setBlankImage(params: BlankImageParams) {
    handleImageCreate(params.size);
    createBlankLayer({ ...params }, true);
  }

  function setImageFromUpload(data: ImageUploadResponse) {
    const { fileName } = data;
    if ('document' in data) {
      const { size, layers, warnings } = data.document;
      if (warnings.length && !window.confirm(`PSD import limitations:\n\n${warnings.join('\n')}\n\nOpen anyway?`))
        return;
      const activeLayerId = Object.values(layers).sort((a, b) => b.order - a.order)[0]?.id ?? null;
      const baseline = Object.fromEntries(
        Object.values(layers).map((layer) => [layer.id, { ...layer, pos: { ...layer.pos } }])
      );
      setRefValue(currentArgsRef, {} as typeof currentArgsRef.current);
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
              documentSource: { layers: baseline, size: { ...size } },
            }),
          ],
          updates: {
            fileName,
            totalSize: size,
            layers,
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
    _setFileName(fileName);
    const size = { width: image.width, height: image.height };
    handleImageCreate(size);
    createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true }, true);
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
