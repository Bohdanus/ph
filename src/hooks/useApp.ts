import type { Size } from '../contexts/general-types.ts';
import { useStore } from '../contexts/StoreContext.tsx';
import type { BlankImageParams, NewBedrockSize, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';
import { v4 as uuidv4 } from 'uuid';
import { OPEN_DOCUMENT_ACTION } from '../util/constants.ts';

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
  const [{ canvasRef, currentArgs: currentArgsRef, toolOverlayRef, rectOverlayRef }, dispatch] = useStore();
  const { createBlankLayer, createLayerFromBitmap, commitDirtyTool } = useLayers();

  function handleImageCreate(size: Size) {
    dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        hasImage: true,
        hasUnsavedChanges: false,
        totalSize: size,
      },
    });
    // eslint-disable-next-line react-compiler/react-compiler
    canvasRef.current!.width = size.width;
    canvasRef.current!.height = size.height;
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
    handleImageCreate((params as NewBedrockSize).size);
    params.isBedrock = true;
    createBlankLayer(params);
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
      currentArgsRef.current = {} as typeof currentArgsRef.current;
      for (const ref of [canvasRef, toolOverlayRef, rectOverlayRef]) {
        if (ref.current) {
          ref.current.width = size.width;
          ref.current.height = size.height;
        }
      }
      dispatch({
        type: 'BATCH_UPDATES',
        payload: {
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
          historyIndex: 0,
          history: [
            {
              id: uuidv4(),
              actionName: OPEN_DOCUMENT_ACTION,
              layerId: activeLayerId ?? '',
              documentSource: { layers: baseline, size: { ...size } },
              imagePromise: Promise.resolve(null),
            },
          ],
        },
      });
      return;
    }
    const { image } = data;
    _setFileName(fileName);
    const size = { width: image.width, height: image.height };
    handleImageCreate(size);
    createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true });
  }

  function goToTool(toolName: ToolName) {
    // commit any dirty tool changes before switching
    commitDirtyTool();

    dispatch({ type: 'SET_TOOL_NAME', payload: toolName });
  }

  return {
    setBlankImage,
    setImageFromUpload,
    handleImageSave,

    goToTool,
  };
};
