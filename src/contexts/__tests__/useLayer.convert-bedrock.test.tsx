import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { useHistory } from '../useHistory.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';

const mockStoreAdoptLayerBitmaps = vi.hoisted(() => vi.fn());
const mockDrawLayersToCanvas = vi.hoisted(() => vi.fn());

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas: mockDrawLayersToCanvas };
});

vi.mock('../StoreContext.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../StoreContext.tsx')>();
  return {
    ...actual,
    useStore: () => {
      const [store, dispatch] = actual.useStore();
      return [{ ...store, adoptLayerBitmaps: mockStoreAdoptLayerBitmaps }, dispatch];
    },
  };
});

function makeLayer(id: string, overrides: Partial<Omit<Layer, 'source'>> = {}): Layer {
  return {
    id,
    name: 'Background',
    isBedrock: true,
    bitmap: new OffscreenCanvas(800, 600),
    tmpCanvas: null,
    pos: { x: 0, y: 0, width: 800, height: 600 },
    source: {
      kind: 'image',
      bitmap: new OffscreenCanvas(800, 600),
      name: 'Background',
      isBedrock: true,
      size: { width: 800, height: 600 },
    },
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    presentationBounds: null,
    operations: [],
    ...overrides,
  };
}

function makeNonBedrockLayer(id: string, overrides: Partial<Omit<Layer, 'source'>> = {}): Layer {
  return {
    id,
    name: 'Layer 1',
    isBedrock: false,
    bitmap: null,
    tmpCanvas: null,
    pos: { x: 0, y: 0, width: 100, height: 100 },
    source: {
      kind: 'tool',
      args: { toolName: 'draw', alpha: 1, color: '#000000', penType: 'pen', lineWidth: 1 },
      pos: { x: 0, y: 0, width: 100, height: 100 },
    },
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    presentationBounds: null,
    operations: [],
    ...overrides,
  };
}

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers(), history: useHistory() };
}

const size = { width: 800, height: 600 };
const frame = documentFrameFromSize(size);

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

  return result;
}

describe('useLayers convertBedrockLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawLayersToCanvas.mockReturnValue(true);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when no active layer and no id provided', async () => {
    const result = setup({ layers: {}, activeLayerId: null });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());
    expect(converted).toBeNull();
  });

  it('returns null when active layer is not a bedrock layer', async () => {
    const result = setup({
      layers: { 'regular-layer': makeNonBedrockLayer('regular-layer') },
      activeLayerId: 'regular-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());
    expect(converted).toBeNull();
  });

  it('returns null when there is more than one layer (stack > 1)', async () => {
    const result = setup({
      layers: {
        'bedrock-layer': makeLayer('bedrock-layer'),
        'layer-2': makeNonBedrockLayer('layer-2'),
      },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());
    expect(converted).toBeNull();
  });

  it('returns null when bedrock layer has no bitmap or tmpCanvas', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer', { bitmap: null, tmpCanvas: null }) },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());
    expect(converted).toBeNull();
  });

  it('uses the temporary canvas when the bedrock bitmap is absent', async () => {
    const result = setup({
      layers: {
        'bedrock-layer': makeLayer('bedrock-layer', {
          bitmap: null,
          tmpCanvas: new OffscreenCanvas(800, 600),
        }),
      },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());

    expect(converted).not.toBeNull();
    expect(converted!.source?.kind).toBe('image');
  });

  it('converts bedrock layer to image layer on success', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer') },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());

    expect(converted).not.toBeNull();
    expect(converted!.isBedrock).toBe(false);
    expect(converted!.name).toBe('Background 1');
    expect(converted!.source?.kind).toBe('image');
    expect(converted!.source).toBeDefined();

    expect(mockStoreAdoptLayerBitmaps).toHaveBeenCalledTimes(1);
    expect(mockDrawLayersToCanvas).toHaveBeenCalledTimes(1);
  });

  it('uses the provided id when no active layer is selected', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer') },
      activeLayerId: null,
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer('bedrock-layer'));

    expect(converted).not.toBeNull();
    expect(converted!.id).toBe('bedrock-layer');
  });

  it('preserves bedrock layer name and position in converted layer', async () => {
    const customPos = { x: 100, y: 50, width: 400, height: 300 };
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer', { name: 'Custom Background', pos: customPos }) },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());

    expect(converted!.name).toBe('Custom Background 1');
    expect(converted!.pos).toEqual(customPos);
  });

  it('sets isBedrock to false on the converted layer source', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer') },
      activeLayerId: 'bedrock-layer',
    });

    const converted = await act(async () => result.current.layers.convertBedrockLayer());

    expect(converted!.source?.kind).toBe('image');
    expect(converted!.source).toMatchObject({ isBedrock: false });
  });

  it('registers the new layer bitmap with adoptLayerBitmaps', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer') },
      activeLayerId: 'bedrock-layer',
    });

    await act(async () => result.current.layers.convertBedrockLayer());

    expect(mockStoreAdoptLayerBitmaps).toHaveBeenCalledTimes(1);
  });

  it('dispatches history entry with new layer action', async () => {
    const result = setup({
      layers: { 'bedrock-layer': makeLayer('bedrock-layer') },
      activeLayerId: 'bedrock-layer',
    });

    await act(async () => result.current.layers.convertBedrockLayer());

    const historyEntry = result.current.store.history.find((h) => h.actionName === 'new layer');
    expect(historyEntry).toBeDefined();
    expect(historyEntry!.layerSource?.kind).toBe('image');
    expect(historyEntry!.layerId).toBeDefined();
  });
});
