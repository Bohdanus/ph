import type { Size } from '../contexts/general-types.ts';
import { useStore } from '../contexts/StoreContext.tsx';
import type { BlankImageParams, NewBedrockSize, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';
import { useCurrentTool } from '../contexts/useCurrentTool.tsx';

export interface UseAppType {
  setBlankImage: (data: BlankImageParams) => void;
  setImageFromUpload: (data: ImageUploadResponse) => void;

  handleImageSave: (data: ImageSaveResponse) => void;

  clearOverlay: () => void;
  goToTool: (toolName: ToolName) => void;
}

/**
 * Custom hook for accessing and managing application-level state and utilities.

  BASIC UI OPERATIONS

 */
export const useApp = (): UseAppType => {
  const [{ canvasRef, toolOverlayRef, totalSize }, dispatch] = useStore();
  // TODO this is a performance bottleneck?????
  const { resetToLastSavedArgs } = useCurrentTool();
  const { createBlankLayer, createLayerFromBitmap, commitDirtyLayer } = useLayers();

  function handleImageCreate(size: Size) {
    dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        hasImage: true,
        hasUnsavedChanges: false,
        totalSize: size,
      },
    });
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

  function setImageFromUpload({ fileName, image }: ImageUploadResponse) {
    _setFileName(fileName);
    const size = { width: image.width, height: image.height };
    handleImageCreate(size);
    createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true });
  }

  function clearOverlay() {
    const overlayCtx = toolOverlayRef.current?.getContext('2d')!;
    overlayCtx.clearRect(0, 0, totalSize.width, totalSize.height);
  }

  function goToTool(toolName: ToolName) {
    // commit any dirty tool changes before switching
    commitDirtyLayer();
    clearOverlay();

    dispatch({ type: 'SET_TOOL_NAME', payload: toolName });

    resetToLastSavedArgs(toolName);
  }

  return {
    setBlankImage,
    setImageFromUpload,
    handleImageSave,

    clearOverlay,
    goToTool,
  };
};
