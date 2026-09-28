import { describe, expect, it, vi } from 'vitest';

import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import { deriveSetLayerPropertiesEntry } from '../history-adapter.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import {
  HIDE_LAYER_ACTION,
  NEW_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

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

    expect(result.layers[layerId].operations).toEqual([
      { id: 'blur-action', args: { toolName: 'blur', radius: 3 }, enabled: true },
      { id: 'color-action', args: { toolName: 'color', grayscale: 0.2, sepia: 0.1, saturation: 0.3 }, enabled: true },
      { id: 'levels-action', args: { toolName: 'levels', brightness: 10, contrast: -5 }, enabled: true },
    ]);
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

  it('replays a committed selection move back to the pre-move geometry and forward again', () => {
    const dependencies = createDependencies();
    const drawn: Selection = {
      id: 'selection-1',
      points: [
        { x: 1, y: 1 },
        { x: 91, y: 1 },
        { x: 91, y: 91 },
      ],
      isActive: true,
      pos: { x: 9, y: 9, width: 92, height: 92 },
    };
    const moved: Selection = {
      ...drawn,
      points: [
        { x: 11, y: 6 },
        { x: 101, y: 6 },
        { x: 101, y: 96 },
      ],
      isActive: true,
      pos: { x: 19, y: 4, width: 92, height: 92 },
      metadata: { movedAtVersion: 1 },
    };
    // The shape a polygon's anchor or body drag now leaves behind: two entries,
    // one per completed gesture, the second replacing the first selection's
    // geometry rather than appending a second selection.
    const history: HistoryItem[] = [
      newLayerHistoryItem(),
      {
        id: 'selection-create',
        actionName: SELECTION_ACTION,
        layerId,
        args: {
          previousSelectionState: { selections: [], activeSelectionId: null },
          nextSelectionState: { selections: [drawn], activeSelectionId: drawn.id },
        },
      },
      {
        id: 'selection-move',
        actionName: SELECTION_ACTION,
        layerId,
        args: {
          previousSelectionState: { selections: [drawn], activeSelectionId: drawn.id },
          nextSelectionState: { selections: [moved], activeSelectionId: moved.id },
        },
      },
    ];

    // The user-visible fix: redo after the move returns the pre-move geometry, and
    // undoing that redo puts the move back. A move that appended no history entry
    // could not be undone at all, and redoing it left the moved geometry forever.
    expect(replayHistory(history, 1, initialSize, dependencies)).toMatchObject({
      selections: [drawn],
      activeSelectionId: drawn.id,
    });
    expect(replayHistory(history, 2, initialSize, dependencies)).toMatchObject({
      selections: [moved],
      activeSelectionId: moved.id,
    });
    expect(replayHistory(history, 1, initialSize, dependencies)).toMatchObject({
      selections: [drawn],
      activeSelectionId: drawn.id,
    });
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

/**
 * `deriveSetLayerPropertiesEntry` and the branches above encode the same rule
 * twice: once for the durable entry the store publishes, once for the legacy
 * replay that drives undo/redo. Nothing in the type system ties them together,
 * so this suite pins the agreement directly — if either side is edited alone,
 * the layer starts changing on commit and not reverting, and this fails.
 */
describe('layer-property parity between the durable derivation and legacy replay', () => {
  const propertyCases = [
    { label: 'show', actionName: SHOW_LAYER_ACTION, args: { visible: true } },
    { label: 'hide', actionName: HIDE_LAYER_ACTION, args: { visible: false } },
    { label: 'rename', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' } },
  ] as const;

  it.each(propertyCases)(
    'replaying $label changes exactly the property the derivation patched',
    ({ actionName, args }) => {
      const history: HistoryItem[] = [newLayerHistoryItem(), { id: 'property', actionName, layerId, args }];
      const planned = deriveSetLayerPropertiesEntry(history[1]);
      expect(planned).not.toBeNull();

      const replayed = replayHistory(history, history.length - 1, initialSize, createDependencies()).layers[layerId];
      const patch = planned!.operation.patch;
      expect(Object.keys(patch)).toHaveLength(1);
      for (const [property, value] of Object.entries(patch)) {
        expect(replayed[property as 'name' | 'visible']).toEqual(value);
      }
    }
  );

  it('refuses a malformed rename in the derivation, and replay still applies it raw', () => {
    // A documented divergence, not an oversight: the derivation refuses a
    // non-string name, but replay assigns `args.name` unconditionally once the
    // layer exists. That is why the writer falls back to the caller's patch
    // when the derivation refuses — falling back to `{}` would leave the live
    // layer untouched and make undo restore a value it never had.
    const history: HistoryItem[] = [
      newLayerHistoryItem(),
      { id: 'bad-rename', actionName: RENAME_LAYER_ACTION, layerId, args: { name: 42 } },
    ];

    expect(deriveSetLayerPropertiesEntry(history[1])).toBeNull();
    expect(replayHistory(history, 1, initialSize, createDependencies()).layers[layerId].name).toBe(42);
  });

  it('records a property entry for a layer replay cannot find', () => {
    const orphan: HistoryItem = { id: 'orphan', actionName: HIDE_LAYER_ACTION, layerId: 'missing', args: {} };

    expect(deriveSetLayerPropertiesEntry(orphan)).not.toBeNull();
    expect(replayHistory([orphan], 0, initialSize, createDependencies()).layers['missing']).toBeUndefined();
  });
});
