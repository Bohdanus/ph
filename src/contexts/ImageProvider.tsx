import React, { useState, type ReactNode, useRef, useEffect } from 'react';
import { loadImageFile } from './loadFromFile.ts';
import { saveImage } from './saveToFile.ts';
import SaveDialog from '../components/SaveDialog/SaveDialog.tsx';
import { type HistoryItem, ImageContext, type ToolArgs, type ToolName } from './ImageContext.tsx';
import { toolsMap } from '../tools/toolsMap.ts';
import { defaultSettings, savedLastSettings } from '../tools/settings.ts';
import { isEqual } from 'lodash-es';
import { writeImageToCanvas } from '../tools/functions.ts';
import type { CropToolType } from '../tools/crop.ts';

export const ImageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fileName, setFileName] = useState('');
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentEmptyTool, setCurrentEmptyTool] = useState<ToolName | null | undefined>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLength, setHistoryLength] = useState<number>(0);

  const [crop, setCrop] = useState<CropToolType | null>(null);
  const [zoom, setZoom] = useState(1);
  const [interactionMode, setInteractionMode] = useState<'pan' | 'draw' | 'crop'>('draw');

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    await handleImageUpload(file);

    // Reset input so the same file can be selected again if needed
    if (event.target) {
      event.target.value = '';
    }
  };

  async function handleImageUpload(file?: File) {
    // todo add a propmt, because we are overwriting the original image
    if (!file) {
      return;
    }

    try {
      const img = await loadImageFile(file);
      const canvas = canvasRef.current!;
      writeImageToCanvas(img, canvas);

      setFileName(file.name);
      setOriginalImage(img);
      setCurrentEmptyTool(getCurrentTool() ?? 'draw');

      const bitmap = await createImageBitmap(canvas); // or maybe from inage??
      setHistory([
        {
          tool: 'init',
          args: {},
          bitmap,
          saved: true,
        },
      ]);
      setHistoryLength(1);
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }

  const openLoadImageDialog = () => {
    fileInputRef.current?.click();
  };

  const openSaveImageDialog = () => {
    if (getCurrentBitmap()) {
      setShowSaveDialog(true);
    } else {
      alert('No image to save!');
    }
  };

  const handleSave = (filename: string, format: string) => {
    const success = saveImage(canvasRef.current, filename, format);
    if (success) {
      setFileName(filename);
    }
  };

  const handleCloseSaveDialog = () => {
    setShowSaveDialog(false);
  };

  function getCurrentBitmap() {
    return history[historyLength - 1].bitmap!;
  }

  function getPrevBitmap() {
    if (historyLength === 1) {
      return history[0].bitmap!;
    }
    return history[historyLength - 2].bitmap!;
  }

  function getNextBitmap() {
    return history[historyLength].bitmap!;
  }

  // function getPrevHistoryImage() {
  //   if (prevHistoryImage) return prevHistoryImage;
  //
  //   if (history.length === 0) {
  //     return originalImage;
  //   }
  //
  //     setPrevHistoryImage(history[history.length - 1].image);
  //   }
  //
  //   return prevHistoryImage;
  // }

  function saveCurrentBitmap({
    bitmapToDisplay, // used in case you are saving AND moving in history
    hist = history,
    length = historyLength,
    callback,
  }: { bitmapToDisplay?: ImageBitmap; hist?: HistoryItem[]; length?: number; callback?: () => void } = {}) {
    const historyItem = hist[length - 1];
    if (!historyItem.saved) {
      createImageBitmap(canvasRef.current!).then((bitmap) => {
        historyItem.bitmap = bitmap;
        historyItem.saved = true;

        callback?.();

        // the below will reset the context and draw the bitmap instead of transformations
        writeImageToCanvas(bitmapToDisplay ?? bitmap, canvasRef.current);
      });
    } else {
      if (bitmapToDisplay) {
        // if we were explicitly asked to SHOW a bitmap, we should do it
        writeImageToCanvas(bitmapToDisplay, canvasRef.current);
      }
      // if there is callback execute it
      callback?.();
    }
  }

  useEffect(() => {
    if (crop && currentEmptyTool === 'crop') {
      updateLastHistoryItem(crop);
      setCrop(null);
    }
  }, [crop, currentEmptyTool, updateLastHistoryItem]);

  function startEmptyTool(toolName: ToolName) {
    if (toolName === 'transform' || toolName === 'crop') {
      setInteractionMode('crop');
    } else if (toolName === 'draw') {
      setInteractionMode('draw');
    } else {
      setInteractionMode('pan');
    }
    saveCurrentBitmap({ callback: () => setCurrentEmptyTool(toolName) });
    // if (historyLength > 0) {
    //   canvasRef.current!.toBlob(
    //     (blob) => {
    //       history[historyLength - 1].imageBlob = blob;
    //     },
    //     'image/webp',
    //     1
    //   );
    // }
  }

  function getCurrentTool(): ToolName | null | undefined {
    if (currentEmptyTool) {
      return currentEmptyTool;
    }

    if (historyLength === 0) return null;
    return history[historyLength - 1].tool;
  }

  function getCurrentArgs(): ToolArgs | undefined {
    if (currentEmptyTool) {
      return savedLastSettings[currentEmptyTool] || defaultSettings[currentEmptyTool];
    }
    if (historyLength === 0) return undefined;
    return history[historyLength - 1].args;
  }

  async function addCanvasToHistory(toolName: ToolName, args: ToolArgs) {
    if (!originalImage) return;
    //  savedLastSettings[toolName] = args;
    const newHistory = [...history.slice(0, historyLength), { tool: toolName, args, saved: false }];
    setCurrentEmptyTool(null);
    setHistory(newHistory);
    setHistoryLength(newHistory.length);
    saveCurrentBitmap({ hist: newHistory, length: newHistory.length });
  }

  function updateLastHistoryItem(args: ToolArgs) {
    if (!originalImage) return;

    const toolName = getCurrentTool();
    if (!toolName) return; // shouldn't normally happen, but just in case

    if (isEqual(args, defaultSettings[toolName])) {
      if (currentEmptyTool) {
        console.log('currentEmptyTool is not null, but args are equal to defaultSettings');
        // should never happen, but just in case
        return;
      }
      setCurrentEmptyTool(toolName);
      const newHistory = history.slice(0, historyLength - 1);
      setHistory(newHistory);
      setHistoryLength(newHistory.length);
      writeImageToCanvas(getPrevBitmap(), canvasRef.current);
      return;
    }

    const addNewItem = currentEmptyTool;

    // should normally have args, but just in case
    args ??= { ...defaultSettings[toolName] };

    toolsMap[toolName].imageProcessor(canvasRef.current!, addNewItem ? getCurrentBitmap() : getPrevBitmap())(args);

    const newHistory = history.slice(0, historyLength - (addNewItem ? 0 : 1));
    const newHistoryItem = { tool: toolName, args, saved: false } as HistoryItem;
    newHistory.push(newHistoryItem);

    setCurrentEmptyTool(null);
    setHistory(newHistory);
    setHistoryLength(newHistory.length);
  }

  // async function calculateImageToPosition(position: number) {
  //   if (!originalImage) return;
  //
  //   let image = originalImage;
  //   for (let i = 0; i < position; i++) {
  //     const { tool, args } = history[i];
  //     image = await toolsMap[tool](image)(args);
  //   }
  //
  //   return image;
  // }

  function undo() {
    const toolName = getCurrentTool();
    if (canUndo()) {
      const newLength = historyLength - 1;
      const newToolName = history[newLength - 1]?.tool;
      if (newToolName === toolName) {
        setCurrentEmptyTool(null);
      } else {
        setCurrentEmptyTool(toolName ?? null);
      }
      // should save current state and only then proceed
      saveCurrentBitmap({ bitmapToDisplay: getPrevBitmap() });

      setHistoryLength(newLength);
    }
  }

  function canUndo() {
    return historyLength > 1;
  }

  function redo() {
    const toolName = getCurrentTool();
    if (canRedo()) {
      const newLength = historyLength + 1;
      const newToolName = history[newLength - 1]?.tool;
      if (newToolName === toolName) {
        setCurrentEmptyTool(null);
      } else {
        setCurrentEmptyTool(toolName ?? null);
      }

      writeImageToCanvas(getNextBitmap(), canvasRef.current);

      setHistoryLength(newLength);
    }
  }

  function canRedo() {
    return historyLength < history.length;
  }

  // NOSONAR: React Compiler handles memoization of this object
  const providerValue = {
    canvasRef,
    fileName,
    setFileName,
    originalImage,
    openLoadImageDialog,
    openSaveImageDialog,
    _setOriginalImage: handleImageUpload,
    toolName: getCurrentTool(),
    toolArgs: getCurrentArgs(),
    startEmptyTool,
    addCanvasToHistory,
    updateLastHistoryItem,
    undo,
    redo,
    canUndo,
    canRedo,
    crop,
    setCrop,
    canvasDimensions: `${canvasRef.current?.width}x${canvasRef.current?.height}`,
    zoom,
    setZoom,
    interactionMode,
    setInteractionMode,
  };

  return (
    <>
      <ImageContext.Provider value={providerValue}>{children}</ImageContext.Provider>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/*"
        style={{ display: 'none' }}
      />
      {showSaveDialog && (
        <SaveDialog proposedName={`${fileName} (copy)`} onClose={handleCloseSaveDialog} onSave={handleSave} />
      )}
    </>
  );
};
