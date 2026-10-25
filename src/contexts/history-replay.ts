import type { Selection, Size } from './general-types.ts';
import type { DocumentFrameHistoryArgs, HistoryItem } from './history-types.ts';
import {
  cloneDocumentFrame,
  documentFrameFromSize,
  documentFrameSize,
  isValidDocumentFrame,
  type DocumentFrame,
} from './document-frame.ts';
import { createAffineLayerOperation, createLayerOperation, reorderLayers } from './layer-utils.ts';
import {
  isLayerBlendMode,
  type Layer,
  type LayerId,
  type LayerOperationArgs,
  type LayerSource,
  type LayersRecord,
} from './layer-types.ts';
import type { NewBedrockSize, ToolArgs } from './tool-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';
import type { ActionType } from '../util/constants.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import { getTransformFromHistoryArgs, isTrapezoidOnlyTransform } from './affine-transform.ts';
import {
  activeSelectionIdFromSnapshot,
  deriveSelectionBaseline,
  isValidSelectionSnapshot,
  type SelectionHistoryArgs,
} from './selection-baseline.ts';
import { documentAffineToLayerLocal, isIdentityAffineTransform, validateAffineTransform } from './affine-transform.ts';
import {
  HIDE_LAYER_ACTION,
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  UNLOCK_LAYER_ACTION,
} from '../util/constants.ts';

/**
 * A history entry this replay refused to apply.
 *
 * The refusal itself is the correct behaviour — a malformed entry is skipped
 * rather than allowed to corrupt the replayed state — but a skip is a silent
 * loss of a user edit unless something reports it, and HANDOFF.md §98 makes the
 * console the app's only error channel. Collected rather than logged at the
 * throw site because `replayHistory` runs on every undo, redo and history-panel
 * click, and these catches sit inside the per-item loop: logging per item turns
 * one refused entry into one line per navigation, repeated forever. The caller
 * reports the whole set once per replay.
 */
export type ReplayDiagnostic = Readonly<{
  historyId?: string;
  actionName?: ActionType;
  code:
    | 'canvas-filter-unsupported'
    | 'invalid-affine-transform'
    | 'invalid-layer-blend-mode'
    | 'invalid-document-transform'
    | 'invalid-layer-opacity'
    | 'invalid-layer-source'
    | 'invalid-selection-snapshot';
  error: unknown;
}>;

export type HistoryReplayResult = {
  layers: LayersRecord;
  totalSize: Size;
  documentFrame: DocumentFrame;
  selections: Selection[];
  activeSelectionId: string | null;
  /** Refused entries, in timeline order. Empty on a clean replay. */
  diagnostics: ReplayDiagnostic[];
};

export type HistoryReplayDependencies = {
  createLayer: (input: { layerId: LayerId; layers: LayersRecord; source: LayerSource }) => Layer;
  applyRasterTool: (layer: Layer, args: ToolArgs) => Layer;
};

function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    pos: { ...layer.pos },
    operations: layer.operations.map((operation) =>
      operation.kind === 'affine-transform'
        ? { ...operation, transform: { ...operation.transform } }
        : { ...operation, ...(operation.kind ? { kind: operation.kind } : {}), args: { ...operation.args } }
    ),
  };
}

function cloneLayers(layers: LayersRecord): LayersRecord {
  return Object.fromEntries(Object.values(layers).map((layer) => [layer.id, cloneLayer(layer)]));
}

export function replayHistory(
  history: readonly HistoryItem[],
  targetIndex: number,
  initialSize: Size,
  dependencies: HistoryReplayDependencies,
  initialFrame: DocumentFrame = documentFrameFromSize(initialSize)
): HistoryReplayResult {
  let layers: LayersRecord = {};
  const firstFrameTransition = history.find((item) => item.actionName === SET_DOCUMENT_FRAME_ACTION);
  const baselineFrame = (firstFrameTransition?.args as DocumentFrameHistoryArgs | undefined)?.previousFrame;
  let documentFrame = cloneDocumentFrame(isValidDocumentFrame(baselineFrame) ? baselineFrame : initialFrame);
  const selectionBaseline = deriveSelectionBaseline(history);
  let selections: Selection[] = selectionBaseline.selections.map((selection) => ({ ...selection }));
  let activeSelectionId: string | null = selectionBaseline.activeSelectionId;
  const diagnostics: ReplayDiagnostic[] = [];

  for (let index = 0; index <= targetIndex; index += 1) {
    const item = history[index];
    if (!item || item.disabled) continue;

    const { actionName, args, documentSource, layerId, layerSource } = item;
    const source = layerSource ?? (args as LayerSource | undefined);
    if (documentSource) {
      // A document replacement means to be a WHOLE new document, so it is honoured
      // only as the first entry, which is how one is ever written: the single
      // production producer is `REPLACE_DOCUMENT` with `history: [entry]`
      // from the document-replacement path in `useApp`. Carried mid-history it would replace
      // the layer record and resize the canvas from anywhere in the timeline, which
      // is the same class of defect as the mid-history bedrock source below, so it is
      // refused — the durable converter already refuses it, reporting
      // `document-replacement` and holding the previous state
      // through `history-adapter`. Unreachable in production today, so this is a
      // parity repair rather than a fix for something a user can see.
      if (index === 0) {
        layers = cloneLayers(documentSource.layers);
        documentFrame = documentSource.frame
          ? cloneDocumentFrame(documentSource.frame)
          : documentFrameFromSize(documentSource.size);
      }
      continue;
    }
    // A bedrock source sizes the DOCUMENT, so it may only establish the frame for
    // the initial document entry. A later layer or tool commit is an ordinary edit:
    // committing a background layer, or any geometric figure, must not resize the
    // canvas. A `documentSource` above still replaces the frame outright, and
    // `SET_DOCUMENT_FRAME` below still sets it explicitly, so a crop — the one
    // action that means to change the document size — is unaffected.
    if (index === 0) {
      if (source?.isBedrock) {
        documentFrame = documentFrameFromSize(source.size);
      } else if ((args as NewBedrockSize | undefined)?.isBedrock) {
        documentFrame = documentFrameFromSize((args as NewBedrockSize).size);
      }
    }

    if (actionName === SET_DOCUMENT_FRAME_ACTION) {
      const frameArgs = args as DocumentFrameHistoryArgs | undefined;
      const nextFrame = frameArgs?.nextFrame;
      if (!isValidDocumentFrame(nextFrame)) continue;

      let transform = frameArgs?.transform;
      if (transform !== undefined) {
        try {
          transform = validateAffineTransform(transform);
          if (!isIdentityAffineTransform(transform)) {
            const transformedLayers = Object.values(layers).map((layer) => {
              const localTransform = validateAffineTransform(documentAffineToLayerLocal(transform!, layer.pos), {
                width: layer.pos.width,
                height: layer.pos.height,
              });
              return {
                ...layer,
                operations: [...layer.operations, createAffineLayerOperation(localTransform, `${item.id}:${layer.id}`)],
                tmpCanvas: null,
                presentationBounds: null,
              };
            });
            layers = Object.fromEntries(transformedLayers.map((layer) => [layer.id, layer]));
          }
        } catch (error) {
          diagnostics.push({
            historyId: item.id,
            actionName,
            code: 'invalid-document-transform',
            error,
          });
          continue;
        }
      }
      documentFrame = cloneDocumentFrame(nextFrame);
      continue;
    }

    if (actionName === SELECTION_ACTION) {
      const next = (args as SelectionHistoryArgs | undefined)?.nextSelectionState;
      if (next != null && !isValidSelectionSnapshot(next)) {
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-selection-snapshot',
          error: new TypeError('Selection history value is not a valid selection snapshot'),
        });
        continue;
      }
      selections = next?.selections.map((selection) => ({ ...selection })) ?? [];
      activeSelectionId = activeSelectionIdFromSnapshot(selections, next?.activeSelectionId);
      continue;
    }

    if (actionName === NEW_LAYER_ACTION || (actionName === TOOL_ACTION && layerSource?.kind === 'tool')) {
      if (!source) continue;
      const layer = dependencies.createLayer({ layerId, layers, source });
      layers = { ...layers, [layer.id]: layer };
      continue;
    }
    if (actionName === SHOW_LAYER_ACTION || actionName === HIDE_LAYER_ACTION) {
      const layer = layers[layerId];
      if (layer) layers = { ...layers, [layerId]: { ...layer, visible: actionName === SHOW_LAYER_ACTION } };
      continue;
    }
    if (actionName === RENAME_LAYER_ACTION) {
      const layer = layers[layerId];
      if (layer) layers = { ...layers, [layerId]: { ...layer, name: (args as { name: string }).name } };
      continue;
    }
    if (actionName === SET_LAYER_OPACITY_ACTION) {
      const opacity = (args as { opacity?: unknown } | undefined)?.opacity;
      if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-layer-opacity',
          error: new TypeError('Layer opacity history value must be a finite number between 0 and 1'),
        });
        continue;
      }
      const layer = layers[layerId];
      if (layer) layers = { ...layers, [layerId]: { ...layer, opacity: (args as { opacity: number }).opacity } };
      continue;
    }
    if (actionName === SET_LAYER_BLEND_MODE_ACTION) {
      const blendMode = (args as { blendMode?: unknown } | undefined)?.blendMode;
      if (!isLayerBlendMode(blendMode)) {
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-layer-blend-mode',
          error: new TypeError('Layer blend mode history value is not supported'),
        });
        continue;
      }
      const layer = layers[layerId];
      if (layer) layers = { ...layers, [layerId]: { ...layer, blendMode } };
      continue;
    }
    if (actionName === LOCK_LAYER_ACTION || actionName === UNLOCK_LAYER_ACTION) {
      const layer = layers[layerId];
      if (layer) layers = { ...layers, [layerId]: { ...layer, locked: actionName === LOCK_LAYER_ACTION } };
      continue;
    }
    if (actionName === REORDER_ACTION) {
      const { layerToMoveId, afterWhichLayerId } = args as {
        layerToMoveId: LayerId;
        afterWhichLayerId?: LayerId | null;
      };
      if (!layers[layerToMoveId] || (afterWhichLayerId && !layers[afterWhichLayerId])) continue;
      layers = cloneLayers(layers);
      reorderLayers({ layers, layerToMoveId, afterWhichLayerId });
      continue;
    }
    if (actionName === MERGE_ACTION) {
      if (!source) continue;
      const layer = dependencies.createLayer({ layerId, layers, source });
      layers = { [layer.id]: layer };
      continue;
    }
    if (actionName === REPLACE_LAYER_SOURCE_ACTION) {
      const layer = layers[layerId];
      const replacementSource = (args as { source?: unknown } | undefined)?.source;
      if (!layer) continue;
      if (!replacementSource || typeof replacementSource !== 'object' || Array.isArray(replacementSource)) {
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-layer-source',
          error: new TypeError('Layer source history value must be an object'),
        });
        continue;
      }
      if ((replacementSource as { kind?: unknown }).kind !== 'tool') {
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-layer-source',
          error: new TypeError('Layer source history value must be a tool source'),
        });
        continue;
      }
      const replacement = dependencies.createLayer({
        layerId,
        layers,
        source: replacementSource as LayerSource,
      });
      layers = {
        ...layers,
        [layerId]: {
          ...layer,
          name: replacement.name,
          pos: { ...replacement.pos },
          source: replacement.source,
          bitmap: replacement.bitmap,
          // Preserve the creator's rendered replacement; replay should not discard its raster and
          // rely on a different reconstruction path.
          tmpCanvas: replacement.tmpCanvas,
          presentationBounds: null,
          operations: [...layer.operations],
          lastHistoryId: item.id,
        },
      };
      continue;
    }
    if (actionName === REMOVE_ACTION) {
      layers = Object.fromEntries(Object.entries(layers).filter(([id]) => id !== layerId));
      continue;
    }
    if (actionName !== TOOL_ACTION) continue;

    const layer = layers[layerId];
    const toolArgs = args as ToolArgs;
    if (!layer || !toolArgs?.toolName) continue;
    const processor = findToolProcessor(toolArgs.toolName);
    // A tool with no processor (see `PIXEL_FREE_TOOLS`) rasterizes nothing, so there is nothing to
    // replay for it. Unreachable today, because such a tool never writes a history item.
    if (!processor) continue;

    if (processor.commit === 'layer-operation') {
      // A retained filter this browser cannot apply must not be re-appended: the layer would then
      // present unchanged pixels that no replay reproduces, and `layer-renderer` would refuse to
      // draw it at all. Skipping is the same refusal the commit path makes, at replay time.
      if (processor.requiresCanvasFilter) {
        try {
          requireCanvasFilter(toolArgs.toolName);
        } catch (error) {
          // The `tempUpdateLayer()` canvas-filter gate refuses the same tool and logs it
          // there, before any `TOOL_ACTION` exists, so this catch is a backstop for
          // a timeline that arrived some other way. It records rather than logs,
          // because replay repeats: see `ReplayDiagnostic`.
          diagnostics.push({
            historyId: item.id,
            actionName,
            code: 'canvas-filter-unsupported',
            error,
          });
          continue;
        }
      }
      layers = {
        ...layers,
        [layerId]: {
          ...layer,
          operations: [...layer.operations, createLayerOperation(toolArgs as LayerOperationArgs, item.id)],
        },
      };
      continue;
    }
    if (processor.commit === 'affine-operation') {
      const trapezoid = toolArgs.toolName === 'transform' ? (toolArgs.trapezoid ?? 0) : 0;
      if (toolArgs.toolName === 'transform' && trapezoid !== 0) {
        try {
          if (!isTrapezoidOnlyTransform(toolArgs)) continue;
        } catch {
          continue;
        }
        layers = { ...layers, [layerId]: dependencies.applyRasterTool(layer, toolArgs) };
        continue;
      }
      try {
        const transform = getTransformFromHistoryArgs(toolArgs, layer.pos);
        if (!transform) continue;
        layers = {
          ...layers,
          [layerId]: {
            ...layer,
            operations: [...layer.operations, createAffineLayerOperation(transform, item.id)],
          },
        };
      } catch (error) {
        // Invalid historical transforms are ignored rather than producing a
        // corrupt replay state. Reachable, and unlike the two catches above this
        // one loses a real edit: `getTransformFromHistoryArgs` validates the affine
        // against `layer.pos` AS IT IS NOW, while it was validated at commit time
        // against the pos the layer had then (`normalizeCommittedToolArgs` at
        // `normalizeCommittedToolArgs()` writes the retained transform into the committed
        // args), so a transform valid when committed can fail a bounds check here
        // after the layer moved. Recorded, not logged — see `ReplayDiagnostic`.
        diagnostics.push({
          historyId: item.id,
          actionName,
          code: 'invalid-affine-transform',
          error,
        });
      }
      continue;
    }
    if (processor.commit === 'geometry') {
      const { move, resize } = toolArgs as RepositionToolArgs;
      const patch = resize ?? move;
      if (patch) layers = { ...layers, [layerId]: { ...layer, pos: { ...layer.pos, ...patch } } };
      continue;
    }
    if (processor.commit === 'document-operation') continue;
    layers = { ...layers, [layerId]: dependencies.applyRasterTool(layer, toolArgs) };
  }

  const activeSelection = activeSelectionId && selections.some((selection) => selection.id === activeSelectionId);
  return {
    layers,
    totalSize: documentFrameSize(documentFrame),
    documentFrame,
    selections,
    activeSelectionId: activeSelection ? activeSelectionId : null,
    diagnostics,
  };
}
