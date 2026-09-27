import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import type { BitmapSource } from '../general-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import type { ToolResult } from '../../tools/toolProcessors.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
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
  return { store, dispatch, layers: useLayers() };
}

function setup({
  layers = {},
  activeLayerId = null,
  canvas = null,
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

function drawnLayers(callIndex = 0): readonly Layer[] {
  return drawLayersToCanvas.mock.calls[callIndex]?.[1] ?? [];
}

function lastDrawnLayers(): readonly Layer[] {
  return drawnLayers(drawLayersToCanvas.mock.calls.length - 1);
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.unstubAllGlobals();
});

describe('useLayers mergeAllLayers', () => {
  it('collapses every layer into one image layer anchored to the document frame', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), top: makeLayer('top', 1) },
      activeLayerId: 'top',
      canvas,
      totalSize: { width: 200, height: 100 },
      documentFrame: { x: 30, y: 40, width: 200, height: 100 },
    });

    let merged: Layer | null = null;
    await act(async () => {
      merged = await result.current.layers.mergeAllLayers();
    });

    expect(merged).not.toBeNull();
    const store = result.current.store;
    // The merged record is the only layer left in the document.
    expect(Object.keys(store.layers)).toEqual([merged!.id]);
    expect(store.activeLayerId).toBe(merged!.id);
    expect(merged!.pos).toEqual({ x: 30, y: 40, width: 200, height: 100 });
    // The merged layer is named from the pre-merge stack, not from the
    // single-layer record that replaces it.
    expect(merged!.name).toBe('Merged Layer 2');
    expect(store.history.at(-1)).toMatchObject({
      actionName: MERGE_ACTION,
      layerId: merged!.id,
      args: { kind: 'image', name: 'Merged Layer', isBedrock: false },
    });
  });

  it('returns null and leaves the document untouched when no canvas is mounted', async () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only', canvas: null });

    let merged: Layer | null = null;
    await act(async () => {
      merged = await result.current.layers.mergeAllLayers();
    });

    expect(merged).toBeNull();
    expect(Object.keys(result.current.store.layers)).toEqual(['only']);
    expect(result.current.store.history).toEqual([]);
  });

  it('merges an empty document into a single layer without a prior source', async () => {
    const canvas = document.createElement('canvas');
    const { result } = setup({ canvas });

    let merged: Layer | null = null;
    await act(async () => {
      merged = await result.current.layers.mergeAllLayers();
    });

    expect(merged).not.toBeNull();
    expect(merged!.bitmap).not.toBeNull();
    expect(merged!.isBedrock).toBe(false);
    expect(result.current.store.activeLayerId).toBe(merged!.id);
  });
});

describe('useLayers cancelLayerPreview', () => {
  it('drops the active layer preview and redraws the committed layer set', () => {
    const committed = makeLayer('edited', 0);
    const { result } = setup({
      layers: { edited: committed },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'blur', radius: 5 } as ToolArgs,
      });
    });
    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['edited']);
    expect(drawnLayers().at(-1)!.operations).toHaveLength(1);

    act(() => {
      result.current.layers.cancelLayerPreview();
    });

    expect(result.current.store.previewLayers.current).toEqual({});
    // The cancelled preview never reached the store, and the redraw uses the
    // committed record with no retained operation.
    const drawn = lastDrawnLayers();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.operations).toEqual([]);
    expect(result.current.store.layers.edited.operations).toEqual([]);
  });

  it('cancels only the requested layer and leaves sibling previews intact', () => {
    const { result } = setup({
      layers: { a: makeLayer('a', 0), b: makeLayer('b', 1) },
      activeLayerId: 'a',
      canvas: document.createElement('canvas'),
    });

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'a', toolArgs: { toolName: 'blur', radius: 2 } as ToolArgs });
      result.current.layers.tempUpdateLayer({ id: 'b', toolArgs: { toolName: 'blur', radius: 3 } as ToolArgs });
    });
    expect(Object.keys(result.current.store.previewLayers.current).sort()).toEqual(['a', 'b']);

    act(() => {
      result.current.layers.cancelLayerPreview('a');
    });

    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['b']);
  });

  it('is a no-op for a null layer id and still redraws', () => {
    const committed = makeLayer('only', 0);
    const { result } = setup({
      layers: { only: committed },
      activeLayerId: null,
      canvas: document.createElement('canvas'),
    });

    act(() => {
      result.current.store.previewLayers.current = { only: { layer: { ...committed, name: 'preview' } } };
    });

    act(() => {
      result.current.layers.cancelLayerPreview(null);
    });

    // A null id cancels nothing: the preview ref is unchanged.
    expect(Object.keys(result.current.store.previewLayers.current)).toEqual(['only']);
    expect(lastDrawnLayers()[0]!.name).toBe('preview');
  });
});

describe('useLayers createLayerFromBitmap raster import', () => {
  const immutableBitmap = () => ({ width: 12, height: 8, close: vi.fn() }) as unknown as ImageBitmap;

  it('reuses an already-immutable ImageBitmap instead of copying it', async () => {
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
    const bitmap = immutableBitmap();
    const { result } = setup();

    await act(async () => {
      await result.current.layers.createLayerFromBitmap({
        bitmap,
        name: 'Imported.png',
        pos: { x: 5, y: 6, width: 12, height: 8 },
      });
    });

    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    const store = result.current.store;
    const layerId = store.activeLayerId!;
    expect(store.layers[layerId]!.bitmap).toBe(bitmap);
    expect(store.layers[layerId]!.pos).toEqual({ x: 5, y: 6, width: 12, height: 8 });
  });

  it('snapshots a mutable canvas source into an owned bitmap', async () => {
    const copied = immutableBitmap();
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap').mockResolvedValue(copied);
    const mutable = new OffscreenCanvas(12, 8);
    const { result } = setup();

    await act(async () => {
      await result.current.layers.createLayerFromBitmap({
        bitmap: mutable as unknown as BitmapSource,
        name: 'Canvas',
        pos: { x: 0, y: 0, width: 12, height: 8 },
      });
    });

    expect(createImageBitmapSpy).toHaveBeenCalledWith(mutable);
    const store = result.current.store;
    expect(store.layers[store.activeLayerId!]!.bitmap).toBe(copied);
  });

  it('rejects a mutable raster import when createImageBitmap is unavailable', async () => {
    const original = globalThis.createImageBitmap;
    // @ts-expect-error deliberately removing the global for the negative path
    delete globalThis.createImageBitmap;
    try {
      const { result } = setup();
      await act(async () => {
        await expect(
          result.current.layers.createLayerFromBitmap({
            bitmap: new OffscreenCanvas(4, 4) as unknown as BitmapSource,
            pos: { x: 0, y: 0, width: 4, height: 4 },
          })
        ).rejects.toThrow(/createImageBitmap is required to import a mutable raster source/);
      });
      expect(Object.keys(result.current.store.layers)).toEqual([]);
    } finally {
      globalThis.createImageBitmap = original;
    }
  });

  it('replaces the whole document for an opening import and clears stale previews', async () => {
    const { result } = setup({
      layers: { stale: makeLayer('stale', 0) },
      activeLayerId: 'stale',
      totalSize: { width: 10, height: 10 },
      documentFrame: documentFrameFromSize({ width: 10, height: 10 }),
    });

    act(() => {
      result.current.store.previewLayers.current = { stale: { layer: makeLayer('stale', 0) } };
      result.current.dispatch({
        type: 'COMMIT_SELECTION',
        payload: {
          id: 'sel-1',
          geometry: 'rectangle',
          sourceTool: 'rectangular-selection',
          lifecycle: 'committed',
          isActive: true,
          pos: { x: 0, y: 0, width: 4, height: 4 },
          points: [],
        },
      });
    });

    const previousDocumentId = result.current.store.documentId;
    await act(async () => {
      await result.current.layers.createLayerFromBitmap(
        { bitmap: immutableBitmap(), name: 'Opened.psd', pos: { x: 0, y: 0, width: 12, height: 8 } },
        true
      );
    });

    const store = result.current.store;
    expect(store.documentId).not.toBe(previousDocumentId);
    expect(store.documentRevision).toBe(1);
    expect(Object.keys(store.layers)).toHaveLength(1);
    expect(store.previewLayers.current).toEqual({});
    expect(store.selections).toEqual([]);
    expect(store.activeSelectionId).toBeNull();
    // An opening import is not an unsaved edit.
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.totalSize).toEqual({ width: 12, height: 8 });
  });

  it('sizes an opening bedrock import from its declared size rather than its position', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.layers.createLayerFromBitmap(
        {
          bitmap: immutableBitmap(),
          name: 'Bedrock.psd',
          isBedrock: true,
          size: { width: 640, height: 480 },
        },
        true
      );
    });

    const store = result.current.store;
    expect(store.totalSize).toEqual({ width: 640, height: 480 });
    expect(store.documentFrame).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(store.layers[store.activeLayerId!]!.isBedrock).toBe(true);
  });
});

describe('useLayers tempUpdateLayer tool boundaries', () => {
  it('retains a non-trapezoid transform as an affine operation instead of a preview canvas', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 0, rotate: 90 } as ToolArgs,
      });
    });

    const preview = result.current.store.previewLayers.current.edited!;
    expect(preview.layer.operations).toHaveLength(1);
    expect(preview.layer.operations[0]).toMatchObject({ kind: 'affine-transform', enabled: true });
    expect(preview.layer.tmpCanvas).toBeNull();
  });

  it('ignores a trapezoid transform that is combined with a retained affine change', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 40, rotate: 15 } as ToolArgs,
      });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
  });

  it('records a trapezoid-only transform as a raster preview', () => {
    const rasterized = new OffscreenCanvas(40, 20) as unknown as Layer['tmpCanvas'];
    const processor = vi
      .spyOn(toolProcessors.transform, 'imageProcessor')
      // The rasterized preview canvas is the observable outcome, so the returned
      // processor ignores its args instead of declaring an unused parameter.
      .mockReturnValue((() => [rasterized]) as unknown as (args: ToolArgs) => ToolResult);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 40 } as ToolArgs,
      });
    });

    const preview = result.current.store.previewLayers.current.edited!;
    expect(preview.layer.operations).toEqual([]);
    expect(preview.layer.tmpCanvas).toBe(rasterized);
    expect(processor).toHaveBeenCalled();
    processor.mockRestore();
  });

  it('contains a transform that throws instead of writing a preview', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 0, resizeX: 0 } as ToolArgs,
      });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
    expect(consoleError).toHaveBeenCalled();
  });

  it('previews a geometry tool as a position change and ignores a patch-free call', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.tempUpdateLayer({
        id: 'edited',
        toolArgs: { toolName: 'reposition', move: { x: 12, y: 14 } } as ToolArgs,
      });
    });
    expect(result.current.store.previewLayers.current.edited!.layer.pos).toEqual({
      x: 12,
      y: 14,
      width: 40,
      height: 20,
    });

    act(() => {
      result.current.store.previewLayers.current = {};
      result.current.layers.tempUpdateLayer({ id: 'edited', toolArgs: { toolName: 'reposition' } as ToolArgs });
    });
    expect(result.current.store.previewLayers.current).toEqual({});
  });

  it('refuses to preview a raster tool on a layer with no bitmap', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = setup({
      layers: { empty: makeLayer('empty', 0, { bitmap: null, tmpCanvas: null }) },
      activeLayerId: 'empty',
    });

    act(() => {
      result.current.layers.tempUpdateLayer({ id: 'empty', toolArgs: { toolName: 'brush', lineWidth: 3 } as ToolArgs });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
    expect(consoleError).toHaveBeenCalledWith('No active layer or bitmap to update preview');
  });

  it('ignores a preview request for an unknown layer or a null active layer', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: null });

    act(() => {
      result.current.layers.tempUpdateLayer({ toolArgs: { toolName: 'blur', radius: 1 } as ToolArgs });
      result.current.layers.tempUpdateLayer({
        id: 'missing',
        toolArgs: { toolName: 'blur', radius: 1 } as ToolArgs,
      });
    });

    expect(result.current.store.previewLayers.current).toEqual({});
  });
});

describe('useLayers updateLayerByTool', () => {
  it('commits a retained filter as one history entry and drops the preview from the layer', async () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'edited',
        toolArgs: { toolName: 'blur', radius: 3 } as ToolArgs,
      });
    });

    const store = result.current.store;
    expect(store.layers.edited!.operations).toEqual([
      expect.objectContaining({ enabled: true, args: { toolName: 'blur', radius: 3 } }),
    ]);
    expect(store.previewLayers.current).toEqual({});
    expect(store.history.at(-1)).toMatchObject({ actionName: TOOL_ACTION, layerId: 'edited' });
  });

  it('records no history for a document-scoped tool such as crop', async () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'edited',
        toolArgs: { toolName: 'crop', rect: { x1: 0, y1: 0, x2: 10, y2: 10 } } as ToolArgs,
      });
    });

    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.previewLayers.current).toEqual({});
  });

  it('does nothing for an unknown layer or a null active layer', async () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: null });

    await act(async () => {
      await result.current.layers.updateLayerByTool({ toolArgs: { toolName: 'blur', radius: 1 } as ToolArgs });
      await result.current.layers.updateLayerByTool({
        id: 'missing',
        toolArgs: { toolName: 'blur', radius: 1 } as ToolArgs,
      });
    });

    expect(result.current.store.history).toEqual([]);
    expect(result.current.store.layers.edited!.operations).toEqual([]);
  });

  it('discards an identity transform preview without publishing a layer or history entry', async () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    await act(async () => {
      await result.current.layers.updateLayerByTool({
        id: 'edited',
        toolArgs: { toolName: 'transform', trapezoid: 0, rotate: 0 } as ToolArgs,
      });
    });

    const store = result.current.store;
    // An identity transform carries no logical edit, so the deferred commit
    // publishes nothing: no operation, no history entry, no stale preview.
    expect(store.layers.edited!.operations).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.previewLayers.current).toEqual({});
  });
});

describe('useLayers layer mutation commands', () => {
  it('removes a layer, detaches its bitmaps and moves the active layer to the new top', () => {
    const layers: LayersRecord = {
      bottom: makeLayer('bottom', 0),
      middle: makeLayer('middle', 1),
      top: makeLayer('top', 2),
    };
    const { result } = setup({ layers, activeLayerId: 'top' });

    act(() => {
      result.current.layers.removeLayer('top');
    });

    const store = result.current.store;
    expect(Object.keys(store.layers).sort()).toEqual(['bottom', 'middle']);
    expect(store.deletedLayers.top).toMatchObject({ id: 'top', bitmap: null, tmpCanvas: null });
    expect(store.activeLayerId).toBe('middle');
    expect(store.history.at(-1)).toMatchObject({ actionName: REMOVE_ACTION, layerId: 'top' });
  });

  it('clears the active layer when the last remaining layer is removed', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.removeLayer('only');
    });

    expect(result.current.store.layers).toEqual({});
    expect(result.current.store.activeLayerId).toBeNull();
  });

  it('keeps the active layer when a different layer is removed', () => {
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), top: makeLayer('top', 1) },
      activeLayerId: 'bottom',
    });

    act(() => {
      result.current.layers.removeLayer('top');
    });

    expect(result.current.store.activeLayerId).toBe('bottom');
  });

  it('ignores a removal request for an unknown layer', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.removeLayer('missing');
    });

    expect(Object.keys(result.current.store.layers)).toEqual(['only']);
    expect(result.current.store.history).toEqual([]);
  });

  it('commits the removal and then throws when the overlay has no 2d context (PROD DEFECT, not fixed)', () => {
    // PROD DEFECT, not fixed: `src/contexts/useLayer.ts:378` uses
    // `toolOverlayRef.current!.getContext('2d')!` with no null guard, while the
    // sibling `clearOverlay` at `src/contexts/useLayer.ts:100` guards both with
    // `toolOverlayRef.current?.getContext('2d')` and an early return. When the
    // overlay is unmounted or its context is unavailable, `removeLayer` throws a
    // raw TypeError AFTER the dispatch has already committed the layer removal.
    // HANDOFF §23. Delete or invert this test in the same change that adds the
    // null guard; it would fail the moment `removeLayer` stopped throwing.
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });
    const overlay = result.current.store.toolOverlayRef.current;
    if (!overlay) throw new Error('expected an overlay canvas');
    vi.spyOn(overlay, 'getContext').mockReturnValue(null);

    // The context really is unavailable, which is exactly what the sibling
    // `clearOverlay` guard tolerates.
    expect(overlay.getContext('2d')).toBeNull();

    expect(() => {
      act(() => {
        result.current.layers.removeLayer('only');
      });
    }).toThrow(TypeError);

    // The dispatch at `useLayer.ts:362-375` already ran before the unguarded
    // overlay clear, so the removal is not rolled back by the throw.
    act(() => undefined);
    expect(Object.keys(result.current.store.layers)).toEqual([]);
  });

  it('toggles visibility with the matching history action in both directions', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 0) }, activeLayerId: 'edited' });

    act(() => {
      result.current.layers.toggleVisibility('edited');
    });
    expect(result.current.store.layers.edited!.visible).toBe(false);
    expect(result.current.store.history.at(-1)).toMatchObject({ actionName: HIDE_LAYER_ACTION });

    act(() => {
      result.current.layers.toggleVisibility('edited');
    });
    expect(result.current.store.layers.edited!.visible).toBe(true);
    expect(result.current.store.history.at(-1)).toMatchObject({ actionName: SHOW_LAYER_ACTION });
  });

  it('ignores a patch for an unknown layer', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.updateLayer('missing', { name: 'x' }, HIDE_LAYER_ACTION);
    });

    expect(result.current.store.layers.only!.name).toBe('only');
    expect(result.current.store.history).toEqual([]);
  });

  it('reorders a layer and records the reorder intent', () => {
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), middle: makeLayer('middle', 1), top: makeLayer('top', 2) },
      activeLayerId: 'top',
    });

    act(() => {
      result.current.layers.moveLayerAfter('bottom', 'top');
    });

    const store = result.current.store;
    const orderOf = (id: string) => store.layers[id]!.order;
    expect(orderOf('bottom')).toBe(3);
    expect(orderOf('top')).toBe(2);
    expect(store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: 'bottom',
      args: { layerToMoveId: 'bottom', afterWhichLayerId: 'top' },
    });
  });

  it('sends a missing active layer to null', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.setActiveLayer(undefined);
    });

    expect(result.current.store.activeLayerId).toBeNull();
  });
});

describe('useLayers applyDocumentCrop', () => {
  it('crops the document frame and records the frame change in history', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = false;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 100, y1: 50, x2: 900, y2: 650 });
    });

    expect(applied).toBe(true);
    const store = result.current.store;
    // The rect is clamped to the document bounds before the frame is derived.
    expect(store.documentFrame).toEqual({ x: 100, y: 50, width: 700, height: 550 });
    expect(store.totalSize).toEqual({ width: 700, height: 550 });
    expect(store.history.at(-1)).toMatchObject({
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'document',
      args: {
        previousFrame: frame,
        nextFrame: { x: 100, y: 50, width: 700, height: 550 },
      },
    });
    // The store converts the appended timeline, so the legacy edit is published.
    expect(store.durableStatus).toBe('current');
  });

  it('refuses a crop that trims to nothing and records no history', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = true;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 10, y1: 10, x2: 10, y2: 200 });
    });

    expect(applied).toBe(false);
    expect(result.current.store.documentFrame).toEqual(frame);
    expect(result.current.store.history).toEqual([]);
  });

  it('refuses a crop that resolves to the current frame', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = true;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: size.width, y2: size.height });
    });

    expect(applied).toBe(false);
    expect(result.current.store.history).toEqual([]);
  });

  it('accumulates crops relative to the already-cropped frame', () => {
    // The `console.warn` spy this test used to install was never asserted, and
    // `useLayer.ts` contains no `console.warn` call at all, so it existed only to swallow a
    // warning the author expected — and would have hidden a real one if one were ever added.
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 10, y1: 20, x2: 410, y2: 320 });
    });
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 5, y1: 5, x2: 105, y2: 105 });
    });

    expect(result.current.store.documentFrame).toEqual({ x: 15, y: 25, width: 100, height: 100 });
    expect(result.current.store.history.filter((entry) => entry.actionName === SET_DOCUMENT_FRAME_ACTION)).toHaveLength(
      2
    );
  });
});
