import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import { useHistory } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord, ToolLayerSource } from '../layer-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { getSortedLayersArray } from '../layer-utils.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';
import { createMockCanvasContext } from '../../test/setup.ts';

const storeStateMock = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  history: [] as HistoryItem[],
  historyIndex: -1,
  layers: {} as LayersRecord,
  deletedLayers: {},
  activeLayerId: null as string | null,
  totalSize: { width: 128, height: 64 },
  documentFrame: null as DocumentFrame | null,
  selections: [] as Array<{
    id: string;
    isActive: boolean;
    points: [];
    pos: { x: number; y: number; width: number; height: number };
  }>,
  activeSelectionId: null as string | null,
  branchRevision: 0,
  hasUnsavedChanges: false,
}));

const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

// The renderer now stages every presentation on a canvas created through
// document.createElement, so a failing publication must be simulated through the
// module boundary rather than through the visible canvas context.
const rendererControl = vi.hoisted(() => ({
  drawCalls: [] as Array<{ canvas: HTMLCanvasElement; layers: readonly Layer[]; frame: DocumentFrame }>,
  result: null as boolean | null,
}));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return {
    ...actual,
    drawLayersToCanvas: (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => {
      rendererControl.drawCalls.push({ canvas, layers, frame });
      return rendererControl.result ?? actual.drawLayersToCanvas(canvas, layers, frame);
    },
  };
});

const replayControl = vi.hoisted(() => ({
  failure: null as unknown,
  replayCount: 0,
}));

vi.mock('../history-replay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-replay.ts')>();
  return {
    ...actual,
    replayHistory: (...args: Parameters<typeof actual.replayHistory>) => {
      replayControl.replayCount += 1;
      if (replayControl.failure !== null) throw replayControl.failure;
      return actual.replayHistory(...args);
    },
  };
});

const canvasContexts: CanvasRenderingContext2D[] = [];

// vi.restoreAllMocks() in beforeEach also drops the global canvas context stub
// installed by src/test/setup.ts, so every test re-installs it before rendering.
function installCanvasContextStub() {
  canvasContexts.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    const context = createMockCanvasContext(this) as unknown as CanvasRenderingContext2D;
    canvasContexts.push(context);
    return context;
  });
}

function contextFor(canvas: HTMLCanvasElement | null) {
  return [...canvasContexts].reverse().find((context) => (context.canvas as unknown) === canvas);
}

function drawImageCallsFor(source: unknown) {
  return canvasContexts.flatMap((context) =>
    vi.mocked(context.drawImage).mock.calls.filter((call) => call[0] === source)
  );
}

type DispatchedAction = {
  type: string;
  payload?: { status?: string; diagnostics?: Record<string, unknown>[] };
};

function dispatchedActions(): DispatchedAction[] {
  return dispatchMock.mock.calls.map((call) => call[0] as DispatchedAction);
}

function dispatchedTypes(): string[] {
  return dispatchedActions().map((action) => action.type);
}

function createLayerSource(isBedrock = true) {
  return {
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    isBedrock,
    size: { width: 128, height: 64 },
  };
}

function createHistory(sourceIn: 'layerSource' | 'args'): HistoryItem[] {
  const source = createLayerSource();
  const firstItemBase: HistoryItem = {
    id: 'h-1',
    layerId: 'layer-1',
    actionName: NEW_LAYER_ACTION,
  };

  const firstItem =
    sourceIn === 'layerSource' ? { ...firstItemBase, layerSource: source } : { ...firstItemBase, args: source };

  return [
    firstItem,
    {
      id: 'h-2',
      layerId: 'layer-1',
      actionName: RENAME_LAYER_ACTION,
      args: { name: 'Layer 1' },
    },
  ] as HistoryItem[];
}

function makeReplayLayer(id: string, order: number, bitmap: ImageBitmap): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: 0, y: 0, width: 40, height: 20 },
    operations: [],
  };
}

function resetStoreState(history: HistoryItem[]) {
  Object.assign(storeStateMock, {
    canvasRef: { current: document.createElement('canvas') },
    history,
    historyIndex: history.length - 1,
    layers: {},
    deletedLayers: {},
    activeLayerId: null,
    totalSize: { width: 128, height: 64 },
    documentFrame: null,
    selections: [],
    activeSelectionId: null,
    branchRevision: 0,
    hasUnsavedChanges: false,
  });
}

function createDispatch() {
  return vi.fn((action: { type: string; payload: unknown }) => {
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      const payload = action.payload as {
        updates: Record<string, unknown>;
        timeline: { entries: HistoryItem[]; cursor: number; branchRevision: number };
      };
      Object.assign(storeStateMock, payload.updates, {
        history: [...payload.timeline.entries],
        historyIndex: payload.timeline.cursor,
        branchRevision: payload.timeline.branchRevision,
        hasUnsavedChanges: true,
      });
    } else if (action.type === 'COMMIT_DOCUMENT_EDIT') {
      const payload = action.payload as { updates: Record<string, unknown>; historyItem: HistoryItem };
      const timeline = updateHistoryTimeline(
        {
          entries: storeStateMock.history,
          cursor: storeStateMock.historyIndex,
          branchRevision: storeStateMock.branchRevision,
        },
        { type: 'append', entry: payload.historyItem }
      );
      Object.assign(storeStateMock, payload.updates, {
        history: [...timeline.entries],
        historyIndex: timeline.cursor,
        branchRevision: timeline.branchRevision,
        hasUnsavedChanges: true,
      });
    }
  });
}

describe('useHistory undo replay', () => {
  beforeAll(() => {
    class MockOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          fillStyle: '#ffffff',
          globalAlpha: 1,
          fillRect: vi.fn(),
        };
      }
    }

    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (bitmap: { width: number; height: number }) => {
        if (!bitmap) throw new Error('Missing bitmap source');
        return { width: bitmap.width, height: bitmap.height, close: vi.fn() };
      })
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    dispatchMock.mockReset();
    rendererControl.drawCalls.length = 0;
    rendererControl.result = null;
    replayControl.failure = null;
    replayControl.replayCount = 0;
    installCanvasContextStub();
  });

  it('undoes history when NEW_LAYER source is stored in layerSource', () => {
    resetStoreState(createHistory('layerSource'));
    const dispatch = createDispatch();
    dispatchMock.mockImplementation(dispatch);

    const { undo } = useHistory();

    expect(() => undo()).not.toThrow();
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPLY_HISTORY_REPLAY',
      })
    );
  });

  it('keeps compatibility with history where NEW_LAYER source is stored in args', () => {
    resetStoreState(createHistory('args'));
    const dispatch = createDispatch();
    dispatchMock.mockImplementation(dispatch);

    const { undo } = useHistory();

    expect(() => undo()).not.toThrow();
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPLY_HISTORY_REPLAY',
      })
    );
  });

  function setup(history = createHistory('layerSource')) {
    resetStoreState(history);
    const dispatch = createDispatch();
    dispatchMock.mockImplementation(dispatch);
    return { state: storeStateMock, dispatch };
  }

  /**
   * A commit that lands on a cursor with redo entries behind it is the only way this timeline
   * ever branches, and `useHistory` cannot cause one: it exposes no `addHistoryEntry`, and the
   * append is the reducer's single-writer path. So the commit is fed through the same
   * `createDispatch` fake the rest of this file uses, which runs the real `updateHistoryTimeline`
   * — and the test is titled for what it actually exercises, the append contract, rather than for
   * a hook call that no longer exists.
   */
  function commitAndBranch() {
    const { state } = setup();
    state.historyIndex = 0;
    dispatchMock({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        historyItem: { id: 'h-branch', layerId: 'layer-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Branch' } },
      },
    });
    return state;
  }

  it('discards the redo entries and bumps the branch revision when a commit lands on a cursor with redo behind it', () => {
    const state = commitAndBranch();

    expect(state.history.map((entry) => entry.id)).toEqual(['h-1', 'h-branch']);
    expect(state.history[1]).not.toHaveProperty('imagePromise');
    expect(state.historyIndex).toBe(1);
    expect(state.branchRevision).toBe(1);
  });

  it('carries the branched timeline and its revision into every replay the hook dispatches afterwards', () => {
    const state = commitAndBranch();
    const branchedEntries = state.history.map((entry) => entry.id);
    dispatchMock.mockClear();

    useHistory().undo();

    // The branch belongs to the store, so the hook can only forward what it read. An action
    // carrying the pre-branch cursor, a revision left at 0, or the pre-branch entries would let
    // the next commit branch off a position the user has already undone.
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'APPLY_HISTORY_REPLAY',
      payload: expect.objectContaining({
        timeline: {
          entries: expect.any(Array),
          cursor: 0,
          branchRevision: 1,
        },
      }),
    });
    const undone = dispatchedActions()[0].payload as unknown as {
      timeline: { entries: HistoryItem[] };
    };
    expect(undone.timeline.entries.map((entry) => entry.id)).toEqual(branchedEntries);
    expect(state.historyIndex).toBe(0);

    useHistory().redo();

    // Redo walks the same branched timeline, and the revision is not consumed by navigation: a
    // revision that reset on the way back would let two different timelines share a number.
    expect(dispatchedActions().at(-1)).toMatchObject({
      type: 'APPLY_HISTORY_REPLAY',
      payload: { timeline: { cursor: 1, branchRevision: 1 } },
    });
    expect(state.branchRevision).toBe(1);
  });

  it.each([NEW_LAYER_ACTION, TOOL_ACTION] as const)('restores tool-created layers recorded as %s', (actionName) => {
    const canvas = new OffscreenCanvas(20, 30);
    vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [canvas, { width: 20, height: 30 }]);
    const source = {
      kind: 'tool',
      args: { toolName: 'shape' },
      pos: { x: 5, y: 10, width: 20, height: 30 },
    } as ToolLayerSource & { pos: { x: number; y: number; width: number; height: number } };
    const { state } = setup([
      createHistory('layerSource')[0],
      { id: 'tool', layerId: 'shape', actionName, layerSource: source },
    ]);
    state.activeLayerId = 'shape';
    useHistory().undo();
    expect(state.layers.shape).toBeUndefined();
    expect(state.activeLayerId).toBe('layer-1');
    useHistory().redo();
    expect(state.layers.shape.pos).toEqual(source.pos);
    expect(state.layers.shape.tmpCanvas).toBe(canvas);
    expect(state.historyIndex).toBe(1);
  });

  it.each([NEW_LAYER_ACTION, MERGE_ACTION] as const)(
    'replays image sources for %s without saving null canvases',
    (actionName) => {
      const bitmap = { width: 40, height: 20 } as ImageBitmap;
      const { state } = setup([
        createHistory('layerSource')[0],
        {
          id: 'image',
          layerId: 'image',
          actionName,
          layerSource: { kind: 'image', bitmap, isBedrock: true, size: { width: 40, height: 20 } },
        },
      ]);
      useHistory().resetHistoryTo(1);
      expect(state.layers.image.bitmap).toBe(bitmap);
      // The replayed layer is drawn on the staging canvas first and only then
      // composited onto the visible canvas.
      expect(drawImageCallsFor(bitmap)).toEqual([[bitmap, 0, 0, 40, 20]]);
      const visibleContext = contextFor(state.canvasRef.current);
      expect(visibleContext?.clearRect).toHaveBeenCalledWith(0, 0, 40, 20);
      expect(visibleContext?.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0);
      expect(vi.mocked(createImageBitmap).mock.calls.every(([source]) => source != null)).toBe(true);
      if (actionName === MERGE_ACTION) expect(Object.keys(state.layers)).toEqual(['image']);
    }
  );

  it('passes imported bitmaps to raster tool replay without persisting a cache', async () => {
    const bitmap = { width: 40, height: 20 } as ImageBitmap;
    const canvas = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.shape, 'imageProcessor')
      .mockReturnValue(() => [canvas, { x: 12, y: 0, width: 40, height: 20 }]);
    const { state } = setup([
      {
        id: 'image',
        layerId: 'image',
        actionName: NEW_LAYER_ACTION,
        layerSource: { kind: 'image', bitmap, isBedrock: true, size: { width: 40, height: 20 } },
      },
      {
        id: 'edit',
        layerId: 'image',
        actionName: TOOL_ACTION,
        args: { toolName: 'shape' },
      },
    ]);
    useHistory().resetHistoryTo(1);
    expect(processor).toHaveBeenCalledWith({ bitmap, size: expect.objectContaining({ width: 40 }) });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(state.layers.image.tmpCanvas).toBe(canvas);
    expect(state.layers.image.pos.x).toBe(12);
  });

  it('skips dependent edits when creation is disabled and restores them when re-enabled', () => {
    const history = createHistory('layerSource');
    history.push(
      ...([HIDE_LAYER_ACTION, SHOW_LAYER_ACTION, REORDER_ACTION] as const).map((actionName, i) => ({
        id: `dependent-${i}`,
        layerId: 'layer-1',
        actionName,
        args: { layerToMoveId: 'layer-1' },
      }))
    );
    const { state } = setup(history);
    useHistory().toggleDisabled('h-1');
    expect(state.layers).toEqual({});
    expect(state.activeLayerId).toBeNull();
    expect(state.historyIndex).toBe(4);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    useHistory().toggleDisabled('h-1');
    expect(state.layers['layer-1']).toMatchObject({ name: 'Layer 1', visible: true });
  });

  it('selects a surviving layer when redoing deletion', () => {
    const history = createHistory('layerSource');
    history.push({ ...history[0], id: 'second', layerId: 'second' });
    history.push({ id: 'delete', layerId: 'second', actionName: REMOVE_ACTION });
    const { state } = setup(history);
    useHistory().resetHistoryTo(2);
    state.activeLayerId = 'second';
    useHistory().redo();
    expect(state.layers.second).toBeUndefined();
    expect(state.activeLayerId).toBe('layer-1');
  });

  it('restores a cleared selection when undoing the tool-switch history entry', () => {
    const selection = {
      id: 'selection-1',
      isActive: true,
      points: [],
      pos: { x: 2, y: 3, width: 12, height: 8 },
    };
    const history: HistoryItem[] = [
      {
        id: 'base',
        layerId: 'layer-1',
        actionName: RENAME_LAYER_ACTION,
        args: { name: 'Base' },
      },
      {
        id: 'selection-clear',
        layerId: 'selection',
        actionName: 'selection',
        args: {
          previousSelectionState: { selections: [selection], activeSelectionId: 'selection-1' },
          nextSelectionState: { selections: [], activeSelectionId: null },
        },
      },
    ];
    resetStoreState(history);
    storeStateMock.historyIndex = 1;
    storeStateMock.selections = [];
    storeStateMock.activeSelectionId = null;
    const dispatch = createDispatch();
    dispatchMock.mockImplementation(dispatch);

    useHistory().undo();

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'APPLY_HISTORY_REPLAY',
        payload: expect.objectContaining({
          updates: expect.objectContaining({
            selections: [selection],
            activeSelectionId: 'selection-1',
          }),
        }),
      })
    );
    expect(storeStateMock.selections).toEqual([selection]);
    expect(storeStateMock.activeSelectionId).toBe('selection-1');
  });

  it('ignores invalid history targets', () => {
    setup();
    const historyApi = useHistory();
    for (const index of [-1, 2, 0.5, NaN]) historyApi.resetHistoryTo(index);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('marks navigation dirty without mutating the old deleted-layer record', () => {
    const { state } = setup();
    const deletedLayers = state.deletedLayers;
    useHistory().undo();
    expect(deletedLayers).toEqual({});
    expect(state.hasUnsavedChanges).toBe(true);
  });

  it('preserves PSD baseline metadata through tool edits and removal undo/redo', async () => {
    const bitmap = { width: 40, height: 20 } as ImageBitmap;
    const layers: LayersRecord = {
      top: {
        id: 'top',
        name: 'PSD artwork',
        bitmap,
        tmpCanvas: null,
        isBedrock: false,
        visible: true,
        opacity: 0.35,
        locked: true,
        blendMode: 'multiply',
        order: 7,
        pos: { x: -8, y: 13, width: 40, height: 20 },
        operations: [],
      },
      bottom: {
        id: 'bottom',
        name: 'Hidden background',
        bitmap,
        tmpCanvas: null,
        isBedrock: false,
        visible: false,
        opacity: 0.8,
        locked: false,
        blendMode: 'screen',
        order: 2,
        pos: { x: 4, y: -2, width: 40, height: 20 },
        operations: [],
      },
    };
    const size = { width: 300, height: 200 };
    const original = Object.fromEntries(
      Object.entries(layers).map(([id, layer]) => [id, { ...layer, pos: { ...layer.pos } }])
    );
    const canvas = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.shape, 'imageProcessor')
      .mockReturnValue(() => [canvas, { x: 22, y: 31, width: 40, height: 20 }]);
    const { state } = setup([
      {
        id: 'psd',
        layerId: 'top',
        actionName: OPEN_DOCUMENT_ACTION,
        documentSource: { layers, size },
      },
      {
        id: 'edit',
        layerId: 'top',
        actionName: TOOL_ACTION,
        args: { toolName: 'shape' },
      },
      { id: 'remove', layerId: 'top', actionName: REMOVE_ACTION },
    ]);
    useHistory().resetHistoryTo(0);
    expect(state.layers).toEqual(original);
    expect(state.totalSize).toEqual(size);
    expect(state.totalSize).not.toBe(size);
    expect(state.canvasRef.current).toMatchObject(size);
    expect(state.activeLayerId).toBe('top');
    expect(state.layers.top).not.toBe(layers.top);
    expect(state.layers.top.pos).not.toBe(layers.top.pos);

    useHistory().redo();
    expect(processor).toHaveBeenCalledWith({ bitmap, size: original.top.pos });
    expect(state.layers.top).toMatchObject({
      ...original.top,
      tmpCanvas: canvas,
      pos: { ...original.top.pos, x: 22, y: 31 },
    });
    expect(state.layers.top.tmpCanvas).toBe(canvas);
    expect(state.layers.bottom).toEqual(original.bottom);
    useHistory().undo();
    expect(state.layers).toEqual(original);
    expect(state.layers.top.bitmap).toBe(bitmap);

    useHistory().redo();
    useHistory().redo();
    expect(state.layers.top).toBeUndefined();
    expect(state.activeLayerId).toBe('bottom');
    useHistory().undo();
    expect(state.layers.top).toMatchObject({
      ...original.top,
      tmpCanvas: canvas,
      pos: { ...original.top.pos, x: 22, y: 31 },
    });
    await Promise.resolve();
    useHistory().redo();
    expect(state.layers).toEqual({ bottom: original.bottom });
    expect(state.historyIndex).toBe(2);
    expect(state.totalSize).toEqual(size);
    expect(layers).toEqual(original);
    expect(layers.top.bitmap).toBe(bitmap);
    expect(size).toEqual({ width: 300, height: 200 });
  });

  describe('replay presentation publication', () => {
    it('fails closed and reports an unavailable durable status when the staged presentation cannot be published', () => {
      const { state } = setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const currentFrame = { x: 8, y: 12, width: 128, height: 64 };
      state.documentFrame = currentFrame;
      rendererControl.result = false;

      useHistory().undo();

      expect(dispatchedTypes()).toEqual(['SET_DURABLE_STATUS']);
      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'APPLY_HISTORY_REPLAY' }));
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'SET_DURABLE_STATUS',
        payload: {
          status: 'unavailable',
          diagnostics: [
            {
              historyId: 'h-1',
              actionName: NEW_LAYER_ACTION,
              severity: 'error',
              code: 'conversion-failed',
              message: 'Unable to publish replayed history presentation',
            },
          ],
        },
      });
      expect(consoleError).toHaveBeenCalledWith('History replay is unavailable', expect.any(Error));
      expect(consoleError.mock.calls[0][1]).toMatchObject({
        message: 'Unable to publish replayed history presentation',
      });
      expect(state.layers).toEqual({});
      expect(state.history).toHaveLength(2);
      expect(state.historyIndex).toBe(1);
      expect(state.activeLayerId).toBeNull();
      expect(state.totalSize).toEqual({ width: 128, height: 64 });
      expect(state.documentFrame).toBe(currentFrame);
      expect(state.hasUnsavedChanges).toBe(false);
    });

    it('fails closed on redo as well when the staged presentation cannot be published', () => {
      const { state } = setup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      rendererControl.result = false;
      state.historyIndex = 0;

      useHistory().redo();

      expect(dispatchedTypes()).toEqual(['SET_DURABLE_STATUS']);
      expect(dispatchedActions()[0].payload?.diagnostics?.[0]).toMatchObject({
        historyId: 'h-2',
        actionName: RENAME_LAYER_ACTION,
        code: 'conversion-failed',
      });
      expect(state.layers).toEqual({});
      expect(state.historyIndex).toBe(0);
    });

    it('applies the replay without touching the durable status when the staged presentation publishes', () => {
      const { state } = setup();

      useHistory().undo();

      expect(dispatchedTypes()).toEqual(['APPLY_HISTORY_REPLAY']);
      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_DURABLE_STATUS' }));
      expect(state.layers['layer-1']).toMatchObject({ id: 'layer-1', visible: true });
      expect(state.historyIndex).toBe(0);
      expect(state.hasUnsavedChanges).toBe(true);
    });

    it('treats a missing mounted canvas as nothing to publish and still applies the replay', () => {
      resetStoreState(createHistory('layerSource'));
      storeStateMock.canvasRef = { current: null };
      dispatchMock.mockImplementation(createDispatch());
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const { undo } = useHistory();

      expect(() => undo()).not.toThrow();
      expect(rendererControl.drawCalls).toEqual([]);
      expect(dispatchedTypes()).toEqual(['APPLY_HISTORY_REPLAY']);
      expect(storeStateMock.layers['layer-1']).toBeDefined();
      expect(storeStateMock.historyIndex).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('publishes the mounted canvas with the sorted replayed layers and the replayed document frame', () => {
      const bitmap = { width: 40, height: 20 } as ImageBitmap;
      const layers: LayersRecord = {
        top: makeReplayLayer('top', 7, bitmap),
        bottom: makeReplayLayer('bottom', 2, bitmap),
      };
      const { state } = setup([
        {
          id: 'psd',
          layerId: 'top',
          actionName: OPEN_DOCUMENT_ACTION,
          documentSource: { layers, size: { width: 300, height: 200 } },
        },
      ]);

      useHistory().resetHistoryTo(0);

      expect(rendererControl.drawCalls).toHaveLength(1);
      const [call] = rendererControl.drawCalls;
      expect(call.canvas).toBe(state.canvasRef.current);
      expect(call.frame).toEqual({ x: 0, y: 0, width: 300, height: 200 });
      expect(call.layers).toEqual(getSortedLayersArray(state.layers));
      expect(call.layers.map((layer) => layer.id)).toEqual(['bottom', 'top']);
      expect(Object.keys(state.layers)).toEqual(['top', 'bottom']);
    });

    it('keeps failing closed with the same structured diagnostic when replay itself throws', () => {
      const { state } = setup();
      const failure = new Error('replay conversion failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      replayControl.failure = failure;

      useHistory().undo();

      expect(dispatchedTypes()).toEqual(['SET_DURABLE_STATUS']);
      expect(rendererControl.drawCalls).toEqual([]);
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'SET_DURABLE_STATUS',
        payload: {
          status: 'unavailable',
          diagnostics: [
            {
              historyId: 'h-1',
              actionName: NEW_LAYER_ACTION,
              severity: 'error',
              code: 'conversion-failed',
              message: 'replay conversion failed',
            },
          ],
        },
      });
      expect(consoleError).toHaveBeenCalledWith('History replay is unavailable', failure);
      expect(state.layers).toEqual({});
      expect(state.historyIndex).toBe(1);
      expect(state.hasUnsavedChanges).toBe(false);
    });

    it('stringifies a non-Error replay failure into the diagnostic message', () => {
      setup();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      replayControl.failure = 'unsupported source kind';

      useHistory().undo();

      expect(dispatchedActions()[0].payload?.diagnostics?.[0]).toStrictEqual({
        historyId: 'h-1',
        actionName: NEW_LAYER_ACTION,
        severity: 'error',
        code: 'conversion-failed',
        message: 'unsupported source kind',
      });
    });

    it('keeps the diagnostic identity keys present but undefined when the target index has no item', () => {
      const sparse = createHistory('layerSource');
      sparse.length = 3;
      setup(sparse);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      rendererControl.result = false;

      useHistory().resetHistoryTo(2);

      // A hole in the timeline is the only way to reach a target without an item:
      // Array#find does not skip holes, so replay fails closed before publication
      // and the identity keys are still emitted as explicit undefined values.
      const diagnostic = dispatchedActions()[0].payload?.diagnostics?.[0];
      expect(dispatchMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'APPLY_HISTORY_REPLAY' }));
      expect(Object.keys(diagnostic ?? {})).toEqual(['historyId', 'actionName', 'severity', 'code', 'message']);
      expect(diagnostic).toStrictEqual({
        historyId: undefined,
        actionName: undefined,
        severity: 'error',
        code: 'conversion-failed',
        message: expect.any(String),
      });
      expect(String(diagnostic?.message)).toContain('actionName');
      expect(consoleError).toHaveBeenCalledWith('History replay is unavailable', expect.any(TypeError));
    });
  });
});
