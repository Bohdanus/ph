import type { Selection, Size } from './general-types.ts';
import type { DocumentFrameHistoryArgs, HistoryItem } from './history-types.ts';
import {
  cloneDocumentFrame,
  documentFrameFromSize,
  documentFrameSize,
  isValidDocumentFrame,
  type DocumentFrame,
} from './document-frame.ts';
import { createLayerOperation, reorderLayers } from './layer-utils.ts';
import type { Layer, LayerId, LayerOperationArgs, LayerSource, LayersRecord } from './layer-types.ts';
import type { NewBedrockSize, ToolArgs } from './tool-types.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import type { RepositionToolArgs } from '../tools/reposition.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';

export type HistoryReplayResult = {
  layers: LayersRecord;
  totalSize: Size;
  documentFrame: DocumentFrame;
  selections: Selection[];
  activeSelectionId: string | null;
};

export type HistoryReplayDependencies = {
  createLayer: (input: { layerId: LayerId; layers: LayersRecord; source: LayerSource }) => Layer;
  applyRasterTool: (layer: Layer, args: ToolArgs) => Layer;
};

type SelectionHistoryArgs = {
  previousSelectionState?: { selections: Selection[]; activeSelectionId: string | null };
  nextSelectionState?: { selections: Selection[]; activeSelectionId: string | null };
};

function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    pos: { ...layer.pos },
    operations: layer.operations.map((operation) => ({ ...operation, args: { ...operation.args } })),
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
  let documentFrame = cloneDocumentFrame(initialFrame);
  const firstSelection = history.find((item) => item.actionName === SELECTION_ACTION && !item.disabled);
  const selectionBaseline = (firstSelection?.args as SelectionHistoryArgs | undefined)?.previousSelectionState;
  let selections: Selection[] = selectionBaseline?.selections.map((selection) => ({ ...selection })) ?? [];
  let activeSelectionId: string | null = selectionBaseline?.activeSelectionId ?? null;

  for (let index = 0; index <= targetIndex; index += 1) {
    const item = history[index];
    if (!item || item.disabled) continue;

    const { actionName, args, documentSource, layerId, layerSource } = item;
    const source = layerSource ?? (args as LayerSource | undefined);
    if (documentSource) {
      layers = cloneLayers(documentSource.layers);
      documentFrame = documentSource.frame
        ? cloneDocumentFrame(documentSource.frame)
        : documentFrameFromSize(documentSource.size);
      continue;
    }
    if (source?.isBedrock) {
      documentFrame = documentFrameFromSize(source.size);
    } else if ((args as NewBedrockSize | undefined)?.isBedrock) {
      documentFrame = documentFrameFromSize((args as NewBedrockSize).size);
    }

    if (actionName === SET_DOCUMENT_FRAME_ACTION) {
      const nextFrame = (args as DocumentFrameHistoryArgs | undefined)?.nextFrame;
      if (isValidDocumentFrame(nextFrame)) {
        documentFrame = cloneDocumentFrame(nextFrame);
      }
      continue;
    }

    if (actionName === SELECTION_ACTION) {
      const next = (args as SelectionHistoryArgs | undefined)?.nextSelectionState;
      selections = next?.selections.map((selection) => ({ ...selection })) ?? [];
      activeSelectionId = next?.activeSelectionId ?? null;
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
    if (actionName === REMOVE_ACTION) {
      layers = Object.fromEntries(Object.entries(layers).filter(([id]) => id !== layerId));
      continue;
    }
    if (actionName !== TOOL_ACTION) continue;

    const layer = layers[layerId];
    const toolArgs = args as ToolArgs;
    if (!layer || !toolArgs?.toolName) continue;
    const processor = toolProcessors[toolArgs.toolName];

    if (processor.commit === 'layer-operation') {
      layers = {
        ...layers,
        [layerId]: {
          ...layer,
          operations: [...layer.operations, createLayerOperation(toolArgs as LayerOperationArgs, item.id)],
        },
      };
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
  };
}
