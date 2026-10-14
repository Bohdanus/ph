import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
  type Dispatch,
} from 'react';
import { isEqual } from 'lodash-es';
import {
  DEFAULT_TOOL,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REORDER_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
} from '../util/constants.ts';

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
import { DEFAULT_VIEW_STATE, viewStateRef, type ViewState } from './view-state.ts';
import type { ToolArgs, ToolName } from './tool-types.ts';
import type { HistoryItem } from './history-types.ts';
import { updateHistoryTimeline, type HistoryTimeline } from './history-timeline.ts';
import {
  cloneDocumentFrame,
  documentFrameEquals,
  documentFrameFromSize,
  documentFrameSize,
  type DocumentFrame,
} from './document-frame.ts';
import { createHistoryItem } from './history-utils.ts';
import { getSortedLayersArray, reorderLayers } from './layer-utils.ts';
import {
  collectDurableAssetIds,
  refreezeDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
} from './history-model.ts';
import {
  convertLegacyHistorySafely,
  deriveReplaceLayerSourceEntry,
  durableSourceKindForTool,
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
import { replayDurableAtCursor, replayDurableDocument, type DurableReplayLayer } from './durable-replay.ts';
import { composeDurableDocument, DurableCompositionRefusal } from './durable-compositor.ts';
import { projectDurableRender, type DurableRenderProjection } from './durable-render-projection.ts';
import { getAssetRegistry, type DocumentAssetTransaction } from './asset-registry.ts';
import {
  closePresentationBitmap,
  DocumentPresentationScope,
  isSamePresentationCanvas,
  layersDifferOnlyByPresentation,
  layersDifferOnlyByPresentationAndIdentityAffine,
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
  legacyCursorToDurableCursor?: readonly number[];
};

export type DurablePresentationStatus = 'unpublished' | 'durable' | 'legacy-fallback';
export type DurablePresentationReason =
  'unsupported-source' | 'materialization-refused' | 'layer-coverage' | 'renderer-incompatible' | 'stale';

export type DurablePresentationRecord = Readonly<{
  status: DurablePresentationStatus;
  cursor: number | null;
  reason: DurablePresentationReason | null;
}>;

export type DurableNavigationPresentationOutcome =
  | Readonly<{ status: 'durable'; layers: LayersRecord; frame: DocumentFrame; cursor: number }>
  | Readonly<{ status: 'legacy-fallback'; reason: DurablePresentationReason; cursor: number }>
  | Readonly<{ status: 'stale'; reason: 'stale'; cursor: number }>;

/**
 * Canvas navigation has exactly one complete presentation authority. `pending`
 * deliberately writes nothing, preserving the prior canvas until publication
 * accepts either the durable projection or the replayed legacy layers.
 */
export type RenderSelector = Readonly<{
  source: 'legacy' | 'pending' | 'durable';
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  historyCursor: number;
  frame: DocumentFrame;
}>;

const EMPTY_DURABLE_PRESENTATION: DurablePresentationRecord = Object.freeze({
  status: 'unpublished',
  cursor: null,
  reason: null,
});

type DurablePresentationPublication = Readonly<{
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  historyIndex: number;
  durableRevision: number;
  record: DurablePresentationRecord;
}>;

export function durablePresentationIsRendererIdentical(
  replayLayer: DurableReplayLayer,
  existing: Layer,
  bounds: Layer['pos']
): boolean {
  return (
    replayLayer.operations.length === 0 &&
    isEqual(bounds, existing.pos) &&
    (replayLayer.snapshot.source.kind === 'raster' ||
      replayLayer.snapshot.source.kind === 'blank' ||
      replayLayer.snapshot.source.kind === 'vector')
  );
}

export type StoreData = {
  // refs
  canvasRef: RefObject<HTMLCanvasElement | null>;
  toolOverlayRef: RefObject<HTMLCanvasElement | null>;
  rectOverlayRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;

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
  publishDurableNavigationPresentation: () => Promise<DurableNavigationPresentationOutcome>;
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
  /** Durable logical document used by successful navigation/export; legacy history remains the structural fallback. */
  durableDocument: DurableDocument | null;
  /** A non-current sidecar must never be used as a replay or export input. */
  durableStatus: DurableDocumentStatus;
  durableDiagnostics: readonly MigrationDiagnostic[];
  /** Dev-only evidence of the last durable navigation publication decision. */
  durablePresentation: DurablePresentationRecord;
  /**
   * A leased, runtime-shaped durable render snapshot. Canvas navigation may
   * select it, but export and logical replay remain legacy-authoritative.
   */
  durableRenderProjection: DurableRenderProjection | null;
  /** The complete authority selected for desktop/tablet canvas navigation. */
  renderSelector: RenderSelector;
  viewStateRef: { current: ViewState };
  viewState: ViewState;
  setViewState: (partial: Partial<ViewState>) => void;

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
    | 'durableRenderProjection'
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
  /** Dispatcher-owned: only navigation starts in a hold-before-paint state. */
  renderSelector?: RenderSelector;
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
  | { type: 'ADOPT_LAYER_BITMAPS'; payload: { bitmaps: readonly BitmapSource[] } }
  | {
      type: 'SET_DURABLE_PRESENTATION';
      payload: DurablePresentationPublication & { projection: DurableRenderProjection | null };
    };

type StoreAction = Action | InternalAction;

export type PublicAction = Action;
export type StoreDispatch = Dispatch<PublicAction>;

/**
 * The action kinds `dispatchAction` handles itself, in the order the chain below
 * tests them.
 *
 * Each one either needs a side effect the reducer cannot perform — asset
 * transactions, bitmap liveness, closing a superseded cache — or must publish a
 * committed payload whose durable fields only the dispatcher can compute. A kind
 * that needs neither belongs in the reducer, and this list is where saying so is
 * checked: `dispatchAction`'s trailing assertion only compiles while the chain
 * above covers exactly these names, so deleting a branch or adding one without
 * adding the name here fails `npm run tsc` rather than quietly changing which
 * transitions bypass the default.
 *
 * The exported name is the list a test pins, not a second place to register a
 * kind: the assertion at the end of `dispatchAction` is what ties it to the
 * branches.
 */
export const INTERCEPTED_STORE_ACTION_TYPES = [
  'PROMOTE_LAYER_PRESENTATIONS',
  'ADOPT_LAYER_BITMAPS',
  'PUBLISH_RUNTIME_PRESENTATION',
  'REORDER_LAYERS',
  'COMMIT_DOCUMENT_EDIT',
  'APPLY_HISTORY_REPLAY',
  'REPLACE_DOCUMENT',
] as const satisfies readonly StoreAction['type'][];

const INTERCEPTED_STORE_ACTIONS: ReadonlySet<StoreAction['type']> = new Set(INTERCEPTED_STORE_ACTION_TYPES);

type UninterceptedActionType = Exclude<StoreAction['type'], (typeof INTERCEPTED_STORE_ACTION_TYPES)[number]>;

const StoreContext = createContext<[StoreData, StoreDispatch] | undefined>(undefined);

const initialState: StoreData = {
  canvasRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  containerRef: { current: null },
  viewStateRef,
  viewState: DEFAULT_VIEW_STATE,
  setViewState: () => undefined,

  currentArgs: { current: {} as ToolArgs },
  clearPreviewLayers: () => undefined,
  promoteLayerPresentation: () => undefined,
  publishRuntimePresentation: () => undefined,
  adoptLayerBitmaps: () => undefined,
  publishDurableNavigationPresentation: async () => ({ status: 'legacy-fallback', reason: 'stale', cursor: -1 }),
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
  durablePresentation: EMPTY_DURABLE_PRESENTATION,
  durableRenderProjection: null,
  renderSelector: {
    source: 'legacy',
    documentId: 'uninitialized',
    documentRevision: 0,
    branchRevision: 0,
    historyCursor: 0,
    frame: { x: 0, y: 0, width: 0, height: 0 },
  },

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

function projectionMatchesPresentation(
  projection: DurableRenderProjection | null,
  publication: DurablePresentationPublication
): boolean {
  if (publication.record.status !== 'durable') return projection === null;
  return (
    projection !== null &&
    projection.status === 'durable' &&
    projection.documentId === publication.documentId &&
    projection.documentRevision === publication.documentRevision &&
    projection.branchRevision === publication.branchRevision &&
    projection.historyCursor === publication.record.cursor &&
    projection.durableRevision === publication.durableRevision
  );
}

function legacyRenderSelector(
  documentId: string,
  documentRevision: number,
  branchRevision: number,
  historyCursor: number,
  frame: DocumentFrame
): RenderSelector {
  return {
    source: 'legacy',
    documentId,
    documentRevision,
    branchRevision,
    historyCursor,
    frame: cloneDocumentFrame(frame),
  };
}

function pendingRenderSelector(state: StoreData): RenderSelector {
  return {
    ...legacyRenderSelector(
      state.documentId,
      state.documentRevision,
      state.branchRevision,
      state.historyIndex,
      state.documentFrame
    ),
    source: 'pending',
  };
}

function selectorMatchesPublication(
  state: StoreData,
  publication: DurablePresentationPublication,
  projection: DurableRenderProjection | null
): boolean {
  const selector = state.renderSelector;
  if (
    selector.source !== 'pending' ||
    selector.documentId !== publication.documentId ||
    selector.documentRevision !== publication.documentRevision ||
    selector.branchRevision !== publication.branchRevision ||
    selector.historyCursor !== publication.historyIndex ||
    !documentFrameEquals(selector.frame, state.documentFrame)
  ) {
    return false;
  }
  return (
    publication.record.status !== 'durable' ||
    (projection !== null && documentFrameEquals(projection.frame, selector.frame))
  );
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
    renderSelector?: RenderSelector;
  }
): StoreData {
  const updates = payload.updates ?? {};
  const nextFrame = updates.documentFrame;
  const documentFrame = nextFrame ? cloneDocumentFrame(nextFrame) : state.documentFrame;
  const durable = normalizeDurableProjection({
    document: payload.durableDocument,
    status: payload.durableStatus,
    diagnostics: payload.durableDiagnostics,
  });
  return {
    ...state,
    ...updates,
    ...(nextFrame ? { documentFrame, totalSize: documentFrameSize(documentFrame) } : {}),
    history: [...payload.timeline.entries],
    historyIndex: payload.timeline.cursor,
    branchRevision: payload.timeline.branchRevision,
    durableDocument: durable.document,
    durableStatus: durable.status,
    durableDiagnostics: durable.diagnostics,
    durablePresentation: EMPTY_DURABLE_PRESENTATION,
    durableRenderProjection: null,
    renderSelector:
      payload.renderSelector ??
      legacyRenderSelector(
        state.documentId,
        state.documentRevision,
        payload.timeline.branchRevision,
        payload.timeline.cursor,
        documentFrame
      ),
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
    durablePresentation: EMPTY_DURABLE_PRESENTATION,
    durableRenderProjection: null,
    renderSelector: legacyRenderSelector(
      payload.documentId,
      state.documentRevision + 1,
      0,
      payload.historyIndex ?? payload.history.length - 1,
      nextFrame
    ),
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
  if (candidateRecord?.kind === 'tool') {
    const toolName = (candidateRecord.args as { toolName?: unknown } | undefined)?.toolName;
    if (typeof toolName !== 'string' || !durableSourceKindForTool(toolName)) return null;
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
    case 'SET_ORIGINAL_IMAGE':
      // Typed no-op. No writer dispatches this and `StoreData` carries no
      // original-image record, so the arm exists to keep the switch exhaustive;
      // deleting the action kind is the change that removes it (see the arm's
      // registration sites in `StoreContext.boundary-gates.test.ts`).
      return state;
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
        durablePresentation: EMPTY_DURABLE_PRESENTATION,
        durableRenderProjection: null,
        renderSelector: legacyRenderSelector(
          state.documentId,
          state.documentRevision,
          state.branchRevision,
          state.historyIndex,
          state.documentFrame
        ),
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
        durablePresentation: EMPTY_DURABLE_PRESENTATION,
        durableRenderProjection: null,
        renderSelector: legacyRenderSelector(
          state.documentId,
          state.documentRevision,
          state.branchRevision,
          state.historyIndex,
          state.documentFrame
        ),
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
        durablePresentation: EMPTY_DURABLE_PRESENTATION,
        durableRenderProjection: null,
        renderSelector: legacyRenderSelector(
          state.documentId,
          state.documentRevision,
          state.branchRevision,
          state.historyIndex,
          state.documentFrame
        ),
        hasUnsavedChanges: true,
      };
    case 'PUBLISH_RUNTIME_PRESENTATION':
      // Presentation-only publication of already-known layer records. The
      // dispatcher proves the payload differs from the stored layers only by a
      // promoted cache, so this transition cannot move durable logical state,
      // records no history, and does not invalidate the durable projection.
      return { ...state, layers: action.payload.layers };
    case 'SET_DURABLE_PRESENTATION': {
      const publication = action.payload;
      if (
        state.documentId !== publication.documentId ||
        state.documentRevision !== publication.documentRevision ||
        state.branchRevision !== publication.branchRevision ||
        state.historyIndex !== publication.historyIndex ||
        state.durableStatus !== 'current' ||
        state.durableDocument?.durableRevision !== publication.durableRevision ||
        !projectionMatchesPresentation(action.payload.projection, publication) ||
        !selectorMatchesPublication(state, publication, action.payload.projection)
      ) {
        return state;
      }
      const renderSelector: RenderSelector = {
        ...state.renderSelector,
        source: publication.record.status === 'durable' ? 'durable' : 'legacy',
        frame:
          publication.record.status === 'durable'
            ? cloneDocumentFrame(action.payload.projection!.frame)
            : cloneDocumentFrame(state.documentFrame),
      };
      return {
        ...state,
        durablePresentation: Object.freeze({ ...publication.record }),
        durableRenderProjection: action.payload.projection,
        renderSelector,
      };
    }
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
    case 'ADOPT_LAYER_BITMAPS':
      // Ownership bookkeeping, not a transition: the dispatcher registers the
      // rasters with the presentation scope and deliberately does not forward
      // this action here. The arm is a no-op that keeps the switch exhaustive,
      // so a new action kind cannot be added without a transition of its own.
      return state;
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
        durablePresentation: EMPTY_DURABLE_PRESENTATION,
        durableRenderProjection: null,
        renderSelector: legacyRenderSelector(
          state.documentId,
          state.documentRevision,
          state.branchRevision,
          state.historyIndex,
          state.documentFrame
        ),
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
        durablePresentation: EMPTY_DURABLE_PRESENTATION,
        durableRenderProjection: null,
        renderSelector: legacyRenderSelector(
          state.documentId,
          state.documentRevision,
          state.branchRevision,
          state.historyIndex,
          state.documentFrame
        ),
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
    default: {
      // Load-bearing, and the `never` is the point: `StoreAction` is a closed
      // union, so a kind added to `Action` or `InternalAction` without an arm
      // above fails `tsc` here rather than reaching the caller as a dispatch that
      // quietly does nothing. `return state` is kept so a runtime untyped caller
      // still gets the no-op the old `default` gave it, because `useReducer` must
      // not throw inside a render. The two arms that exist only to be written down
      // — `SET_ORIGINAL_IMAGE` and `ADOPT_LAYER_BITMAPS` — are named above in
      // their alphabetical positions rather than here.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
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
      // `converted.document` is already a deep-frozen copy this module froze, and the
      // cursor is the only field that moves here, so the navigation write reuses the
      // baseline and the whole timeline instead of deep-copying both to change a
      // number. Any other base falls back to the full freeze.
      document: converted.document ? refreezeDurableDocument(converted.document, { cursor }) : null,
      diagnostics: converted.diagnostics,
      legacyCursorToDurableCursor: converted.legacyCursorToDurableCursor,
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
      legacyCursorToDurableCursor: [],
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

function collectLivePresentationBitmaps(
  next: LayersRecord,
  history: readonly HistoryItem[],
  projection: DurableRenderProjection | null
): Set<BitmapSource> {
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
  if (projection) {
    for (const layer of Object.values(projection.layers)) addLayerAliases(layer);
  }
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
  presentationScope.retireUnreferenced(documentId, () =>
    collectLivePresentationBitmaps(state.layers, state.history, state.durableRenderProjection)
  );
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
  const [, forceViewStateUpdate] = useState(0);
  const setViewState = (partial: Partial<ViewState>) => {
    viewStateRef.current = { ...viewStateRef.current, ...partial };
    forceViewStateUpdate((value) => value + 1);
  };

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

  const publishDurableNavigationPresentation = async (
    state: StoreData,
    document: DurableDocument,
    durableCursor: number
  ): Promise<DurableNavigationPresentationOutcome> => {
    const replay = replayDurableAtCursor(document, durableCursor);
    const publishRecord = (
      record: DurablePresentationRecord,
      projection: DurableRenderProjection | null = null
    ): boolean => {
      const action: Extract<InternalAction, { type: 'SET_DURABLE_PRESENTATION' }> = {
        type: 'SET_DURABLE_PRESENTATION',
        payload: {
          documentId: state.documentId,
          documentRevision: document.documentRevision,
          branchRevision: document.branchRevision,
          historyIndex: state.historyIndex,
          durableRevision: document.durableRevision,
          record,
          projection,
        },
      };
      const latest = latestStateRef.current;
      const next = reducer(latest, action);
      if (next === latest) return false;
      latestStateRef.current = next;
      rawDispatch(action);
      return true;
    };

    // Legacy-tool sources remain an explicitly unsupported durable source. Keep
    // navigation on the legacy presentation until that source adapter exists.
    if (Object.values(replay.layers).some(({ snapshot }) => snapshot.source.kind === 'legacy-tool')) {
      const accepted = publishRecord({
        status: 'legacy-fallback',
        cursor: durableCursor,
        reason: 'unsupported-source',
      });
      return accepted
        ? { status: 'legacy-fallback', reason: 'unsupported-source', cursor: durableCursor }
        : { status: 'stale', reason: 'stale', cursor: durableCursor };
    }

    const registry = getAssetRegistry();
    let composite: Awaited<ReturnType<typeof composeDurableDocument>> | undefined;
    let detached: ReturnType<NonNullable<typeof composite>['takeLayers']> | undefined;
    let failureReason: DurablePresentationReason = 'materialization-refused';
    const assertFresh = () => {
      const latest = latestStateRef.current;
      if (
        latest.documentId !== state.documentId ||
        latest.historyIndex !== state.historyIndex ||
        latest.documentRevision !== document.documentRevision ||
        latest.branchRevision !== document.branchRevision ||
        latest.durableStatus !== 'current' ||
        latest.durableDocument?.durableRevision !== document.durableRevision ||
        !documentFrameEquals(latest.documentFrame, replay.frame)
      ) {
        failureReason = 'stale';
        throw new Error('Durable navigation presentation became stale before publication');
      }
    };

    try {
      composite = await composeDurableDocument(replay, {
        documentId: state.documentId,
        baselineAssetGeneration: registry.getDocumentGeneration(state.documentId),
        operationSetRevision: document.durableRevision,
        assetRegistry: registry,
      });
      assertFresh();
      detached = composite.takeLayers();
      const latest = latestStateRef.current;
      const nextLayers = { ...latest.layers };
      const visibleLayerIds = Object.values(replay.layers)
        .filter(({ snapshot }) => snapshot.visible)
        .sort((left, right) => left.snapshot.order - right.snapshot.order)
        .map(({ snapshot }) => snapshot.id);
      const materializedLayerIds = Object.keys(detached.layers);
      if (
        materializedLayerIds.length !== visibleLayerIds.length ||
        visibleLayerIds.some((layerId) => !detached?.layers[layerId])
      ) {
        failureReason = 'layer-coverage';
        throw new DurableCompositionRefusal(
          'layer-coverage',
          'Durable navigation presentation did not cover every visible replay layer'
        );
      }
      for (const layerId of visibleLayerIds) {
        const materialized = detached.layers[layerId];
        if (!materialized || !materialized.bitmap) {
          failureReason = 'layer-coverage';
          throw new DurableCompositionRefusal('layer-coverage', `Durable navigation layer ${layerId} is missing`);
        }
        const existing = nextLayers[layerId];
        if (!existing) {
          failureReason = 'layer-coverage';
          throw new DurableCompositionRefusal(
            'layer-coverage',
            `Durable navigation layer ${layerId} is absent from legacy replay`
          );
        }
        const replayLayer = replay.layers[layerId];
        const isRendererIdentical = durablePresentationIsRendererIdentical(replayLayer, existing, materialized.bounds);
        if (!isRendererIdentical) {
          failureReason = 'renderer-incompatible';
          throw new DurableCompositionRefusal(
            'renderer-incompatible',
            `Durable navigation layer ${layerId} is not renderer-identical`
          );
        }
        nextLayers[layerId] = {
          ...existing,
          tmpCanvas: materialized.bitmap,
          presentationBounds: materialized.bounds,
        };
      }
      assertFresh();
      if (!layersDifferOnlyByPresentation(latest.layers, nextLayers)) {
        failureReason = 'renderer-incompatible';
        throw new DurableCompositionRefusal(
          'renderer-incompatible',
          'Durable navigation presentation changed logical layer state'
        );
      }
      const projection = projectDurableRender(replay, {
        status: 'durable',
        materializedLayers: detached.layers,
      });

      for (const layerId of visibleLayerIds) {
        const materialized = detached.layers[layerId];
        if (!materialized.bitmap || !materialized.lease) continue;
        presentationScope.trackPublishedLease(state.documentId, materialized.bitmap, materialized.lease.release);
      }
      const action: Extract<InternalAction, { type: 'PUBLISH_RUNTIME_PRESENTATION' }> = {
        type: 'PUBLISH_RUNTIME_PRESENTATION',
        payload: { layers: nextLayers },
      };
      latestStateRef.current = reducer(latest, action);
      rawDispatch(action);
      publishRecord(
        {
          status: 'durable',
          cursor: durableCursor,
          reason: null,
        },
        projection
      );
      retireDepartedPresentationBitmaps(presentationScope, state.documentId, latestStateRef.current);
      detached = undefined;
      return { status: 'durable', layers: projection.layers, frame: projection.frame, cursor: durableCursor };
    } catch (error) {
      detached?.release();
      const reason: DurablePresentationReason = error instanceof DurableCompositionRefusal ? error.code : failureReason;
      const accepted = publishRecord({ status: 'legacy-fallback', cursor: durableCursor, reason });
      if (!accepted || String(reason) === 'stale') return { status: 'stale', reason: 'stale', cursor: durableCursor };
      return { status: 'legacy-fallback', reason, cursor: durableCursor };
    } finally {
      composite?.release();
    }
  };

  const dispatchAction = (action: StoreAction) => {
    // Legacy writers still submit HistoryItem; conversion and registry ownership
    // happen here so the reducer remains a pure atomic state transition.
    const currentState = latestStateRef.current;
    if (!INTERCEPTED_STORE_ACTIONS.has(action.type)) {
      // The default transition, stated rather than fallen into. Every kind in
      // INTERCEPTED_STORE_ACTION_TYPES returns from its own branch below, so this
      // is what the rest of the union gets: one reducer call outside React, so a
      // second dispatch in the same batch is decided against the state the first
      // one produced, then one `rawDispatch`.
      latestStateRef.current = reducer(currentState, action);
      rawDispatch(action);
      return;
    }
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
      const payloadLayers = action.payload.layers;
      // First check: pure presentation-only difference (caches only).
      const purePresentation = layersDifferOnlyByPresentation(currentState.layers, payloadLayers);
      // Second check: presentation-only plus identity affine operations.
      const presentationWithIdentityAffine = layersDifferOnlyByPresentationAndIdentityAffine(
        currentState.layers,
        payloadLayers
      );
      if (!purePresentation && !presentationWithIdentityAffine) {
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
            `Offending layer ids: ${divergentLayerIds(currentState.layers, payloadLayers).join(', ')}`
        );
        return;
      }
      // If the only durable difference is identity affine operations, publish the
      // stored record with the payload's presentation caches instead of the payload
      // itself. This prevents identity affine operations from polluting the durable
      // layer state while still allowing the presentation cache promotion to proceed.
      let layersToPublish = payloadLayers;
      if (presentationWithIdentityAffine && !purePresentation) {
        layersToPublish = { ...currentState.layers };
        for (const [id, payloadLayer] of Object.entries(payloadLayers)) {
          const storedLayer = currentState.layers[id];
          if (!storedLayer) continue;
          layersToPublish[id] = {
            ...storedLayer,
            bitmap: payloadLayer.bitmap,
            tmpCanvas: payloadLayer.tmpCanvas,
            presentationBounds: payloadLayer.presentationBounds,
          };
        }
      }
      latestStateRef.current = reducer(currentState, {
        ...action,
        payload: { layers: layersToPublish },
      });
      rawDispatch({ ...action, payload: { layers: layersToPublish } });
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
      if (plannedEntry == null && action.payload.historyItem.actionName === REPLACE_LAYER_SOURCE_ACTION) {
        plannedEntry = deriveReplaceLayerSourceEntry(action.payload.historyItem);
      } else if (plannedEntry == null && sourceContext) {
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
      // published document names.
      //
      // The `try` covers the FALLIBLE work and nothing else, and its catch is
      // therefore the one place the rebuild below may be reached from: the whole
      // conversion rebuild and its dispatch run only when no state has moved
      // yet, so the append is still un-published and rolling the transaction
      // back is exactly right.
      //
      // Publication itself is deliberately OUTSIDE it. `latestStateRef.current`
      // and `rawDispatch` are the point of no return — an exception from
      // `transaction.commit`, `reconcileDocumentAssets` or the retirement walk
      // used to land in the same catch, fall out of this `if`, and dispatch a
      // SECOND `COMMIT_DOCUMENT_EDIT` for one append. The rebuild derives its
      // projection from `currentState`, the pre-publication record, so the second
      // dispatch both re-published a transition that had already happened and
      // computed it from a state the store no longer held.
      if (publishPlanned) {
        let transaction: DocumentAssetTransaction | undefined = plannerTransaction;
        let published:
          | {
              transaction: DocumentAssetTransaction;
              converted: DurableProjection;
              action: { type: 'COMMIT_DOCUMENT_EDIT'; payload: CommitDocumentEditCommittedPayload };
              state: StoreData;
            }
          | undefined;
        try {
          transaction ??= registry.beginDocumentAssetTransaction(currentState.documentId);
          const converted = appendBoundaryDiagnostics(
            { status: 'current', document: planned.document, diagnostics: currentState.durableDiagnostics },
            boundaryDiagnostics
          );
          const committed: { type: 'COMMIT_DOCUMENT_EDIT'; payload: CommitDocumentEditCommittedPayload } = {
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: commitPayload(converted),
          };
          published = {
            transaction,
            converted,
            action: committed,
            state: projectPublishedTimeline(currentState, {
              updates: committed.payload.updates,
              timeline,
              durableDocument: converted.document,
              durableStatus: converted.status,
              durableDiagnostics: converted.diagnostics,
            }),
          };
        } catch (error) {
          // The transaction is the local one, and nothing below reads
          // `plannerTransaction`: a rollback here releases exactly what the plan
          // registered and nothing has named it yet.
          transaction?.rollback();
          console.error('Unable to plan a durable append publication; rebuilding the durable document', error);
        }
        if (published) {
          latestStateRef.current = published.state;
          rawDispatch(published.action);
          // Past `rawDispatch` the append is published, so a failure here is
          // contained: reported, and never re-entered through the rebuild. The
          // rollback is dropped with the fall-through — `rollback()` on a settled
          // transaction is a no-op anyway, and the publication has named the very
          // assets it would have released. Retirement that does not run is
          // deferred to the next transition that consults the scope, which is
          // safe because the same walk would have closed nothing the store still
          // reaches.
          try {
            published.transaction.commit();
            if (published.converted.document) {
              registry.reconcileDocumentAssets(
                currentState.documentId,
                collectDurableAssetIds(published.converted.document)
              );
            }
            // Retirement runs after the transition is published, and only against
            // the record that transition actually produced.
            retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, published.state);
          } catch (error) {
            console.error('Unable to finalize a published durable append; the append itself is committed', error);
          }
          return;
        }
      }

      // Reached only when the fast path above did NOT publish: the plan was not
      // publishable, or its publication could not be prepared. Nothing has moved
      // in either case, so the whole-timeline conversion is both the correct and
      // the only remaining route to an append — which is what makes this the sole
      // fallback, rather than one of several.
      let converted: DurableProjection = appendBoundaryDiagnostics(
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
      const renderSelector =
        converted.status === 'current' && converted.document
          ? pendingRenderSelector(nextState)
          : nextState.renderSelector;
      const navigationState = { ...nextState, renderSelector };
      latestStateRef.current = navigationState;
      rawDispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: replayUpdates,
          timeline: action.payload.timeline,
          durableDocument: converted.document,
          durableStatus: converted.status,
          durableDiagnostics: converted.diagnostics,
          renderSelector,
        },
      });
      // Replay is the other way a cache leaves the record, and the identity case
      // is the common one: navigating back over a removal re-creates the layer
      // under the same id with no cache at all, or with a different one. The
      // replayed record is already painted, so retiring against it cannot blank
      // a layer that is still on screen.
      retireDepartedPresentationBitmaps(presentationScope, currentState.documentId, navigationState);
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
      viewStateRef.current = DEFAULT_VIEW_STATE;
      rawDispatch({
        type: 'REPLACE_DOCUMENT',
        payload: committedPayload,
      });
      return;
    }
    // Unreachable at runtime: the chain above returns for every intercepted
    // kind, and the default at the top of `dispatchAction` returns for the rest.
    // It exists to be a compile-time assertion rather than a comment — if a
    // branch is removed from the chain without removing its name from
    // INTERCEPTED_STORE_ACTION_TYPES, the narrowed `action.type` no longer fits
    // `UninterceptedActionType` and `npm run tsc` fails.
    const _everyInterceptedKindReturns: UninterceptedActionType = action.type;
    void _everyInterceptedKindReturns;
  };
  const dispatchInternalAction = (action: InternalAction) => dispatchAction(action);
  const dispatch: StoreDispatch = (action) => dispatchAction(action);
  const publishDurableNavigation = (): Promise<DurableNavigationPresentationOutcome> => {
    const latest = latestStateRef.current;
    if (latest.durableStatus !== 'current' || !latest.durableDocument) {
      return Promise.resolve({ status: 'legacy-fallback', reason: 'stale', cursor: latest.historyIndex });
    }
    return publishDurableNavigationPresentation(latest, latest.durableDocument, latest.durableDocument.cursor);
  };
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
    currentArgs: currentArgsRef,
    clearPreviewLayers,
    promoteLayerPresentation,
    publishRuntimePresentation,
    adoptLayerBitmaps,
    publishDurableNavigationPresentation: publishDurableNavigation,
    previewLayers: previewLayersRef,
    viewStateRef,
    viewState: viewStateRef.current,
    setViewState,
  };

  return <StoreContext.Provider value={[store, dispatch]}>{children}</StoreContext.Provider>;
}

export const useStore = (): [StoreData, StoreDispatch] => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};

export const useOptionalStore = (): [StoreData, StoreDispatch] | null => useContext(StoreContext) ?? null;
