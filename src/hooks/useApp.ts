import type { Size } from '../contexts/general-types.ts';
import { useStore } from '../contexts/StoreContext.tsx';
import type { BlankImageParams, NewBedrockSize, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/useFile.tsx';

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
  const [{ canvasRef }, dispatch] = useStore();
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
