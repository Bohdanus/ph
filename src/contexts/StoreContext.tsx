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
import { freezeDurableDocument, type DurableDocument, type DurableHistoryEntry } from './history-model.ts';
import {
  convertLegacyHistorySafely,
  type DurableConversionStatus,
  type MigrationDiagnostic,
} from './history-adapter.ts';
import { decideDurableAppend, durableAppendDiagnostic } from './history-append.ts';
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
 *
 * INVARIANT: `stale` must mean "the durable document is no longer a faithful
 * projection of the history", and nothing else. `buildDurableDocument` below
 * converts the history entries and reads exactly six pieces of store state as
 * conversion inputs: `documentId`, `documentRevision`, `branchRevision`,
 * `totalSize` (as `initialSize`), `documentFrame` (as `initialFrame`), and
 * `durableDocument.durableRevision`. Those are the only inputs whose movement
 * can make a stored durable document unfaithful, so a transition that writes
 * none of them must not downgrade the status.
 *
 * Two consequences make the narrow rule safe rather than merely optimistic:
 *
 * 1. Runtime layers and selection state never reach the converted document.
 *    `DurableBaseline.activeLayerId` is derived from the FIRST history entry
 *    (`history-adapter.ts` `snapshotFromDocumentSource`), never from
 *    `state.activeLayerId`, and `DurableBaseline.selections` is derived from the
 *    history timeline by the shared rule in `selection-baseline.ts` — the first
 *    enabled `SELECTION_ACTION` entry's `previousSelectionState` — never from live
 *    store state. A selection
 *    can therefore only enter the document through a `SELECTION_ACTION` history
 *    entry, and a layer operation only through a history entry. This holds
 *    whichever rule seeds the baseline, because both read the timeline.
 * 2. `stale` is sticky. Every action that writes one of the six inputs either
 *    marks `stale` or reconverts and writes the resulting status, so no
 *    non-reconverting transition can ever clear a `stale` that a durable input
 *    produced. A transition that stops marking `stale` therefore cannot unblock
 *    a publication that a genuine divergence had blocked.
 *
 * The append gate (`decideDurableAppend`, reached at the `base:` argument of the
 * `COMMIT_DOCUMENT_EDIT` dispatcher branch) additionally re-checks
 * `documentId`, `documentRevision` and `branchRevision` against the live state,
 * and a publish extends the stored document without reconverting it — so the
 * gate depends on input freshness, not on the reconversion being byte-stable
 * (conversion mints fresh `AssetId`s from the asset registry's identity cache).
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
        /**
         * The durable entry the append boundary planned for this edit. When the
         * store can publish it against its current durable document, the planned
         * entry becomes the durable state instead of a full reconversion. It is
         * never authoritative on its own: a disagreement falls back to the
         * conversion and is reported as a diagnostic.
         */
        durableEntry?: DurableHistoryEntry | null;
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

type CommitDocumentEditAction = Extract<Action, { type: 'COMMIT_DOCUMENT_EDIT' }>;

function projectCommitDocumentEdit(
  state: StoreData,
  action: CommitDocumentEditAction,
  timeline: HistoryTimeline
): StoreData {
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
          durableStatus: action.payload.durableStatus ?? (action.payload.durableDocument ? 'current' : 'unavailable'),
          durableDiagnostics: action.payload.durableDiagnostics ?? [],
        }
      : {}),
    hasUnsavedChanges: true,
  };
}

function commitSelection(state: StoreData, selection: Selection): StoreData {
  const committedSelection: Selection = {
    ...selection,
    isActive: true,
    lifecycle: 'committed',
    geometry: selection.geometry ?? 'polygon',
  };

  // No durable input moves: `ADD_SELECTION`/`COMMIT_SELECTION` write only
  // selection state, append no history entry, and the conversion never reads
  // selection state (see the `DurableDocumentStatus` invariant).
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

  // No durable input moves, for the same reason as `commitSelection`. These
  // transitions are the common case while a selection is being dragged, so
  // downgrading here would make an ordinary crop append fall back to a
  // whole-timeline reconversion.
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
      // `totalSize` is the conversion's `initialSize`, so this genuinely moves a
      // durable input. It is the only transition outside the three document
      // writers that does, which is why the append gate relies on it invalidating.
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
      // Kept conservative on purpose. Runtime layers are not one of the six
      // conversion inputs, but no production writer dispatches this action; a
      // layer create/remove/reorder reaches the document through a history entry
      // in `COMMIT_DOCUMENT_EDIT`, which reconverts. Marking here costs nothing
      // and means a future layer writer cannot be assumed to arrive on a
      // reconverting path.
      return {
        ...state,
        layers: action.payload,
        durableStatus: state.durableStatus === 'unavailable' ? 'unavailable' : 'stale',
      };
    case 'SET_ACTIVE_LAYER':
      if (state.activeLayerId === action.payload) {
        return state;
      }
      // Focus only. The converted document's active layer is derived from the
      // first history entry, so this writes no durable input.
      return { ...state, activeLayerId: action.payload };
    case 'ADD_LAYER':
      // Conservative, as for `SET_LAYERS`: zero production dispatch, and a real
      // layer create is a history append that reconverts.
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
      // `PROMOTE_LAYER_PRESENTATIONS`. Conservative, as for `SET_LAYERS`.
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
      // Metadata-only in production (the sole writer passes `fileName` and
      // `hasUnsavedChanges`). The wider legacy payload type still admits
      // `totalSize` and `documentFrame`, which are durable inputs, so this
      // transition stays conservatively stale-marking rather than trusting the
      // current callers to stay narrow.
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
      return projectCommitDocumentEdit(state, action, timeline);
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
      // Selection state only; no durable input moves.
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
      // Selection focus only; no durable input moves.
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
      // Selection metadata only; the clipboard itself already never invalidated.
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
      // Selection state only; no durable input moves.
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

/**
 * Retires the presentation caches the published layer record no longer names.
 *
 * A cache is a candidate only when the transition dropped it from the live
 * record: either its layer is gone, or the layer that took its place points at a
 * different cache. `deletedLayers` and layer identity prove neither — the
 * deleted record accumulates across removals and survives undo, and replay
 * re-creates a removed layer under the same id with a freshly built cache — so
 * neither is consulted here.
 *
 * Ownership still decides. `retire` closes a bitmap only when this scope
 * published it, so a borrowed import, a replay source, and an in-flight
 * materialization are all left alone, and a cache that merely moved to another
 * layer stays live.
 */
function retireDepartedPresentationBitmaps(
  presentationScope: DocumentPresentationScope,
  previous: LayersRecord,
  next: LayersRecord
): void {
  const live = new Set<BitmapSource>();
  for (const layer of Object.values(next)) {
    if (layer.bitmap) live.add(layer.bitmap);
  }
  for (const layer of Object.values(previous)) {
    if (layer.bitmap && !live.has(layer.bitmap)) presentationScope.retire(layer.bitmap);
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
      // One append, one durable entry: the boundary's plan is published when the
      // store's durable document still describes the timeline it was planned
      // against, and the whole timeline is reconverted otherwise.
      const planned = decideDurableAppend({
        documentId: currentState.documentId,
        base: currentState.durableStatus === 'current' ? currentState.durableDocument : null,
        prior: {
          entries: currentState.history,
          cursor: currentState.historyIndex,
          branchRevision: currentState.branchRevision,
        },
        next: timeline,
        entry: action.payload.historyItem,
        planned: action.payload.durableEntry,
        documentRevision: currentState.documentRevision,
      });
      const converted =
        planned.outcome === 'published'
          ? { status: 'current' as const, document: planned.document, diagnostics: currentState.durableDiagnostics }
          : buildDurableDocument(
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
      if (planned.outcome === 'mismatch') {
        converted.diagnostics = [
          ...converted.diagnostics,
          durableAppendDiagnostic(action.payload.historyItem, planned.reason),
        ];
      }
      const committedAction: CommitDocumentEditAction = {
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableStatus: converted.status,
          durableDiagnostics: converted.diagnostics,
        },
      };
      const nextState = projectCommitDocumentEdit(currentState, committedAction, timeline);
      latestStateRef.current = nextState;
      rawDispatch(committedAction);
      // Retirement runs after the transition is published, and only against the
      // record that transition actually produced: a delete, a merge, and a
      // commit that swaps a layer's cache all leave a published bitmap behind
      // with no remaining reference. The shared projection above matches the
      // reducer fields, including the dirty flag, before the queued transition.
      retireDepartedPresentationBitmaps(presentationScope, currentState.layers, nextState.layers);
      return;
    }
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      // The action type requires `updates`; defaulting it here keeps a malformed
      // navigation a no-op instead of a dispatch that throws mid-reducer.
      const replayUpdates = action.payload.updates ?? {};
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
      const nextState: StoreData = {
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
      latestStateRef.current = nextState;
      rawDispatch({
        ...action,
        payload: {
          ...action.payload,
          durableDocument: converted.document,
          durableStatus: converted.status,
          durableDiagnostics: converted.diagnostics,
        },
      });
      // Replay is the other way a cache leaves the record, and the identity case
      // is the common one: navigating back over a removal re-creates the layer
      // under the same id with no cache at all, or with a different one. The
      // replayed record is already painted, so retiring against it cannot blank
      // a layer that is still on screen.
      retireDepartedPresentationBitmaps(presentationScope, currentState.layers, nextState.layers);
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
