import React, { createContext, useContext, useRef, useReducer } from 'react';
import { DEFAULT_TOOL } from '../util/constants.ts';

import type { ReactNode, RefObject } from 'react';
import type { LayerId, LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { ToolName } from './tool-types.ts';
import type { HistoryItem } from './history-types.ts';

export type StoreType = {
  // refs
  canvasRef: RefObject<HTMLCanvasElement | null>;
  toolOverlayRef: RefObject<HTMLCanvasElement | null>;
  rectOverlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  canvasCtxRef: React.RefObject<CanvasRenderingContext2D | null | undefined>;

  currentArgs: React.RefObject<Record<string, any>>;

  // file / image state
  hasImage: boolean;
  hasUnsavedChanges: boolean;
  fileName: string;
  totalSize: Size;

  // tool state (that changes not so frequently)
  toolName: ToolName;

  // layers
  layers: LayersRecord;
  deletedLayers: LayersRecord;
  activeLayerId: LayerId | null;

  // history
  history: HistoryItem[];
  historyIndex: number;

  // // misc
  // zoomDataRef: React.MutableRefObject<ZoomData>;
  // setZoomData: (d: ZoomData) => void;
};

const StoreContext = createContext<[StoreType, any] | undefined>(undefined);

type Action =
  | { type: 'SET_HAS_IMAGE'; payload: boolean }
  | { type: 'SET_HAS_UNSAVED_CHANGES'; payload: boolean }
  | { type: 'SET_FILE_NAME'; payload: string }
  | { type: 'SET_ORIGINAL_IMAGE'; payload: boolean }
  | { type: 'SET_SIZE'; payload: Size }
  | { type: 'SET_TOOL_NAME'; payload: ToolName }
  | { type: 'SET_LAYERS'; payload: LayersRecord }
  | { type: 'SET_ACTIVE_LAYER'; payload: LayerId | null }
  | { type: 'ADD_LAYER'; payload: { layers: LayersRecord; activeLayerId: LayerId } }
  | { type: 'UPDATE_LAYERS'; payload: LayersRecord }
  | { type: 'BATCH_UPDATES'; payload: Partial<StoreType> }
  | { type: 'ADD_HISTORY_ITEM'; payload: HistoryItem }
  | { type: 'REPLACE_HISTORY'; payload: HistoryItem[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_HISTORY_INDEX'; payload: number };

const initialState: StoreType = {
  canvasRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  containerRef: { current: null },
  textareaRef: { current: null },
  canvasCtxRef: { current: null },

  currentArgs: { current: {} },

  hasImage: false,
  hasUnsavedChanges: false,
  fileName: '',
  totalSize: { width: 0, height: 0 },

  toolName: (DEFAULT_TOOL as ToolName) ?? 'draw',

  layers: {} as LayersRecord,
  deletedLayers: {} as LayersRecord,
  activeLayerId: null,

  history: [],
  historyIndex: 0,
};

function reducer(state: StoreType, action: Action): StoreType {
  switch (action.type) {
    case 'SET_HAS_IMAGE':
      return { ...state, hasImage: action.payload };
    case 'SET_HAS_UNSAVED_CHANGES':
      return { ...state, hasUnsavedChanges: action.payload };
    case 'SET_FILE_NAME':
      return { ...state, fileName: action.payload };
    case 'SET_SIZE':
      return { ...state, totalSize: action.payload };
    case 'SET_TOOL_NAME':
      return { ...state, toolName: action.payload };
    case 'SET_LAYERS':
      return { ...state, layers: action.payload };
    case 'SET_ACTIVE_LAYER':
      return { ...state, activeLayerId: action.payload };
    case 'ADD_LAYER':
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
        hasUnsavedChanges: true,
      };
    case 'UPDATE_LAYERS':
      return {
        ...state,
        layers: action.payload,
        hasUnsavedChanges: true,
      };
    case 'BATCH_UPDATES':
      return {
        ...state,
        ...action.payload,
      };
    case 'ADD_HISTORY_ITEM':
      return {
        ...state,
        history: [...state.history, action.payload],
        historyIndex: state.history.length,
        hasUnsavedChanges: true,
      };
    case 'REPLACE_HISTORY':
      return {
        ...state,
        history: action.payload,
        historyIndex: action.payload.length - 1,
        hasUnsavedChanges: true,
      };
    case 'UNDO':
      return {
        ...state,
        historyIndex: state.historyIndex - 1,
        hasUnsavedChanges: true,
      };
    case 'REDO':
      return {
        ...state,
        historyIndex: state.historyIndex + 1,
        hasUnsavedChanges: true,
      };
    case 'SET_HISTORY_INDEX':
      return {
        ...state,
        historyIndex: action.payload,
        hasUnsavedChanges: true,
      };
    default:
      return state;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const rectOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const currentArgs = useRef<Record<string, any>>({});

  // reducer-managed state (file/tool/layers)
  const [store, dispatch] = useReducer(reducer, {
    ...initialState,
    canvasRef,
    toolOverlayRef,
    rectOverlayRef,
    containerRef,
    textareaRef,
    canvasCtxRef,

    currentArgs,
  });
  //
  // function setSizeMemo(width: number, height: number) {
  //   const { totalSize } = store;
  //   if (width !== totalSize.width || height !== totalSize.height) {
  //     dispatch({ type: 'SET_SIZE', payload: { width, height } });
  //   }
  // }
  // zoom data
  // const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });
  // const [, forceUpdate] = useState(0);
  // const setZoomData = (data: ZoomData) => {
  //   zoomDataRef.current = data;
  //   forceUpdate((v) => v + 1);
  // };

  return <StoreContext.Provider value={[store, dispatch]}>{children}</StoreContext.Provider>;
}

export const useStore = (): [StoreType, any] => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};
