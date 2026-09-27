import React, { createContext, useContext, useEffect, useMemo, useRef, useReducer, type Dispatch } from 'react';
import { DEFAULT_TOOL } from '../util/constants.ts';

import type { ReactNode, RefObject } from 'react';
import type { Layer, LayerId, LayersRecord } from './layer-types.ts';
import type {
  BitmapSource,
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
import {
  convertLegacyHistorySafely,
  type DurableConversionStatus,
  type MigrationDiagnostic,
} from './history-adapter.ts';
import { getAssetRegistry } from './asset-registry.ts';
import {
  closePresentationBitmap,
  DocumentPresentationScope,
  isSamePresentationCanvas,
  layersDifferOnlyByPresentation,
  materializePresentationBitmap,
  type LayerPresentationBatch,
  type LayerPresentationPromotion,
  type LayerPresentationRequest,
} from './layer-presentation.ts';

/**
 * `current` describes an exact, transactionally converted shadow; `stale`
 * means runtime state changed outside that conversion; `unavailable` means
 * conversion failed and no durable shadow may be consumed.
 */
export type DurableDocumentStatus = DurableConversionStatus | 'stale';

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
  /**
   * Promotion of a disposable presentation cache. The bitmaps are materialized
   * asynchronously and published only while the requesting layers still hold
   * those exact canvases, so no runtime layer is mutated outside a reducer
   * publication. Pass every layer a single commit produced in one call.
   */
  promoteLayerPresentation: (request: LayerPresentationRequest | readonly LayerPresentationRequest[]) => void;
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
  /** Diagnostic shadow only; legacy history/runtime layers remain authoritative during cutover. */
  durableDocument: DurableDocument | null;
  /** A non-current sidecar must never be used as a replay or export input. */
  durableStatus: DurableDocumentStatus;
  durableDiagnostics: readonly MigrationDiagnostic[];

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
    | 'durableStatus'
    | 'durableDiagnostics'
    | 'promoteLayerPresentation'
  >
>;

/**
 * `BATCH_UPDATES` is the intended shape of a metadata-only batch. The action
 * keeps the wider legacy payload for compatibility with existing callers; no
 * production writer uses it for layer, frame, selection, or history state.
 */
export type StoreMetadataUpdates = Pick<StoreUpdates, 'fileName' | 'hasImage' | 'hasUnsavedChanges'>;

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
  | { type: 'PUBLISH_RUNTIME_PRESENTATION'; payload: { layers: LayersRecord } }
  | { type: 'PROMOTE_LAYER_PRESENTATIONS'; payload: LayerPresentationBatch }
  /**
   * Document metadata only, such as save state. Layer, frame, selection, and
   * history mutations have their own actions, so a history writer can never be
   * hidden inside a metadata batch.
   */
  | { type: 'BATCH_UPDATES'; payload: StoreUpdates }
  | {
      type: 'COMMIT_DOCUMENT_EDIT';
      payload: {
        updates?: StoreUpdates;
        historyItem: HistoryItem;
        durableDocument?: DurableDocument | null;
        durableStatus?: DurableDocumentStatus;
        durableDiagnostics?: readonly MigrationDiagnostic[];
      };
    }
  | {
      type: 'APPLY_HISTORY_REPLAY';
      payload: {
        updates: StoreUpdates;
        timeline: HistoryTimeline;
        durableDocument?: DurableDocument | null;
        durableStatus?: DurableDocumentStatus;
        durableDiagnostics?: readonly MigrationDiagnostic[];
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
        durableStatus?: DurableDocumentStatus;
        durableDiagnostics?: readonly MigrationDiagnostic[];
      };
    }
  | {
      type: 'SET_DURABLE_STATUS';
      payload: { status: DurableDocumentStatus; diagnostics: readonly MigrationDiagnostic[] };
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

export type StoreDispatch = Dispatch<Action>;

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
  promoteLayerPresentation: () => undefined,
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
  durableStatus: 'unavailable',
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
    durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
    durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
      };
    case 'SET_TOOL_NAME':
      return { ...state, isToolDirty: false, toolName: action.payload };
    case 'SET_TOOL_DIRTY':
      if (state.isToolDirty === action.payload) {
        return state;
      }
      return { ...state, isToolDirty: action.payload };
    case 'SET_LAYERS':
      return {
        ...state,
        layers: action.payload,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
      };
    case 'SET_ACTIVE_LAYER':
      if (state.activeLayerId === action.payload) {
        return state;
      }
      return {
        ...state,
        activeLayerId: action.payload,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
      };
    case 'ADD_LAYER':
      return {
        ...state,
        layers: action.payload.layers,
        activeLayerId: action.payload.activeLayerId,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
        hasUnsavedChanges: true,
      };
    case 'UPDATE_LAYERS':
      // Legacy escape hatch, retained for compatibility. No production writer
      // uses it: layer changes that belong to a document edit go through
      // `COMMIT_DOCUMENT_EDIT`, and cache promotion goes through
      // `PROMOTE_LAYER_PRESENTATIONS`.
      return {
        ...state,
        layers: action.payload,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
        hasUnsavedChanges: true,
      };
    case 'PUBLISH_RUNTIME_PRESENTATION':
      // Presentation-only publication of already-known layer records. The
      // dispatcher proves the payload differs from the stored layers only by a
      // promoted cache, so this transition cannot move durable logical state,
      // records no history, and does not invalidate the durable shadow.
      return { ...state, layers: action.payload.layers };
    case 'PROMOTE_LAYER_PRESENTATIONS': {
      // One transition for every promotion a commit produced. The dispatcher
      // already filtered out superseded canvases; the identity re-check keeps the
      // reducer pure and correct on its own. A bitmap that misses here is still
      // owned by the presentation scope, so it is closed on document release.
      let published = state.layers;
      for (const { layerId, canvas, bitmap } of action.payload.promotions) {
        const layer = published[layerId];
        if (!isSamePresentationCanvas(layer, canvas)) continue;
        if (published === state.layers) published = { ...state.layers };
        published[layerId] = { ...layer, bitmap, tmpCanvas: null };
      }
      return published === state.layers ? state : { ...state, layers: published };
    }
    case 'BATCH_UPDATES':
      // Metadata-only in production. The wider legacy payload stays
      // conservatively stale-marking because a compatibility caller may still
      // hand it document state.
      return {
        ...state,
        ...action.payload,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
              durableStatus:
                action.payload.durableStatus ?? (action.payload.durableDocument ? 'current' : 'unavailable'),
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
              durableStatus:
                action.payload.durableStatus ?? (action.payload.durableDocument ? 'current' : 'unavailable'),
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
        durableStatus: action.payload.durableStatus ?? (action.payload.durableDocument ? 'current' : 'unavailable'),
        durableDiagnostics: action.payload.durableDiagnostics ?? [],
        history: action.payload.history,
        historyIndex: action.payload.historyIndex ?? action.payload.history.length - 1,
      };
    }
    case 'SET_COLOR':
      return { ...state, color: action.payload };
    case 'SET_BACKGROUND_COLOR':
      return { ...state, backgroundColor: action.payload };
    case 'SET_DURABLE_STATUS':
      return { ...state, durableStatus: action.payload.status, durableDiagnostics: action.payload.diagnostics };
    case 'SET_SELECTIONS':
      return {
        ...state,
        selections: action.payload,
        activeSelectionId: action.payload.find((selection) => selection.isActive)?.id ?? null,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
      };
    case 'CLEAR_SELECTIONS':
      return {
        ...state,
        selections: [],
        activeSelectionId: null,
        selectionDraft: { status: 'idle' },
        selectionCleared: { status: 'cleared', version: (state.selectionCleared?.version ?? 0) + 1 },
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
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
    const converted = convertLegacyHistorySafely(history, {
      documentId: state.documentId,
      documentRevision: state.documentRevision,
      branchRevision,
      durableRevision: (state.durableDocument?.durableRevision ?? 0) + 1,
      initialSize: state.totalSize,
      initialFrame: state.documentFrame,
    });
    const cursor =
      Number.isInteger(historyCursor) && historyCursor >= 0
        ? (converted.legacyCursorToDurableCursor[historyCursor] ?? -1)
        : -1;
    return {
      status: converted.status,
      document: converted.document ? freezeDurableDocument({ ...converted.document, cursor }) : null,
      diagnostics: converted.diagnostics,
    };
  } catch (error) {
    return {
      status: 'unavailable' as const,
      document: null,
      diagnostics: [
        {
          severity: 'error' as const,
          code: 'conversion-failed' as const,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
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
  // Presentation ownership is provider-scoped, not document-scoped. A document
  // replacement commits in the same turn as a promotion requested just before
  // it, so a per-document scope would dispose a bitmap the new document
  // legitimately owns. The document boundary is the canvas identity token, and
  // document exit releases that document's published caches explicitly.
  const presentationScope = useMemo(() => new DocumentPresentationScope(), []);
  useEffect(() => () => presentationScope.dispose(), [presentationScope]);
  useEffect(() => {
    const releasedDocumentId = storeState.documentId;
    return () => presentationScope.releaseDocument(releasedDocumentId);
  }, [presentationScope, storeState.documentId]);
  useEffect(() => {
    latestStateRef.current = storeState;
  }, [storeState]);
  const dispatch: StoreDispatch = (action) => {
    // Legacy writers still submit HistoryItem; conversion and registry ownership
    // happen here so the reducer remains a pure atomic state transition.
    const currentState = latestStateRef.current;
    if (action.type === 'PROMOTE_LAYER_PRESENTATIONS') {
      // A promotion is accepted only while the layer still holds the requesting
      // canvas. A superseded bitmap can never reach a layer, so the dispatcher
      // closes it here, and the cache it replaces is closed only when this
      // boundary created it.
      const superseded: Array<BitmapSource | null> = [];
      const promotions = action.payload.promotions.filter(({ layerId, canvas, bitmap }) => {
        if (isSamePresentationCanvas(currentState.layers[layerId], canvas)) {
          presentationScope.trackPublished(currentState.documentId, bitmap);
          superseded.push(currentState.layers[layerId].bitmap);
          return true;
        }
        closePresentationBitmap(bitmap);
        return false;
      });
      if (!promotions.length) return;
      const accepted: Action =
        promotions.length === action.payload.promotions.length
          ? action
          : { type: 'PROMOTE_LAYER_PRESENTATIONS', payload: { promotions } };
      latestStateRef.current = reducer(currentState, accepted);
      rawDispatch(accepted);
      // Retire the replaced caches only after the publication, so a dropped
      // update can never leave a live layer pointing at a closed bitmap.
      for (const previous of superseded) presentationScope.retire(previous);
      return;
    }
    if (action.type === 'PUBLISH_RUNTIME_PRESENTATION') {
      if (!layersDifferOnlyByPresentation(currentState.layers, action.payload.layers)) {
        // A refused publication is a contained no-op: the layer keeps rendering
        // from its tmpCanvas and no logical state moves. It is the intended path
        // for a record that only differs by an identity operation, so it is not
        // a warning; a refusal that is not identity-only is the defect case.
        console.debug('Ignored a runtime presentation publication that also changes durable layer state');
        return;
      }
      latestStateRef.current = reducer(currentState, action);
      rawDispatch(action);
      return;
    }
    if (action.type === 'COMMIT_DOCUMENT_EDIT') {
      const timeline = updateHistoryTimeline(
        {
          entries: currentState.history,
          cursor: currentState.historyIndex,
          branchRevision: currentState.branchRevision,
        },
        { type: 'append', entry: action.payload.historyItem }
      );
      const updates = action.payload.updates ?? {};
      const nextFrame = updates.documentFrame;
      const converted = buildDurableDocument(
        nextFrame
          ? {
              ...currentState,
              documentFrame: cloneDocumentFrame(nextFrame),
              totalSize: documentFrameSize(nextFrame),
            }
          : currentState,
        [...timeline.entries],
        timeline.cursor,
        timeline.branchRevision
      );
      latestStateRef.current = {
        ...currentState,
        ...updates,
        ...(nextFrame ? { documentFrame: cloneDocumentFrame(nextFrame), totalSize: documentFrameSize(nextFrame) } : {}),
        history: [...timeline.entries],
        historyIndex: timeline.cursor,
        branchRevision: timeline.branchRevision,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableStatus: converted.status,
          durableDiagnostics: converted.diagnostics,
        },
      });
      return;
    }
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      const replayUpdates = action.payload.updates;
      const replayFrame = replayUpdates.documentFrame;
      const converted = buildDurableDocument(
        replayFrame
          ? {
              ...currentState,
              documentFrame: cloneDocumentFrame(replayFrame),
              totalSize: documentFrameSize(replayFrame),
            }
          : currentState,
        [...action.payload.timeline.entries],
        action.payload.timeline.cursor,
        action.payload.timeline.branchRevision
      );
      latestStateRef.current = {
        ...currentState,
        ...replayUpdates,
        ...(replayFrame
          ? {
              documentFrame: cloneDocumentFrame(replayFrame),
              totalSize: documentFrameSize(replayFrame),
            }
          : {}),
        history: [...action.payload.timeline.entries],
        historyIndex: action.payload.timeline.cursor,
        branchRevision: action.payload.timeline.branchRevision,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableStatus: converted.status,
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
      if (currentState.documentId !== action.payload.documentId) {
        getAssetRegistry().disposeDocument(currentState.documentId);
      }
      latestStateRef.current = {
        ...currentState,
        ...action.payload.updates,
        documentFrame: cloneDocumentFrame(nextFrame),
        totalSize: documentFrameSize(nextFrame),
        documentId: action.payload.documentId,
        documentRevision: currentState.documentRevision + 1,
        branchRevision: 0,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
        history: action.payload.history,
        historyIndex: action.payload.historyIndex ?? action.payload.history.length - 1,
      };
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableStatus: converted.status,
          durableDiagnostics: converted.diagnostics,
        },
      });
      return;
    }
    latestStateRef.current = reducer(currentState, action);
    rawDispatch(action);
  };
  const promoteLayerPresentation = (request: LayerPresentationRequest | readonly LayerPresentationRequest[]) => {
    const requests = (Array.isArray(request) ? request : [request as LayerPresentationRequest]).filter(
      (candidate) => candidate.canvas
    );
    if (!requests.length) return;
    // One scope owns every in-flight materialization and the store receives one
    // publication for the whole batch, so a commit that dirties several layers
    // costs a single store transition.
    presentationScope.deliverBatch(
      // Each materialization settles on its own so one failure cannot drop the
      // bitmaps the other requests already produced.
      Promise.all(
        requests.map((candidate) =>
          materializePresentationBitmap(candidate.canvas).catch((error) => {
            console.error('Unable to materialize a layer presentation cache', error);
            return undefined;
          })
        )
      ),
      (bitmaps) => {
        const promotions = requests
          .map((candidate, index) => {
            const bitmap = bitmaps[index];
            return bitmap ? { ...candidate, bitmap } : undefined;
          })
          .filter((promotion): promotion is LayerPresentationPromotion => promotion !== undefined);
        if (!promotions.length) return;
        dispatch({ type: 'PROMOTE_LAYER_PRESENTATIONS', payload: { promotions } });
      }
    );
  };
  useEffect(
    () => () => {
      // The registry tombstones disposed document IDs, so this cleanup safely
      // backs up synchronous dispatch disposal and React development probes.
      getAssetRegistry().disposeDocument(storeState.documentId);
    },
    [storeState.documentId]
  );
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
    promoteLayerPresentation,
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
