import React, { useState, type ReactNode, useRef } from 'react';
import { loadImageFile } from './loadFromFile.ts';
import { saveImage } from './saveToFile.ts';
import SaveDialog from '../components/SaveDialog/SaveDialog.tsx';
import {
  type HistoryItem,
  ImageContext,
  type Size,
  type ToolArgs,
  type ToolName,
  type UpdateHistoryFn,
  type ZoomData,
} from './ImageContext.tsx';
import { toolsMap } from '../tools/toolsMap.ts';
import { defaultSettings, savedLastSettings } from '../tools/settings.ts';
import { isEqual } from 'lodash-es';
import { writeImageToCanvas } from '../tools/functions.ts';
import type { CropToolType } from '../tools/crop.ts';

export const ImageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // const isWorkingRef = useRef(false);

  const [fileName, setFileName] = useState('');
  const [originalImage, setOriginalImage] = useState<boolean>(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // todo replace this with "dirty" history prop
  const [currentEmptyTool, setCurrentEmptyTool] = useState<ToolName | null | undefined>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLength, setHistoryLength] = useState<number>(0);

  const [crop, setCrop] = useState<CropToolType | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState<number | null>(null);
  const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });

  function getCurrentTool(): ToolName | null | undefined {
    const tool = currentEmptyTool ?? history[historyLength - 1]?.tool;

    return tool || 'draw';
  }

  const toolName = getCurrentTool();

  function getCurrentArgs(): ToolArgs | undefined {
    if (currentEmptyTool) return savedLastSettings[currentEmptyTool] || defaultSettings[currentEmptyTool];

    const tool = toolName!;
    return history[historyLength - 1]?.args ?? savedLastSettings[tool] ?? defaultSettings[tool];
  }

  function setSizeMemo(width: number, height: number) {
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
  }

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    await handleImageUpload(file);

    // Reset input so the same file can be selected again if needed
    if (event.target) {
      event.target.value = '';
    }
  };

  async function handleNewImage(width: number, height: number) {
    setOriginalImage(true);
    setSize({ width, height });

    setCurrentEmptyTool(toolName ?? 'draw');

    const bitmap = await createImageBitmap(canvasRef.current!);
    setHistory([
      {
        tool: '',
        args: {},
        bitmap,
        saved: true,
      },
    ]);
    setHistoryLength(1);
  }

  async function handleImageUpload(file?: File) {
    if (!file) {
      return;
    }

    try {
      const img = await loadImageFile(file);
      writeImageToCanvas(img, canvasRef.current!);

      setFileName(file.name);
      handleNewImage(img.width, img.height);
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }

  const openLoadImageDialog = () => {
    if (historyLength > 0 && !history[historyLength - 1].saved) {
      if (confirm('You have unsaved changes, do you want to save them?')) {
        openSaveImageDialog();
        return;
      }
    }
    fileInputRef.current?.click();
  };

  const openSaveImageDialog = () => {
    if (getCurrentBitmap()) {
      setShowSaveDialog(true);
    } else {
      alert('No image to save!');
    }
  };

  const createBlankImage = async (width: number, height: number) => {
    const canvas = canvasRef.current!;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    setFileName('new-image.png');
    handleNewImage(width, height);
  };

  const handleSave = (filename: string, format: string) => {
    const success = saveImage(canvasRef.current, filename, format);
    if (success) {
      setFileName(filename);
      history[historyLength - 1].saved = true;
      setHistory([...history]);
      // setShowSaveDialog(false);
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

  function saveCurrentBitmap({
    bitmapToDisplay, // used in case you are saving AND moving in history
    hist = history,
    length = historyLength,
    callback,
  }: { bitmapToDisplay?: ImageBitmap; hist?: HistoryItem[]; length?: number; callback?: () => void } = {}) {
    const historyItem = hist[length - 1];
    if (!historyItem.bitmap) {
      createImageBitmap(canvasRef.current!).then((bitmap) => {
        historyItem.bitmap = bitmap;

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

  function startEmptyTool(toolName: ToolName) {
    setCurrentEmptyTool(toolName);

    // the old tool is done so save the history
    saveCurrentBitmap();
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

  async function addCanvasToHistory(toolName: ToolName, args: ToolArgs) {
    if (!originalImage) return;
    //  savedLastSettings[toolName] = args;
    const newHistory = [...history.slice(0, historyLength), { tool: toolName, args }];
    setCurrentEmptyTool(null);
    setHistory(newHistory);
    setHistoryLength(newHistory.length);
    saveCurrentBitmap({ hist: newHistory, length: newHistory.length });
  }

  // todo apply this low priority
  function updateLastHistoryItem({ args, dryRun, forceNewItem }: UpdateHistoryFn) {
    if (!originalImage) return;

    const tool = toolName;
    if (!tool) return; // shouldn't normally happen, but just in case

    if (isEqual(args, defaultSettings[tool])) {
      if (currentEmptyTool) {
        console.log('currentEmptyTool is not null, but args are equal to defaultSettings');
        return;
      }
      setCurrentEmptyTool(tool);
      const newHistory = history.slice(0, historyLength - 1);
      setHistory(newHistory);
      setHistoryLength(newHistory.length);
      const bmp = getPrevBitmap();
      writeImageToCanvas(bmp, canvasRef.current);
      setSizeMemo(bmp.width, bmp.height);
      return;
    }

    const addNewItem = forceNewItem || currentEmptyTool;

    // should normally have args, but just in case
    args ??= { ...defaultSettings[tool] };

    if (!dryRun) {
      toolsMap[tool].imageProcessor(canvasRef.current!, addNewItem ? getCurrentBitmap() : getPrevBitmap())(
        args,
        (width, height) => {
          saveCurrentBitmap({ hist: newHistory, length: newHistory.length });
          setSizeMemo(width, height);
        }
      );
    }

    const newHistory = history.slice(0, historyLength - (addNewItem ? 0 : 1));
    const newHistoryItem = { tool, args };
    newHistory.push(newHistoryItem);

    setHistory(newHistory);
    setHistoryLength(newHistory.length);

    if (forceNewItem) {
      setCurrentEmptyTool(tool);
    } else {
      setCurrentEmptyTool(null);
    }
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
    if (canUndo()) {
      const newLength = historyLength - 1;
      if (newLength > 0) {
        setCurrentEmptyTool(null);
      } else {
        setCurrentEmptyTool('draw');
      }

      const bitmap = getPrevBitmap();
      setSizeMemo(bitmap.width, bitmap.height);
      // should save current state and only then proceed
      saveCurrentBitmap({ bitmapToDisplay: bitmap });

      setHistoryLength(newLength);
    }
  }

  function canUndo() {
    return historyLength > 1;
  }

  function resetArgs() {
    const tool = toolName!;
    updateLastHistoryItem({ args: defaultSettings[tool] });
  }

  function redo() {
    if (canRedo()) {
      const newLength = historyLength + 1;
      setCurrentEmptyTool(null);

      const bitmap = getNextBitmap();
      setSizeMemo(bitmap.width, bitmap.height);
      writeImageToCanvas(bitmap, canvasRef.current);

      setHistoryLength(newLength);
    }
  }

  function canRedo() {
    return historyLength < history.length;
  }

  function isSaved() {
    const len = historyLength;
    if (len === 0) return true;

    return history[len - 1].saved!;
  }

  React.useEffect(() => {
    setCropAspectRatio(null);
  }, [toolName]);

  // NOSONAR: React Compiler handles memoization of this object
  const providerValue = {
    canvasRef,
    containerRef,
    textareaRef,

    fileName,
    setFileName,
    originalImage,
    size,

    openLoadImageDialog,
    openSaveImageDialog,
    createBlankImage,
    _setOriginalImage: handleImageUpload,
    isSaved: isSaved(),

    toolName: getCurrentTool(),
    toolArgs: getCurrentArgs(),
    startEmptyTool,
    addCanvasToHistory,
    updateLastHistoryItem,
    undo,
    redo,
    canUndo,
    canRedo,
    resetArgs,

    crop,
    setCrop,
    cropAspectRatio,
    setCropAspectRatio,
    zoomDataRef,
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
