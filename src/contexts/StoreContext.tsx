import React, { createContext, useContext, useEffect, useRef, useReducer, type Dispatch } from 'react';
import { DEFAULT_TOOL } from '../util/constants.ts';

import type { ReactNode, RefObject } from 'react';
import type { Layer, LayerId, LayersRecord } from './layer-types.ts';
import type {
  ClearedSelectionState,
  Selection,
  SelectionClipboard,
  SelectionDraftState,
  SelectionSourceTool,
  Size,
} from './general-types.ts';
import type { ToolArgs, ToolName } from './tool-types.ts';
import type { HistoryItem } from './history-types.ts';
import { updateHistoryTimeline, type HistoryTimeline } from './history-timeline.ts';
import { cloneDocumentFrame, documentFrameFromSize, documentFrameSize, type DocumentFrame } from './document-frame.ts';
import { freezeDurableDocument, type DurableDocument } from './history-model.ts';
import { legacyHistoryToDurable } from './history-adapter.ts';
import { getAssetRegistry } from './asset-registry.ts';

export type StoreData = {
  // refs
  canvasRef: RefObject<HTMLCanvasElement | null>;
  toolOverlayRef: RefObject<HTMLCanvasElement | null>;
  rectOverlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  canvasCtxRef: React.RefObject<CanvasRenderingContext2D | null | undefined>;

  currentArgs: React.RefObject<ToolArgs>;
  clearPreviewLayers: () => void;
  // Transient previews are document-scoped, not hook-instance-scoped. This
  // lets toolbars, export, and tool switching share one draft transaction.
  previewLayers: React.MutableRefObject<Record<LayerId, { layer: Layer; toolArgs?: ToolArgs }>>;

  // file / image state
  hasImage: boolean;
  hasUnsavedChanges: boolean;
  fileName: string;
  totalSize: Size;
  documentFrame: DocumentFrame;

  // tool state (that changes not so frequently)
  toolName: ToolName;
  isToolDirty: boolean;

  // layers
  layers: LayersRecord;
  deletedLayers: LayersRecord;
  activeLayerId: LayerId | null;

  // selections (supports multiple selections for future extensions)
  selections: Selection[];
  activeSelectionId: string | null;
  selectionDraft: SelectionDraftState;
  selectionCleared: ClearedSelectionState | null;
  selectionClipboard: SelectionClipboard | null;

  // history
  history: HistoryItem[];
  historyIndex: number;
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  /** Canonical replay state. Runtime layers remain a presentation projection during cutover. */
  durableDocument: DurableDocument | null;
  durableDiagnostics: readonly string[];

  // colors
  color: string;
  backgroundColor: string;

  // // misc
  // zoomDataRef: React.MutableRefObject<ZoomData>;
  // setZoomData: (d: ZoomData) => void;
};

type StoreUpdates = Partial<
  Omit<
    StoreData,
    | 'history'
    | 'historyIndex'
    | 'documentId'
    | 'documentRevision'
    | 'branchRevision'
    | 'durableDocument'
    | 'durableDiagnostics'
  >
>;

type Action =
  | { type: 'SET_HAS_IMAGE'; payload: boolean }
  | { type: 'SET_HAS_UNSAVED_CHANGES'; payload: boolean }
  | { type: 'SET_FILE_NAME'; payload: string }
  | { type: 'SET_ORIGINAL_IMAGE'; payload: boolean }
  | { type: 'SET_SIZE'; payload: Size }
  | { type: 'SET_TOOL_NAME'; payload: ToolName }
  | { type: 'SET_TOOL_DIRTY'; payload: boolean }
  | { type: 'SET_LAYERS'; payload: LayersRecord }
  | { type: 'SET_ACTIVE_LAYER'; payload: LayerId | null }
  | { type: 'ADD_LAYER'; payload: { layers: LayersRecord; activeLayerId: LayerId } }
  | { type: 'UPDATE_LAYERS'; payload: LayersRecord }
  | { type: 'BATCH_UPDATES'; payload: StoreUpdates }
  | {
      type: 'COMMIT_DOCUMENT_EDIT';
      payload: {
        updates?: StoreUpdates;
        historyItem: HistoryItem;
        durableDocument?: DurableDocument | null;
        durableDiagnostics?: readonly string[];
      };
    }
  | {
      type: 'APPLY_HISTORY_REPLAY';
      payload: {
        updates: StoreUpdates;
        timeline: HistoryTimeline;
        durableDocument?: DurableDocument | null;
        durableDiagnostics?: readonly string[];
      };
    }
  | {
      type: 'REPLACE_DOCUMENT';
      payload: {
        documentId: string;
        updates: StoreUpdates;
        history: HistoryItem[];
        historyIndex?: number;
        durableDocument?: DurableDocument | null;
        durableDiagnostics?: readonly string[];
      };
    }
  | { type: 'SET_COLOR'; payload: string }
  | { type: 'SET_BACKGROUND_COLOR'; payload: string }
  | { type: 'SET_SELECTIONS'; payload: Selection[] }
  | { type: 'ADD_SELECTION'; payload: Selection }
  | { type: 'COMMIT_SELECTION'; payload: Selection }
  | { type: 'UPDATE_SELECTION'; payload: Selection }
  | { type: 'MOVE_SELECTION'; payload: Selection }
  | { type: 'SET_ACTIVE_SELECTION'; payload: string | null }
  | { type: 'START_SELECTION_DRAFT'; payload: { sourceTool: SelectionSourceTool } }
  | { type: 'CANCEL_SELECTION_DRAFT' }
  | { type: 'SET_SELECTION_CLIPBOARD'; payload: SelectionClipboard | null }
  | { type: 'MARK_SELECTION_COPIED'; payload: { id: string } }
  | { type: 'CLEAR_SELECTIONS' };

type StoreDispatch = Dispatch<Action>;

const StoreContext = createContext<[StoreData, StoreDispatch] | undefined>(undefined);

const initialState: StoreData = {
  canvasRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  containerRef: { current: null },
  textareaRef: { current: null },
  canvasCtxRef: { current: null },

  currentArgs: { current: {} as ToolArgs },
  clearPreviewLayers: () => undefined,
  previewLayers: { current: {} },

  hasImage: false,
  hasUnsavedChanges: false,
  fileName: '',
  totalSize: { width: 0, height: 0 },
  documentFrame: { x: 0, y: 0, width: 0, height: 0 },

  toolName: (DEFAULT_TOOL as ToolName) ?? 'reposition',

  layers: {} as LayersRecord,
  deletedLayers: {} as LayersRecord,
  activeLayerId: null,

  selections: [],
  activeSelectionId: null,
  selectionDraft: { status: 'idle' },
  selectionCleared: null,
  selectionClipboard: null,

  history: [],
  historyIndex: 0,
  documentId: 'uninitialized',
  documentRevision: 0,
  branchRevision: 0,
  durableDocument: null,
  durableDiagnostics: [],

  color: '#000000',
  backgroundColor: '#ffffff',

  isToolDirty: false,
};

function commitSelection(state: StoreData, selection: Selection): StoreData {
  const committedSelection: Selection = {
    ...selection,
    isActive: true,
    lifecycle: 'committed',
    geometry: selection.geometry ?? 'polygon',
  };

  return {
    ...state,
    selections: [...state.selections.map((current) => ({ ...current, isActive: false })), committedSelection],
    activeSelectionId: committedSelection.id,
    selectionDraft: { status: 'idle' },
    selectionCleared: null,
  };
}

function updateCommittedSelection(state: StoreData, selection: Selection): StoreData {
  const committedSelection: Selection = {
    ...selection,
    lifecycle: 'committed',
    geometry: selection.geometry ?? 'polygon',
  };

  return {
    ...state,
    selections: state.selections.map((current) =>
      current.id === committedSelection.id ? committedSelection : current
    ),
    activeSelectionId: committedSelection.isActive ? committedSelection.id : state.activeSelectionId,
    selectionDraft: { status: 'idle' },
  };
}

function reducer(state: StoreData, action: Action): StoreData {
  switch (action.type) {
    case 'SET_HAS_IMAGE':
      return { ...state, hasImage: action.payload };
    case 'SET_HAS_UNSAVED_CHANGES':
      return { ...state, hasUnsavedChanges: action.payload };
    case 'SET_FILE_NAME':
      return { ...state, fileName: action.payload };
    case 'SET_SIZE':
      if (state.totalSize.width === action.payload.width && state.totalSize.height === action.payload.height) {
        return state;
      }
      return {
        ...state,
        totalSize: action.payload,
        documentFrame: { ...state.documentFrame, ...action.payload },
      };
    case 'SET_TOOL_NAME':
      return { ...state, isToolDirty: false, toolName: action.payload };
    case 'SET_TOOL_DIRTY':
      if (state.isToolDirty === action.payload) {
        return state;
      }
      return { ...state, isToolDirty: action.payload };
    case 'SET_LAYERS':
      return { ...state, layers: action.payload };
    case 'SET_ACTIVE_LAYER':
      if (state.activeLayerId === action.payload) {
        return state;
      }
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
    case 'COMMIT_DOCUMENT_EDIT': {
      const timeline = updateHistoryTimeline(
        { entries: state.history, cursor: state.historyIndex, branchRevision: state.branchRevision },
        { type: 'append', entry: action.payload.historyItem }
      );
      const updates = action.payload.updates ?? {};
      const nextFrame = updates.documentFrame;
      return {
        ...state,
        ...updates,
        ...(nextFrame ? { documentFrame: cloneDocumentFrame(nextFrame), totalSize: documentFrameSize(nextFrame) } : {}),
        history: [...timeline.entries],
        historyIndex: timeline.cursor,
        branchRevision: timeline.branchRevision,
        ...(action.payload.durableDocument !== undefined
          ? {
              durableDocument: action.payload.durableDocument,
              durableDiagnostics: action.payload.durableDiagnostics ?? [],
            }
          : {}),
        hasUnsavedChanges: true,
      };
    }
    case 'APPLY_HISTORY_REPLAY': {
      const replayUpdates = action.payload.updates;
      const replayFrame = replayUpdates.documentFrame;
      return {
        ...state,
        ...replayUpdates,
        ...(replayFrame
          ? { documentFrame: cloneDocumentFrame(replayFrame), totalSize: documentFrameSize(replayFrame) }
          : {}),
        history: [...action.payload.timeline.entries],
        historyIndex: action.payload.timeline.cursor,
        branchRevision: action.payload.timeline.branchRevision,
        ...(action.payload.durableDocument !== undefined
          ? {
              durableDocument: action.payload.durableDocument,
              durableDiagnostics: action.payload.durableDiagnostics ?? [],
            }
          : {}),
        hasUnsavedChanges: true,
      };
    }
    case 'REPLACE_DOCUMENT': {
      const updates = action.payload.updates;
      const nextFrame =
        updates.documentFrame ?? (updates.totalSize ? documentFrameFromSize(updates.totalSize) : state.documentFrame);
      return {
        ...state,
        ...updates,
        documentFrame: cloneDocumentFrame(nextFrame),
        totalSize: documentFrameSize(nextFrame),
        documentId: action.payload.documentId,
        documentRevision: state.documentRevision + 1,
        branchRevision: 0,
        durableDocument: action.payload.durableDocument ?? null,
        durableDiagnostics: action.payload.durableDiagnostics ?? [],
        history: action.payload.history,
        historyIndex: action.payload.historyIndex ?? action.payload.history.length - 1,
      };
    }
    case 'SET_COLOR':
      return { ...state, color: action.payload };
    case 'SET_BACKGROUND_COLOR':
      return { ...state, backgroundColor: action.payload };
    case 'SET_SELECTIONS':
      return {
        ...state,
        selections: action.payload,
        activeSelectionId: action.payload.find((selection) => selection.isActive)?.id ?? null,
      };
    case 'ADD_SELECTION':
    case 'COMMIT_SELECTION':
      return commitSelection(state, action.payload);
    case 'UPDATE_SELECTION':
    case 'MOVE_SELECTION':
      return updateCommittedSelection(state, action.payload);
    case 'SET_ACTIVE_SELECTION':
      return {
        ...state,
        activeSelectionId: action.payload,
        selections: state.selections.map((selection) => ({ ...selection, isActive: selection.id === action.payload })),
      };
    case 'START_SELECTION_DRAFT':
      return {
        ...state,
        selectionDraft: { status: 'draft', sourceTool: action.payload.sourceTool },
      };
    case 'CANCEL_SELECTION_DRAFT':
      if (state.selectionDraft.status === 'idle') {
        return state;
      }

      return { ...state, selectionDraft: { status: 'idle' } };
    case 'SET_SELECTION_CLIPBOARD':
      return {
        ...state,
        selectionClipboard: action.payload,
      };
    case 'MARK_SELECTION_COPIED':
      return {
        ...state,
        selections: state.selections.map((selection) =>
          selection.id === action.payload.id
            ? {
                ...selection,
                metadata: {
                  ...selection.metadata,
                  copiedAtVersion: (selection.metadata?.copiedAtVersion ?? 0) + 1,
                },
              }
            : selection
        ),
      };
    case 'CLEAR_SELECTIONS':
      return {
        ...state,
        selections: [],
        activeSelectionId: null,
        selectionDraft: { status: 'idle' },
        selectionCleared: { status: 'cleared', version: (state.selectionCleared?.version ?? 0) + 1 },
      };
    default:
      return state;
  }
}

function buildDurableDocument(
  state: StoreData,
  history: readonly HistoryItem[],
  historyCursor: number,
  branchRevision: number
) {
  try {
    const converted = legacyHistoryToDurable(history, {
      documentId: state.documentId,
      documentRevision: state.documentRevision,
      branchRevision,
      durableRevision: (state.durableDocument?.durableRevision ?? 0) + 1,
      initialSize: state.totalSize,
      initialFrame: state.documentFrame,
    });
    const durableEntryId = history[historyCursor]?.id;
    const cursor = durableEntryId ? converted.document.history.findIndex((entry) => entry.id === durableEntryId) : -1;
    return {
      document: freezeDurableDocument({
        ...converted.document,
        cursor: cursor >= 0 ? cursor : converted.document.history.length - 1,
      }),
      diagnostics: converted.diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Durable history conversion failed', error);
    return state.durableDocument
      ? { document: state.durableDocument, diagnostics: [...(state.durableDiagnostics ?? []), `error: ${message}`] }
      : { document: null, diagnostics: [`error: ${message}`] };
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

  const currentArgsRef = useRef<ToolArgs>({} as ToolArgs);
  const previewLayersRef = useRef<Record<LayerId, { layer: Layer; toolArgs?: ToolArgs }>>({});
  const clearPreviewLayers = () => {
    previewLayersRef.current = {};
  };

  // Keep live DOM refs out of the reducer initializer; expose them after state updates.
  const [storeState, rawDispatch] = useReducer(reducer, initialState);
  const latestStateRef = useRef(storeState);
  useEffect(() => {
    latestStateRef.current = storeState;
  }, [storeState]);
  const dispatch: StoreDispatch = (action) => {
    // Legacy writers still submit HistoryItem; conversion and registry ownership
    // happen here so the reducer remains a pure atomic state transition.
    const currentState = latestStateRef.current;
    if (action.type === 'COMMIT_DOCUMENT_EDIT') {
      const timeline = updateHistoryTimeline(
        {
          entries: currentState.history,
          cursor: currentState.historyIndex,
          branchRevision: currentState.branchRevision,
        },
        { type: 'append', entry: action.payload.historyItem }
      );
      const converted = buildDurableDocument(
        currentState,
        [...timeline.entries],
        timeline.cursor,
        timeline.branchRevision
      );
      const updates = action.payload.updates ?? {};
      const nextFrame = updates.documentFrame;
      latestStateRef.current = {
        ...currentState,
        ...updates,
        ...(nextFrame ? { documentFrame: cloneDocumentFrame(nextFrame), totalSize: documentFrameSize(nextFrame) } : {}),
        history: [...timeline.entries],
        historyIndex: timeline.cursor,
        branchRevision: timeline.branchRevision,
        durableDocument: converted.document,
        durableDiagnostics: converted.diagnostics,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableDiagnostics: converted.diagnostics,
        },
      });
      return;
    }
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      const converted = buildDurableDocument(
        currentState,
        [...action.payload.timeline.entries],
        action.payload.timeline.cursor,
        action.payload.timeline.branchRevision
      );
      latestStateRef.current = {
        ...currentState,
        ...action.payload.updates,
        ...(action.payload.updates.documentFrame
          ? {
              documentFrame: cloneDocumentFrame(action.payload.updates.documentFrame),
              totalSize: documentFrameSize(action.payload.updates.documentFrame),
            }
          : {}),
        history: [...action.payload.timeline.entries],
        historyIndex: action.payload.timeline.cursor,
        branchRevision: action.payload.timeline.branchRevision,
        durableDocument: converted.document,
        durableDiagnostics: converted.diagnostics,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableDiagnostics: converted.diagnostics,
        },
      });
      return;
    }
    if (action.type === 'REPLACE_DOCUMENT') {
      const nextFrame =
        action.payload.updates.documentFrame ??
        (action.payload.updates.totalSize
          ? documentFrameFromSize(action.payload.updates.totalSize)
          : currentState.documentFrame);
      const converted = buildDurableDocument(
        {
          ...currentState,
          documentId: action.payload.documentId,
          documentRevision: currentState.documentRevision + 1,
          documentFrame: nextFrame,
          totalSize: documentFrameSize(nextFrame),
        },
        action.payload.history,
        action.payload.historyIndex ?? action.payload.history.length - 1,
        0
      );
      latestStateRef.current = {
        ...currentState,
        ...action.payload.updates,
        documentFrame: cloneDocumentFrame(nextFrame),
        totalSize: documentFrameSize(nextFrame),
        documentId: action.payload.documentId,
        documentRevision: currentState.documentRevision + 1,
        branchRevision: 0,
        durableDocument: converted.document,
        durableDiagnostics: converted.diagnostics,
        history: action.payload.history,
        historyIndex: action.payload.historyIndex ?? action.payload.history.length - 1,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableDiagnostics: converted.diagnostics,
        },
      });
      return;
    }
    rawDispatch(action);
  };
  const previousDocumentId = useRef(storeState.documentId);
  useEffect(() => {
    const previous = previousDocumentId.current;
    if (previous !== storeState.documentId) getAssetRegistry().disposeDocument(previous);
    previousDocumentId.current = storeState.documentId;
  }, [storeState.documentId]);
  const store = {
    ...storeState,
    canvasRef,
    toolOverlayRef,
    rectOverlayRef,
    containerRef,
    textareaRef,
    canvasCtxRef,
    currentArgs: currentArgsRef,
    clearPreviewLayers,
    previewLayers: previewLayersRef,
  };
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

export const useStore = (): [StoreData, StoreDispatch] => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};
