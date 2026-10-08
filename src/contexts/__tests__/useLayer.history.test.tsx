import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { getAssetRegistry } from '../asset-registry.ts';
import { deriveRemoveLayerEntry, deriveSetLayerPropertiesEntry } from '../history-adapter.ts';
import { useLayers } from '../useLayer.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import {
  HIDE_LAYER_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REORDER_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

/**
 * The append boundary is the only thing that can turn a layer-property update
 * into a durable entry, so the writer's routing is observed by counting the
 * plans it asks for and reading the entry each plan produced. The spy delegates
 * to the real boundary so every durable assertion below is about production
 * behaviour, not about a stubbed return value.
 */
const planHistoryAppend = vi.hoisted(() => vi.fn());

vi.mock('../history-append.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-append.ts')>();
  return { ...actual, planHistoryAppend };
});

let realPlanHistoryAppend: typeof import('../history-append.ts').planHistoryAppend;

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

const documentSize = { width: 800, height: 600 };

/** A layer the durable model can convert, so an append is decided against a real shadow. */
function documentLayer(id: string, order: number): Layer {
  return {
    ...createMockLayer({
      id,
      name: id,
      order,
      isBedrock: true,
      pos: { x: 0, y: 0, width: 800, height: 600 },
    }),
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: true,
      size: { width: 800, height: 600 },
    },
  } as Layer;
}

/**
 * An open document with a baseline entry, which is the only state where the
 * append gate has a durable document it could extend: an empty timeline is
 * never at its tip, so nothing published from one.
 */
function setupWithDocument(layers: LayersRecord = { [documentLayer('layer-1', 0).id]: documentLayer('layer-1', 0) }) {
  const result = setup(layers);
  const documentFrame = documentFrameFromSize(documentSize);
  act(() => {
    result.current.dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'doc-layer-props',
        history: [
          {
            id: 'baseline',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: Object.keys(layers)[0]!,
            documentSource: { layers, size: documentSize, frame: documentFrame },
          },
        ],
        historyIndex: 0,
        updates: { layers, totalSize: documentSize, documentFrame, hasImage: true },
      },
    });
  });
  return result;
}

beforeAll(async () => {
  ({ planHistoryAppend: realPlanHistoryAppend } =
    await vi.importActual<typeof import('../history-append.ts')>('../history-append.ts'));
});

beforeEach(() => {
  drawLayersToCanvas.mockClear();
  planHistoryAppend.mockClear();
  planHistoryAppend.mockImplementation(realPlanHistoryAppend);
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

  it('records a reorder as its own history entry through the store-owned action', () => {
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

describe('useLayers removeLayer', () => {
  it('routes a removal through the append boundary exactly once, against the live timeline', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;
    expect(planHistoryAppend).not.toHaveBeenCalled();

    act(() => {
      result.current.layers.removeLayer(id);
    });

    // The removal's durable operation is a function of the history item alone, so
    // the hook boundary can derive it without the store's live layer record — which
    // is why this writer asks here at all, unlike a reorder.
    expect(planHistoryAppend).toHaveBeenCalledTimes(1);
    expect(planHistoryAppend.mock.calls[0]![0]).toMatchObject({
      item: { layerId: id, actionName: REMOVE_ACTION, args: {} },
      timeline: { cursor: 0, branchRevision: 0 },
    });
  });

  it('publishes the removal the boundary derived, under the legacy entry id', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.removeLayer(id);
    });

    const store = result.current.store;
    expect(store.layers[id]).toBeUndefined();
    expect(store.deletedLayers[id]).toMatchObject({ id, bitmap: null, tmpCanvas: null });
    expect(store.history).toHaveLength(2);
    const entry = store.history[1]!;
    expect(entry).toMatchObject({ actionName: REMOVE_ACTION, layerId: id, args: {} });

    // A publication, not a reconversion: the shadow grew by exactly the one entry
    // the boundary derived from the same legacy entry, under the same id.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(store.durableDocument!.history).toHaveLength(1);
    expect(store.durableDocument!.history[0]).toEqual(deriveRemoveLayerEntry(entry));
    expect(store.durableDocument!.history[0]!.id).toBe(entry.id);
    expect(store.durableDocument!.cursor).toBe(0);
  });

  it('hands the store the entry it planned, so the store publishes instead of reconverting', () => {
    // A clean removal's published document and its reconverted document are
    // byte-identical by design — that identity is the invariant the append
    // boundary exists to hold. So no assertion on the resulting document can tell
    // the two paths apart, and a writer that planned the entry and then dropped it
    // on the floor would leave the whole feature inert with every other assertion
    // still green.
    //
    // The discriminator is the registry: publication opens exactly one append
    // transaction, while reconversion opens its own conversion transaction. This
    // test is the one that fails if the writer stops passing `durableEntry`.
    const beginTransaction = vi.spyOn(getAssetRegistry(), 'beginDocumentAssetTransaction');
    try {
      const result = setupWithDocument();
      // `setupWithDocument` replaces the document, which itself reconverts; only the
      // removal is under test here.
      beginTransaction.mockClear();
      const id = Object.keys(result.current.store.layers)[0]!;

      act(() => {
        result.current.layers.removeLayer(id);
      });

      expect(beginTransaction).toHaveBeenCalledTimes(1);
      expect(result.current.store.durableStatus).toBe('current');
    } finally {
      beginTransaction.mockRestore();
    }
  });

  it('still removes the layer when the boundary itself throws', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A shadow projection that throws must not reject a valid removal, exactly as
    // the selection writers' `catch` re-dispatch says. Nothing has been appended
    // and no layer has left the record when the plan runs, so the catch path is
    // the whole edit rather than a repair of it.
    planHistoryAppend.mockImplementationOnce(() => {
      throw new Error('the durable projection failed');
    });

    act(() => {
      result.current.layers.removeLayer(id);
    });

    const store = result.current.store;
    expect(store.layers[id]).toBeUndefined();
    expect(store.deletedLayers[id]).toMatchObject({ id });
    expect(store.history).toHaveLength(2);
    expect(store.history[1]).toMatchObject({ actionName: REMOVE_ACTION, layerId: id, args: {} });
    // The fallback carries no plan, so the store reconverts and the removal is
    // still in the shadow — the legacy timeline is the authority either way.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDocument!.history.map((entry) => entry.operation.kind)).toEqual(['remove-layer']);
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to plan durable history for a layer removal',
      expect.objectContaining({ message: 'the durable projection failed' })
    );
  });

  it('removes a layer the record does not hold without asking the boundary at all', () => {
    const result = setupWithDocument();
    // The baseline entry `setupWithDocument` seeds, captured rather than counted:
    // this asserts the removal added nothing, not that history is empty.
    const before = result.current.store.history;

    act(() => {
      result.current.layers.removeLayer('ghost');
    });

    expect(planHistoryAppend).not.toHaveBeenCalled();
    expect(result.current.store.history).toBe(before);
  });
});

describe('useLayers layer-property writers', () => {
  it('routes opacity through the append boundary and publishes one canonical entry', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.updateLayer(id, { opacity: 0.42 }, SET_LAYER_OPACITY_ACTION);
    });

    expect(planHistoryAppend).toHaveBeenCalledTimes(1);
    expect(planHistoryAppend.mock.calls[0]![0]).toMatchObject({
      item: { layerId: id, actionName: SET_LAYER_OPACITY_ACTION, args: { opacity: 0.42 } },
      timeline: { cursor: 0, branchRevision: 0 },
    });

    const store = result.current.store;
    expect(store.layers[id].opacity).toBe(0.42);
    expect(store.history).toHaveLength(2);
    expect(store.history[1]).toMatchObject({
      actionName: SET_LAYER_OPACITY_ACTION,
      layerId: id,
      args: { opacity: 0.42 },
    });
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(store.durableDocument!.history).toHaveLength(1);
    expect(store.durableDocument!.history[0]).toMatchObject({
      id: store.history[1]!.id,
      operation: { kind: 'set-layer-properties', layerId: id, patch: { opacity: 0.42 } },
    });
    expect(store.durableDocument!.cursor).toBe(0);
  });

  it('routes a rename through the append boundary and publishes one entry under the legacy id', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.updateLayer(id, { name: 'Renamed' }, RENAME_LAYER_ACTION);
    });

    expect(planHistoryAppend).toHaveBeenCalledTimes(1);
    expect(planHistoryAppend.mock.calls[0]![0]).toMatchObject({
      item: { layerId: id, actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' } },
      timeline: { cursor: 0, branchRevision: 0 },
    });

    const store = result.current.store;
    expect(store.layers[id].name).toBe('Renamed');
    expect(store.history).toHaveLength(2);
    expect(store.history[1]).toMatchObject({ actionName: RENAME_LAYER_ACTION, layerId: id, args: { name: 'Renamed' } });
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    // One append mints one id: the durable entry is the one the boundary derived
    // from the same legacy entry, not a second id the store invented.
    expect(store.durableDocument!.history).toHaveLength(1);
    expect(store.durableDocument!.history[0]).toMatchObject({
      id: store.history[1]!.id,
      operation: { kind: 'set-layer-properties', layerId: id, patch: { name: 'Renamed' } },
    });
    expect(store.durableDocument!.cursor).toBe(0);
  });

  it('toggles visibility through the boundary and flips the canonical patch both ways', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.toggleVisibility(id);
    });

    expect(planHistoryAppend).toHaveBeenCalledTimes(1);
    expect(planHistoryAppend.mock.calls[0]![0]).toMatchObject({
      item: { layerId: id, actionName: HIDE_LAYER_ACTION, args: { visible: false } },
    });
    let store = result.current.store;
    expect(store.layers[id].visible).toBe(false);
    expect(store.history[1]).toMatchObject({ actionName: HIDE_LAYER_ACTION, layerId: id, args: { visible: false } });
    expect(store.durableDocument!.history[0]).toMatchObject({
      id: store.history[1]!.id,
      operation: { kind: 'set-layer-properties', layerId: id, patch: { visible: false } },
    });

    act(() => {
      result.current.layers.toggleVisibility(id);
    });

    expect(planHistoryAppend).toHaveBeenCalledTimes(2);
    expect(planHistoryAppend.mock.calls[1]![0]).toMatchObject({
      item: { layerId: id, actionName: SHOW_LAYER_ACTION, args: { visible: true } },
    });
    store = result.current.store;
    expect(store.layers[id].visible).toBe(true);
    // The second append published onto the first, so both survive and the
    // durable cursor tracks the legacy one.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(store.durableDocument!.history.map((entry) => entry.id)).toEqual([
      result.current.store.history[1]!.id,
      result.current.store.history[2]!.id,
    ]);
    expect(store.durableDocument!.history[1]).toMatchObject({
      operation: { kind: 'set-layer-properties', layerId: id, patch: { visible: true } },
    });
    expect(store.durableDocument!.cursor).toBe(1);
    // The document baseline is not a durable entry, so the cursor lags the
    // legacy one and must never lead it.
    expect(store.durableDocument!.cursor).toBeLessThan(store.historyIndex);
  });

  it('applies only the derived property to the runtime layer, not every field the caller passed', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.updateLayer(
        id,
        { name: 'Renamed', visible: false, opacity: 0.5 } as Partial<Layer>,
        RENAME_LAYER_ACTION
      );
    });

    const store = result.current.store;
    // A rename's durable operation is the name and nothing else, so the runtime
    // record is patched with the derived property rather than the caller's
    // `Partial<Layer>`. Otherwise an unrelated field in the patch would reach
    // the layer with no durable entry to replay it from.
    expect(store.layers[id].name).toBe('Renamed');
    expect(store.layers[id].visible).toBe(true);
    expect(store.layers[id].opacity).toBe(1);
    // The legacy record keeps the caller's arguments verbatim: the timeline stays
    // the replay authority, and only the runtime layer and the shadow are
    // narrowed to the derived property.
    expect(store.history[1]!.args).toEqual({ name: 'Renamed', visible: false, opacity: 0.5 });
    expect(store.durableDocument!.history[0]).toMatchObject({
      operation: { kind: 'set-layer-properties', layerId: id, patch: { name: 'Renamed' } },
    });
  });

  it('keeps the caller patch and drops the durable branch when the rename value is unreadable', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    act(() => {
      result.current.layers.updateLayer(id, { name: 42 as unknown as string }, RENAME_LAYER_ACTION);
    });

    const store = result.current.store;
    // A boundary that cannot read the value plans no entry, so the writer keeps
    // the caller's patch: refusing the durable branch never rejects the edit.
    expect(store.layers[id].name).toBe(42);
    expect(store.history).toHaveLength(2);
    expect(store.history[1]).toMatchObject({ actionName: RENAME_LAYER_ACTION, layerId: id, args: { name: 42 } });
    // Nothing is manufactured to satisfy the cursor: the shadow stays on the
    // baseline while the legacy timeline keeps the entry.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDocument!.history).toHaveLength(0);
    expect(store.durableDocument!.cursor).toBe(-1);
  });

  it('publishes the boundary plan instead of letting the store reconvert it', () => {
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;

    // A publication carries the store's current diagnostics forward and a
    // whole-timeline reconversion replaces the list, so a diagnostic that
    // survives the next commit is a direct read of which path that commit took.
    const planted: HistoryItem = {
      id: 'planted-mismatch',
      actionName: RENAME_LAYER_ACTION,
      layerId: id,
      args: { name: 'Renamed' },
    };
    act(() => {
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { [id]: { ...result.current.store.layers[id], name: 'Renamed' } } },
          historyItem: planted,
          durableEntry: {
            ...(deriveSetLayerPropertiesEntry(planted) as DurableHistoryEntry),
            operation: { kind: 'set-layer-properties', layerId: id, patch: { name: 'Somewhere else' } },
          },
        },
      });
    });
    expect(result.current.store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'durable-append-mismatch',
    ]);

    act(() => {
      result.current.layers.updateLayer(id, { name: 'Renamed twice' }, RENAME_LAYER_ACTION);
    });

    const store = result.current.store;
    // The writer handed the boundary's entry to the store and the store
    // published it onto its own document, so the shadow grew by exactly one
    // entry and the previous diagnostic was carried rather than recomputed.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(store.durableDocument!.history.map((entry) => entry.id)).toEqual([planted.id, store.history[2]!.id]);
    expect(store.durableDocument!.cursor).toBe(1);
  });

  it('publishes a reorder through the store and carries the diagnostics a publication carries', () => {
    const bottom = documentLayer('bottom', 0);
    const top = documentLayer('top', 1);
    const result = setupWithDocument({ bottom, top });
    expect(planHistoryAppend).not.toHaveBeenCalled();

    // A commit whose plan disagrees with its own legacy entry reports a
    // mismatch, and a publication carries that diagnostic into the next append.
    // Whether the next append publishes or reconverts is therefore readable off
    // the list: a publication preserves it, a reconversion replaces it.
    const rename: HistoryItem = {
      id: 'rename-1',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'bottom',
      args: { name: 'Renamed' },
    };
    act(() => {
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { bottom: { ...bottom, name: 'Renamed' }, top } },
          historyItem: rename,
          durableEntry: {
            ...(deriveSetLayerPropertiesEntry(rename) as DurableHistoryEntry),
            operation: { kind: 'set-layer-properties', layerId: 'bottom', patch: { name: 'Somewhere else' } },
          },
        },
      });
    });
    expect(result.current.store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'durable-append-mismatch',
    ]);

    act(() => {
      result.current.layers.moveLayerAfter('bottom', 'top');
    });

    // The writer still asks the hook boundary for nothing, because a reorder's
    // durable operation names the order of every layer and only the store can see
    // the record it must describe. The store plans it from that record instead.
    expect(planHistoryAppend).not.toHaveBeenCalled();
    const store = result.current.store;
    expect(store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: 'bottom',
      args: { layerToMoveId: 'bottom', afterWhichLayerId: 'top' },
    });
    // The carried diagnostic is the proof the append published rather than
    // reconverting: a reconversion would have replaced the list with its own.
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(store.durableStatus).toBe('current');
    expect(store.durableDocument!.history.map((entry) => entry.operation.kind)).toEqual([
      'set-layer-properties',
      'reorder-layers',
    ]);
    expect(store.durableDocument!.cursor).toBe(1);
  });
});
