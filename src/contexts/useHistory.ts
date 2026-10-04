import { useStore } from './StoreContext.tsx';
import type { LayersRecord } from './layer-types.ts';
import type { HistoryItem } from './history-types.ts';
import type { ToolArgs } from './tool-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';
import { createLayerSource, getSortedLayersArray } from './layer-utils.ts';
import { drawLayersToCanvas } from './layer-renderer.ts';
import { replayHistory } from './history-replay.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../util/constants.ts';
import { updateHistoryTimeline } from './history-timeline.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';
import type { MigrationDiagnostic } from './history-adapter.ts';
import { operationsRetainedAfterBake, stageProcessorInput } from './presentation-evaluator.ts';

export function getHistoryItemTitle(item: HistoryItem) {
  const { actionName, args, layerSource } = item;

  if (layerSource?.kind === 'tool') {
    return layerSource.args.toolName;
  }

  if (actionName === TOOL_ACTION) {
    return (args as ToolArgs).toolName;
  }

  if (actionName === SET_DOCUMENT_FRAME_ACTION) return 'crop';

  return actionName;
}

export const useHistory = () => {
  const [
    {
      canvasRef,
      history,
      historyIndex,
      deletedLayers,
      activeLayerId,
      totalSize: currentSize,
      documentFrame: currentDocumentFrame,
      branchRevision = 0,
      clearPreviewLayers,
    },
    dispatch,
  ] = useStore();

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

  function drawReplay(layers: LayersRecord, frame: DocumentFrame) {
    const canvas = canvasRef.current;
    return !canvas || drawLayersToCanvas(canvas, getSortedLayersArray(layers), frame);
  }

  function resetHistoryTo(targetIndex: number, _history: HistoryItem[] = history, _branchRevision = branchRevision) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= _history.length) return Promise.resolve();
    // Durable replay remains a diagnostic shadow until every pixel consumer
    // uses the same materialization contract. Navigation therefore replays the
    // legacy runtime representation and lets StoreContext rebuild the sidecar.
    try {
      const initialFrame = currentDocumentFrame ?? documentFrameFromSize(currentSize);
      const replay = replayHistory(
        _history,
        targetIndex,
        currentSize,
        {
          // Replay layers keep their tmpCanvas: a cache is promoted only when the
          // user commits an edit, and the renderer draws from the canvas.
          createLayer: ({ layerId, layers, source }) => createLayerSource({ layerId, layers, source }),
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
      if (!drawReplay(replay.layers, replay.documentFrame)) {
        throw new Error('Unable to publish replayed history presentation');
      }

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
    }

    return Promise.resolve();
  }

  function toggleDisabled(historyId: string) {
    // todo commit dirty tool
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
  };
};
