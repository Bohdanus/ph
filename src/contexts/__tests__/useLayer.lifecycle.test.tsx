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
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_OPACITY_ACTION,
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

function setupWithDocument() {
  const layer = makeLayer('edited', 0, {
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    },
  });
  const layers = { edited: layer };
  const { result } = setup({ layers, activeLayerId: layer.id });

  act(() => {
    result.current.dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'doc-layer-lifecycle',
        history: [
          {
            id: 'baseline',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: layer.id,
            documentSource: { layers, size, frame },
          },
        ],
        historyIndex: 0,
        updates: { layers, totalSize: size, documentFrame: frame, hasImage: true },
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

  it('commits the removal without throwing when the overlay has no 2d context', () => {
    // The `COMMIT_DOCUMENT_EDIT` dispatch runs before the overlay clear, so a throwing
    // overlay clear escapes a function that has already done its job. `removeLayer`
    // therefore shares the sibling `clearOverlay` guard in `src/contexts/useLayer.ts`,
    // which tolerates both a missing overlay canvas and an unavailable 2d context,
    // rather than asserting both hops on its own.
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });
    const overlay = result.current.store.toolOverlayRef.current;
    if (!overlay) throw new Error('expected an overlay canvas');
    const getContext = vi.spyOn(overlay, 'getContext').mockReturnValue(null);

    // The context really is unavailable, which is exactly what the guard tolerates.
    expect(overlay.getContext('2d')).toBeNull();

    expect(() => {
      act(() => {
        result.current.layers.removeLayer('only');
      });
    }).not.toThrow();

    act(() => undefined);
    // The overlay is still cleared through the shared path, and the removal the
    // dispatch already committed is not rolled back.
    expect(getContext).toHaveBeenCalledWith('2d');
    expect(Object.keys(result.current.store.layers)).toEqual([]);
    expect(result.current.store.history.at(-1)).toMatchObject({ actionName: REMOVE_ACTION, layerId: 'only' });
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

  it.each([
    ['bring-forward', { bottom: 0, middle: 3, top: 2 }],
    ['bring-to-front', { bottom: 0, middle: 3, top: 2 }],
    ['send-backward', { bottom: 0, middle: -1, top: 2 }],
    ['send-to-back', { bottom: 0, middle: -1, top: 2 }],
  ] as const)('arranges the active layer with %s through reorder history', (command, expected) => {
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), middle: makeLayer('middle', 1), top: makeLayer('top', 2) },
      activeLayerId: 'middle',
    });

    act(() => {
      result.current.layers.arrangeLayer(command);
    });

    expect(result.current.store.layers.bottom!.order).toBe(expected.bottom);
    expect(result.current.store.layers.middle!.order).toBe(expected.middle);
    expect(result.current.store.layers.top!.order).toBe(expected.top);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: 'middle',
    });
  });

  it('keeps the locked background below the stack when sending a layer to the back', () => {
    const { result } = setup({
      layers: {
        background: makeLayer('background', 0, { isBedrock: true }),
        middle: makeLayer('middle', 1),
        top: makeLayer('top', 2),
      },
      activeLayerId: 'top',
    });

    act(() => {
      result.current.layers.arrangeLayer('send-to-back');
    });

    expect(result.current.store.layers.background!.order).toBe(0);
    expect(result.current.store.layers.top!.order).toBe(1);
    expect(result.current.store.layers.middle!.order).toBe(3);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'top', afterWhichLayerId: 'background' },
    });
  });

  it.each([
    ['bedrock', { only: makeLayer('only', 0, { isBedrock: true }) }, 'only'],
    ['locked', { only: makeLayer('only', 0, { locked: true }) }, 'only'],
  ] as const)('does not arrange a %s active layer', (_kind, layers, activeLayerId) => {
    const { result } = setup({ layers, activeLayerId });

    act(() => {
      result.current.layers.arrangeLayer('bring-to-front');
    });

    expect(result.current.store.layers.only!.order).toBe(0);
    expect(result.current.store.history).toEqual([]);
  });

  it('sends a missing active layer to null', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.setActiveLayer(undefined);
    });

    expect(result.current.store.activeLayerId).toBeNull();
  });

  it('toggles visibility for an unknown layer without touching the document', () => {
    const { result } = setup({ layers: { only: makeLayer('only', 0) }, activeLayerId: 'only' });

    act(() => {
      result.current.layers.toggleVisibility('missing');
    });

    expect(result.current.store.layers.only!.visible).toBe(true);
    expect(result.current.store.history).toEqual([]);
  });

  it('sets opacity to zero and back to one through the opacity action', () => {
    const { result } = setupWithDocument();

    act(() => {
      result.current.layers.updateLayer('edited', { opacity: 0 }, SET_LAYER_OPACITY_ACTION);
    });
    expect(result.current.store.layers.edited!.opacity).toBe(0);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: SET_LAYER_OPACITY_ACTION,
      layerId: 'edited',
      args: { opacity: 0 },
    });
    expect(result.current.store.durableStatus).toBe('current');
    expect(result.current.store.durableDiagnostics).toEqual([]);
    expect(result.current.store.durableDocument!.history).toHaveLength(1);
    expect(result.current.store.durableDocument!.history[0]).toMatchObject({
      id: result.current.store.history.at(-1)!.id,
      operation: { kind: 'set-layer-properties', layerId: 'edited', patch: { opacity: 0 } },
    });
    expect(result.current.store.durableDocument!.cursor).toBe(0);

    act(() => {
      result.current.layers.updateLayer('edited', { opacity: 1 }, SET_LAYER_OPACITY_ACTION);
    });
    expect(result.current.store.layers.edited!.opacity).toBe(1);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: SET_LAYER_OPACITY_ACTION,
      layerId: 'edited',
      args: { opacity: 1 },
    });
    expect(result.current.store.durableDocument!.history).toHaveLength(2);
    expect(result.current.store.durableStatus).toBe('current');
    expect(result.current.store.durableDiagnostics).toEqual([]);
    expect(result.current.store.durableDocument!.history[0]).toMatchObject({
      id: result.current.store.history[1]!.id,
      operation: { kind: 'set-layer-properties', layerId: 'edited', patch: { opacity: 0 } },
    });
    expect(result.current.store.durableDocument!.history[1]).toMatchObject({
      id: result.current.store.history[2]!.id,
      operation: { kind: 'set-layer-properties', layerId: 'edited', patch: { opacity: 1 } },
    });
    expect(result.current.store.durableDocument!.cursor).toBe(1);
  });

  it('moves a layer to the bottom when the anchor is null', () => {
    const { result } = setup({
      layers: { bottom: makeLayer('bottom', 0), middle: makeLayer('middle', 1), top: makeLayer('top', 2) },
      activeLayerId: 'top',
    });

    act(() => {
      result.current.layers.moveLayerAfter('top', null);
    });

    const store = result.current.store;
    const orderOf = (id: string) => store.layers[id]!.order;
    expect(orderOf('top')).toBe(-1);
    expect(orderOf('bottom')).toBe(0);
    expect(orderOf('middle')).toBe(1);
    expect(store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: 'top',
      args: { layerToMoveId: 'top', afterWhichLayerId: null },
    });
  });

  it('returns null and leaves the layer untouched when the replacement source cannot be rendered', () => {
    const source = {
      kind: 'tool' as const,
      args: { toolName: 'shape', figure: 'rectangle', color: '#000000' } as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    };
    const { result } = setup({ layers: { edited: makeLayer('edited', 0, { source }) }, activeLayerId: 'edited' });

    const before = result.current.store.history.length;
    const replaced = result.current.layers.replaceLayerSource('edited', {
      kind: 'tool',
      args: { toolName: 'no-such-tool' } as unknown as ToolArgs,
      pos: { x: 0, y: 0, width: 40, height: 20 },
    });

    expect(replaced).toBeNull();
    expect(result.current.store.layers.edited!.source).toEqual(source);
    expect(result.current.store.history).toHaveLength(before);
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
    // The rect is NOT clamped to the document bounds: 900x650 is what the gesture asked for,
    // and the frame keeps all of it, so an 800x600 document is untouched in size and only
    // re-anchored at 100,50.
    expect(store.documentFrame).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(store.totalSize).toEqual({ width: 800, height: 600 });
    // Layer positions are world-space coordinates. The renderer and export path subtract the
    // document-frame origin when composing, so changing the frame must not translate the layer
    // record itself or a crop would move pixels twice.
    expect(store.layers.edited?.pos).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    expect(store.history.at(-1)).toMatchObject({
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'document',
      args: {
        previousFrame: frame,
        nextFrame: { x: 100, y: 50, width: 800, height: 600 },
      },
    });
    // An empty legacy timeline has a valid append cursor at zero, so the first
    // crop can publish a current durable projection without a baseline row.
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

  it('refuses a non-finite crop rectangle without publishing an invalid frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = true;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: Number.NaN, y2: 200 });
    });

    expect(applied).toBe(false);
    expect(result.current.store.documentFrame).toEqual(frame);
    expect(result.current.store.totalSize).toEqual(size);
    expect(result.current.store.history).toEqual([]);
    expect(warn).toHaveBeenCalledWith('applyDocumentCrop refused a non-finite crop rectangle');
    warn.mockRestore();
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

  it('grows the document past the right and bottom edge', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = false;
    act(() => {
      // 900x650 on an 800x600 document: 100px of new canvas on the right, 50px on the bottom.
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 900, y2: 650 });
    });

    expect(applied).toBe(true);
    const store = result.current.store;
    expect(store.documentFrame).toEqual({ x: 0, y: 0, width: 900, height: 650 });
    expect(store.totalSize).toEqual({ width: 900, height: 650 });
    // The commit carries the frame and nothing else, so the added band holds no pixels: OVR-1.
    expect(store.history.at(-1)).toMatchObject({
      actionName: SET_DOCUMENT_FRAME_ACTION,
      args: { previousFrame: frame, nextFrame: { x: 0, y: 0, width: 900, height: 650 } },
    });
  });

  it('anchors the frame negatively when the rect extends past the left and top edge', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    let applied = false;
    act(() => {
      // -100,-50 to 700,550: the extent is the document's own 800x600, only moved up and left.
      applied = result.current.layers.applyDocumentCrop({ x1: -100, y1: -50, x2: 700, y2: 550 });
    });

    expect(applied).toBe(true);
    const store = result.current.store;
    expect(store.documentFrame).toEqual({ x: -100, y: -50, width: 800, height: 600 });
    // The size is unchanged, which is what makes a negative origin legible: 800x600 of canvas,
    // with the pixels now sitting 100px in from its left edge and 50px down from its top.
    expect(store.totalSize).toEqual({ width: 800, height: 600 });
  });

  it('refuses a frame past the per-side ceiling, and records no history', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    // 32768x1 is 32768 pixels in area — a rounding error against the 16777216px area ceiling —
    // and 32768 pixels on one side against the 4096px per-side ceiling, so only the side arm can
    // refuse it. It is the rect the guard refused at its own 32767 ceiling and it is still
    // refused: a lower ceiling must not turn a refused frame into an accepted one.
    // 20000x20000 is over both ceilings now (20000 > 4096, and 400,000,000 > 16777216), so it no
    // longer isolates the area arm and is kept for the outcome rather than for the arm.
    let overSide = true;
    let overBoth = true;
    act(() => {
      overSide = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 32768, y2: 1 });
    });
    act(() => {
      overBoth = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 20000, y2: 20000 });
    });

    expect(overSide).toBe(false);
    expect(overBoth).toBe(false);
    expect(result.current.store.documentFrame).toEqual(frame);
    expect(result.current.store.totalSize).toEqual(size);
    expect(result.current.store.history).toEqual([]);
    // A refusal the operator cannot see is indistinguishable from a crop that did nothing.
    const refusals = warn.mock.calls.map((call) => String(call[0]));
    expect(refusals.filter((message) => message.includes('32768x1'))).toHaveLength(1);
    expect(refusals.filter((message) => message.includes('20000x20000'))).toHaveLength(1);

    warn.mockRestore();
  });

  it('refuses a strip the area ceiling admits, so the side arm is the one that fires', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    // 16384x1 is 16384 pixels of area, a thousandth of the 16777216px area ceiling, so the area
    // arm cannot be what refuses it — 16384 pixels on one side is what does, against 4096. This
    // is the test that makes the two arms independent: the previous test passes just as well with
    // a side ceiling of 32767, because at that ceiling every over-area frame is also over a side
    // and the side arm is unreachable. The cost of the side arm is stated here: a 16384x1 frame is
    // legal on every browser this app targets, and it is refused.
    let applied = true;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 16384, y2: 1 });
    });

    expect(applied).toBe(false);
    expect(result.current.store.documentFrame).toEqual(frame);
    expect(result.current.store.history).toEqual([]);
    const refusals = warn.mock.calls.map((call) => String(call[0]));
    expect(refusals.filter((message) => message.includes('16384x1'))).toHaveLength(1);
    // The message names the ceilings it was measured against, not a single canvas that gave up.
    expect(refusals[0]).toContain('4096px per-side');
    expect(refusals[0]).toContain('16777216px area');

    warn.mockRestore();
  });

  it('accepts the largest frame the ceilings allow', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    // 4096 * 4096 === 16777216, so this frame sits on BOTH ceilings exactly and is the largest
    // legal one. The control for the three refusals above: a guard whose ceilings were set one
    // notch too tight — a `>` where the intent was `>=`, or an area ceiling below sqrt(2^24) —
    // refuses legal work and nothing else here would show it.
    let applied = false;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 4096, y2: 4096 });
    });

    expect(applied).toBe(true);
    const store = result.current.store;
    expect(store.documentFrame).toEqual({ x: 0, y: 0, width: 4096, height: 4096 });
    expect(store.totalSize).toEqual({ width: 4096, height: 4096 });
    expect(store.history.filter((entry) => entry.actionName === SET_DOCUMENT_FRAME_ACTION)).toHaveLength(1);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('applyDocumentCrop refused'))).toEqual([]);

    warn.mockRestore();
  });

  it('refuses one pixel over the area ceiling and names the attempted size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    // 4097x4096 is 16781312 pixels: 4096 over the area ceiling, and one pixel over the side
    // ceiling as well. Both arms are over, and that is the arithmetic of a 4096 side ceiling
    // rather than a gap in the guard: no frame can be over the area while inside the sides,
    // because 4096 * 4096 IS the area ceiling. The area arm is therefore subsumed, the side arm
    // carries every refusal, and both are kept so the budget and the box it is spent in stay
    // written down next to each other.
    let applied = true;
    act(() => {
      applied = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 4097, y2: 4096 });
    });

    expect(applied).toBe(false);
    expect(result.current.store.documentFrame).toEqual(frame);
    expect(result.current.store.totalSize).toEqual(size);
    expect(result.current.store.history).toEqual([]);
    const refusals = warn.mock.calls.map((call) => String(call[0]));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('4097x4096');
    expect(refusals[0]).toContain('16781312px');
    expect(refusals[0]).toContain('six canvas surfaces');

    warn.mockRestore();
  });

  it('composes a growth and a shrink the way two shrinks compose', () => {
    const { result } = setup({
      layers: { edited: makeLayer('edited', 0) },
      activeLayerId: 'edited',
      canvas: document.createElement('canvas'),
    });

    // Same composition the accumulating case above pins, with the first step going the other
    // way: the rect is relative to the current frame, so 100,50 is 100,50 of a 900x650 canvas.
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 900, y2: 650 });
    });
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 100, y1: 50, x2: 500, y2: 400 });
    });

    const store = result.current.store;
    expect(store.documentFrame).toEqual({ x: 100, y: 50, width: 400, height: 350 });
    expect(store.totalSize).toEqual({ width: 400, height: 350 });
    expect(store.history.filter((entry) => entry.actionName === SET_DOCUMENT_FRAME_ACTION)).toHaveLength(2);
  });
});
