import { createContext, type RefObject } from 'react';
import { toolsMap } from '../tools/toolsMap.ts';
import type { CropToolType } from '../tools/crop.ts';
import type { DrawToolType } from '../tools/draw.ts';
import type { TransformToolType } from '../tools/transform.ts';
import type { ColorsToolType } from '../tools/colors.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { BlurToolType } from '../tools/blur.ts';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export type RectXY = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type RectXYSorted = RectXY;

export type ZoomData = { dx: number; dy: number; zoom: number };
export type Delta = { dx: number; dy: number };

export type ToolName = keyof typeof toolsMap;
export type ToolArgs =
  | Record<string, string | number>
  | BlurToolType
  | DrawToolType
  | ColorsToolType
  | CropToolType
  | TextToolArgs
  | TransformToolType;

// export type InteractionMode = 'zoom' | 'draw' | 'crop' | 'text';

export type UpdateHistoryFn = {
  args: ToolArgs;
  overrideCurrentTool?: ToolName /* used when crop */;
  dryRun?: boolean;
  forceNewItem?: boolean;
};

export type HistoryItem = {
  saved?: boolean; // exported to disk
  tool: ToolName;
  args: ToolArgs;
  bitmap?: ImageBitmap | null;
  imageBlob?: Blob | null;
};

interface ImageContextType {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;

  fileName: string;
  setFileName: (name: string) => void;
  originalImage: HTMLImageElement | null;
  size: Size;

  openLoadImageDialog: () => void;
  openSaveImageDialog: () => void;
  createBlankImage: (width: number, height: number) => void;
  _setOriginalImage: (image?: File) => Promise<void>; // use with caution now and refactor later
  isSaved: boolean;

  toolName: ToolName | null | undefined;
  toolArgs: ToolArgs | undefined;
  startEmptyTool: (tool: ToolName) => void;
  addCanvasToHistory: (toolName: ToolName, args: ToolArgs) => void;
  updateLastHistoryItem: (params: UpdateHistoryFn) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetArgs: () => void;

  crop: CropToolType | null;
  setCrop: (args: CropToolType | null) => void;

  zoomDataRef: { current: ZoomData };
  // setZoomData: (data: ZoomData) => void;
}

export const ImageContext = createContext<ImageContextType>({
  containerRef: { current: null },
  canvasRef: { current: null },
  textareaRef: { current: null },

  fileName: '',
  setFileName: () => {},
  originalImage: null,
  size: { width: 0, height: 0 },

  openLoadImageDialog: () => {},
  openSaveImageDialog: () => {},
  createBlankImage: () => {},
  _setOriginalImage: () => Promise.resolve(),
  isSaved: false,

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
  // setZoomData: () => {},
});
