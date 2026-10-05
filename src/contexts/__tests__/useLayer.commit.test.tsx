import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { useHistory } from '../useHistory.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import {
  HIDE_LAYER_ACTION,
  NEW_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

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
  return { store, dispatch, layers: useLayers(), history: useHistory() };
}

/**
 * The record a navigation has to reproduce, minus the two fields no comparison across one can use:
 * `bitmap` and `tmpCanvas` are pixels, and `createLayerSource` materialises a FRESH canvas for a
 * `blank` source on every replay, so identity and object-graph equality are unavailable across a
 * navigation and asserting them would pin the mock rather than the record.
 */
function committedShape(layer: Layer) {
  const source = layer.source as (Layer['source'] & { isBedrock?: boolean }) | undefined;
  return {
    id: layer.id,
    name: layer.name,
    order: layer.order,
    visible: layer.visible,
    isBedrock: layer.isBedrock,
    pos: layer.pos,
    operations: layer.operations,
    // Compared as a boolean because the flag is written two ways for one meaning: a source a
    // history entry carries spells it out, and one built straight from `createBlankLayer` leaves it
    // implicit. Only its ABSENCE is load-bearing here — a record the replay rebuilt names a source,
    // a record that swallowed a draft names none.
    source: source && { ...source, isBedrock: Boolean(source.isBedrock) },
  };
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

/**
 * A document the timeline can rebuild, which is the precondition for a navigation being a replay
 * at all: `replayHistory` starts from `{}` and honours a `documentSource` at index 0 only, so it
 * is `createBlankLayer(..., true)` that puts the base document IN the timeline and the second call
 * that appends a `NEW_LAYER` entry after it. Ids come back from the store because
 * `createLayerSource` mints them. Module scope because two describes need it: a commit that owns
 * one layer, and a commit that promotes a preview a logical edit landed on.
 */
function seedReplayableDocument() {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
  });
  act(() => {
    result.current.layers.createBlankLayer({ color: '#ffffff', opacity: 1, isBedrock: true, size: { ...size } }, true);
  });
  act(() => {
    result.current.layers.createBlankLayer({
      color: '#ff0000',
      opacity: 1,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    });
  });
  const [ownedId, draftId] = Object.keys(result.current.store.layers);
  return { result, ownedId, draftId };
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

  it('leaves a dirty cache it does not own staged, which is the only way the promotion loop stays inside the scope', async () => {
    // The second loop detaches ONE dirty cache so its promotion can be requested, and it breaks on
    // the first hit. Ordered with the unowned cache FIRST, because `Object.values` walks the
    // record's insertion order: a scoped commit reaches the owned layer's own cache only by
    // declining this one, and an unscoped commit detaches it instead and never looks at the owned
    // layer. That is the whole difference the `ownedLayerId` check makes here, so the assertion is
    // on the CACHE and not on the record — a promotion is the only thing this loop can cause.
    const foreignCache = new OffscreenCanvas(40, 20) as unknown as Layer['tmpCanvas'];
    const { result } = setup({
      layers: { foreign: makeLayer('foreign', 0, { tmpCanvas: foreignCache }), owned: makeLayer('owned', 1) },
      activeLayerId: 'owned',
    });
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValue(() => [new OffscreenCanvas(40, 20)]);

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'owned',
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });

    // ONE claim, two halves. The owned half is the control — asserting the
    // unowned half alone would also pass on a loop that promoted nothing at all, which is the other
    // way this loop can be inert. Removing the scope check promotes the unowned cache instead and
    // the unowned half reads `null`.
    //
    // `toBe`, not `toEqual`: two `OffscreenCanvas`es of the same size are `toEqual`, so a
    // structural comparison proves only "some canvas" and would pass on a loop that swapped in a
    // fresh one. The claim is that this cache is left exactly where it was found.
    expect(result.current.store.layers.owned!.tmpCanvas).toBeNull();
    expect(result.current.store.layers.foreign!.tmpCanvas).toBe(foreignCache);
    processor.mockRestore();
  });

  it('a real undo replays the timeline, and the layer the commit did not own comes back as the record it published', async () => {
    const draftRaster = new OffscreenCanvas(40, 20);
    const commitRaster = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.brush, 'imageProcessor')
      .mockReturnValueOnce(() => [draftRaster])
      .mockReturnValueOnce(() => [commitRaster])
      .mockReturnValue(() => [commitRaster]);
    const { result, ownedId, draftId } = seedReplayableDocument();
    const seededOwned = committedShape(result.current.store.layers[ownedId]!);

    // A live draft on the other layer, staged the way a second concurrent gesture stages one.
    act(() => {
      result.current.layers.tempUpdateLayer({
        id: draftId,
        toolArgs: { toolName: 'brush', lineWidth: 6 } as ToolArgs,
      });
    });

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: ownedId,
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });

    // Three entries — document, new layer, tool — and the tool commit cleared the owned layer's
    // `source`, which is what the raster commit does. So there is a state below to navigate back
    // FROM, and the undo below has something it can fail to reverse.
    expect(result.current.store.historyIndex).toBe(2);
    expect(result.current.store.layers[ownedId]!.source).toBeUndefined();
    const published = committedShape(result.current.store.layers[draftId]!);

    // THE NAVIGATION IS A REPLAY, not the store's own layers handed back to it. The owned layer's
    // `source` comes back, which only `replayHistory` rebuilding the record from the timeline can
    // do; a navigation that echoed the current record would leave it undefined and fail here.
    await act(async () => {
      await result.current.history.undo();
    });
    expect(result.current.store.historyIndex).toBe(1);
    expect(committedShape(result.current.store.layers[ownedId]!)).toEqual(seededOwned);

    // AND THE UNOWNED LAYER IS A FIXED POINT OF THAT REPLAY: what the timeline rebuilt for it is
    // the record the scoped commit published, at the cursor below the commit and at the tip. A
    // commit that folded the draft in publishes a record naming no `source` at all, which no replay
    // of this timeline reproduces — so the undo would silently revert a draft nothing ever recorded.
    expect(committedShape(result.current.store.layers[draftId]!)).toEqual(published);
    await act(async () => {
      await result.current.history.redo();
    });
    expect(result.current.store.historyIndex).toBe(2);
    expect(committedShape(result.current.store.layers[draftId]!)).toEqual(published);
    processor.mockRestore();
  });
});

/**
 * `tempUpdateLayer` stages a preview as a full spread of the layer it read, so promoting one used
 * to republish that instant's copy of every logical field. A rename, a hide or a drag-reorder that
 * landed in between — none of which commits the pending preview — was therefore reverted by the
 * promote, while the timeline kept it and `replayHistory` applied both entries in order.
 *
 * The regression is ONE test because the defect is one: the promote's field provenance. The three
 * logical edits are staged as three of them only because each has its own history entry and each
 * exercises a different `useLayers` writer (`updateLayer`, `toggleVisibility`, `moveLayerAfter`).
 */
describe('useLayers preview promotion and logical layer edits', () => {
  it('promotes the draft pixels onto the LIVE logical properties, and replay rebuilds that record', async () => {
    const draftRaster = new OffscreenCanvas(40, 20);
    const processor = vi.spyOn(toolProcessors.brush, 'imageProcessor').mockReturnValue(() => [draftRaster]);
    const { result, draftId: editedId } = seedReplayableDocument();

    // 1. A live whole-layer preview, the state a Colors/Blur/Levels slider or a brush stroke
    // leaves behind: pixels staged, nothing published, nothing in the timeline.
    act(() => {
      result.current.layers.tempUpdateLayer({
        id: editedId,
        toolArgs: { toolName: 'brush', lineWidth: 4 } as ToolArgs,
      });
    });
    expect(result.current.store.previewLayers.current[editedId]!.layer.tmpCanvas).toBe(draftRaster);
    expect(result.current.store.history).toHaveLength(2);

    // 2. Three logical edits to the SAME layer while that preview is still staged. Each is a
    // panel gesture that does not commit the draft, which is what made the window reachable. One
    // `act` per gesture, because each is a separate user event and `updateLayer` publishes from the
    // `layers` its own render closed over — batching them would make the last one win on a record
    // two ticks old, and the rename would be gone before the promote is ever reached.
    act(() => {
      result.current.layers.updateLayer(editedId, { name: 'Renamed' }, RENAME_LAYER_ACTION);
    });
    act(() => {
      result.current.layers.toggleVisibility(editedId);
    });
    act(() => {
      result.current.layers.moveLayerAfter(editedId, null);
    });
    // The preview is STILL staged, which is what makes this a regression rather than a test of a
    // commit-then-edit ordering that does not occur.
    expect(result.current.store.previewLayers.current[editedId]!.layer.tmpCanvas).toBe(draftRaster);
    const reorderedOrder = result.current.store.layers[editedId]!.order;
    const draftOrder = result.current.store.previewLayers.current[editedId]!.layer.order;
    expect(reorderedOrder).not.toBe(draftOrder);
    const draftPos = result.current.store.previewLayers.current[editedId]!.layer.pos;

    // 3. The tool switch. `commitDirtyTool()` is what `goToTool()` calls, and it promotes every
    // preview the map holds.
    act(() => {
      result.current.layers.commitDirtyTool();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    expect(store.previewLayers.current).toEqual({});
    const committed = store.layers[editedId]!;
    // The DRAFT's pixels and geometry promoted...
    expect(committed.tmpCanvas).toBeNull();
    expect(committed.bitmap).not.toBeNull();
    expect(committed.pos).toEqual(draftPos);
    expect(committed.source).toBeUndefined();
    // ...onto the LIVE logical properties, not the preview-time snapshot of them. Each field is
    // asserted against what the panel gesture wrote, and `not` against what the draft still held:
    // without the merge every one of these reads the draft's copy and the user edit is gone.
    expect(committed.name).toBe('Renamed');
    expect(committed.visible).toBe(false);
    expect(committed.order).toBe(reorderedOrder);
    // The timeline carries all four edits in order, the promote last — which is what replay applies.
    expect(store.history.map((entry) => entry.actionName)).toEqual([
      NEW_LAYER_ACTION,
      NEW_LAYER_ACTION,
      RENAME_LAYER_ACTION,
      HIDE_LAYER_ACTION,
      REORDER_ACTION,
      TOOL_ACTION,
    ]);
    const published = committedShape(committed);

    // 4. THE NAVIGATION IS A REPLAY, and the two authorities AGREE. Undo steps below the tool
    // entry, so every logical edit survives on its own entry while the promoted pixels do not:
    // that is the state the old promote had no way to reach, because it had already overwritten
    // the rename, the hide and the order in the record it published.
    await act(async () => {
      await result.current.history.undo();
    });
    const undone = result.current.store.layers[editedId]!;
    expect(undone.name).toBe('Renamed');
    expect(undone.visible).toBe(false);
    expect(undone.order).toBe(reorderedOrder);
    expect(undone.source).toBeDefined();

    await act(async () => {
      await result.current.history.redo();
    });
    // Replay of this timeline rebuilds exactly the record runtime published, which is the whole
    // claim: a preview that swallows a property edit publishes state no navigation reproduces.
    expect(committedShape(result.current.store.layers[editedId]!)).toEqual(published);
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
