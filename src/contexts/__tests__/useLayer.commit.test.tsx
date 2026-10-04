import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { RENAME_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

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
  it('gives a pixel processor the retained affine presentation and transformed bounds', () => {
    const raster = new OffscreenCanvas(80, 20);
    const source = makeLayer('edited', 0, {
      operations: [
        {
          id: 'scale',
          kind: 'affine-transform',
          transform: { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 },
          enabled: true,
        },
      ],
    });
    const processor = vi.spyOn(toolProcessors.brush, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({ layers: { edited: source }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });

    const params = processor.mock.calls[0]![0] as { bitmap: OffscreenCanvas; size: Layer['pos'] };
    expect(params.bitmap).not.toBe(source.bitmap);
    expect(params.bitmap.width).toBe(80);
    expect(params.bitmap.height).toBe(20);
    expect(params.size).toEqual({ x: 0, y: 0, width: 80, height: 20 });
    processor.mockRestore();
  });

  it('publishes trapezoid transforms at the staged bounds without retaining the baked affine', () => {
    const raster = new OffscreenCanvas(80, 20);
    const source = makeLayer('edited', 0, {
      operations: [
        {
          id: 'scale',
          kind: 'affine-transform',
          transform: { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 },
          enabled: true,
        },
      ],
    });
    const processor = vi.spyOn(toolProcessors.transform, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({ layers: { edited: source }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: {
          toolName: 'transform',
          rotate: 0,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          trapezoid: 12,
          resizeX: 100,
          resizeY: 100,
        } as ToolArgs,
      });
    });

    const preview = result.current.store.previewLayers.current.edited!.layer;
    expect(preview.pos).toEqual({ x: 0, y: 0, width: 80, height: 20 });
    expect(preview.operations).toEqual([]);
    expect(preview.source).toBeUndefined();
    processor.mockRestore();
  });

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

  it('preserves hasUnsavedChanges and the durable shadow across a presentation-only commit', async () => {
    // A real document edit first, so both the dirty flag and a `current` durable
    // shadow exist before the promotion. `commitDirtyTool` on a layer that only
    // carries a staged canvas publishes through `PUBLISH_RUNTIME_PRESENTATION`,
    // which is the hook-level path to the presentation boundary.
    const staged = new OffscreenCanvas(40, 20);
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0, { tmpCanvas: staged as unknown as Layer['tmpCanvas'] }) },
      activeLayerId: 'edited',
    });

    act(() => {
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { edited: { ...result.current.store.layers.edited!, name: 'Renamed' } } },
          historyItem: { id: 'edit-1', actionName: RENAME_LAYER_ACTION, layerId: 'edited', args: {} },
        },
      });
    });
    const before = result.current.store;
    expect(before.hasUnsavedChanges).toBe(true);
    expect(before.durableStatus).toBe('current');

    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const after = result.current.store;
    // The promotion did land — this is a publication, not a no-op.
    expect(after).not.toBe(before);
    expect(after.layers.edited!.tmpCanvas).toBeNull();
    expect(after.layers.edited!.bitmap).not.toBeNull();
    // A swap of a disposable cache is not an edit: it neither dirties the document
    // nor invalidates the durable shadow, and it appends nothing.
    expect(after.hasUnsavedChanges).toBe(before.hasUnsavedChanges);
    expect(after.durableStatus).toBe(before.durableStatus);
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument).toBe(before.durableDocument);
    expect(after.history).toEqual(before.history);
  });

  it('refuses a presentation publication that also moves durable layer state', () => {
    const cache = { width: 40, height: 20, close: vi.fn() } as unknown as ImageBitmap;
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = result.current.store.layers;

    // Called through the store's internal handle, the same path `useLayers`
    // commits with, so this is not a direct reducer call.
    act(() => {
      result.current.store.publishRuntimePresentation({
        edited: { ...before.edited!, name: 'Renamed by a refused publication', bitmap: cache, tmpCanvas: null },
      });
    });

    const store = result.current.store;
    // Refused, not applied: the very same record object is still the live one, so
    // the rename never reaches the document.
    expect(store.layers).toBe(before);
    expect(store.layers.edited!.name).toBe('edited');
    expect(store.layers.edited!.bitmap).not.toBe(cache);
    // Two refusals share one outcome and mean different things, so only the one
    // that would drop a user edit is reported — with the offending layer ids.
    expect(consoleError).toHaveBeenCalledTimes(1);
    const reported = consoleError.mock.calls[0][0] as string;
    expect(reported).toContain('PUBLISH_RUNTIME_PRESENTATION carries presentation caches only');
    expect(reported).toContain('Offending layer ids: edited');
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

describe('useLayers deferred commit ownership', () => {
  /**
   * Two previews at once: one the committing caller owns, one staged by a different consumer —
   * a gesture on another layer, or a document-scoped raster draft. `updateLayerByTool` commits
   * ONE layer, so only that layer's pixels may reach the committed record.
   */
  function stageTwoPreviews() {
    const draftRaster = new OffscreenCanvas(40, 20);
    const commitRaster = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValueOnce(() => [draftRaster])
      .mockReturnValueOnce(() => [commitRaster]);
    const before = { a: makeLayer('a', 0), b: makeLayer('b', 1) };
    const { result } = setup({ layers: before, activeLayerId: 'a' });

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'b', toolArgs: { toolName: 'brush', lineWidth: 6 } as ToolArgs });
    });
    return { result, processor, before, draftRaster };
  }

  /** The two steps `useHistory`'s `resetHistoryTo` runs before any navigation replays. */
  function navigateHistory(result: { current: ReturnType<typeof useLayerHarness> }, cursor: number) {
    const store = result.current.store;
    const before = store.layers;
    act(() => {
      store.clearPreviewLayers();
      result.current.dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: {
            layers: before,
            deletedLayers: store.deletedLayers,
            activeLayerId: store.activeLayerId,
            totalSize: store.totalSize,
            documentFrame: store.documentFrame,
            selections: [],
            activeSelectionId: null,
          },
          timeline: { entries: store.history, cursor, branchRevision: store.branchRevision },
        },
      });
    });
  }

  it("leaves another layer's live preview pending instead of folding it into the caller's commit", async () => {
    const { result, processor, before, draftRaster } = stageTwoPreviews();
    expect(result.current.store.previewLayers.current.b!.layer.tmpCanvas).toBe(draftRaster);

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'a',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });

    const store = result.current.store;
    // The caller's own layer committed, with the one history entry that reproduces it.
    expect(store.history.map((entry) => [entry.actionName, entry.layerId])).toEqual([[TOOL_ACTION, 'a']]);
    expect(store.previewLayers.current.a).toBeUndefined();
    expect(store.layers.a!.tmpCanvas).toBeNull();

    // The other layer's draft is still a draft: pending in the preview map, and byte-for-byte
    // absent from the committed record. Publishing it would leave pixels with no history entry.
    expect(store.previewLayers.current.b!.layer.tmpCanvas).toBe(draftRaster);
    expect(store.layers.b).toEqual(before.b);
    processor.mockRestore();
  });

  it('leaves the committed record a fixed point of history navigation, so undo cannot drop a preview nothing recorded', async () => {
    const { result, processor, before } = stageTwoPreviews();

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'a',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });
    const committed = result.current.store.layers;
    navigateHistory(result, 0);

    // Navigation rebuilds every layer from the timeline, which names no change to `b`, so `b`'s
    // committed record must be the record the timeline reproduces. An undo that CHANGED `b` would
    // be reverting pixels that existed only as a preview the commit wrongly consumed: the commit
    // already cleared it from the preview map, and no history entry could bring those pixels back.
    expect(result.current.store.layers.b).toEqual(before.b);
    expect(result.current.store.layers.b).toEqual(committed.b);
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
