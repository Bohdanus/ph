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
  type ZoomData,
} from './ImageContext.tsx';
import { toolsMap } from '../tools/toolsMap.ts';
import { defaultSettings } from '../tools/settings.ts';
import { writeImageToCanvas } from '../tools/functions.ts';
import { saveSettings } from '../util/settings.ts';
import { DEFAULT_TOOL } from '../util/constants.ts';

export const ImageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // @ts-expect-error sdsd
  const canvasCtxRef = useRef<CanvasRenderingContext2D>();

  const [fileName, setFileName] = useState('');
  const [originalImage, setOriginalImage] = useState<boolean>(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [toolName, setToolName] = useState<ToolName>('draw');
  const [args, setArgs] = useState<ToolArgs>(defaultSettings.draw);
  const [isToolDirty, setIsToolDirty] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLength, setHistoryLength] = useState<number>(0);

  const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });
  const [, forceUpdate] = useState(0);

  const setZoomData = (data: ZoomData) => {
    zoomDataRef.current = data;
    forceUpdate((v) => v + 1);
  };

  function setToolDirty() {
    setIsToolDirty(true);
    if (history.length > historyLength) {
      setHistory(history.slice(0, historyLength));
    }
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

    const bitmap = await createImageBitmap(canvasRef.current!);
    setHistory([
      {
        toolName: DEFAULT_TOOL,
        args: defaultSettings[DEFAULT_TOOL],
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
      canvasCtxRef.current = writeImageToCanvas(img, canvasRef.current!);

      setFileName(file.name);
      await handleNewImage(img.width, img.height);
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
    canvasCtxRef.current = canvas.getContext('2d')!;
    canvasCtxRef.current.fillStyle = 'white';
    canvasCtxRef.current.fillRect(0, 0, width, height);

    setFileName('new-image.png');
    await handleNewImage(width, height);
  };

  const handleSave = (filename: string, format: string) => {
    autoFinishLastTool();

    // todo test if bitmap gets updated after auto finish
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
    return historyLength > 0 ? history[historyLength - 1].bitmap! : null;
  }

  function saveCurrentBitmap({
    hist = history,
    length = historyLength,
  }: { hist?: HistoryItem[]; length?: number } = {}) {
    const historyItem = hist[length - 1];
    createImageBitmap(canvasRef.current!).then((bitmap) => {
      historyItem.bitmap = bitmap;

      // provide canvas handoff. This is very ugly but provides context reset
      canvasCtxRef.current = writeImageToCanvas(bitmap, canvasRef.current!);
    });
  }

  function autoFinishLastTool() {
    if (isToolDirty) {
      updateLastHistoryItem(args);
      setIsToolDirty(false);
    } else {
      // the old tool is done so save the history
      if (historyLength > 0 && !history[historyLength - 1].bitmap) {
        saveCurrentBitmap();
      }
    }
  }

  function onHistoryMove(historyItem: HistoryItem) {
    setArgs(defaultSettings[toolName]);
    setIsToolDirty(false);

    if (historyItem.bitmap) {
      canvasCtxRef.current = writeImageToCanvas(historyItem.bitmap, canvasRef.current!, setSizeMemo);
    }
  }

  function startTool(newToolName: ToolName, args?: ToolArgs) {
    // auto apply these tools if moving away from them
    autoFinishLastTool();

    args ??= defaultSettings[newToolName];

    setToolName(newToolName);
    setArgs(args);
    setIsToolDirty(false);

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

  async function addCanvasToHistory(args: ToolArgs) {
    saveSettings(toolName, args);
    setIsToolDirty(false);
    setArgs(defaultSettings[toolName]);

    const newHistory = [...history, { toolName, args }];
    setHistory(newHistory);
    setHistoryLength(newHistory.length);

    saveCurrentBitmap({ hist: newHistory, length: newHistory.length });
  }

  // todo apply this low priority RAF
  function updateLastHistoryItem(args: ToolArgs) {
    saveSettings(toolName, args);
    setIsToolDirty(false);
    setArgs(defaultSettings[toolName]);

    toolsMap[toolName].imageProcessor({
      bitmap: getCurrentBitmap()!,
      canvas: canvasRef.current!,
      ctx: canvasCtxRef.current,
    })(args, setSizeMemo);

    const newHistory = [...history, { toolName, args }];
    setHistory(newHistory);
    setHistoryLength(newHistory.length);

    saveCurrentBitmap({ hist: newHistory, length: newHistory.length });
  }

  function canUndo() {
    if (isToolDirty) return true;
    return historyLength > 1;
  }

  function setToolArgs(args: ToolArgs) {
    setArgs(args);
    saveSettings(toolName, args);
    setToolDirty();
  }

  function undo() {
    if (!canUndo()) return;

    if (isToolDirty) {
      setIsToolDirty(false);
      setArgs(defaultSettings[toolName]);
      canvasCtxRef.current = writeImageToCanvas(getCurrentBitmap()!, canvasRef.current!, setSizeMemo);
      return;
    }

    // todo save current state when doing undo, by autoFinishLastTool
    const newLength = historyLength - 1;
    setHistoryLength(newLength);

    const historyItem = history[newLength - 1];
    onHistoryMove(historyItem);
  }

  function canRedo() {
    return historyLength < history.length;
  }

  function redo() {
    if (!canRedo()) return;

    const newLength = historyLength + 1;
    setHistoryLength(newLength);

    const historyItem = history[newLength - 1];
    onHistoryMove(historyItem);
  }

  function goToHistoryIndex(index: number) {
    if (index < 0 || index >= history.length) return;
    if (index === historyLength - 1) return; // already at this index
    if (index === historyLength - 2) {
      undo(); // do special treatment for going back one step, to just clear the tool state
      return;
    }

    setHistoryLength(index + 1);
    const historyItem = history[index];
    onHistoryMove(historyItem);
  }

  function isSaved() {
    if (historyLength === 0) return true;
    return history[historyLength - 1].saved!;
  }

  // NOSONAR: React Compiler handles memoization of this object
  const providerValue = {
    canvasRef,
    containerRef,
    textareaRef,
    canvasCtxRef,

    fileName,
    setFileName,
    originalImage,
    getBitmap: getCurrentBitmap,
    size,
    setSizeMemo,

    openLoadImageDialog,
    openSaveImageDialog,
    createBlankImage,
    _setOriginalImage: handleImageUpload,
    isSaved: isSaved(),

    toolName,
    toolArgs: args,
    setToolArgs,
    startTool,

    isToolDirty,
    setToolDirty,

    addCanvasToHistory,
    updateLastHistoryItem,

    canUndo,
    undo,
    canRedo,
    redo,
    goToHistoryIndex,
    getHistory: () => history.slice(0, history.length),
    historyLength,

    zoomDataRef,
    setZoomData,
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
