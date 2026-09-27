import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { TOOL_ACTION } from '../../util/constants.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const size = { width: 800, height: 600 };
const frame = documentFrameFromSize(size);

function makeLayer(id: string, order: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 40, height: 20 } as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: 0, y: 0, width: 40, height: 20 },
    operations: [],
    ...overrides,
  };
}

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setup({
  layers = {},
  activeLayerId = null,
  canvas = document.createElement('canvas'),
  totalSize = size,
  documentFrame = frame,
}: {
  layers?: LayersRecord;
  activeLayerId?: string | null;
  canvas?: HTMLCanvasElement | null;
  totalSize?: { width: number; height: number };
  documentFrame?: DocumentFrame;
} = {}) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });

  act(() => {
    result.current.store.canvasRef.current = canvas;
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId,
        totalSize: { ...totalSize },
        documentFrame,
        hasImage: true,
      },
    });
  });

  return { result };
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers commitDirtyTool presentation promotion', () => {
  it('materialises a tool-less preview canvas onto the committed layer without a history entry', async () => {
    // A preview can be staged by a document-scoped consumer that only owns a
    // raster draft (no replayable tool args). Promoting it is a presentation
    // change, not a logical edit, so it must not reach the history.
    const raster = new OffscreenCanvas(40, 20);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.store.previewLayers.current = {
        edited: { layer: makeLayer('edited', 0, { tmpCanvas: raster as unknown as Layer['tmpCanvas'] }) },
      };
    });
    // The preview exists but is not yet the committed layer's presentation.
    expect(result.current.store.previewLayers.current.edited!.layer.tmpCanvas).toBe(raster);
    expect(result.current.store.layers.edited!.tmpCanvas).toBeNull();

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    // The staged canvas replaced the committed presentation: the draft is gone
    // and the layer now carries the materialised bitmap.
    expect(store.previewLayers.current).toEqual({});
    expect(store.layers.edited!.tmpCanvas).toBeNull();
    expect(store.layers.edited!.bitmap).not.toBeNull();
    expect(store.history).toEqual([]);
  });

  it('materialises a raster-tool preview and records the tool edit as history', async () => {
    const raster = new OffscreenCanvas(40, 20);
    const processor = vi.spyOn(toolProcessors.brush, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });
    expect(result.current.store.previewLayers.current.edited!.layer.tmpCanvas).toBe(raster);

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    expect(store.previewLayers.current).toEqual({});
    expect(store.layers.edited!.tmpCanvas).toBeNull();
    expect(store.layers.edited!.bitmap).not.toBeNull();
    expect(store.history).toMatchObject([{ actionName: TOOL_ACTION, layerId: 'edited' }]);
    processor.mockRestore();
  });

  it('materialises a committed layer that still carries a staged canvas', async () => {
    const staged = new OffscreenCanvas(40, 20);
    const previous = { width: 1, height: 1 } as ImageBitmap;
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0, { tmpCanvas: staged, bitmap: previous }) },
      activeLayerId: 'edited',
    });

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    expect(store.previewLayers.current).toEqual({});
    expect(store.layers.edited!.tmpCanvas).toBeNull();
    expect(store.layers.edited!.bitmap).not.toBe(previous);
    expect(store.history).toEqual([]);
  });

  it('leaves an already-materialised layer untouched and records no history', () => {
    const { result } = setup({ layers: { clean: makeLayer('clean', 0) }, activeLayerId: 'clean' });

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.previewLayers.current).toEqual({});
    expect(result.current.store.layers.clean!.tmpCanvas).toBeNull();
  });
});

describe('useLayers commitDirtyTool history boundary', () => {
  it('publishes every previewed tool edit as its own history entry, with the layer record on the first', async () => {
    const firstRaster = new OffscreenCanvas(40, 20);
    const secondRaster = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValueOnce(() => [firstRaster])
      .mockReturnValueOnce(() => [secondRaster]);
    const { result } = setup({
      layers: { a: makeLayer('a', 0), b: makeLayer('b', 1) },
      activeLayerId: 'a',
    });

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'a', toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs });
      result.current.layers.tempUpdateLayer({ id: 'b', toolArgs: { toolName: 'brush', lineWidth: 6 } as ToolArgs });
    });

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    expect(store.history.map((entry) => [entry.actionName, entry.layerId])).toEqual([
      [TOOL_ACTION, 'a'],
      [TOOL_ACTION, 'b'],
    ]);
    // Only the first commit carries the layer record; both layers must therefore
    // be published, which is what proves the first commit carried the updates.
    expect(store.layers.a!.tmpCanvas).toBeNull();
    expect(store.layers.b!.tmpCanvas).toBeNull();
    expect(store.layers.a!.bitmap).not.toBeNull();
    expect(store.layers.b!.bitmap).not.toBeNull();
    expect(store.previewLayers.current).toEqual({});
    processor.mockRestore();
  });

  it('defers publication when asked to, publishing the layer record without any history entry', async () => {
    const raster = new OffscreenCanvas(40, 20);
    const processor = vi.spyOn(toolProcessors.brush, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });

    let returned: LayersRecord | undefined;
    act(() => {
      returned = result.current.layers.commitDirtyTool(true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // A deferred commit returns the merged record for the caller's own dispatch.
    expect(Object.keys(returned!)).toEqual(['edited']);
    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.previewLayers.current).toEqual({});
    processor.mockRestore();
  });
});

describe('useLayers text commit boundary', () => {
  it('short-circuits a text commit whose draft text has been cleared', () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
    });

    act(() => {
      result.current.store.currentArgs.current = { toolName: 'text', text: '' } as ToolArgs;
      const returned = result.current.layers.commitDirtyTool();
      expect(Object.keys(returned)).toEqual([]);
    });

    expect(result.current.store.history).toEqual([]);
    expect(Object.keys(result.current.store.layers)).toEqual([]);
  });

  it('short-circuits a text commit whose draft rect has been cleared even while text remains', () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ type: 'SET_TOOL_NAME', payload: 'text' });
    });

    act(() => {
      result.current.store.currentArgs.current = { toolName: 'text', text: 'Hello', rect: null } as ToolArgs;
      const returned = result.current.layers.commitDirtyTool();
      expect(Object.keys(returned)).toEqual([]);
    });

    // The stale text survives in the shared draft: the guard is the cleared rect,
    // and no layer is created for it.
    expect(result.current.store.history).toEqual([]);
    expect((result.current.store.currentArgs.current as { text: string }).text).toBe('Hello');
  });
});
