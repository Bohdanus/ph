import React, { createContext, useContext, useEffect, useMemo, useRef, useReducer, type Dispatch } from 'react';
import { DEFAULT_TOOL, MERGE_ACTION, NEW_LAYER_ACTION, REORDER_ACTION } from '../util/constants.ts';

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
import { createHistoryItem } from './history-utils.ts';
import { getSortedLayersArray, reorderLayers } from './layer-utils.ts';
import {
  collectDurableAssetIds,
  freezeDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
} from './history-model.ts';
import {
  convertLegacyHistorySafely,
  type DurableConversionStatus,
  type MigrationDiagnostic,
} from './history-adapter.ts';
import {
  decideDurableAppend,
  deriveCreateLayerEntry,
  deriveMergeDocumentEntry,
  deriveReorderLayersEntry,
  durableAppendDiagnostic,
  type SourceBackedEntryContext,
} from './history-append.ts';
import { replayDurableDocument } from './durable-replay.ts';
import { getAssetRegistry, type DocumentAssetTransaction } from './asset-registry.ts';
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

type DurableProjection = {
  document: DurableDocument | null;
  status: DurableDocumentStatus;
  diagnostics: readonly MigrationDiagnostic[];
};

export type StoreData = {
  // refs
  canvasRef: RefObject<HTMLCanvasElement | null>;
  toolOverlayRef: RefObject<HTMLCanvasElement | null>;
  rectOverlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;

  currentArgs: React.RefObject<ToolArgs>;
  clearPreviewLayers: () => void;
  /**
   * Promotion of a disposable presentation cache. The bitmaps are materialized
   * asynchronously and published only while the requesting layers still hold
   * those exact canvases, so no runtime layer is mutated outside a reducer
   * publication. Pass every layer a single commit produced in one call.
   */
  promoteLayerPresentation: (request: LayerPresentationRequest | readonly LayerPresentationRequest[]) => void;
  /** Internal presentation publication; logical layer state is checked by the store. */
  publishRuntimePresentation: (layers: LayersRecord) => void;
  /** Internal adoption registration; the action is not part of public dispatch. */
  adoptLayerBitmaps: (bitmaps: readonly BitmapSource[]) => void;
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
    | 'publishRuntimePresentation'
    | 'adoptLayerBitmaps'
  >
>;

/**
 * `BATCH_UPDATES` is the intended shape of a metadata-only batch. The action
 * keeps the wider legacy payload for compatibility with existing callers; no
 * production writer uses it for layer, frame, selection, or history state.
 */
export type StoreMetadataUpdates = Pick<StoreUpdates, 'fileName' | 'hasImage' | 'hasUnsavedChanges'>;

type ReorderLayersIntent = {
  layerToMoveId: LayerId;
  afterWhichLayerId?: LayerId | null;
};

type ReorderLayersIntentAction = {
  type: 'REORDER_LAYERS';
  /** Callers provide intent only; the store owns the history and projection metadata. */
  payload: ReorderLayersIntent;
  historyItem?: never;
  durableProjection?: never;
};

type ReorderLayersCommittedAction = {
  type: 'REORDER_LAYERS';
  payload: ReorderLayersIntent;
  /** Dispatcher-owned metadata keeps the reducer and fast path on one history item and conversion. */
  historyItem: HistoryItem;
  durableProjection: DurableProjection;
};

type ReorderLayersAction = ReorderLayersIntentAction | ReorderLayersCommittedAction;

type CommitDocumentEditIntentPayload = {
  updates?: StoreUpdates;
  historyItem: HistoryItem;
  /** The durable entry the append boundary planned for this edit. */
  durableEntry?: DurableHistoryEntry | null;
  /** Diagnostics from the append boundary; they are folded into the projection. */
  durableDiagnostics?: readonly MigrationDiagnostic[];
  durableDocument?: never;
  durableStatus?: never;
};

type CommitDocumentEditCommittedPayload = Omit<CommitDocumentEditIntentPayload, 'durableDocument' | 'durableStatus'> & {
  durableDocument: DurableDocument | null;
  durableStatus: DurableDocumentStatus;
  durableDiagnostics: readonly MigrationDiagnostic[];
};

type ApplyHistoryReplayIntentPayload = {
  updates: StoreUpdates;
  timeline: HistoryTimeline;
  durableDiagnostics?: readonly MigrationDiagnostic[];
  durableDocument?: never;
  durableStatus?: never;
};

type ApplyHistoryReplayCommittedPayload = Omit<ApplyHistoryReplayIntentPayload, 'durableDocument' | 'durableStatus'> & {
  durableDocument: DurableDocument | null;
  durableStatus: DurableDocumentStatus;
  durableDiagnostics: readonly MigrationDiagnostic[];
};

type ReplaceDocumentIntentPayload = {
  documentId: string;
  updates: StoreUpdates;
  history: HistoryItem[];
  historyIndex?: number;
  durableDiagnostics?: readonly MigrationDiagnostic[];
  durableDocument?: never;
  durableStatus?: never;
};

type ReplaceDocumentCommittedPayload = Omit<ReplaceDocumentIntentPayload, 'durableDocument' | 'durableStatus'> & {
  durableDocument: DurableDocument | null;
  durableStatus: DurableDocumentStatus;
  durableDiagnostics: readonly MigrationDiagnostic[];
};

export type Action =
  | { type: 'SET_HAS_IMAGE'; payload: boolean }
  | { type: 'SET_HAS_UNSAVED_CHANGES'; payload: boolean }
  | { type: 'SET_FILE_NAME'; payload: string }
  | { type: 'SET_ORIGINAL_IMAGE'; payload: boolean }
  | { type: 'SET_SIZE'; payload: Size }
  | { type: 'SET_TOOL_NAME'; payload: ToolName }
  | { type: 'SET_LAYERS'; payload: LayersRecord }
  | { type: 'SET_ACTIVE_LAYER'; payload: LayerId | null }
  | { type: 'ADD_LAYER'; payload: { layers: LayersRecord; activeLayerId: LayerId } }
  | { type: 'PROMOTE_LAYER_PRESENTATIONS'; payload: LayerPresentationBatch }
  | ReorderLayersAction
  /**
   * Document metadata only, such as save state. Layer, frame, selection, and
   * history mutations have their own actions, so a history writer can never be
   * hidden inside a metadata batch.
   */
  | { type: 'BATCH_UPDATES'; payload: StoreUpdates }
  | {
      type: 'COMMIT_DOCUMENT_EDIT';
      payload: CommitDocumentEditIntentPayload | CommitDocumentEditCommittedPayload;
    }
  | {
      type: 'APPLY_HISTORY_REPLAY';
      payload: ApplyHistoryReplayIntentPayload | ApplyHistoryReplayCommittedPayload;
    }
  | {
      type: 'REPLACE_DOCUMENT';
      payload: ReplaceDocumentIntentPayload | ReplaceDocumentCommittedPayload;
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

type InternalAction =
  | { type: 'PUBLISH_RUNTIME_PRESENTATION'; payload: { layers: LayersRecord } }
  | { type: 'ADOPT_LAYER_BITMAPS'; payload: { bitmaps: readonly BitmapSource[] } };

type StoreAction = Action | InternalAction;

export type PublicAction = Action;
export type StoreDispatch = Dispatch<PublicAction>;

const StoreContext = createContext<[StoreData, StoreDispatch] | undefined>(undefined);

const initialState: StoreData = {
  canvasRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  containerRef: { current: null },
  textareaRef: { current: null },

  currentArgs: { current: {} as ToolArgs },
  clearPreviewLayers: () => undefined,
  promoteLayerPresentation: () => undefined,
  publishRuntimePresentation: () => undefined,
  adoptLayerBitmaps: () => undefined,
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
};

function normalizeDurableProjection(projection: DurableProjection): DurableProjection {
  return projection.status === 'current' ? projection : { ...projection, document: null };
}

function appendBoundaryDiagnostics(
  projection: DurableProjection,
  diagnostics: readonly MigrationDiagnostic[]
): DurableProjection {
  const merged: DurableProjection = {
    ...projection,
    diagnostics: [...projection.diagnostics, ...diagnostics],
  };
  // Boundary errors describe an append that the durable side cannot trust. A
  // warning is deliberately retained without changing a current document into
  // an unavailable one; severity is part of the diagnostic contract.
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { ...merged, document: null, status: 'unavailable' }
    : normalizeDurableProjection(merged);
}

/**
 * The one post-transition projection, shared by every path that publishes a
 * new timeline: the `COMMIT_DOCUMENT_EDIT` reducer branch, the dispatcher's
 * commit fast path, the `APPLY_HISTORY_REPLAY` reducer branch, the dispatcher's
 * replay path, and the store-owned reorder action.
 *
 * The dispatcher bypasses the reducer and pre-computes `latestStateRef` so a
 * second dispatch in the same React batch is decided against the state the
 * first one produced. When that copy was hand-written it silently dropped
 * `hasUnsavedChanges`, so after an undo the ref disagreed with the published
 * state. One function removes the class of bug rather than the instance.
 */
function projectPublishedTimeline(
  state: StoreData,
  payload: {
    updates?: StoreUpdates;
    timeline: HistoryTimeline;
    durableDocument: DurableDocument | null;
    durableStatus: DurableDocumentStatus;
    durableDiagnostics: readonly MigrationDiagnostic[];
  }
): StoreData {
  const updates = payload.updates ?? {};
  const nextFrame = updates.documentFrame;
  const durable = normalizeDurableProjection({
    document: payload.durableDocument,
    status: payload.durableStatus,
    diagnostics: payload.durableDiagnostics,
  });
  return {
    ...state,
    ...updates,
    ...(nextFrame ? { documentFrame: cloneDocumentFrame(nextFrame), totalSize: documentFrameSize(nextFrame) } : {}),
    history: [...payload.timeline.entries],
    historyIndex: payload.timeline.cursor,
    branchRevision: payload.timeline.branchRevision,
    durableDocument: durable.document,
    durableStatus: durable.status,
    durableDiagnostics: durable.diagnostics,
    hasUnsavedChanges: true,
  };
}

function replacementFrame(
  state: StoreData,
  payload: Pick<ReplaceDocumentIntentPayload, 'updates' | 'history'>
): DocumentFrame {
  const updates = payload.updates;
  if (updates.documentFrame) return cloneDocumentFrame(updates.documentFrame);
  if (updates.totalSize) return documentFrameFromSize(updates.totalSize);

  const baseline = payload.history[0]?.documentSource;
  if (baseline?.frame) return cloneDocumentFrame(baseline.frame);
  if (baseline?.size) return documentFrameFromSize(baseline.size);
  return cloneDocumentFrame(state.documentFrame);
}

/** One projection for both the reducer and REPLACE_DOCUMENT's dispatcher fast path. */
function projectReplacedDocument(
  state: StoreData,
  payload: Pick<ReplaceDocumentIntentPayload, 'documentId' | 'updates' | 'history' | 'historyIndex'>,
  projection: DurableProjection
): StoreData {
  const nextFrame = replacementFrame(state, payload);
  const durable = normalizeDurableProjection(projection);
  return {
    ...state,
    ...payload.updates,
    documentFrame: cloneDocumentFrame(nextFrame),
    totalSize: documentFrameSize(nextFrame),
    documentId: payload.documentId,
    documentRevision: state.documentRevision + 1,
    branchRevision: 0,
    durableDocument: durable.document,
    durableStatus: durable.status,
    durableDiagnostics: durable.diagnostics,
    history: payload.history,
    historyIndex: payload.historyIndex ?? payload.history.length - 1,
  };
}

function createReorderHistoryItem(intent: ReorderLayersIntent): HistoryItem {
  return createHistoryItem({
    layerId: intent.layerToMoveId,
    actionName: REORDER_ACTION,
    args: { layerToMoveId: intent.layerToMoveId, afterWhichLayerId: intent.afterWhichLayerId },
  });
}

/**
 * The live record's layer order, bottom first: index 0 is the bottom of the
 * stack, which is the same sequence `reorderLayers` mutates, `replayHistory`
 * replays, and the durable converter normalizes its own snapshots into.
 *
 * Read here, at the store, rather than in the hook: a drag dispatches 200 ms
 * after the row that started it was rendered, so a closure's copy of the layer
 * record is stale by exactly the interval in which a rename or a second reorder
 * can land.
 *
 * This is `getSortedLayersArray` rather than a local sort on purpose. The order
 * this reads IS the feature — everything downstream is derived from the sequence
 * it produces — so a private copy of the comparator would be a second
 * implementation of a load-bearing rule, and the parity test would pin the test's
 * copy rather than this one.
 */
function layerOrderBottomFirst(layers: LayersRecord): LayerId[] {
  return getSortedLayersArray(layers).map((layer) => layer.id);
}

function durableLayersAtCursor(document: DurableDocument | null): Map<LayerId, DurableLayerSnapshot> {
  if (!document) return new Map();
  const replayed = replayDurableDocument(document, document.cursor);
  return new Map(Object.entries(replayed.layers).map(([id, layer]) => [id, layer.snapshot]));
}

function sourceBackedEntryContext(
  state: StoreData,
  historyItem: HistoryItem,
  registry: ReturnType<typeof getAssetRegistry>
): SourceBackedEntryContext | null {
  if (historyItem.actionName !== NEW_LAYER_ACTION && historyItem.actionName !== MERGE_ACTION) {
    return null;
  }
  const candidate = historyItem.layerSource ?? historyItem.args;
  const candidateRecord = candidate as { kind?: unknown; args?: unknown } | undefined;
  if (
    candidateRecord &&
    candidateRecord.kind === 'tool' &&
    !['text', 'shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line'].includes(
      (candidateRecord.args as ToolArgs).toolName
    )
  ) {
    // Raster creator tools have no durable source representation yet. They are
    // intentionally conversion-only; do not enter the planner only to throw.
    return null;
  }
  return {
    documentId: state.documentId,
    registry,
    preLayers: durableLayersAtCursor(state.durableStatus === 'current' ? state.durableDocument : null),
    liveLayers: state.layers,
  };
}

function reorderLayersFromState(layers: LayersRecord, intent: ReorderLayersIntent): LayersRecord {
  if (!layers[intent.layerToMoveId]) return layers;
  if (intent.afterWhichLayerId && !layers[intent.afterWhichLayerId]) return layers;

  const reorderedLayers = Object.fromEntries(
    Object.entries(layers).map(([id, layer]) => [id, { ...layer, pos: { ...layer.pos } }])
  ) as LayersRecord;

  // Legacy replay treats an absent mover or anchor as a no-op. Avoid calling the
  // mutating helper in that case so the store keeps the same no-throw semantics.
  reorderLayers({
    layers: reorderedLayers,
    layerToMoveId: intent.layerToMoveId,
    afterWhichLayerId: intent.afterWhichLayerId,
  });
  return reorderedLayers;
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

function reducer(state: StoreData, action: StoreAction): StoreData {
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
      return { ...state, toolName: action.payload };
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
    case 'REORDER_LAYERS': {
      if (!action.historyItem || !action.durableProjection) return state;
      const historyItem = action.historyItem;
      const timeline = updateHistoryTimeline(
        { entries: state.history, cursor: state.historyIndex, branchRevision: state.branchRevision },
        { type: 'append', entry: historyItem }
      );
      const durableProjection = action.durableProjection;
      return projectPublishedTimeline(state, {
        updates: { layers: reorderLayersFromState(state.layers, action.payload) },
        timeline,
        durableDocument: durableProjection.document,
        durableStatus: durableProjection.status,
        durableDiagnostics: durableProjection.diagnostics,
      });
    }
    case 'COMMIT_DOCUMENT_EDIT': {
      if (
        action.payload.durableDocument === undefined ||
        action.payload.durableStatus === undefined ||
        action.payload.durableDiagnostics === undefined
      )
        return state;
      const committedPayload = action.payload as CommitDocumentEditCommittedPayload;
      const timeline = updateHistoryTimeline(
        { entries: state.history, cursor: state.historyIndex, branchRevision: state.branchRevision },
        { type: 'append', entry: committedPayload.historyItem }
      );
      return projectPublishedTimeline(state, { ...committedPayload, timeline });
    }
    case 'APPLY_HISTORY_REPLAY': {
      if (
        action.payload.durableDocument === undefined ||
        action.payload.durableStatus === undefined ||
        action.payload.durableDiagnostics === undefined
      )
        return state;
      return projectPublishedTimeline(state, action.payload as ApplyHistoryReplayCommittedPayload);
    }
    case 'REPLACE_DOCUMENT': {
      if (
        action.payload.durableDocument === undefined ||
        action.payload.durableStatus === undefined ||
        action.payload.durableDiagnostics === undefined
      )
        return state;
      const committedPayload = action.payload as ReplaceDocumentCommittedPayload;
      return projectReplacedDocument(state, committedPayload, {
        document: committedPayload.durableDocument,
        status: committedPayload.durableStatus,
        diagnostics: committedPayload.durableDiagnostics,
      });
    }
    case 'SET_COLOR':
      return { ...state, color: action.payload };
    case 'SET_BACKGROUND_COLOR':
      return { ...state, backgroundColor: action.payload };
    case 'SET_DURABLE_STATUS':
      return {
        ...state,
        durableDocument: action.payload.status === 'current' ? state.durableDocument : null,
        durableStatus: action.payload.status,
        durableDiagnostics: action.payload.diagnostics,
      };
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
      durableRevision: (state.durableStatus === 'current' ? (state.durableDocument?.durableRevision ?? 0) : 0) + 1,
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
 * Every raster the document still names, from anywhere a later read can reach it.
 *
 * An adopted raster — one a writer minted for an import, a merge, or a
 * document import — has three aliases, not one: the layer's own `bitmap`, the
 * `source` object the layer stores verbatim, and the `layerSource`/`args`
 * reference a `MERGE_ACTION` or an import entry retains rather than copies. So
 * `history-replay` reads the same bitmap back on undo, and a liveness set built
 * from `layer.bitmap` alone would let the scope close a bitmap replay is about
 * to use.
 *
 * `tmpCanvas` is included for the same reason: a preview canvas is not owned by
 * the scope, but it IS reachable, and keeping it out of the set would only ever
 * make the set smaller and the scope more eager to close.
 */
function imageSourceBitmap(value: unknown): BitmapSource | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { kind?: unknown; bitmap?: BitmapSource };
  return candidate.kind === 'image' && candidate.bitmap ? candidate.bitmap : null;
}

function collectLivePresentationBitmaps(next: LayersRecord, history: readonly HistoryItem[]): Set<BitmapSource> {
  const live = new Set<BitmapSource>();
  const add = (bitmap: BitmapSource | null | undefined) => {
    if (bitmap) live.add(bitmap);
  };
  const addLayerAliases = (layer: Layer) => {
    add(layer.bitmap);
    add(layer.tmpCanvas);
    add(imageSourceBitmap(layer.source));
  };
  for (const layer of Object.values(next)) addLayerAliases(layer);
  for (const entry of history) {
    add(imageSourceBitmap(entry.layerSource));
    add(imageSourceBitmap(entry.args));
    if (entry.documentSource) {
      for (const layer of Object.values(entry.documentSource.layers)) addLayerAliases(layer);
    }
  }
  return live;
}

/**
 * Closes the caches the transition left behind, and only those.
 *
 * `previous` is deliberately not consulted. It used to supply the candidates,
 * which was right when every cache in the scope had been `previous[].bitmap` at
 * the moment it was replaced, and is wrong now that the scope also owns adopted
 * rasters: one can leave the store's reach through a history truncation without
 * ever appearing in a previous record. Candidacy now comes from the scope's own
 * published set, vetoed by the liveness set above.
 */
function retireDepartedPresentationBitmaps(
  presentationScope: DocumentPresentationScope,
  documentId: string,
  state: StoreData
): void {
  // The thunk is the cost control, not a style choice: `state` is the post-transition
  // record, and a document the scope has published nothing for has nothing to
  // retire, so walking the unbounded history to answer a question that cannot change
  // the outcome is the regression this defers behind the scope's ownership check.
  presentationScope.retireUnreferenced(documentId, () => collectLivePresentationBitmaps(state.layers, state.history));
}

/** Ids whose candidate record is not the stored record, added or removed ids included. */
function divergentLayerIds(current: LayersRecord, next: LayersRecord): string[] {
  return [...new Set([...Object.keys(current), ...Object.keys(next)])]
    .filter((id) => !Object.is(current[id], next[id]))
    .sort();
}

export function StoreProvider({ children }: { children: ReactNode }) {
  // refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const rectOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
  const dispatchAction = (action: StoreAction) => {
    // Legacy writers still submit HistoryItem; conversion and registry ownership
    // happen here so the reducer remains a pure atomic state transition.
    const currentState = latestStateRef.current;
    if (action.type === 'PROMOTE_LAYER_PRESENTATIONS') {
      // A promotion is accepted only while the layer still holds the requesting
      // canvas. A superseded bitmap can never reach a layer, so the dispatcher
      // closes it here. The cache it REPLACES is not closed here — see the
      // retirement call after the publication below, which has to consult the
      // history because a replaced cache may be an adopted raster that live
      // history still names.
      const promotions = action.payload.promotions.filter(({ layerId, canvas, bitmap }) => {
        if (isSamePresentationCanvas(currentState.layers[layerId], canvas)) {
          presentationScope.trackPublished(currentState.documentId, bitmap);
          return true;
        }
        closePresentationBitmap(bitmap);
        return false;
      });
      if (!promotions.length) return;
      const accepted: Extract<Action, { type: 'PROMOTE_LAYER_PRESENTATIONS' }> =
        promotions.length === action.payload.promotions.length
          ? action
          : { type: 'PROMOTE_LAYER_PRESENTATIONS', payload: { promotions } };
      latestStateRef.current = reducer(currentState, accepted);
      rawDispatch(accepted);
      // Retire only after the publication, so a dropped update can never leave a
      // live layer pointing at a closed bitmap. The replaced cache is not retired
      // by name: an ADOPTED raster — an import, a merge, a document import — is
      // also named by the layer's `source` and by the `layerSource`/`args`
      // reference a history entry retains, so `history-replay` reads it back on
      // undo. Retiring by name here closed it under a live history entry, and
      // the next undo of the import then drew from a closed bitmap.
      retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, latestStateRef.current);
      return;
    }
    if (action.type === 'ADOPT_LAYER_BITMAPS') {
      // Registration is ownership bookkeeping, not a transition: the layer
      // records that reference these rasters are already published, so there is
      // nothing for the reducer to do and the action is deliberately not
      // forwarded to it. The writer dispatches this AFTER the edit that published
      // the layer, so a registration is never filed under the document that has
      // just been replaced.
      for (const bitmap of action.payload.bitmaps) {
        presentationScope.trackPublished(currentState.documentId, bitmap);
      }
      return;
    }
    if (action.type === 'PUBLISH_RUNTIME_PRESENTATION') {
      if (!layersDifferOnlyByPresentation(currentState.layers, action.payload.layers)) {
        // A refused publication is a contained no-op: the layer keeps rendering
        // from its tmpCanvas and no logical state moves. Two refusals share that
        // outcome and mean different things, so only one of them is reported.
        //
        // A payload that differs in durable layer state breaks this action's
        // invariant, which exists precisely because a promotion must never move
        // logical state. Dropping it quietly loses a user edit, so it is
        // reported with the offending ids. Re-publishing the stored records
        // unchanged cannot reach here: `layersDifferOnlyByPresentation` accepts a
        // reference-identical record (`layer-presentation.ts` short-circuits
        // `previous === candidate` to `true`), so there is no quiet case to
        // separate and no second test to keep honest.
        console.error(
          'Refused a runtime presentation publication that also changes durable layer state ' +
            '(invariant: PUBLISH_RUNTIME_PRESENTATION carries presentation caches only, never logical layer state). ' +
            `Offending layer ids: ${divergentLayerIds(currentState.layers, action.payload.layers).join(', ')}`
        );
        return;
      }
      latestStateRef.current = reducer(currentState, action);
      rawDispatch(action);
      return;
    }
    if (action.type === 'REORDER_LAYERS') {
      const intent = { ...action.payload };
      const historyItem = action.historyItem ?? createReorderHistoryItem(intent);
      const prior = {
        entries: currentState.history,
        cursor: currentState.historyIndex,
        branchRevision: currentState.branchRevision,
      };
      const timeline = updateHistoryTimeline(prior, { type: 'append', entry: historyItem });
      // A reorder's durable operation names the resulting order of every layer,
      // so it is planned here, where the pre-append record is authoritative, and
      // it is checked against a second, independent copy of the rule. The
      // shadow's OWN layer order is supplied too, and compared as a sequence: a
      // published map is a fresh normalisation of the order, so publishing one
      // while the two models already disagree about the order would overwrite
      // that disagreement with a document no reconversion would reproduce.
      const base = currentState.durableStatus === 'current' ? currentState.durableDocument : null;
      const preLayerOrder = layerOrderBottomFirst(currentState.layers);
      const durableLayerOrder = base
        ? Object.values(replayDurableDocument(base, base.cursor).layers)
            .sort((left, right) => left.snapshot.order - right.snapshot.order)
            .map((layer) => layer.snapshot.id)
        : null;
      // The record is reordered by `intent` while the durable map is derived from
      // the history item's args, because that is what a replay reads. Production
      // never supplies its own item, so the two are the same move by
      // construction — but a supplied item that disagreed with the payload would
      // leave the shadow describing one move and the document another, and the
      // plan is refused rather than reconciled, because nothing here can tell
      // which of the two is the intent.
      const args = historyItem.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
      const itemMatchesIntent =
        args?.layerToMoveId === intent.layerToMoveId &&
        (args?.afterWhichLayerId ?? null) === (intent.afterWhichLayerId ?? null);
      const decision = decideDurableAppend({
        documentId: currentState.documentId,
        base,
        prior,
        next: timeline,
        entry: historyItem,
        planned: itemMatchesIntent ? deriveReorderLayersEntry(historyItem, preLayerOrder) : null,
        documentRevision: currentState.documentRevision,
        preLayerOrder,
        durableLayerOrder,
      });
      const converted =
        decision.outcome === 'published'
          ? { status: 'current' as const, document: decision.document, diagnostics: currentState.durableDiagnostics }
          : buildDurableDocument(currentState, [...timeline.entries], timeline.cursor, timeline.branchRevision);
      if (decision.outcome === 'mismatch') {
        converted.diagnostics = [...converted.diagnostics, durableAppendDiagnostic(historyItem, decision.reason)];
      }
      const nextLayers = reorderLayersFromState(currentState.layers, intent);
      const committedAction: ReorderLayersCommittedAction = {
        ...action,
        payload: intent,
        historyItem,
        durableProjection: {
          document: converted.document,
          status: converted.status,
          diagnostics: converted.diagnostics,
        },
      };
      const nextState = projectPublishedTimeline(currentState, {
        updates: { layers: nextLayers },
        timeline,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      });
      latestStateRef.current = nextState;
      rawDispatch(committedAction);
      retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, nextState);
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
      const boundaryDiagnostics = action.payload.durableDiagnostics ?? [];
      // One append, one durable entry: the boundary's plan is published when the
      // store's durable document still describes the timeline it was planned
      // against, and the whole timeline is reconverted otherwise.
      const registry = getAssetRegistry();
      const sourceContext = sourceBackedEntryContext(currentState, action.payload.historyItem, registry);
      let plannedEntry = action.payload.durableEntry;
      let plannerTransaction: DocumentAssetTransaction | undefined;
      if (plannedEntry == null && sourceContext) {
        try {
          plannerTransaction = registry.beginDocumentAssetTransaction(currentState.documentId);
          plannedEntry =
            action.payload.historyItem.actionName === MERGE_ACTION
              ? deriveMergeDocumentEntry(action.payload.historyItem, sourceContext)
              : deriveCreateLayerEntry(action.payload.historyItem, sourceContext);
        } catch (error) {
          plannerTransaction?.rollback();
          plannerTransaction = undefined;
          plannedEntry = null;
          console.error('Unable to derive a source-backed durable append plan', error);
        }
      }
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
        planned: plannedEntry,
        documentRevision: currentState.documentRevision,
        preLayers: sourceContext?.preLayers,
      });
      const boundaryHasError = boundaryDiagnostics.some((diagnostic) => diagnostic.severity === 'error');
      const publishPlanned = planned.outcome === 'published' && !boundaryHasError;
      let publicationFailed = false;

      if (!publishPlanned) {
        plannerTransaction?.rollback();
        plannerTransaction = undefined;
      }

      const commitPayload = (projection: DurableProjection): CommitDocumentEditCommittedPayload => ({
        updates: action.payload.updates,
        historyItem: action.payload.historyItem,
        durableEntry: plannedEntry,
        durableDocument: projection.document,
        durableStatus: projection.status,
        durableDiagnostics: projection.diagnostics,
      });

      // A planned durable append can carry a newly registered asset-bearing
      // operation. Open the document transaction only after the pure decision
      // succeeds, publish the state, then commit and reconcile the exact set the
      // published document names. If any step fails, rollback before rebuilding.
      if (publishPlanned) {
        let transaction: DocumentAssetTransaction | undefined = plannerTransaction;
        try {
          transaction ??= registry.beginDocumentAssetTransaction(currentState.documentId);
          const converted = appendBoundaryDiagnostics(
            { status: 'current', document: planned.document, diagnostics: currentState.durableDiagnostics },
            boundaryDiagnostics
          );
          const committedAction: { type: 'COMMIT_DOCUMENT_EDIT'; payload: CommitDocumentEditCommittedPayload } = {
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: commitPayload(converted),
          };
          const nextState = projectPublishedTimeline(currentState, {
            updates: committedAction.payload.updates,
            timeline,
            durableDocument: converted.document,
            durableStatus: converted.status,
            durableDiagnostics: converted.diagnostics,
          });
          latestStateRef.current = nextState;
          rawDispatch(committedAction);
          transaction.commit();
          if (converted.document) {
            registry.reconcileDocumentAssets(currentState.documentId, collectDurableAssetIds(converted.document));
          }
          // Retirement runs after the transition is published, and only against
          // the record that transition actually produced.
          retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, nextState);
          return;
        } catch (error) {
          publicationFailed = true;
          transaction?.rollback();
          console.error('Unable to publish a planned durable append; rebuilding the durable document', error);
        }
      }

      let converted: DurableProjection =
        planned.outcome === 'published' && !boundaryHasError && !publicationFailed
          ? appendBoundaryDiagnostics(
              { status: 'current', document: planned.document, diagnostics: currentState.durableDiagnostics },
              boundaryDiagnostics
            )
          : appendBoundaryDiagnostics(
              buildDurableDocument(
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
              ),
              boundaryDiagnostics
            );
      if (planned.outcome === 'mismatch') {
        converted = {
          ...converted,
          diagnostics: [...converted.diagnostics, durableAppendDiagnostic(action.payload.historyItem, planned.reason)],
        };
      }
      const committedAction: { type: 'COMMIT_DOCUMENT_EDIT'; payload: CommitDocumentEditCommittedPayload } = {
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: commitPayload(converted),
      };
      const nextState = projectPublishedTimeline(currentState, {
        updates: committedAction.payload.updates,
        timeline,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      });
      latestStateRef.current = nextState;
      rawDispatch(committedAction);
      // Retirement runs after the transition is published, and only against the
      // record that transition actually produced: a delete, a merge, and a
      // commit that swaps a layer's cache all leave a published bitmap behind
      // with no remaining reference.
      retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, nextState);
      return;
    }
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      // The action type requires `updates`; defaulting it here keeps a malformed
      // navigation a no-op instead of a dispatch that throws mid-reducer.
      const replayUpdates = action.payload.updates ?? {};
      const replayFrame = replayUpdates.documentFrame;
      const converted = appendBoundaryDiagnostics(
        buildDurableDocument(
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
        ),
        action.payload.durableDiagnostics ?? []
      );
      const nextState = projectPublishedTimeline(currentState, {
        updates: replayUpdates,
        timeline: action.payload.timeline,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      });
      latestStateRef.current = nextState;
      rawDispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: replayUpdates,
          timeline: action.payload.timeline,
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
      retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, nextState);
      return;
    }
    if (action.type === 'REPLACE_DOCUMENT') {
      const nextFrame = replacementFrame(currentState, action.payload);
      const converted = appendBoundaryDiagnostics(
        buildDurableDocument(
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
        ),
        action.payload.durableDiagnostics ?? []
      );
      if (currentState.documentId !== action.payload.documentId) {
        getAssetRegistry().disposeDocument(currentState.documentId);
      }
      const nextState = projectReplacedDocument(currentState, action.payload, converted);
      latestStateRef.current = nextState;
      const committedPayload: ReplaceDocumentCommittedPayload = {
        documentId: action.payload.documentId,
        updates: action.payload.updates,
        history: action.payload.history,
        historyIndex: action.payload.historyIndex,
        durableDocument: converted.document,
        durableStatus: converted.status,
        durableDiagnostics: converted.diagnostics,
      };
      rawDispatch({
        type: 'REPLACE_DOCUMENT',
        payload: committedPayload,
      });
      return;
    }
    latestStateRef.current = reducer(currentState, action);
    rawDispatch(action);
  };
  const dispatchInternalAction = (action: InternalAction) => dispatchAction(action);
  const dispatch: StoreDispatch = (action) => dispatchAction(action);
  const publishRuntimePresentation = (layers: LayersRecord) =>
    dispatchInternalAction({ type: 'PUBLISH_RUNTIME_PRESENTATION', payload: { layers } });
  const adoptLayerBitmaps = (bitmaps: readonly BitmapSource[]) =>
    dispatchInternalAction({ type: 'ADOPT_LAYER_BITMAPS', payload: { bitmaps } });
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
    currentArgs: currentArgsRef,
    clearPreviewLayers,
    promoteLayerPresentation,
    publishRuntimePresentation,
    adoptLayerBitmaps,
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
