import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { ADOPT_LAYER_BITMAPS, useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { BitmapSource } from '../general-types.ts';
import type { ImageLayerSource, Layer, LayersRecord } from '../layer-types.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

/**
 * Every action `useStore` hands out is recorded before it reaches the real
 * provider, so the store still runs its own reducer while the registration this
 * file pins — an `ADOPT_LAYER_BITMAPS` action, its payload and the order it is
 * dispatched in — stays observable. The registration itself belongs to
 * `StoreContext`'s dispatcher, which is where `documentId` lives; this is the half
 * `useLayers` owns, and the half that decides *when* the action is dispatched.
 */
const recorded = vi.hoisted(() => [] as { type: string; payload?: unknown }[]);

vi.mock('../StoreContext.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../StoreContext.tsx')>();
  return {
    ...actual,
    useStore: (() => {
      const [store, dispatch] = actual.useStore();
      const recording = (action: Parameters<typeof dispatch>[0]) => {
        recorded.push(action as { type: string });
        dispatch(action);
      };
      return [store, recording] as unknown as ReturnType<typeof actual.useStore>;
    }) as typeof actual.useStore,
  };
});

const size = { width: 200, height: 100 };
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

function immutableBitmap(): ImageBitmap {
  return { width: 12, height: 8, close: vi.fn() } as unknown as ImageBitmap;
}

function adoptionActions(): { type: string; payload?: unknown }[] {
  return recorded.filter((action) => action.type === ADOPT_LAYER_BITMAPS);
}

function indexOfType(type: string): number {
  return recorded.findIndex((action) => action.type === type);
}

beforeEach(() => {
  recorded.length = 0;
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers adopted raster presentation ownership', () => {
  it('registers an imported raster with the scope by identity after publishing the layer', async () => {
    const bitmap = immutableBitmap();
    const { result } = setup({ layers: { existing: makeLayer('existing', 0) }, activeLayerId: 'existing' });

    await act(async () => {
      await result.current.layers.createLayerFromBitmap({
        bitmap,
        name: 'Imported.png',
        pos: { x: 5, y: 6, width: 12, height: 8 },
      });
    });

    const store = result.current.store;
    const layer = store.layers[store.activeLayerId!]!;
    const source = layer.source as ImageLayerSource;
    // `layer.bitmap` and `layer.source.bitmap` are the same object, so one
    // registration covers both aliases.
    expect(layer.bitmap).toBe(bitmap);
    expect(source.bitmap).toBe(bitmap);

    const adoptions = adoptionActions();
    expect(adoptions).toHaveLength(1);
    const payload = adoptions[0]!.payload as { bitmaps: readonly BitmapSource[] };
    expect(payload.bitmaps).toHaveLength(1);
    expect(payload.bitmaps[0]).toBe(bitmap);
    // The registration names the raster the store actually published, so the
    // scope's retirement can later find it.
    expect(payload.bitmaps[0]).toBe(layer.bitmap);
  });

  it('registers the raster only after the edit that published it', async () => {
    const bitmap = immutableBitmap();
    const { result } = setup({ layers: { existing: makeLayer('existing', 0) }, activeLayerId: 'existing' });

    await act(async () => {
      await result.current.layers.createLayerFromBitmap({
        bitmap,
        name: 'Imported.png',
        pos: { x: 0, y: 0, width: 12, height: 8 },
      });
    });

    // A registration published before the layer exists would be a candidate for
    // retirement on the very next edit, which closes a bitmap the live history
    // entry still names.
    const commit = indexOfType('COMMIT_DOCUMENT_EDIT');
    const adopt = indexOfType(ADOPT_LAYER_BITMAPS);
    expect(commit).toBeGreaterThanOrEqual(0);
    expect(adopt).toBeGreaterThan(commit);
  });

  it('registers an opening import against the incoming document, not the outgoing one', async () => {
    const bitmap = immutableBitmap();
    const { result } = setup({
      layers: { stale: makeLayer('stale', 0) },
      activeLayerId: 'stale',
      totalSize: { width: 64, height: 48 },
      documentFrame: documentFrameFromSize({ width: 64, height: 48 }),
    });
    const outgoingDocumentId = result.current.store.documentId;

    await act(async () => {
      await result.current.layers.createLayerFromBitmap(
        { bitmap, name: 'Opening.png', isBedrock: true, size: { width: 12, height: 8 } },
        true
      );
    });

    const replace = indexOfType('REPLACE_DOCUMENT');
    const adopt = indexOfType(ADOPT_LAYER_BITMAPS);
    expect(replace).toBeGreaterThanOrEqual(0);
    // The scope is keyed by the document that owns the bitmap, and the store's
    // dispatcher reads `currentState.documentId`. An import registered before its
    // `REPLACE_DOCUMENT` would be filed under `outgoingDocumentId` and closed by
    // that document's release.
    expect(adopt).toBeGreaterThan(replace);
    expect(result.current.store.documentId).not.toBe(outgoingDocumentId);
    const payload = adoptionActions()[0]!.payload as { bitmaps: readonly BitmapSource[] };
    expect(payload.bitmaps[0]).toBe(result.current.store.layers[result.current.store.activeLayerId!]!.bitmap);
  });

  it('registers the merged raster so the collapse leaves a bitmap with an owner', async () => {
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), top: makeLayer('top', 1) },
      activeLayerId: 'top',
    });

    let merged: Layer | null = null;
    await act(async () => {
      merged = await result.current.layers.mergeAllLayers();
    });

    const store = result.current.store;
    const layer = merged as Layer | null;
    expect(layer).not.toBeNull();
    // The merge dropped every previous layer in the same transition, which is
    // exactly the transition whose retirement pass has to leave this one alone.
    expect(Object.keys(store.layers)).toEqual([layer!.id]);

    const payload = adoptionActions()[0]?.payload as { bitmaps: readonly BitmapSource[] } | undefined;
    expect(payload).toBeDefined();
    expect(payload!.bitmaps).toHaveLength(1);
    expect(payload!.bitmaps[0]).toBe(layer!.bitmap);
    expect(payload!.bitmaps[0]).toBe((layer!.source as ImageLayerSource).bitmap);
    const commit = indexOfType('COMMIT_DOCUMENT_EDIT');
    expect(indexOfType(ADOPT_LAYER_BITMAPS)).toBeGreaterThan(commit);
  });

  it('adopts nothing when the merge has no canvas to rasterize', async () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only', canvas: null });

    await act(async () => {
      expect(await result.current.layers.mergeAllLayers()).toBeNull();
    });

    expect(adoptionActions()).toEqual([]);
  });
});
