import { createContext, type RefObject } from 'react';
import { toolsMap } from '../tools/toolsMap.ts';
import type { CropToolType } from '../tools/crop.ts';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export type RectXY = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isRotated?: boolean;
};

export type ZoomData = { dx: number; dy: number; zoom: number };
export type Delta = { dx: number; dy: number };

export type ToolName = keyof typeof toolsMap;
export type ToolArgs = Record<string, string | number | Point[]>;

export type InteractionMode = 'zoom' | 'draw' | 'crop';

export type HistoryItem = {
  saved?: boolean; // saved to disk
  tool: ToolName;
  args: ToolArgs;
  bitmap?: ImageBitmap | null;
  imageBlob?: Blob | null;
};

interface ImageContextType {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;

  fileName: string;
  setFileName: (name: string) => void;
  originalImage: HTMLImageElement | null;
  size: Size;
  setSize: (size: Size) => void;

  openLoadImageDialog: () => void;
  openSaveImageDialog: () => void;
  _setOriginalImage: (image?: File) => Promise<void>; // use with caution now and refactor later

  toolName: ToolName | null | undefined;
  toolArgs: ToolArgs | undefined;
  startEmptyTool: (tool: ToolName) => void;
  addCanvasToHistory: (toolName: ToolName, args: ToolArgs) => void;
  updateLastHistoryItem: (args: ToolArgs, overrideCurrentTool?: ToolName /* used when crop */) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetArgs: () => void;

  crop: CropToolType | null;
  setCrop: (args: CropToolType | null) => void;

  zoomDataRef: { current: ZoomData };
  setZoomData: (data: ZoomData) => void;

  interactionMode: InteractionMode;
  setInteractionMode: (mode: InteractionMode) => void;
}

export const ImageContext = createContext<ImageContextType>({
  containerRef: { current: null },
  canvasRef: { current: null },

  fileName: '',
  setFileName: () => {},
  originalImage: null,
  size: { width: 0, height: 0 },
  setSize: () => {},

  openLoadImageDialog: () => {},
  openSaveImageDialog: () => {},
  _setOriginalImage: () => Promise.resolve(),

  toolName: null,
  toolArgs: {},
  startEmptyTool: () => {},
  addCanvasToHistory: () => {},
  updateLastHistoryItem: () => {},
  undo: () => {},
  redo: () => {},
  canUndo: () => false,
  canRedo: () => false,
  resetArgs: () => {},

  crop: null,
  setCrop: () => {},

  zoomDataRef: { current: { dx: 0, dy: 0, zoom: 1 } },
  setZoomData: () => {},

  interactionMode: 'zoom',
  setInteractionMode: () => {},
});
