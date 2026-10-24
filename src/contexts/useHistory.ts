import { useStore } from './StoreContext.tsx';
import type { LayersRecord } from './layer-types.ts';
import type { HistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';
import { createLayerSource, getSortedLayersArray } from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { replayHistory } from './history-replay.ts';
import {
  OPEN_DOCUMENT_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_OPACITY_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import { updateHistoryTimeline } from './history-timeline.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';
import type { MigrationDiagnostic } from './history-adapter.ts';
import type { DurableDocument } from './history-model.ts';
import { durableEntryTitle } from './history-provenance.ts';
import { operationsRetainedAfterBake, stageProcessorInput } from './presentation-evaluator.ts';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.ts';

export function getHistoryItemTitle(item: HistoryItem) {
  const { actionName, args, layerSource } = item;

  if (layerSource?.kind === 'tool') {
    return layerSource.args.toolName;
  }

  if (actionName === TOOL_ACTION) {
    return (args as ToolArgs).toolName;
  }

  if (actionName === SET_DOCUMENT_FRAME_ACTION) return 'crop';
  if (actionName === SET_LAYER_OPACITY_ACTION) return 'set layer opacity';

  return actionName;
}

export type HistoryPanelRow = Readonly<{
  item: HistoryItem;
  originalIndex: number;
  title: string | undefined;
  isActive: boolean;
  isCurrent: boolean;
}>;

export type HistoryPanelProjection = Readonly<{
  source: 'legacy' | 'durable';
  rows: readonly HistoryPanelRow[];
}>;

export type HistoryPanelProjectionInput = Readonly<{
  history: readonly HistoryItem[];
  historyIndex: number;
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  durableStatus?: string;
  durableDocument?: DurableDocument | null;
}>;

function legacyHistoryPanelRows(history: readonly HistoryItem[], historyIndex: number): readonly HistoryPanelRow[] {
  return Object.freeze(
    history.map((item, originalIndex) => ({
      item,
      originalIndex,
      title: getHistoryItemTitle(item),
      isActive: originalIndex <= historyIndex,
      isCurrent: originalIndex === historyIndex,
    }))
  );
}

function hasUniqueIds(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

/**
 * Selects one complete history-panel authority. Durable rows are admitted only
 * when they are a one-to-one, title/effective-enabled-state match for legacy
 * rows. The opening document row has no durable entry, so ordinary timelines
 * intentionally remain on the complete legacy projection.
 */
export function selectHistoryPanelProjection(input: HistoryPanelProjectionInput): HistoryPanelProjection {
  const legacyRows = legacyHistoryPanelRows(input.history, input.historyIndex);
  const durable = input.durableDocument;
  if (
    input.durableStatus !== 'current' ||
    !durable ||
    durable.documentId !== input.documentId ||
    durable.documentRevision !== input.documentRevision ||
    durable.branchRevision !== input.branchRevision ||
    durable.history.length !== input.history.length ||
    durable.cursor !== input.historyIndex ||
    (input.history.length === 0
      ? input.historyIndex !== -1
      : input.historyIndex < 0 || input.historyIndex >= input.history.length)
  ) {
    return { source: 'legacy', rows: legacyRows };
  }

  const legacyIds = input.history.map((item) => item.id);
  const durableIds = durable.history.map((entry) => entry.id);
  if (!hasUniqueIds(legacyIds) || !hasUniqueIds(durableIds)) {
    return { source: 'legacy', rows: legacyRows };
  }

  const durableRows: HistoryPanelRow[] = [];
  for (let index = 0; index < input.history.length; index += 1) {
    const item = input.history[index];
    const entry = durable.history[index];
    if (!item || !entry || item.id !== entry.id || !entry.provenance) {
      return { source: 'legacy', rows: legacyRows };
    }
    const legacyTitle = getHistoryItemTitle(item);
    const durableTitle = durableEntryTitle(entry.provenance);
    if (legacyTitle !== durableTitle || Boolean(item.disabled) !== !entry.enabled) {
      return { source: 'legacy', rows: legacyRows };
    }
    durableRows.push({
      item,
      originalIndex: index,
      title: durableTitle,
      isActive: index <= input.historyIndex,
      isCurrent: index === input.historyIndex,
    });
  }

  return { source: 'durable', rows: Object.freeze(durableRows) };
}

export const useHistory = () => {
  const [
    {
      canvasRef,
      history,
      historyIndex,
      layers,
      deletedLayers,
      activeLayerId,
      selections,
      activeSelectionId,
      hasUnsavedChanges,
      totalSize: currentSize,
      documentFrame: currentDocumentFrame,
      branchRevision = 0,
      durableDocument,
      durableStatus,
      documentId,
      documentRevision,
      clearPreviewLayers,
      publishDurableNavigationPresentation,
      beginHistoryReplayPresentation,
      isHistoryReplayPresentationCurrent,
      hasPendingHistoryReplayPresentation,
      cancelHistoryReplayPresentation,
      finalizeHistoryReplayPresentation,
    },
    dispatch,
  ] = useStore();

  const dpr = useDevicePixelRatio();

  function canUndo() {
    return historyIndex > 0;
  }

  function undo() {
    if (!canUndo()) return Promise.resolve();
    return resetHistoryTo(historyIndex - 1);
  }

  function canRedo() {
    return historyIndex < history.length - 1;
  }

  function redo() {
    if (!canRedo()) return Promise.resolve();
    return resetHistoryTo(historyIndex + 1);
  }
  //
  // function getLayerHistory(layerId: LayerId) {
  //   return history.filter((item) => item.layerId === layerId);
  // }

  function drawReplay(replayLayers: LayersRecord, frame: DocumentFrame) {
    const canvas = canvasRef.current;
    return !canvas || drawLayersToCanvas(canvas, getSortedLayersArray(replayLayers), frame, undefined, dpr, true);
  }

  async function resetHistoryTo(
    targetIndex: number,
    _history: HistoryItem[] = history,
    _branchRevision = branchRevision
  ) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return Promise.resolve();
    const target = _history[targetIndex];
    // A disabled opening row has no prior document state. Legacy replay skips
    // it, which would otherwise publish an empty canvas from a clickable row.
    if (targetIndex === 0 && target?.disabled && target.actionName === OPEN_DOCUMENT_ACTION) return Promise.resolve();
    const previousReplay = {
      updates: {
        layers,
        deletedLayers,
        activeLayerId,
        totalSize: currentSize,
        documentFrame: currentDocumentFrame,
        selections,
        activeSelectionId,
        hasUnsavedChanges,
      },
      timeline: { entries: history, cursor: historyIndex, branchRevision },
      preserveHasUnsavedChanges: true,
    };
    let replayDispatched = false;
    let attemptId: number | null = null;
    const isCurrentAttempt = (id: number) => isHistoryReplayPresentationCurrent?.(id) ?? true;
    // Legacy replay remains the structural substrate and complete fallback. The
    // durable publication paints the normal path when every identity, coverage,
    // and materialization gate succeeds.
    try {
      const initialFrame = currentDocumentFrame ?? documentFrameFromSize(currentSize);
      const replay = replayHistory(
        _history,
        targetIndex,
        currentSize,
        {
          // Replay layers keep their tmpCanvas: a cache is promoted only when the
          // user commits an edit, and the renderer draws from the canvas.
          createLayer: ({ layerId, layers: runtimeLayers, source }) =>
            createLayerSource({ layerId, layers: runtimeLayers, source }),
          applyRasterTool: (layer, args) => {
            const bitmap = layer.tmpCanvas ?? layer.bitmap;
            if (!bitmap) return layer;
            // A tool with no processor (see `PIXEL_FREE_TOOLS`) rasterizes nothing, so the layer is
            // left exactly as it was rather than replaced with an empty canvas.
            const processor = findToolProcessor(args.toolName);
            if (!processor) return layer;
            // The presented raster, not the raw one: a layer carrying a retained affine or filter
            // is staged at its evaluated extent first, so a stroke commits against the geometry
            // the screen showed. An evaluator throw here fails the navigation closed through the
            // `catch` below, exactly as one from the publication does — `drawReplay` runs the same
            // evaluation over the same layer — so it adds no failure class, only an earlier failure.
            const staged = stageProcessorInput(layer, bitmap);
            const [canvas, patch] = processor.imageProcessor({ bitmap: staged.bitmap, size: staged.bounds })(args);
            // Published at the bounds that raster occupies, with the operations baked into it
            // dropped from the list the renderer evaluates again. Keeping both was the double
            // application: `getLayerBitmap()` prefers this canvas and `drawLayerSource()` then
            // re-evaluated a transform and a filter the canvas already carried, at the layer's
            // original `pos` instead of the evaluated one. The disabled entries survive, so
            // `toggleDisabled()` still governs them.
            return {
              ...layer,
              pos: patch ? { ...staged.bounds, ...patch } : { ...staged.bounds },
              operations: operationsRetainedAfterBake(layer),
              source: undefined,
              tmpCanvas: canvas,
              presentationBounds: null,
            };
          },
        },
        initialFrame
      );
      const sortedLayers = getSortedLayersArray(replay.layers);
      const nextActiveLayerId =
        activeLayerId && replay.layers[activeLayerId]
          ? activeLayerId
          : (sortedLayers[sortedLayers.length - 1]?.id ?? null);
      dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            layers: replay.layers,
            deletedLayers: { ...deletedLayers },
            activeLayerId: nextActiveLayerId,
            totalSize: replay.totalSize,
            documentFrame: replay.documentFrame,
            selections: replay.selections,
            activeSelectionId: replay.activeSelectionId,
          },
          timeline: { entries: _history, cursor: targetIndex, branchRevision: _branchRevision },
        },
      });
      replayDispatched = true;
      // The dispatch is synchronous. Starting the token immediately after it
      // keeps a dispatch failure from superseding an accepted async replay,
      // while still fencing that older publication before it can resume.
      attemptId = beginHistoryReplayPresentation(documentId, documentRevision);
      const outcome = publishDurableNavigationPresentation
        ? await publishDurableNavigationPresentation(attemptId)
        : { status: 'legacy-fallback' as const, reason: 'stale' as const, cursor: targetIndex };
      if (outcome.status === 'stale' || !isCurrentAttempt(attemptId)) {
        cancelHistoryReplayPresentation?.(attemptId);
        return;
      }
      const painted =
        outcome.status === 'durable'
          ? (() => {
              const canvas = canvasRef.current;
              return (
                !canvas ||
                drawLayersToCanvas(canvas, getSortedLayersArray(outcome.layers), outcome.frame, undefined, dpr, true)
              );
            })()
          : drawReplay(replay.layers, replay.documentFrame);
      if (!painted) {
        // APPLY_HISTORY_REPLAY advances logical history before the asynchronous
        // durable presentation gate can finish. Restore the prior timeline when
        // the final legacy/durable draw cannot be accepted, so an unavailable
        // presentation never leaves the cursor pointing at pixels the user did
        // not see.
        dispatch({ type: 'APPLY_HISTORY_REPLAY', payload: previousReplay });
        replayDispatched = false;
        throw new Error('Unable to publish replayed history presentation');
      }
      if (!isCurrentAttempt(attemptId)) {
        cancelHistoryReplayPresentation?.(attemptId);
        return;
      }
      // Dropped HERE, after the replay has been published and applied, and not
      // ahead of it. A navigation that throws — a converter refusal, a tool
      // processor, a refused publication — leaves the visible canvas and the
      // store exactly as they were, so clearing first would discard an
      // in-progress tool draft for a navigation that changed nothing. Once a
      // replay IS on screen the clear is still required, and `drawAllLayers` in
      // `useLayer` is the only thing that recomposites a preview over the
      // layers: left standing, the draft would survive in state while its
      // pixels were gone from the canvas, so the next `commitDirtyTool()` would
      // apply a stroke the user could no longer see.
      clearPreviewLayers?.();
      const finalized = finalizeHistoryReplayPresentation?.({
        attemptId,
        documentId,
        documentRevision,
        branchRevision: _branchRevision,
        historyIndex: targetIndex,
      });
      if (finalized === false) cancelHistoryReplayPresentation?.(attemptId);
      // Reported HERE rather than inside `replayHistory`, which collects instead
      // of logging (see `ReplayDiagnostic`): replay runs on every undo, redo and
      // history-panel click, so a per-item log inside that loop would re-emit the
      // same refusal on every navigation. One line per refused entry per replay,
      // naming the code and passing the error VALUE so the stack survives —
      // matching the throw report below. HANDOFF.md §98 is why this exists at all:
      // skipping a malformed entry is correct, and doing it silently is a user
      // edit that vanished unnoticed.
      for (const diagnostic of replay.diagnostics) {
        console.error(`History replay skipped an entry (${diagnostic.code})`, diagnostic.error);
      }
    } catch (error) {
      if (attemptId !== null && !isCurrentAttempt(attemptId)) {
        cancelHistoryReplayPresentation?.(attemptId);
        return Promise.resolve();
      }
      if (attemptId === null && hasPendingHistoryReplayPresentation?.(documentId, documentRevision)) {
        // A newer request failed while a previously accepted replay is still
        // composing. Its failure must not invalidate the replay already in
        // flight or publish a status against that replay's logical state.
        console.error('History replay is unavailable', error);
        return Promise.resolve();
      }
      if (replayDispatched) {
        // The replay has already moved logical state, but the final presentation
        // can throw before it paints. Restore the prior cursor/layers before
        // reporting the failed target as unavailable.
        dispatch({ type: 'APPLY_HISTORY_REPLAY', payload: previousReplay });
      }
      const item = _history[targetIndex];
      const reason = error instanceof Error ? error.message : String(error);
      const diagnostic: MigrationDiagnostic = {
        historyId: item?.id,
        actionName: item?.actionName,
        severity: 'error',
        code: 'conversion-failed',
        message: reason,
      };
      console.error('History replay is unavailable', error);
      dispatch({ type: 'SET_DURABLE_STATUS', payload: { status: 'unavailable', diagnostics: [diagnostic] } });
      if (attemptId !== null) {
        const finalized = finalizeHistoryReplayPresentation?.({
          attemptId,
          documentId,
          documentRevision,
          branchRevision: previousReplay.timeline.branchRevision,
          historyIndex: previousReplay.timeline.cursor,
        });
        if (finalized === false) cancelHistoryReplayPresentation?.(attemptId);
      }
    }

    return Promise.resolve();
  }

  function toggleDisabled(historyId: string) {
    // todo commit dirty tool
    const entry = history.find((item) => item.id === historyId);
    if (entry && history[0] === entry && entry.actionName === OPEN_DOCUMENT_ACTION && !entry.disabled)
      return Promise.resolve();
    const timeline = updateHistoryTimeline(
      { entries: history, cursor: historyIndex, branchRevision },
      { type: 'toggle-disabled', entryId: historyId }
    );
    if (timeline.entries === history) return Promise.resolve();

    // recalculate current state
    return resetHistoryTo(historyIndex, [...timeline.entries], timeline.branchRevision);
  }

  return {
    canUndo,
    undo,
    canRedo,
    redo,
    resetHistoryTo,
    toggleDisabled,
    historyPanelProjection: selectHistoryPanelProjection({
      history,
      historyIndex,
      documentId,
      documentRevision,
      branchRevision,
      durableStatus,
      durableDocument,
    }),
  };
};
