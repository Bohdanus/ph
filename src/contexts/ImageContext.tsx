import { createContext, type RefObject } from 'react';
import { toolsMap } from '../tools/toolsMap.ts';
import type { CropToolArgs } from '../tools/crop.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { TransformToolArgs } from '../tools/transform.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { SavedSettings } from '../tools/settings.ts';

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
  | BlurToolArgs
  | ColorsToolArgs
  | CropToolArgs
  | DrawToolArgs
  | LevelsToolArgs
  | TextToolArgs
  | TransformToolArgs
  | ShapeToolArgs;

// export type InteractionMode = 'zoom' | 'draw' | 'crop' | 'text';

// export type UpdateHistoryParams = {
//   args: ToolArgs;
//   forceCommit?: boolean;
// };

export type HistoryItem = {
  toolName: ToolName;
  args: ToolArgs;
  bitmap?: ImageBitmap | null;
  saved?: boolean; // exported to disk
  imageBlob?: Blob | null; // todo should replace bitmap, like archive
};

interface ImageContextType {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasCtxRef: RefObject<CanvasRenderingContext2D>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;

  fileName: string;
  setFileName: (name: string) => void;
  originalImage: boolean; // todo change ther name = it tells us if the image is loaded or not
  getBitmap: () => ImageBitmap | null;
  size: Size;
  setSizeMemo: (width: number, height: number) => void;

  openLoadImageDialog: () => void;
  openSaveImageDialog: () => void;
  createBlankImage: (width: number, height: number) => void;
  _setOriginalImage: (image?: File) => Promise<void>; // use with caution now and refactor later
  isSaved: boolean;
  historyLength: number;

  toolName: ToolName | null | undefined;
  toolArgs: ToolArgs | undefined;
  setToolArgs: (args: SavedSettings) => void;
  startTool: (tool: ToolName, args?: ToolArgs) => void;

  isToolDirty: boolean;
  setToolDirty: () => void;

  addCanvasToHistory: (args: ToolArgs) => void;
  updateLastHistoryItem: (args: ToolArgs) => void;

  canUndo: () => boolean;
  undo: () => void;
  canRedo: () => boolean;
  redo: () => void;
  goToHistoryIndex: (index: number) => void;
  getHistory: () => HistoryItem[];

  zoomDataRef: { current: ZoomData };
  setZoomData: (data: ZoomData) => void;
}

export const ImageContext = createContext<ImageContextType>({
  containerRef: { current: null },
  canvasRef: { current: null },
  // @ts-expect-error sdsd
  canvasCtxRef: { current: null },
  textareaRef: { current: null },

  fileName: '',
  setFileName: () => {},
  originalImage: false,
  getBitmap: () => null,
  size: { width: 0, height: 0 },
  setSizeMemo: () => {},

  openLoadImageDialog: () => {},
  openSaveImageDialog: () => {},
  createBlankImage: () => {},
  _setOriginalImage: () => Promise.resolve(),
  isSaved: false,
  historyLength: 0,

  toolName: null,
  toolArgs: {} as ToolArgs,
  setToolArgs: () => {},
  startTool: () => {},

  isToolDirty: false,
  setToolDirty: () => {},

  addCanvasToHistory: () => {},
  updateLastHistoryItem: () => {},

  canUndo: () => false,
  undo: () => {},
  canRedo: () => false,
  redo: () => {},
  goToHistoryIndex: () => {},
  getHistory: () => [],

  zoomDataRef: { current: { dx: 0, dy: 0, zoom: 1 } },
  setZoomData: () => {},
});
