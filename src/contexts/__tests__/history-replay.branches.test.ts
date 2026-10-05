import { describe, expect, it, vi } from 'vitest';

import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { FilterLayerOperation, Layer, LayerOperation, LayerSource, LayersRecord } from '../layer-types.ts';
import type { HistoryItem } from '../history-types.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import type { ActionType } from '../../util/constants.ts';

const initialSize = { width: 400, height: 300 };

function createTestLayer(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 40, height: 30 },
    operations: [],
    ...overrides,
  };
}

function createDependencies() {
  return {
    createLayer: vi.fn((input: Parameters<HistoryReplayDependencies['createLayer']>[0]) =>
      createTestLayer(input.layerId, { pos: { x: 0, y: 0, width: 40, height: 30 }, source: input.source })
    ),
    applyRasterTool: vi.fn((layer: Layer) => ({ ...layer, name: 'rasterized' })),
  } satisfies HistoryReplayDependencies;
}

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 5, y: 6, width: 40, height: 30 },
};

describe('replayHistory document source and frame branches', () => {
  it('derives the frame from the document source size when the legacy entry has no frame', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: { 'layer-1': createTestLayer('layer-1') }, size: { width: 640, height: 480 } },
      },
    ];

    const result = replayHistory(history, 0, initialSize, dependencies);

    expect(result.documentFrame).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(result.totalSize).toEqual({ width: 640, height: 480 });
  });

  it('refuses the frame and layer record of a document source carried mid-history', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'replace',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-9': createTestLayer('layer-9', { order: 4 }) },
          size: initialSize,
          frame: { x: 3, y: 4, width: 200, height: 100 },
        },
      },
    ];
    expect(Object.keys(replayHistory([history[0]], 0, initialSize, dependencies).layers)).toEqual(['layer-1']);

    const result = replayHistory(history, 1, initialSize, dependencies);

    // A document replacement means to be a WHOLE new document, so it is honoured only
    // as the FIRST entry (`history-replay.ts:89`). Carried mid-history it would swap
    // the layer record and resize the canvas from anywhere in the timeline, which is
    // the same shape the durable converter already refuses as an error
    // (`history-adapter.ts:640`) — so honouring it here is exactly the
    // authority/shadow disagreement that gate closes. Unreachable in production: the
    // only writer is `REPLACE_DOCUMENT` with `history: [entry]` (`setImageFromUpload()`), so
    // a `documentSource` always lands at index 0.
    expect(Object.keys(result.layers)).toEqual(['layer-1']);
    expect(result.layers['layer-9']).toBeUndefined();
    expect(result.documentFrame).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it.each([
    {
      label: 'a bedrock layer source',
      item: {
        id: 'bedrock-source',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          isBedrock: true,
          size: { width: 800, height: 600 },
        },
      } satisfies HistoryItem,
      expectedFrame: { x: 0, y: 0, width: 800, height: 600 },
    },
    {
      label: 'bedrock args beside a non-bedrock layer source',
      item: {
        id: 'bedrock-args',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock-args',
        layerSource: blankSource,
        args: { isBedrock: true, size: { width: 1024, height: 768 } },
      } satisfies HistoryItem,
      expectedFrame: { x: 0, y: 0, width: 1024, height: 768 },
    },
  ])('reframes the document from $label at the initial document entry', ({ item, expectedFrame }) => {
    const dependencies = createDependencies();

    const result = replayHistory([item], 0, initialSize, dependencies);

    expect(result.documentFrame).toEqual(expectedFrame);
  });

  it.each([
    {
      label: 'a bedrock layer source',
      item: {
        id: 'bedrock-source',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          isBedrock: true,
          size: { width: 800, height: 600 },
        },
      } satisfies HistoryItem,
    },
    {
      label: 'bedrock args beside a non-bedrock layer source',
      item: {
        id: 'bedrock-args',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock-args',
        layerSource: blankSource,
        args: { isBedrock: true, size: { width: 1024, height: 768 } },
      } satisfies HistoryItem,
    },
  ])('does NOT resize the document from $label committed after the initial entry', ({ item }) => {
    const dependencies = createDependencies();
    const currentFrame = { x: 1, y: 2, width: 300, height: 200 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: { 'layer-1': createTestLayer('layer-1') }, size: initialSize, frame: currentFrame },
      },
      item,
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.documentFrame).toEqual(currentFrame);
    expect(result.totalSize).toEqual({ width: 300, height: 200 });
    // The layer is still committed: refusing to resize is not refusing the edit.
    expect(Object.keys(result.layers)).toContain(item.layerId);
  });

  it('does not resize the document when a tool commits a geometric figure over a layer', () => {
    const dependencies = createDependencies();
    const currentFrame = { x: 0, y: 0, width: 400, height: 300 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: { 'layer-1': createTestLayer('layer-1') }, size: initialSize, frame: currentFrame },
      },
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'rectangle',
        actionName: TOOL_ACTION,
        layerId: 'layer-1',
        layerSource: {
          kind: 'tool',
          args: { toolName: 'shape' },
          isBedrock: true,
          size: { width: 900, height: 700 },
        } as LayerSource,
        args: { toolName: 'shape' },
      },
    ];

    const result = replayHistory(history, 2, initialSize, dependencies);

    expect(result.documentFrame).toEqual(currentFrame);
    expect(result.totalSize).toEqual({ width: 400, height: 300 });
  });

  it('keeps a frame established at index 0 rather than reverting it on a later commit', () => {
    const dependencies = createDependencies();
    const bedrockFrame = { x: 0, y: 0, width: 800, height: 600 };
    const history: HistoryItem[] = [
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          isBedrock: true,
          size: { width: 800, height: 600 },
        },
      },
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
    ];

    // `initialFrame` is the store's CURRENT frame, which is the size a later commit
    // must not be able to drag back to: only `documentSource` and an explicit
    // `SET_DOCUMENT_FRAME` may move it.
    const result = replayHistory(history, 1, initialSize, dependencies, { x: 0, y: 0, width: 400, height: 300 });

    expect(result.documentFrame).toEqual(bedrockFrame);
    expect(result.totalSize).toEqual({ width: 800, height: 600 });
  });

  it('still resizes the document on an explicit frame action after a mid-history bedrock add', () => {
    const dependencies = createDependencies();
    const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };
    const croppedFrame = { x: 5, y: 5, width: 120, height: 90 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: { 'layer-1': createTestLayer('layer-1') }, size: initialSize, frame: baselineFrame },
      },
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: {
          kind: 'blank',
          color: '#000000',
          opacity: 1,
          isBedrock: true,
          size: { width: 800, height: 600 },
        },
      },
      { id: 'crop', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame: croppedFrame } },
    ];

    const result = replayHistory(history, 2, initialSize, dependencies);

    expect(result.documentFrame).toEqual(croppedFrame);
    expect(result.totalSize).toEqual({ width: 120, height: 90 });
  });

  it.each([
    { label: 'a missing next frame', nextFrame: undefined },
    { label: 'a zero-width next frame', nextFrame: { x: 0, y: 0, width: 0, height: 10 } },
    { label: 'a non-finite next frame', nextFrame: { x: 0, y: 0, width: Number.NaN, height: 10 } },
    { label: 'a non-object next frame', nextFrame: 'nope' as unknown as { x: number; y: number } },
  ])('keeps the current document frame for $label', ({ nextFrame }) => {
    const dependencies = createDependencies();
    const currentFrame = { x: 1, y: 2, width: 300, height: 200 };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers: {}, size: initialSize, frame: currentFrame },
      },
      { id: 'frame', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame } },
    ];

    expect(replayHistory(history, 1, initialSize, dependencies).documentFrame).toEqual(currentFrame);
  });

  it('is idempotent when replaying the same cursor twice over an identical history', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'blur', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 3 } },
      { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1' },
    ];

    const first = replayHistory(history, 2, initialSize, dependencies);
    const second = replayHistory(history, 2, initialSize, dependencies);

    expect(second).toEqual(first);
    expect(first.layers['layer-1'].visible).toBe(false);
  });

  it('replays a cursor outside the history range without inventing entries', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
    ];

    expect(replayHistory(history, 99, initialSize, dependencies).layers).toEqual(
      replayHistory(history, 0, initialSize, dependencies).layers
    );
    expect(replayHistory([], 5, initialSize, dependencies)).toMatchObject({ layers: {}, selections: [] });
  });
});

describe('replayHistory selection branches', () => {
  it('clears selections for a selection action that carries no next state', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      {
        id: 'selection',
        actionName: SELECTION_ACTION,
        layerId: 'layer-1',
        args: {
          previousSelectionState: {
            selections: [
              { id: 'old', points: [{ x: 0, y: 0 }], isActive: true, pos: { x: 0, y: 0, width: 4, height: 4 } },
            ],
            activeSelectionId: 'old',
          },
        },
      },
    ];

    const result = replayHistory(history, 0, initialSize, dependencies);

    expect(result.selections).toEqual([]);
    expect(result.activeSelectionId).toBeNull();
  });

  it('ignores a disabled selection action when picking the baseline', () => {
    const dependencies = createDependencies();
    const selection = {
      id: 'live',
      points: [{ x: 1, y: 1 }],
      isActive: true,
      pos: { x: 1, y: 1, width: 5, height: 5 },
    };
    const history: HistoryItem[] = [
      {
        id: 'disabled-selection',
        actionName: SELECTION_ACTION,
        layerId: 'layer-1',
        disabled: true,
        args: { previousSelectionState: { selections: [selection], activeSelectionId: 'live' } },
      },
    ];

    expect(replayHistory(history, 0, initialSize, dependencies)).toMatchObject({
      selections: [],
      activeSelectionId: null,
    });
  });

  it('nulls an active selection id that no longer resolves to a live selection', () => {
    const dependencies = createDependencies();
    const selection = {
      id: 'live',
      points: [{ x: 1, y: 1 }],
      isActive: true,
      pos: { x: 1, y: 1, width: 5, height: 5 },
    };
    const history: HistoryItem[] = [
      {
        id: 'selection',
        actionName: SELECTION_ACTION,
        layerId: 'layer-1',
        args: { nextSelectionState: { selections: [selection], activeSelectionId: 'vanished' } },
      },
    ];

    expect(replayHistory(history, 0, initialSize, dependencies).activeSelectionId).toBeNull();
  });
});

describe('replayHistory layer bookkeeping actions', () => {
  it('skips a new-layer action that carries no source', () => {
    const dependencies = createDependencies();

    const result = replayHistory(
      [{ id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1' }],
      0,
      initialSize,
      dependencies
    );

    expect(result.layers).toEqual({});
    expect(dependencies.createLayer).not.toHaveBeenCalled();
  });

  it('keeps the retained operations of a layer whose source is replaced', () => {
    // The load-bearing half of "a text layer with a filter on it can be retyped": the replace arm
    // installs the replacement's name, `pos`, `source` and rasters and copies the EXISTING layer's
    // `operations` across, so a source edit is an edit of the layer's arguments rather than of the
    // edits already applied to it. `replayDurableDocument` keeps the list for the same reason and
    // pins it in `durable-replay.source-edit.test.ts`; without this half the two replay authorities
    // would disagree about a retyped layer, and both renderers re-apply the list to the new source
    // (`drawLayerSource` at draw time, `materializeLayer`'s retained segment).
    //
    // The arm is otherwise unobservable from this file's other cases: nothing here seeds a layer
    // that already carries an operation, so a replace that dropped the list passed every other test.
    const dependencies = createDependencies();
    const blur: FilterLayerOperation = { id: 'blur', args: { toolName: 'blur', radius: 4 }, enabled: true };
    const replacement: LayerSource = {
      kind: 'tool',
      args: { toolName: 'text', text: 'Retyped' },
      isBedrock: false,
      pos: { x: 0, y: 0, width: 60, height: 40 },
    } as LayerSource;
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-1': createTestLayer('layer-1', { operations: [blur] }) },
          size: initialSize,
          frame: { x: 0, y: 0, width: 400, height: 300 },
        },
      },
      { id: 'retype', actionName: REPLACE_LAYER_SOURCE_ACTION, layerId: 'layer-1', args: { source: replacement } },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].operations).toEqual([blur]);
    // The replacement still took the source, so the layer is retyped rather than untouched.
    expect(result.layers['layer-1'].source).toEqual(replacement);
  });

  it('creates a layer from a tool layer source on a tool action', () => {
    const dependencies = createDependencies();
    const toolSource: LayerSource = {
      kind: 'tool',
      args: { toolName: 'shape', figure: 'polygon' },
      isBedrock: false,
      pos: { x: 0, y: 0, width: 20, height: 20 },
    } as LayerSource;

    const result = replayHistory(
      [{ id: 'tool-source', actionName: TOOL_ACTION, layerId: 'layer-tool', layerSource: toolSource }],
      0,
      initialSize,
      dependencies
    );

    expect(dependencies.createLayer).toHaveBeenCalledWith({ layerId: 'layer-tool', layers: {}, source: toolSource });
    expect(Object.keys(result.layers)).toEqual(['layer-tool']);
  });

  it.each([
    { actionName: SHOW_LAYER_ACTION, expectedVisible: true },
    { actionName: HIDE_LAYER_ACTION, expectedVisible: false },
  ] satisfies ReadonlyArray<{ actionName: ActionType; expectedVisible: boolean }>)(
    'applies $actionName to a present layer and ignores it for a missing one',
    ({ actionName, expectedVisible }) => {
      const dependencies = createDependencies();
      const history: HistoryItem[] = [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: { 'layer-1': createTestLayer('layer-1', { visible: !expectedVisible }) },
            size: initialSize,
            frame: { x: 0, y: 0, width: 400, height: 300 },
          },
        },
        { id: 'toggle', actionName, layerId: 'layer-1' },
        { id: 'toggle-missing', actionName, layerId: 'ghost' },
      ];

      const result = replayHistory(history, 2, initialSize, dependencies);

      expect(result.layers['layer-1'].visible).toBe(expectedVisible);
      expect(result.layers.ghost).toBeUndefined();
    }
  );

  it('renames a present layer and ignores a rename for a missing layer', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Renamed' } },
      { id: 'rename-missing', actionName: RENAME_LAYER_ACTION, layerId: 'ghost', args: { name: 'Nope' } },
    ];

    const result = replayHistory(history, 2, initialSize, dependencies);

    expect(result.layers['layer-1'].name).toBe('Renamed');
    expect(result.layers.ghost).toBeUndefined();
  });

  it.each([
    { label: 'a missing moving layer', layerToMoveId: 'ghost', afterWhichLayerId: undefined },
    { label: 'a missing anchor layer', layerToMoveId: 'layer-b', afterWhichLayerId: 'ghost' },
  ])('leaves the layer order untouched for $label', ({ layerToMoveId, afterWhichLayerId }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new-a', actionName: NEW_LAYER_ACTION, layerId: 'layer-a', layerSource: blankSource },
      { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: blankSource },
      { id: 'reorder', actionName: REORDER_ACTION, layerId: 'document', args: { layerToMoveId, afterWhichLayerId } },
    ];

    const orders = Object.values(replayHistory(history, 2, initialSize, dependencies).layers).map((l) => l.order);

    expect(orders).toEqual([0, 0]);
  });

  it('reorders a layer to the bottom and after an explicit anchor', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new-a', actionName: NEW_LAYER_ACTION, layerId: 'layer-a', layerSource: blankSource },
      { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: blankSource },
      { id: 'bottom', actionName: REORDER_ACTION, layerId: 'document', args: { layerToMoveId: 'layer-b' } },
      {
        id: 'after-a',
        actionName: REORDER_ACTION,
        layerId: 'document',
        args: { layerToMoveId: 'layer-b', afterWhichLayerId: 'layer-a' },
      },
    ];

    const result = replayHistory(history, 3, initialSize, dependencies);

    expect(result.layers['layer-b'].order).toBeGreaterThan(result.layers['layer-a'].order);
  });

  it('collapses the document to a single layer on a merge with a source', () => {
    const dependencies = createDependencies();
    const mergeSource: LayerSource = {
      ...blankSource,
      isBedrock: true,
      size: { width: 90, height: 70 },
    } as LayerSource;
    const history: HistoryItem[] = [
      { id: 'new-a', actionName: NEW_LAYER_ACTION, layerId: 'layer-a', layerSource: blankSource },
      { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: blankSource },
      { id: 'merge', actionName: MERGE_ACTION, layerId: 'layer-merged', layerSource: mergeSource },
    ];

    const result = replayHistory(history, 2, initialSize, dependencies);

    expect(Object.keys(result.layers)).toEqual(['layer-merged']);
    // Two `new layer` actions plus the merge itself.
    expect(dependencies.createLayer).toHaveBeenCalledTimes(3);
    expect(dependencies.createLayer).toHaveBeenLastCalledWith({
      layerId: 'layer-merged',
      layers: expect.any(Object),
      source: mergeSource,
    });
  });

  it('skips a merge that carries no source and removes layers by id', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new-a', actionName: NEW_LAYER_ACTION, layerId: 'layer-a', layerSource: blankSource },
      { id: 'merge-empty', actionName: MERGE_ACTION, layerId: 'layer-merged' },
      { id: 'remove-a', actionName: REMOVE_ACTION, layerId: 'layer-a' },
      { id: 'remove-ghost', actionName: REMOVE_ACTION, layerId: 'ghost' },
    ];

    const result = replayHistory(history, 3, initialSize, dependencies);

    expect(result.layers).toEqual({});
    // The `new layer` action still created its layer; the sourceless merge did not.
    expect(dependencies.createLayer).toHaveBeenCalledTimes(1);
    expect(dependencies.createLayer).toHaveBeenCalledWith({ layerId: 'layer-a', layers: {}, source: blankSource });
  });

  it.each(['layer transparency', 'some unsupported action'])(
    'refuses the action name %s it has no arm for, leaving the layer set untouched',
    (actionName) => {
      // This is the only test in the tree that feeds an action name OUTSIDE the
      // `ActionType` union, so it is the whole coverage of a corrupt, truncated or
      // foreign timeline reaching `replayHistory`. Before `unhandled-action` existed
      // such an entry was skipped SILENTLY, which the layer-set assertion alone could
      // not distinguish from a correctly-applied no-op — so the diagnostic is asserted
      // here too, not only the absence of a change.
      const dependencies = createDependencies();
      const history: HistoryItem[] = [
        { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
        { id: 'unknown', actionName, layerId: 'layer-1', args: {} },
      ] as HistoryItem[];

      const result = replayHistory(history, 1, initialSize, dependencies);

      expect(Object.keys(result.layers)).toEqual(['layer-1']);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'unhandled-action', historyId: 'unknown', actionName }),
      ]);
    }
  );
});

describe('replayHistory tool action branches', () => {
  it.each([
    { label: 'a missing layer', layerId: 'ghost', args: { toolName: 'blur', radius: 2 } },
    { label: 'a missing tool name', layerId: 'layer-1', args: { radius: 2 } },
    { label: 'non-object tool args', layerId: 'layer-1', args: 'blur' },
  ])('ignores a tool action with $label', ({ layerId, args }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'tool', actionName: TOOL_ACTION, layerId, args },
    ] as HistoryItem[];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].operations).toEqual([]);
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it('retains a normalized affine transform as a retained affine layer operation', () => {
    const dependencies = createDependencies();
    const transform = { a: 1.2, b: 0, c: 0, d: 1.2, e: 0, f: 0 };
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'affine', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'transform', transform } },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].operations).toEqual([
      { id: 'affine', kind: 'affine-transform', transform, enabled: true },
    ]);
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a zero scale', args: { toolName: 'transform', rotate: 0, resizeX: 0, resizeY: 100, trapezoid: 0 } },
    {
      label: 'a singular retained matrix',
      args: { toolName: 'transform', transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } },
    },
    {
      label: 'a matrix beyond the coordinate limit',
      args: { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 5_000_000, f: 0 } },
    },
  ])('ignores $label instead of producing a corrupt replay state', ({ args }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'affine', actionName: TOOL_ACTION, layerId: 'layer-1', args },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].operations).toEqual([]);
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it('rasterizes a trapezoid-only transform through the explicit adapter', () => {
    const dependencies = createDependencies();
    const args = {
      toolName: 'transform',
      trapezoid: 30,
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      resizeX: 100,
      resizeY: 100,
    };
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'trapezoid', actionName: TOOL_ACTION, layerId: 'layer-1', args },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(dependencies.applyRasterTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'layer-1' }), args);
    expect(result.layers['layer-1'].operations).toEqual([]);
  });

  it.each([
    { label: 'mixed with rotation', extra: { rotate: 10 } },
    { label: 'mixed with a mirror', extra: { mirrorH: true } },
    { label: 'mixed with resize', extra: { resizeX: 150 } },
  ])('drops a trapezoid transform that is $label', ({ extra }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'trapezoid',
        actionName: TOOL_ACTION,
        layerId: 'layer-1',
        args: {
          toolName: 'transform',
          trapezoid: 30,
          rotate: 0,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          resizeX: 100,
          resizeY: 100,
          ...extra,
        },
      },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
    expect(result.layers['layer-1'].operations).toEqual([]);
  });

  it.each([
    {
      label: 'a move patch',
      args: { toolName: 'reposition', move: { x: 12, y: 34 } },
      expectedPos: { x: 12, y: 34, width: 40, height: 30 },
    },
    {
      label: 'a resize patch',
      args: { toolName: 'reposition', resize: { x: 1, y: 2, width: 8, height: 9 } },
      expectedPos: { x: 1, y: 2, width: 8, height: 9 },
    },
  ])('patches only the logical position for $label', ({ args, expectedPos }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'geometry', actionName: TOOL_ACTION, layerId: 'layer-1', args },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].pos).toEqual(expectedPos);
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it('prefers resize over move when both geometry patches are present', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'geometry',
        actionName: TOOL_ACTION,
        layerId: 'layer-1',
        args: {
          toolName: 'reposition',
          move: { x: 99, y: 99 },
          resize: { x: 1, y: 2, width: 3, height: 4 },
        },
      },
    ];

    expect(replayHistory(history, 1, initialSize, dependencies).layers['layer-1'].pos).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it.each([
    { label: 'no patch at all', args: { toolName: 'reposition' } },
    { label: 'explicitly null patches', args: { toolName: 'reposition', move: null, resize: null } },
  ])('leaves the position untouched for a geometry tool with $label', ({ args }) => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'geometry', actionName: TOOL_ACTION, layerId: 'layer-1', args },
    ] as HistoryItem[];

    expect(replayHistory(history, 1, initialSize, dependencies).layers['layer-1'].pos).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 30,
    });
  });

  it('ignores a document-operation tool action because the frame comes from its own action', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      { id: 'crop-tool', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'crop', rect: null } },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1'].pos).toEqual({ x: 0, y: 0, width: 40, height: 30 });
    expect(dependencies.applyRasterTool).not.toHaveBeenCalled();
  });

  it.each(['brush', 'pencil', 'color-replacement'] as const)(
    'rasterizes the %s tool through the injected adapter',
    (toolName) => {
      const dependencies = createDependencies();
      const history: HistoryItem[] = [
        { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
        { id: 'raster', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName } },
      ];

      const result = replayHistory(history, 1, initialSize, dependencies);

      expect(dependencies.applyRasterTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'layer-1' }), {
        toolName,
      });
      expect(result.layers['layer-1'].name).toBe('rasterized');
    }
  );

  it.each(['pen', 'freeform-pen', 'custom-shape'] as const)(
    'keeps legacy replay authority for the unimplemented %s tool via the injected raster adapter',
    (toolName) => {
      // The durable adapter rejects these tools (history-adapter.ts:354). The
      // legacy replay path must keep rendering them, otherwise an old document
      // would silently lose a stroke on undo.
      const dependencies = createDependencies();
      const history: HistoryItem[] = [
        { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
        { id: 'unimplemented', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName } },
      ] as HistoryItem[];

      const result = replayHistory(history, 1, initialSize, dependencies);

      expect(dependencies.applyRasterTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'layer-1' }), {
        toolName,
      });
      expect(result.layers['layer-1'].name).toBe('rasterized');
    }
  );
});

describe('replayHistory document source cloning', () => {
  it.each([
    {
      label: 'a retained affine operation',
      operations: [
        { id: 'affine', kind: 'affine-transform', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, enabled: true },
      ] as LayerOperation[],
    },
    {
      label: 'a pre-discriminated filter operation without a kind',
      operations: [
        { id: 'filter', args: { toolName: 'blur', radius: 3 }, enabled: true },
      ] as unknown as LayerOperation[],
    },
  ])('deep clones $label from a document source', ({ operations }) => {
    const dependencies = createDependencies();
    const sourceLayer = createTestLayer('layer-1', { operations });
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: {
          layers: { 'layer-1': sourceLayer },
          size: initialSize,
          frame: { x: 0, y: 0, ...initialSize },
        },
      },
    ];

    const replayed = replayHistory(history, 0, initialSize, dependencies).layers['layer-1'];

    expect(replayed.operations).toEqual(operations);
    expect(replayed.operations[0]).not.toBe(sourceLayer.operations[0]);
    if (operations[0].kind === 'affine-transform') {
      const replayedOperation = replayed.operations[0] as Extract<LayerOperation, { kind: 'affine-transform' }>;
      const sourceOperation = sourceLayer.operations[0] as Extract<LayerOperation, { kind: 'affine-transform' }>;
      expect(replayedOperation.transform).not.toBe(sourceOperation.transform);
    } else {
      const replayedOperation = replayed.operations[0] as FilterLayerOperation;
      const sourceOperation = sourceLayer.operations[0] as FilterLayerOperation;
      expect(replayedOperation.args).not.toBe(sourceOperation.args);
      expect(replayed.operations[0]).not.toHaveProperty('kind', undefined);
    }
    expect(replayed.pos).not.toBe(sourceLayer.pos);
  });

  it('keeps an invalid transform entry local so the currently visible document survives', () => {
    const dependencies = createDependencies();
    const history: HistoryItem[] = [
      { id: 'new', actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: blankSource },
      {
        id: 'bad',
        actionName: TOOL_ACTION,
        layerId: 'layer-1',
        args: { toolName: 'transform', transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } },
      },
      { id: 'good', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
    ];
    const before = replayHistory(history, 0, initialSize, dependencies);

    const result = replayHistory(history, 2, initialSize, dependencies);

    // The malformed entry contributes no operation; the document is still
    // replayable and the good edit after it survives.
    expect(result.layers['layer-1'].operations).toEqual([
      { id: 'good', args: { toolName: 'blur', radius: 1 }, enabled: true },
    ]);
    expect(Object.keys(result.layers)).toEqual(Object.keys(before.layers));
  });
});

describe('replayHistory layer record independence', () => {
  it('does not mutate the input history layers when applying actions', () => {
    const dependencies = createDependencies();
    const sourceLayer = createTestLayer('layer-1', { visible: true, order: 0 });
    const layers: LayersRecord = { 'layer-1': sourceLayer };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId: 'layer-1',
        documentSource: { layers, size: initialSize, frame: { x: 0, y: 0, ...initialSize } },
      },
      { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1' },
    ];

    const result = replayHistory(history, 1, initialSize, dependencies);

    expect(result.layers['layer-1']).not.toBe(sourceLayer);
    expect(sourceLayer.visible).toBe(true);
    expect(result.layers['layer-1'].visible).toBe(false);
  });
});
