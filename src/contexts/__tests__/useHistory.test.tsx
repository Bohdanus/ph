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
import type { LayersRecord, ToolLayerSource } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { saveLayerCanvas } from '../layer-utils.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';

const storeStateMock = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  history: [] as HistoryItem[],
  historyIndex: -1,
  layers: {} as LayersRecord,
  deletedLayers: {},
  activeLayerId: null as string | null,
  totalSize: { width: 128, height: 64 },
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

function createDrawContext() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
  };
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

function resetStoreState(history: HistoryItem[]) {
  const drawCtx = createDrawContext();
  Object.assign(storeStateMock, {
    canvasRef: {
      current: {
        getContext: vi.fn(() => drawCtx),
      } as unknown as HTMLCanvasElement,
    },
    history,
    historyIndex: history.length - 1,
    layers: {},
    deletedLayers: {},
    activeLayerId: null,
    totalSize: { width: 128, height: 64 },
    selections: [],
    activeSelectionId: null,
    branchRevision: 0,
    hasUnsavedChanges: false,
  });
}

function createDispatch() {
  return vi.fn((action: { type: string; payload: unknown }) => {
    if (action.type === 'APPLY_HISTORY_REPLAY') {
      const payload = action.payload as { updates: Record<string, unknown>; timeline: { entries: HistoryItem[]; cursor: number; branchRevision: number } };
      Object.assign(storeStateMock, payload.updates, {
        history: [...payload.timeline.entries],
        historyIndex: payload.timeline.cursor,
        branchRevision: payload.timeline.branchRevision,
        hasUnsavedChanges: true,
      });
    } else if (action.type === 'COMMIT_DOCUMENT_EDIT') {
      const payload = action.payload as { updates: Record<string, unknown>; historyItem: HistoryItem };
      const timeline = updateHistoryTimeline(
        { entries: storeStateMock.history, cursor: storeStateMock.historyIndex, branchRevision: storeStateMock.branchRevision },
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
    dispatchMock.mockClear();
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

  it('adds history entries without capturing a canvas preview', () => {
    const { dispatch } = setup(createHistory('layerSource').slice(0, 1));
    useHistory().addHistoryEntry({ layerId: 'layer-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' } });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        historyItem: expect.objectContaining({
          id: expect.any(String),
          layerId: 'layer-1',
          actionName: RENAME_LAYER_ACTION,
          args: { name: 'Renamed' },
        }),
      },
    });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('branches from the current entry and discards redo entries', () => {
    const { state, dispatch } = setup();
    state.historyIndex = 0;
    useHistory().addHistoryEntry({ layerId: 'layer-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Branch' } });
    const action = dispatchMock.mock.calls[0][0];
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(state.history).toHaveLength(2);
    expect(state.history[0].id).toBe('h-1');
    expect(state.history[1].id).not.toBe('h-2');
    expect(state.history[1]).not.toHaveProperty('imagePromise');
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
      expect(state.canvasRef.current!.getContext('2d')!.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 40, 20);
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
    const { state, dispatch } = setup(history);
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
    const { dispatch } = setup();
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

  it('does not let an obsolete bitmap save erase a newer preview', async () => {
    const { state } = setup();
    useHistory().undo();
    await Promise.resolve();
    const layer = state.layers['layer-1'];
    const originalBitmap = layer.bitmap;
    layer.tmpCanvas = new OffscreenCanvas(128, 64);
    const save = saveLayerCanvas(layer);
    const newerCanvas = new OffscreenCanvas(128, 64);
    layer.tmpCanvas = newerCanvas;
    await save;
    expect(layer.tmpCanvas).toBe(newerCanvas);
    expect(layer.bitmap).toBe(originalBitmap);
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
});