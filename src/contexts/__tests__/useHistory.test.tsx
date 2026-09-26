import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayersRecord, ToolLayerSource } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { saveLayerCanvas } from '../layer-utils.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

const useLayersMock = vi.fn();
vi.mock('../useLayer.ts', () => ({
  useLayers: () => useLayersMock(),
}));

function createMockLayerSource(isBedrock = true) {
  return {
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    isBedrock,
    size: { width: 128, height: 64 },
  };
}

function createHistory(sourceIn: 'layerSource' | 'args'): HistoryItem[] {
  const source = createMockLayerSource();
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

function createMockBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as ImageBitmap;
}

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => <StoreProvider>{children}</StoreProvider>;
}

function renderHistoryHook() {
  return renderHook(
    () => {
      const historyHook = useHistory();
      const [storeState, dispatch] = useStore();
      return { historyHook, storeState, dispatch };
    },
    { wrapper: createWrapper() }
  );
}

function initializeDocument(
  dispatch: ReturnType<typeof useStore>[1],
  history: HistoryItem[],
  totalSize = { width: 128, height: 64 }
) {
  act(() => {
    dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'test-doc',
        updates: {
          totalSize,
          documentFrame: { x: 0, y: 0, width: totalSize.width, height: totalSize.height },
        },
        history,
        historyIndex: history.length - 1,
      },
    });
  });
}

describe('useHistory undo replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLayersMock.mockReturnValue({
      toggleVisibility: vi.fn(),
      removeLayer: vi.fn(),
      moveLayerAfter: vi.fn(),
      setActiveLayer: vi.fn(),
      updateLayer: vi.fn(),
    });
  });

  it('undoes history when NEW_LAYER source is stored in layerSource', async () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('layerSource'));

    await act(async () => {
      await result.current.historyHook.undo();
    });

    expect(result.current.storeState.historyIndex).toBe(0);
  });

  it('keeps compatibility with history where NEW_LAYER source is stored in args', async () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('args'));

    await act(async () => {
      await result.current.historyHook.undo();
    });

    expect(result.current.storeState.historyIndex).toBe(0);
  });

  it('adds history entries without capturing a canvas preview', () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('layerSource').slice(0, 1));

    const initialHistoryLength = result.current.storeState.history.length;

    act(() => {
      result.current.historyHook.addHistoryEntry({
        layerId: 'layer-1',
        actionName: RENAME_LAYER_ACTION,
        args: { name: 'Renamed' },
      });
    });

    expect(result.current.storeState.history.length).toBe(initialHistoryLength + 1);
  });

  it('branches from the current entry and discards redo entries', () => {
    const { result } = renderHistoryHook();

    const history = createHistory('layerSource');

    initializeDocument(result.current.dispatch, history);

    act(() => {
      result.current.dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {},
          timeline: {
            entries: result.current.storeState.history,
            cursor: 0,
            branchRevision: result.current.storeState.branchRevision,
          },
        },
      });
    });

    const historyLengthBefore = result.current.storeState.history.length;
    const branchRevisionBefore = result.current.storeState.branchRevision;

    act(() => {
      result.current.historyHook.addHistoryEntry({
        layerId: 'layer-1',
        actionName: RENAME_LAYER_ACTION,
        args: { name: 'Branch' },
      });
    });

    expect(result.current.storeState.history.length).toBe(historyLengthBefore);
    expect(result.current.storeState.history[0].id).toBe('h-1');
    expect(result.current.storeState.history[1].id).not.toBe('h-2');
    expect(result.current.storeState.history[1]).not.toHaveProperty('imagePromise');
    expect(result.current.storeState.branchRevision).toBe(branchRevisionBefore + 1);
  });

  it.each([NEW_LAYER_ACTION, TOOL_ACTION] as const)(
    'restores tool-created layers recorded as %s',
    async (actionName) => {
      const canvas = new OffscreenCanvas(20, 30);
      const processorSpy = vi
        .spyOn(toolProcessors.shape, 'imageProcessor')
        .mockReturnValue(() => [canvas, { width: 20, height: 30 }]);
      const source = {
        kind: 'tool',
        args: { toolName: 'shape' },
        pos: { x: 5, y: 10, width: 20, height: 30 },
      } as ToolLayerSource & { pos: { x: number; y: number; width: number; height: number } };

      const { result } = renderHistoryHook();

      initializeDocument(result.current.dispatch, [
        createHistory('layerSource')[0],
        { id: 'tool', layerId: 'shape', actionName, layerSource: source },
      ]);

      act(() => {
        result.current.dispatch({ type: 'SET_ACTIVE_LAYER', payload: 'shape' });
      });

      await act(async () => {
        await result.current.historyHook.undo();
      });
      expect(result.current.storeState.layers.shape).toBeUndefined();
      expect(result.current.storeState.activeLayerId).toBe('layer-1');
      await act(async () => {
        await result.current.historyHook.redo();
      });
      expect(result.current.storeState.layers.shape).toBeDefined();
      if (result.current.storeState.layers.shape) {
        expect(result.current.storeState.layers.shape.pos).toEqual(source.pos);
        expect(result.current.storeState.layers.shape.bitmap).toEqual(
          expect.objectContaining({ width: 20, height: 30 })
        );
      }
      expect(result.current.storeState.historyIndex).toBe(1);

      processorSpy.mockRestore();
    }
  );

  it.each([NEW_LAYER_ACTION, MERGE_ACTION] as const)(
    'replays image sources for %s without saving null canvases',
    async (actionName) => {
      const bitmap = createMockBitmap(40, 20);

      const { result } = renderHistoryHook();

      initializeDocument(result.current.dispatch, [
        createHistory('layerSource')[0],
        {
          id: 'image',
          layerId: 'image',
          actionName,
          layerSource: { kind: 'image', bitmap, isBedrock: true, size: { width: 40, height: 20 } },
        },
      ]);

      await act(async () => {
        await result.current.historyHook.resetHistoryTo(1);
      });

      expect(result.current.storeState.layers.image.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
      expect(vi.mocked(globalThis.createImageBitmap).mock.calls.every(([source]) => source != null)).toBe(true);
      if (actionName === MERGE_ACTION) expect(Object.keys(result.current.storeState.layers)).toEqual(['image']);
    }
  );

  it('passes imported bitmaps to raster tool replay without persisting a cache', async () => {
    const bitmap = createMockBitmap(40, 20);
    const canvas = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValue(() => [canvas, { x: 12, y: 0, width: 40, height: 20 }]);

    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, [
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
        args: { toolName: 'brush' },
      },
    ]);

    await act(async () => {
      await result.current.historyHook.resetHistoryTo(1);
    });
    expect(processor).toHaveBeenCalledWith({ bitmap: expect.anything(), size: expect.objectContaining({ width: 40 }) });
    expect(globalThis.createImageBitmap).not.toHaveBeenCalledWith(null);
    expect(result.current.storeState.layers.image.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
    expect(result.current.storeState.layers.image.pos.x).toBe(12);

    processor.mockRestore();
  });

  it('skips dependent edits when creation is disabled and restores them when re-enabled', async () => {
    const history = createHistory('layerSource');
    history.push(
      ...([HIDE_LAYER_ACTION, SHOW_LAYER_ACTION, REORDER_ACTION] as const).map((actionName, i) => ({
        id: `dependent-${i}`,
        layerId: 'layer-1',
        actionName,
        args: { layerToMoveId: 'layer-1' },
      }))
    );

    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, history);

    await act(async () => {
      await result.current.historyHook.toggleDisabled('h-1');
    });
    expect(result.current.storeState.layers).toEqual({});
    expect(result.current.storeState.activeLayerId).toBeNull();
    expect(result.current.storeState.historyIndex).toBe(4);
    await act(async () => {
      await result.current.historyHook.toggleDisabled('h-1');
    });
    expect(result.current.storeState.layers['layer-1']).toBeDefined();
  });

  it('selects a surviving layer when redoing deletion', async () => {
    const history = createHistory('layerSource');
    history.push({ ...history[0], id: 'second', layerId: 'second' });
    history.push({ id: 'delete', layerId: 'second', actionName: REMOVE_ACTION });

    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, history);

    await act(async () => {
      await result.current.historyHook.resetHistoryTo(2);
    });
    act(() => {
      result.current.dispatch({ type: 'SET_ACTIVE_LAYER', payload: 'second' });
    });
    await act(async () => {
      await result.current.historyHook.redo();
    });
    expect(result.current.storeState.layers.second).toBeUndefined();
    expect(result.current.storeState.activeLayerId).toBe('layer-1');
  });

  it('restores a cleared selection when undoing the tool-switch history entry', async () => {
    const selection = {
      id: 'selection-1',
      isActive: true,
      points: [],
      pos: { x: 2, y: 3, width: 12, height: 8 },
    };
    const history: HistoryItem[] = [
      {
        id: 'set-initial-selection',
        layerId: 'selection',
        actionName: SELECTION_ACTION,
        args: {
          previousSelectionState: { selections: [], activeSelectionId: null },
          nextSelectionState: { selections: [selection], activeSelectionId: 'selection-1' },
        },
      },
      {
        id: 'base',
        layerId: 'layer-1',
        actionName: RENAME_LAYER_ACTION,
        args: { name: 'Base' },
      },
      {
        id: 'selection-clear',
        layerId: 'selection',
        actionName: SELECTION_ACTION,
        args: {
          previousSelectionState: { selections: [selection], activeSelectionId: 'selection-1' },
          nextSelectionState: { selections: [], activeSelectionId: null },
        },
      },
    ];

    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, history);

    act(() => {
      result.current.dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { selections: [], activeSelectionId: null },
          timeline: {
            entries: result.current.storeState.history,
            cursor: 2,
            branchRevision: result.current.storeState.branchRevision,
          },
        },
      });
    });

    await act(async () => {
      await result.current.historyHook.undo();
    });

    expect(result.current.storeState.selections).toEqual([selection]);
    expect(result.current.storeState.activeSelectionId).toBe('selection-1');
  });

  it('ignores invalid history targets', async () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('layerSource'));

    const initialHistoryIndex = result.current.storeState.historyIndex;
    for (const index of [-1, 2, 0.5, NaN]) {
      await act(async () => {
        await result.current.historyHook.resetHistoryTo(index);
      });
    }
    expect(result.current.storeState.historyIndex).toBe(initialHistoryIndex);
  });

  it('marks navigation dirty without mutating the old deleted-layer record', async () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('layerSource'));

    const deletedLayers = { ...result.current.storeState.deletedLayers };
    await act(async () => {
      await result.current.historyHook.undo();
    });
    expect(deletedLayers).toEqual({});
    expect(result.current.storeState.hasUnsavedChanges).toBe(true);
  });

  it('does not let an obsolete bitmap save erase a newer preview', async () => {
    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, createHistory('layerSource'));

    await act(async () => {
      await result.current.historyHook.undo();
    });
    await Promise.resolve();
    const layer = result.current.storeState.layers['layer-1'];
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
    const bitmap = createMockBitmap(40, 20);
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
    const canvas = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValue(() => [canvas, { x: 22, y: 31, width: 40, height: 20 }]);

    const { result } = renderHistoryHook();

    initializeDocument(result.current.dispatch, [
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
        args: { toolName: 'brush' },
      },
      { id: 'remove', layerId: 'top', actionName: REMOVE_ACTION },
    ]);

    await act(async () => {
      await result.current.historyHook.resetHistoryTo(0);
    });
    expect(result.current.storeState.totalSize).toEqual(size);
    expect(result.current.storeState.totalSize).not.toBe(size);
    expect(result.current.storeState.activeLayerId).toBe('top');
    expect(result.current.storeState.layers.top.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
    expect(result.current.storeState.layers.bottom.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));

    await act(async () => {
      await result.current.historyHook.redo();
    });
    expect(processor).toHaveBeenCalledWith({
      bitmap: expect.objectContaining({ width: 40, height: 20 }),
      size: { width: 40, height: 20 },
    });
    expect(result.current.storeState.layers.top.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
    expect(result.current.storeState.layers.top.pos.x).toBe(22);
    expect(result.current.storeState.layers.top.pos.y).toBe(31);
    expect(result.current.storeState.layers.bottom.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
    await act(async () => {
      await result.current.historyHook.undo();
    });
    expect(result.current.storeState.layers.top.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));

    await act(async () => {
      await result.current.historyHook.redo();
    });
    await act(async () => {
      await result.current.historyHook.redo();
    });
    expect(result.current.storeState.layers.top).toBeUndefined();
    expect(result.current.storeState.activeLayerId).toBe('bottom');
    await act(async () => {
      await result.current.historyHook.undo();
    });
    expect(result.current.storeState.layers.top.bitmap).toEqual(expect.objectContaining({ width: 40, height: 20 }));
    await act(async () => {
      await result.current.historyHook.redo();
    });
    expect(result.current.storeState.layers.top).toBeUndefined();
    expect(result.current.storeState.activeLayerId).toBe('bottom');
    expect(result.current.storeState.totalSize).toEqual(size);
    expect(layers.top.bitmap).toBe(bitmap);
    expect(layers.bottom.bitmap).toBe(bitmap);

    processor.mockRestore();
  });
});
