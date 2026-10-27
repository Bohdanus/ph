import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BlankImageParams, ToolArgs } from '../tool-types.ts';
import { toolProcessors, type ToolResult } from '../../tools/toolProcessors.ts';
import { NEW_LAYER_ACTION } from '../../util/constants.ts';

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
    presentationBounds: null,
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

function shapeArgs(overrides: Partial<ToolArgs> = {}): ToolArgs {
  return {
    toolName: 'shape',
    figure: 'rectangle',
    alpha: 1,
    color: '#000000',
    backgroundColor: null,
    lineWidth: 2,
    ...overrides,
  } as ToolArgs;
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers createLayerFromTool with explicit pos', () => {
  it('keeps the explicit document position and publishes the layer', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi
      .spyOn(toolProcessors.shape, 'imageProcessor')
      .mockReturnValue(() => [raster] as unknown as ToolResult);
    const { result } = setup({ layers: { existing: makeLayer('existing', 0) }, activeLayerId: 'existing' });

    let created: Layer | null = null;
    act(() => {
      created = result.current.layers.createLayerFromTool({
        args: shapeArgs(),
        pos: { x: 5, y: 6, width: 20, height: 10 },
      });
    });

    const newLayer = created as Layer | null;
    expect(newLayer).not.toBeNull();
    expect(newLayer!.pos).toEqual({ x: 5, y: 6, width: 20, height: 10 });
    expect(newLayer!.tmpCanvas).toBe(raster);
    const store = result.current.store;
    expect(store.layers[newLayer!.id]).toBeDefined();
    expect(store.activeLayerId).toBe(newLayer!.id);
    expect(store.history[0]).toMatchObject({ actionName: NEW_LAYER_ACTION, layerId: newLayer!.id });
    processor.mockRestore();
  });
});

describe('useLayers createLayerFromTool rect validation', () => {
  it('throws a named error when rect is missing', () => {
    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.layers.createLayerFromTool({ args: shapeArgs() });
      });
    }).toThrow('Missing rect in args');

    expect(result.current.store.history).toEqual([]);
    expect(Object.keys(result.current.store.layers)).toEqual([]);
  });

  it('throws a named error when rect is explicitly null', () => {
    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.layers.createLayerFromTool({ args: shapeArgs({ rect: null }) });
      });
    }).toThrow('Missing rect in args');
  });
});

describe('useLayers beginTextLayerEdit', () => {
  it('starts an edit session on a text layer by clearing its raster preview', () => {
    const raster = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.text, 'imageProcessor')
      .mockReturnValue(() => [raster] as unknown as ToolResult);
    const { result } = setup();

    const textArgs = {
      toolName: 'text',
      align: 'left' as const,
      bold: false,
      color: '#000000',
      fontFamily: 'Arial',
      fontSize: 64,
      italic: false,
      lineHeight: 1.2,
      text: 'Hello',
      rect: { x1: 0, y1: 0, x2: 40, y2: 20 },
    } as ToolArgs;

    let created: Layer | null = null;
    act(() => {
      created = result.current.layers.createLayerFromTool({ args: textArgs });
    });
    const textLayer = created as Layer | null;
    expect(textLayer).not.toBeNull();
    expect(textLayer!.source?.kind).toBe('tool');

    act(() => {
      result.current.layers.beginTextLayerEdit(textLayer!.id);
    });

    const preview = result.current.store.previewLayers.current[textLayer!.id];
    expect(preview).toBeDefined();
    expect(preview?.layer.id).toBe(textLayer!.id);
    expect(preview?.layer.bitmap).toBeNull();
    expect(preview?.layer.tmpCanvas).toBeNull();
    expect(preview?.toolArgs).toBeUndefined();
    processor.mockRestore();
  });
});

describe('useLayers createBlankLayer append', () => {
  const blankParams: BlankImageParams = {
    color: '#ff0000',
    opacity: 1,
    isBedrock: true,
    size: { width: 32, height: 16 },
  };

  it('appends a blank layer without replacing the document', async () => {
    const { result } = setup({ layers: { existing: makeLayer('existing', 0) }, activeLayerId: 'existing' });

    act(() => {
      result.current.layers.createBlankLayer(blankParams, false);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    const created = store.layers[store.activeLayerId!]!;
    expect([...Object.keys(store.layers)].sort()).toEqual(['existing', created.id].sort());
    expect(store.activeLayerId).toBe(created.id);
    expect(created.name).toBe('Blank 1');
    expect(created.pos).toEqual({ x: 0, y: 0, width: 32, height: 16 });
    expect(store.history).toHaveLength(1);
    expect(store.history[0]).toMatchObject({ actionName: NEW_LAYER_ACTION, layerId: created.id });
    expect(store.documentId).toBe('uninitialized');
    expect(store.hasUnsavedChanges).toBe(true);
  });
});
