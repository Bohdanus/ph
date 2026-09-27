import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { NEW_LAYER_ACTION, REORDER_ACTION, REMOVE_ACTION, TOOL_ACTION } from '../../util/constants.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const layer: Layer = {
  id: 'layer-1',
  name: 'Image',
  isBedrock: false,
  tmpCanvas: null,
  bitmap: { width: 40, height: 20 } as ImageBitmap,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos: { x: 0, y: 0, width: 40, height: 20 },
  operations: [],
};

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setup(layers: LayersRecord = { [layer.id]: layer }) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId: Object.keys(layers)[0] ?? null,
        totalSize: { width: 800, height: 600 },
        documentFrame: documentFrameFromSize({ width: 800, height: 600 }),
        hasImage: true,
      },
    });
  });
  return result;
}

function makeLayer(id: string, order: number): Layer {
  return { ...layer, id, name: id, order };
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers retained history commits', () => {
  it('commits a previewed blur as one retained operation and one history entry', () => {
    const result = setup();
    act(() => {
      result.current.layers.tempUpdateLayer({
        id: layer.id,
        toolArgs: { toolName: 'blur', radius: 12 },
      });
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.layers[layer.id].bitmap).toBe(layer.bitmap);
    expect(result.current.store.layers[layer.id].operations).toEqual([
      { id: expect.any(String), args: { toolName: 'blur', radius: 12 }, enabled: true },
    ]);
    expect(result.current.store.history).toMatchObject([
      { actionName: TOOL_ACTION, layerId: layer.id, args: { toolName: 'blur', radius: 12 } },
    ]);
  });

  it('records nothing for a commit with no preview to promote', () => {
    const result = setup();

    act(() => {
      result.current.layers.commitDirtyTool();
    });

    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.layers[layer.id].operations).toEqual([]);
  });

  it('records one entry per previewed layer in a single commit transaction', () => {
    const layers = { a: makeLayer('a', 0), b: makeLayer('b', 1) };
    const result = setup(layers);

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'a', toolArgs: { toolName: 'blur', radius: 1 } });
      result.current.layers.tempUpdateLayer({ id: 'b', toolArgs: { toolName: 'blur', radius: 2 } });
      result.current.layers.commitDirtyTool();
    });

    const store = result.current.store;
    expect(store.history).toMatchObject([
      { actionName: TOOL_ACTION, layerId: 'a', args: { toolName: 'blur', radius: 1 } },
      { actionName: TOOL_ACTION, layerId: 'b', args: { toolName: 'blur', radius: 2 } },
    ]);
    expect(store.layers.a.operations).toHaveLength(1);
    expect(store.layers.b.operations).toHaveLength(1);
    expect(store.previewLayers.current).toEqual({});
  });

  it('records a reorder as its own history entry against a detached copy of the record', () => {
    const result = setup({ bottom: makeLayer('bottom', 0), top: makeLayer('top', 1) });
    const before = result.current.store.layers;

    act(() => {
      result.current.layers.moveLayerAfter('bottom', 'top');
    });

    const store = result.current.store;
    expect(store.layers).not.toBe(before);
    expect(store.layers.bottom.order).toBe(2);
    expect(store.layers.top.order).toBe(1);
    expect(store.history).toMatchObject([
      {
        actionName: REORDER_ACTION,
        layerId: 'bottom',
        args: { layerToMoveId: 'bottom', afterWhichLayerId: 'top' },
      },
    ]);
  });

  it('records a removal and leaves the deleted record without bitmaps', () => {
    const result = setup({ bottom: makeLayer('bottom', 0), top: makeLayer('top', 1) });

    act(() => {
      result.current.layers.removeLayer('top');
    });

    const store = result.current.store;
    expect(Object.keys(store.layers)).toEqual(['bottom']);
    expect(store.deletedLayers.top).toMatchObject({ id: 'top', bitmap: null, tmpCanvas: null });
    expect(store.history).toMatchObject([{ actionName: REMOVE_ACTION, layerId: 'top', args: {} }]);
  });

  it('records a new-layer entry whose recorded source round-trips through replay', () => {
    const raster = new OffscreenCanvas(40, 20);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const result = setup({});

    act(() => {
      result.current.layers.createLayerFromTool({
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          rect: { x1: 0, y1: 0, x2: 40, y2: 20 },
        } as unknown as ToolArgs,
      });
    });

    const store = result.current.store;
    const created = store.layers[store.activeLayerId!]!;
    expect(store.history).toMatchObject([
      { actionName: NEW_LAYER_ACTION, layerId: created.id, layerSource: { kind: 'tool' } },
    ]);
    expect((store.history[0]!.layerSource as { args: { rect: unknown } }).args.rect).toEqual({
      x1: 0,
      y1: 0,
      x2: 40,
      y2: 20,
    });
    processor.mockRestore();
  });
});
