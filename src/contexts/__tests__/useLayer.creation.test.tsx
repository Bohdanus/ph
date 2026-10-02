import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { BlankImageParams, ToolArgs } from '../tool-types.ts';
import { toolProcessors, type ToolResult } from '../../tools/toolProcessors.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import { NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

// The affine boundary is the only way to reach the defensive guards in
// `tempUpdateLayer`; both wrappers delegate to the real implementation unless a
// test arms a failure, so ordinary behaviour stays authentic.
const affineControl = vi.hoisted(() => ({
  trapezoidCheckFailure: null as Error | null,
  transformResult: undefined as unknown,
}));

vi.mock('../affine-transform.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../affine-transform.ts')>();
  return {
    ...actual,
    isTrapezoidOnlyTransform: (...args: Parameters<typeof actual.isTrapezoidOnlyTransform>) => {
      if (affineControl.trapezoidCheckFailure) throw affineControl.trapezoidCheckFailure;
      return actual.isTrapezoidOnlyTransform(...args);
    },
    transformToolArgsToAffine: (...args: Parameters<typeof actual.transformToolArgsToAffine>) => {
      if (affineControl.transformResult !== undefined) return affineControl.transformResult as null;
      return actual.transformToolArgsToAffine(...args);
    },
  };
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
  affineControl.trapezoidCheckFailure = null;
  affineControl.transformResult = undefined;
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers createBlankLayer', () => {
  const blankParams: BlankImageParams = {
    color: '#ff0000',
    opacity: 1,
    isBedrock: true,
    size: { width: 32, height: 16 },
  };

  it('appends a blank layer to the existing document and records one new-layer entry', async () => {
    const { result } = setup({ layers: { existing: makeLayer('existing', 0) }, activeLayerId: 'existing' });

    act(() => {
      result.current.layers.createBlankLayer(blankParams);
    });
    // The bitmap materialisation is asynchronous, so drain the microtask queue
    // before asserting the published layer.
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
    // The document identity is unchanged: a blank layer is an edit, not a new document.
    expect(store.documentId).toBe('uninitialized');
    expect(store.hasUnsavedChanges).toBe(true);
  });

  it('replaces the whole document and records an unsaved change for a new blank image', async () => {
    const { result } = setup({ layers: { stale: makeLayer('stale', 0) }, activeLayerId: 'stale' });

    act(() => {
      result.current.store.previewLayers.current = { stale: { layer: makeLayer('stale', 0) } };
    });

    act(() => {
      result.current.layers.createBlankLayer(blankParams, true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    expect(store.documentId).not.toBe('uninitialized');
    expect(store.documentRevision).toBe(1);
    expect(Object.keys(store.layers)).toHaveLength(1);
    expect(store.activeLayerId).toBe(Object.keys(store.layers)[0]);
    expect(store.totalSize).toEqual({ width: 32, height: 16 });
    expect(store.documentFrame).toEqual({ x: 0, y: 0, width: 32, height: 16 });
    // A replacement document is a fresh baseline, so stale drafts are dropped.
    expect(store.previewLayers.current).toEqual({});
    expect(store.hasUnsavedChanges).toBe(true);
    expect(store.history).toHaveLength(1);
    expect(store.history[0]).not.toHaveProperty('documentSource');
    expect(store.durableDocument?.baseline.layers).toEqual([]);
    expect(store.durableDocument?.cursor).toBe(0);
  });

  it('opens a single image from its source-only history and replays one bedrock layer', async () => {
    const bitmap = { width: 24, height: 12, close: vi.fn() } as unknown as ImageBitmap;
    const { result } = setup({ layers: { stale: makeLayer('stale', 0) }, activeLayerId: 'stale' });
    const previousDocumentId = result.current.store.documentId;

    await act(async () => {
      await result.current.layers.createLayerFromBitmap(
        { bitmap, name: 'Opened.png', isBedrock: true, size: { width: 24, height: 12 } },
        true
      );
    });

    const store = result.current.store;
    const layer = store.layers[store.activeLayerId!]!;
    expect(store.documentId).not.toBe(previousDocumentId);
    expect(store.history[0]).not.toHaveProperty('documentSource');
    expect(store.durableDocument?.baseline.layers).toEqual([]);
    expect(store.durableDocument?.cursor).toBe(0);
    expect(store.durableDocument?.history[0]?.operation).toMatchObject({
      kind: 'create-layer',
      layer: { id: layer.id, isBedrock: true },
    });
  });

  it('does not paint a fully transparent blank layer', async () => {
    const { result } = setup();

    act(() => {
      result.current.layers.createBlankLayer({
        color: '#ff0000',
        opacity: 0,
        isBedrock: true,
        size: { width: 8, height: 8 },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    const store = result.current.store;
    const created = store.layers[store.activeLayerId!]!;
    expect(created.pos).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    // A zero-opacity source still produces a canvas and a bitmap, but the fill
    // is skipped, so the rasterised layer is transparent rather than coloured.
    expect(created.bitmap).not.toBeNull();
    expect(created.tmpCanvas).toBeNull();
  });

  it('rejects a blank source with a zero extent instead of creating a degenerate layer', () => {
    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.layers.createBlankLayer({
          color: '#ff0000',
          opacity: 1,
          isBedrock: true,
          size: { width: 0, height: 16 },
        });
      });
    }).toThrow('Layer width and height must be greater than 0');

    expect(Object.keys(result.current.store.layers)).toEqual([]);
    expect(result.current.store.history).toEqual([]);
  });
});

describe('useLayers createLayerFromTool geometry', () => {
  it('shifts an explicit canvas position into document space and clears the tool overlay', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({
      layers: { existing: makeLayer('existing', 0) },
      activeLayerId: 'existing',
      documentFrame: { x: 30, y: 40, width: 200, height: 100 },
      totalSize: { width: 200, height: 100 },
    });

    // The global canvas stub mints a fresh context per getContext() call, so pin
    // one to the overlay to observe the clear the hook performs.
    const overlay = document.createElement('canvas');
    const overlayContext = createMockCanvasContext({ canvas: overlay });
    vi.spyOn(overlay, 'getContext').mockReturnValue(overlayContext as unknown as CanvasRenderingContext2D);
    act(() => {
      result.current.store.toolOverlayRef.current = overlay;
    });

    let created: Layer | null = null;
    act(() => {
      created = result.current.layers.createLayerFromTool({
        args: shapeArgs(),
        pos: { x: 5, y: 6, width: 20, height: 10 },
      });
    });

    expect(overlayContext.clearRect).toHaveBeenCalledWith(0, 0, 200, 100);

    const newLayer = created as Layer | null;
    expect(newLayer).not.toBeNull();
    expect(newLayer!.pos).toEqual({ x: 35, y: 46, width: 20, height: 10 });
    expect(newLayer!.tmpCanvas).toBe(raster);
    const store = result.current.store;
    expect(store.layers[newLayer!.id]).toBeDefined();
    expect(store.activeLayerId).toBe(newLayer!.id);
    expect(store.history[0]).toMatchObject({ actionName: NEW_LAYER_ACTION, layerId: newLayer!.id });
    expect(processor).toHaveBeenCalledWith({ size: { x: 35, y: 46, width: 20, height: 10 } });
    processor.mockRestore();
  });

  it('derives a document position from a sorted rect and keeps the stored rect canvas relative', () => {
    const raster = new OffscreenCanvas(30, 40);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({
      documentFrame: { x: 30, y: 40, width: 200, height: 100 },
      totalSize: { width: 200, height: 100 },
    });

    const rect = { x1: 30, y1: 50, x2: 60, y2: 90 };
    let created: Layer | null = null;
    act(() => {
      created = result.current.layers.createLayerFromTool({ args: shapeArgs({ rect }) });
    });

    const newLayer = created as Layer | null;
    // The position is the rect's top-left, expressed in document space.
    expect(newLayer!.pos).toEqual({ x: 60, y: 90, width: 30, height: 40 });
    // The recorded rect is reduced against the document-space position, so it
    // becomes layer-local and starts at the origin.
    expect((newLayer!.source as { args: { rect: unknown } }).args.rect).toEqual({
      x1: 0,
      y1: 0,
      x2: 30,
      y2: 40,
    });
    expect(processor).toHaveBeenCalledWith({ size: { x: 60, y: 90, width: 30, height: 40 } });
    processor.mockRestore();
  });

  it('normalises an inverted rect instead of creating a layer with a negative extent', () => {
    // The producer sorts the tool rect before deriving the document position and
    // the layer-local replay rect (`useLayer.ts:349-360`).
    const raster = new OffscreenCanvas(30, 40);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const { result } = setup({ documentFrame: { x: 0, y: 0, width: 200, height: 100 } });

    let created: Layer | null = null;
    act(() => {
      created = result.current.layers.createLayerFromTool({
        args: shapeArgs({ rect: { x1: 60, y1: 90, x2: 30, y2: 50 } }),
      });
    });

    expect((created as Layer | null)!.pos).toEqual({ x: 30, y: 50, width: 30, height: 40 });
    processor.mockRestore();
  });

  it('throws a named error when neither a position nor a rect is supplied', () => {
    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.layers.createLayerFromTool({ args: shapeArgs() });
      });
    }).toThrow('Missing rect in args');

    expect(result.current.store.history).toEqual([]);
    expect(Object.keys(result.current.store.layers)).toEqual([]);
  });

  it('throws a named error when the supplied rect is explicitly null', () => {
    const { result } = setup();

    expect(() => {
      act(() => {
        result.current.layers.createLayerFromTool({ args: shapeArgs({ rect: null }) });
      });
    }).toThrow('Missing rect in args');
  });
});

describe('useLayers tempUpdateLayer defensive affine guards', () => {
  it('contains a throw from the trapezoid-only classifier instead of writing a preview', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    affineControl.trapezoidCheckFailure = new Error('malformed trapezoid args');
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 40 } as ToolArgs,
      });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
    expect(consoleError).toHaveBeenCalledWith(affineControl.trapezoidCheckFailure);
  });

  it('ignores a retained transform that yields no affine matrix instead of writing a preview', () => {
    affineControl.transformResult = null;
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 0, rotate: 30 } as ToolArgs,
      });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
  });

  it('contains a throw from the imageProcessor call a trapezoid-only transform reaches', () => {
    // `transform` is `commit: 'affine-operation'`, so a trapezoid-only transform is
    // neither a `layer-operation` nor a `geometry` commit and falls past both early
    // returns to the `imageProcessor` call -- the one every live pointer move takes.
    // `|trapezoid| >= 100` is `src/tools/transform.ts:97`'s own refusal, reached with no
    // mocking of the processor at all.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: {
          toolName: 'transform',
          trapezoid: 150,
          rotate: 0,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          resizeX: 100,
          resizeY: 100,
        } as ToolArgs,
      });
    });

    // The throw is contained, so no preview is written and it never reaches a React
    // event handler — the `imageProcessor` call is guarded, which is where every live
    // pointer move actually goes.
    expect(result.current.store.previewLayers.current).toEqual({});
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('100') }));
  });
});

describe('useLayers updateLayerByTool transform retention', () => {
  it('records a trapezoid-only raster preview as a raw tool entry because no affine matrix can be retained', async () => {
    const raster = new OffscreenCanvas(40, 20);
    const processor = vi
      .spyOn(toolProcessors.transform, 'imageProcessor')
      .mockReturnValue((() => [raster]) as unknown as (args: ToolArgs) => ToolResult);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    const toolArgs = { toolName: 'transform', trapezoid: 40 } as ToolArgs;
    await act(async () => {
      await result.current.layers.updateLayerByTool({ id: 'edited', toolArgs });
    });

    const store = result.current.store;
    // A trapezoid cannot be expressed as an affine matrix, so the raw tool args
    // are the only replayable record of the edit.
    expect(store.history.at(-1)).toMatchObject({ actionName: TOOL_ACTION, layerId: 'edited', args: toolArgs });
    expect(store.previewLayers.current).toEqual({});
    expect(processor).toHaveBeenCalled();
    processor.mockRestore();
  });
});
