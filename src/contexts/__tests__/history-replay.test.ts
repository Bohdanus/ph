import { describe, expect, it, vi } from 'vitest';

import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION, SELECTION_ACTION, SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const layerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  pos: { x: 4, y: 8, width: 100, height: 80 },
} satisfies LayerSource;

function createTestLayer(id: string): Layer {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    pos: { ...layerSource.pos },
    operations: [],
  };
}

function createDependencies() {
  const createLayer = vi.fn((input: Parameters<HistoryReplayDependencies['createLayer']>[0]) =>
    createTestLayer(input.layerId)
  );
  const applyRasterTool = vi.fn((layer: Layer) => layer);

  return { createLayer, applyRasterTool } satisfies HistoryReplayDependencies;
}

function newLayerHistoryItem(): HistoryItem {
  return { id: 'new-layer', actionName: NEW_LAYER_ACTION, layerId, layerSource };
}

describe('replayHistory', () => {
  it('retains blur, color, and levels actions as enabled layer operations without rasterizing', () => {
    const dependencies = createDependencies();
    const toolArgs = [
      { toolName: 'blur', radius: 3 },
      { toolName: 'color', grayscale: 0.2, sepia: 0.1, saturation: 0.3 },
      { toolName: 'levels', brightness: 10, contrast: -5 },
    ] as const;
    const history: HistoryItem[] = [
      newLayerHistoryItem(),
      ...toolArgs.map((args): HistoryItem => ({
        id: `${args.toolName}-action`,
        actionName: TOOL_ACTION,
        layerId,
        args,
      })),
    ];

    const result = replayHistory(history, history.length - 1, initialSize, dependencies);

    expect(result.layers[layerId].operations).toEqual(
      toolArgs.map((args) => ({ id: `${args.toolName}-action`, args, enabled: true }))
    );
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it('applies reposition resize only to the layer logical position without rasterizing', () => {
    const dependencies = createDependencies();
    const resize = { x: 20, y: 30, width: 250, height: 160 };
    const history: HistoryItem[] = [
      newLayerHistoryItem(),
      { id: 'resize', actionName: TOOL_ACTION, layerId, args: { toolName: 'reposition', resize } },
    ];

    const result = replayHistory(history, history.length - 1, initialSize, dependencies);

    expect(result.layers[layerId]).toEqual({ ...createTestLayer(layerId), pos: resize });
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it('uses the first selection action baseline before it and its next state at or after it', () => {
    const dependencies = createDependencies();
    const previousSelection: Selection = {
      id: 'previous',
      points: [{ x: 1, y: 2 }],
      isActive: true,
      pos: { x: 1, y: 2, width: 10, height: 12 },
    };
    const nextSelection: Selection = {
      id: 'next',
      points: [{ x: 3, y: 4 }],
      isActive: true,
      pos: { x: 3, y: 4, width: 14, height: 16 },
    };
    const history: HistoryItem[] = [
      newLayerHistoryItem(),
      {
        id: 'selection',
        actionName: SELECTION_ACTION,
        layerId,
        args: {
          previousSelectionState: { selections: [previousSelection], activeSelectionId: previousSelection.id },
          nextSelectionState: { selections: [nextSelection], activeSelectionId: nextSelection.id },
        },
      },
    ];

    const beforeSelection = replayHistory(history, 0, initialSize, dependencies);
    const atSelection = replayHistory(history, 1, initialSize, dependencies);

    expect(beforeSelection).toMatchObject({
      selections: [previousSelection],
      activeSelectionId: previousSelection.id,
    });
    expect(atSelection).toMatchObject({ selections: [nextSelection], activeSelectionId: nextSelection.id });
  });

  it('replays document-frame crops without changing layer world geometry or sources', () => {
    const dependencies = createDependencies();
    const baselineLayer = createTestLayer(layerId);
    const baselineFrame = { x: 0, y: 0, width: 400, height: 300 } as const;
    const croppedFrame = { x: 40, y: 25, width: 200, height: 120 } as const;
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: 'open document',
        layerId,
        documentSource: { layers: { [layerId]: baselineLayer }, size: initialSize, frame: baselineFrame },
      },
      {
        id: 'crop',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        layerId: 'document',
        args: { previousFrame: baselineFrame, nextFrame: croppedFrame },
      },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.documentFrame).toEqual(croppedFrame);
    expect(result.totalSize).toEqual({ width: 200, height: 120 });
    expect(result.layers[layerId].pos).toEqual(baselineLayer.pos);
    expect(result.layers[layerId].source).toBe(baselineLayer.source);
  });

  it('ignores disabled document-frame actions', () => {
    const dependencies = createDependencies();
    const baselineFrame = { x: 0, y: 0, width: 400, height: 300 } as const;
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: 'open document',
        layerId,
        documentSource: { layers: { [layerId]: createTestLayer(layerId) }, size: initialSize, frame: baselineFrame },
      },
      {
        id: 'crop',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        layerId: 'document',
        disabled: true,
        args: { nextFrame: { x: 2, y: 3, width: 10, height: 12 } },
      },
    ];

    expect(replayHistory(history, 1, initialSize, dependencies).documentFrame).toEqual(baselineFrame);
  });
});
