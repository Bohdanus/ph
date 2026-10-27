import { afterEach, describe, expect, it, vi } from 'vitest';

import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const layerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  pos: { x: 4, y: 8, width: 100, height: 80 },
} satisfies LayerSource;

const FILTER_TOOL_ARGS = {
  blur: { toolName: 'blur', radius: 3 },
  color: { toolName: 'color', grayscale: 50, sepia: 0, saturation: 0 },
  levels: { toolName: 'levels', brightness: 10, contrast: 0 },
} as const;

const FILTER_TOOL_NAMES = ['blur', 'color', 'levels'] as const;

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
    presentationBounds: null,
    operations: [],
  };
}

function createDependencies(): HistoryReplayDependencies {
  return {
    createLayer: vi.fn((input) => createTestLayer(input.layerId)),
    applyRasterTool: vi.fn((layer: Layer) => layer),
  };
}

const historyFor = (toolName: (typeof FILTER_TOOL_NAMES)[number]): HistoryItem[] => [
  { id: 'new-layer', actionName: NEW_LAYER_ACTION, layerId, layerSource } as HistoryItem,
  {
    id: `tool-${toolName}`,
    actionName: TOOL_ACTION,
    layerId,
    args: FILTER_TOOL_ARGS[toolName],
  } as unknown as HistoryItem,
];

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('replayHistory does not re-append a filter the engine cannot apply', () => {
  it.each(FILTER_TOOL_NAMES)('skips the %s operation when ctx.filter is unavailable', (toolName) => {
    overrideCanvasFilterSupport(false);
    const dependencies = createDependencies();

    const result = replayHistory(historyFor(toolName), 1, initialSize, dependencies);

    expect(result.layers[layerId].operations).toHaveLength(0);
  });

  it.each(FILTER_TOOL_NAMES)('re-appends the %s operation when support is present', (toolName) => {
    overrideCanvasFilterSupport(true);
    const dependencies = createDependencies();

    const result = replayHistory(historyFor(toolName), 1, initialSize, dependencies);

    expect(result.layers[layerId].operations).toHaveLength(1);
    expect(result.layers[layerId].operations[0].enabled).toBe(true);
  });

  it('still replays the layer creation when only the filter is refused', () => {
    overrideCanvasFilterSupport(false);
    const dependencies = createDependencies();

    const result = replayHistory(historyFor('blur'), 1, initialSize, dependencies);

    expect(result.layers[layerId]).toBeDefined();
    expect(result.layers[layerId].pos).toEqual(layerSource.pos);
    expect(dependencies.createLayer).toHaveBeenCalledTimes(1);
  });

  it('is symmetric: an undo past a refused blur leaves no operation behind', () => {
    overrideCanvasFilterSupport(false);
    const dependencies = createDependencies();

    // Target index 0 is the layer creation alone; 1 is the refused blur. Undo to 0 must not
    // resurrect the operation, and redo to 1 must not introduce one either.
    expect(replayHistory(historyFor('blur'), 0, initialSize, dependencies).layers[layerId].operations).toHaveLength(0);
    expect(replayHistory(historyFor('blur'), 1, initialSize, dependencies).layers[layerId].operations).toHaveLength(0);
  });

  it('does not skip a non-filter layer operation', () => {
    overrideCanvasFilterSupport(false);
    const dependencies = createDependencies();
    const history = [
      { id: 'new-layer', actionName: NEW_LAYER_ACTION, layerId, layerSource } as HistoryItem,
      {
        id: 'tool-reposition',
        actionName: TOOL_ACTION,
        layerId,
        args: { toolName: 'reposition', move: { x: 10, y: 20 } },
      } as unknown as HistoryItem,
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers[layerId].pos).toEqual({ ...layerSource.pos, x: 10, y: 20 });
  });
});
