import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import type { ImageLayerSource } from '../../contexts/layer-types.ts';
import type { StoreData } from '../../contexts/StoreContext.tsx';
import { OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';

function createMockStoreData(): StoreData {
  return {
    canvasRef: { current: null },
    toolOverlayRef: { current: null },
    rectOverlayRef: { current: null },
    containerRef: { current: null },
    currentArgs: {
      current: { toolName: 'draw', alpha: 0.9, lineWidth: 10, color: '#000000', points: [], penType: 'pen' },
    } as { current: ToolArgs },
    clearPreviewLayers: vi.fn(),
    previewLayers: { current: {} },
    hasImage: true,
    hasUnsavedChanges: false,
    fileName: '',
    totalSize: { width: 100, height: 100 },
    documentFrame: { x: 0, y: 0, width: 100, height: 100 },
    toolName: 'draw',
    layers: {},
    deletedLayers: {},
    history: [],
    historyIndex: 0,
    branchRevision: 0,
    activeLayerId: null,
    selections: [],
    activeSelectionId: null,
    selectionDraft: { status: 'idle' },
    selectionCleared: null,
    selectionClipboard: null,
  } as unknown as StoreData;
}

const mocks = vi.hoisted(() => ({
  useStore: vi.fn(),
  createBlankLayer: vi.fn(),
  createLayerFromBitmap: vi.fn(),
  commitDirtyTool: vi.fn(),
  adoptLayerBitmaps: vi.fn(),
}));
vi.mock('../../contexts/StoreContext.tsx', () => ({ useStore: mocks.useStore }));
vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => mocks }));

function setup(warnings: string[] = []) {
  // An image `source` is what makes the import a raster import: it is the field
  // the re-encoding step and the bitmap adoption both read. `source.bitmap` and
  // `bitmap` are the SAME object, because a published layer aliases its raster
  // through both. Each imported layer owns a distinct raster, as two rasters in
  // one PSD are two rasters.
  const makeLayer = (id: string, order: number) => {
    const raster = { width: 20, height: 30, close: vi.fn() } as ImageBitmap;
    return {
      id,
      name: `Imported ${id}`,
      isBedrock: false,
      tmpCanvas: null,
      bitmap: raster,
      source: {
        kind: 'image',
        bitmap: raster,
        name: `Imported ${id}`,
        isBedrock: true,
        size: { width: 20, height: 30 },
      } as ImageLayerSource,
      visible: false,
      opacity: 0.4,
      locked: true,
      blendMode: 'multiply' as const,
      order,
      pos: { x: -3, y: 7, width: 20, height: 30 },
      presentationBounds: null,
      operations: [],
    };
  };
  const layer = makeLayer('top', 9);
  const document: PsdDocument = {
    size: { width: 320, height: 180 },
    warnings,
    layers: { top: layer, bottom: makeLayer('bottom', 2) },
  };
  const state = {
    ...createMockStoreData(),
    canvasRef: { current: { width: 10, height: 10 } },
    toolOverlayRef: { current: { width: 10, height: 10 } },
    rectOverlayRef: { current: { width: 10, height: 10 } },
    currentArgs: { current: { toolName: 'text', text: 'Uncommitted' } } as { current: ToolArgs },
    layers: { old: layer },
    deletedLayers: { deleted: layer },
    history: [{ id: 'old' }],
    historyIndex: 4,
    selections: [{ id: 'old-selection' }],
    hasUnsavedChanges: true,
  };
  const dispatch = vi.fn();
  mocks.useStore.mockReturnValue([{ ...state, adoptLayerBitmaps: mocks.adoptLayerBitmaps }, dispatch]);
  return { document, state, dispatch, adoptLayerBitmaps: mocks.adoptLayerBitmaps };
}

describe('useApp PSD replacement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the document atomically with an independent, metadata-preserving history baseline', async () => {
    const { document, state, dispatch, adoptLayerBitmaps } = setup();
    const confirm = vi.spyOn(window, 'confirm');
    await useApp().setImageFromUpload({ fileName: 'design.psd', document });

    expect(confirm).not.toHaveBeenCalled();
    // The replacement, then the adoption of the rasters it published. The order is
    // load-bearing: the presentation scope is keyed by the owning document, so an
    // adoption published first would be filed under the outgoing document id and
    // closed by its release.
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['REPLACE_DOCUMENT']);
    expect(adoptLayerBitmaps).toHaveBeenCalledExactlyOnceWith([
      (document.layers.top.source as ImageLayerSource).bitmap,
      (document.layers.bottom.source as ImageLayerSource).bitmap,
    ]);
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(adoptLayerBitmaps.mock.invocationCallOrder[0]);
    const action = dispatch.mock.calls[0][0];
    expect(action).toEqual({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: expect.any(String),
        history: [
          {
            id: expect.any(String),
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: 'top',
            documentSource: { layers: document.layers, size: document.size, frame: { x: 0, y: 0, ...document.size } },
          },
        ],
        updates: {
          fileName: 'design.psd',
          documentFrame: { x: 0, y: 0, ...document.size },
          totalSize: document.size,
          layers: document.layers,
          activeLayerId: 'top',
          deletedLayers: {},
          hasImage: true,
          hasUnsavedChanges: false,
          toolName: 'reposition',
          selections: [],
          activeSelectionId: null,
          selectionDraft: { status: 'idle' },
          selectionCleared: null,
          selectionClipboard: null,
        },
      },
    });
    expect(state.currentArgs.current).toEqual({});
    for (const ref of [state.canvasRef, state.toolOverlayRef, state.rectOverlayRef]) {
      expect(ref.current).toEqual(document.size);
    }
    const baseline = action.payload.history[0].documentSource;
    expect(baseline.layers).not.toBe(document.layers);
    expect(baseline.size).not.toBe(document.size);
    for (const layer of Object.values(document.layers)) {
      expect(baseline.layers[layer.id]).not.toBe(layer);
      expect(baseline.layers[layer.id].pos).not.toBe(layer.pos);
      expect(baseline.layers[layer.id].bitmap).toBe(layer.bitmap);
    }
    document.layers.top.pos.x = 99;
    document.layers.top.name = 'Edited';
    document.size.width = 999;
    expect(baseline.layers.top).toMatchObject({ name: 'Imported top', pos: { x: -3 } });
    expect(baseline.size.width).toBe(320);
    expect(mocks.createBlankLayer).not.toHaveBeenCalled();
    expect(mocks.createLayerFromBitmap).not.toHaveBeenCalled();
    expect(mocks.commitDirtyTool).not.toHaveBeenCalled();
    // The adopted rasters are the imported layers' own, by identity: the
    // re-encoding above reuses an already immutable bitmap rather than copying it.
    const sourceBitmap = (id: 'top' | 'bottom') => (document.layers[id].source as ImageLayerSource).bitmap;
    expect(adoptLayerBitmaps).toHaveBeenCalledExactlyOnceWith([sourceBitmap('top'), sourceBitmap('bottom')]);
  });

  it('leaves the old document, dirty tool, and canvases untouched when warnings are declined', () => {
    const { document, state, dispatch } = setup(['Masks are unsupported']);
    const args = state.currentArgs.current;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    useApp().setImageFromUpload({ fileName: 'design.psd', document });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(document.warnings[0]));
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.currentArgs.current).toBe(args);
    for (const ref of [state.canvasRef, state.toolOverlayRef, state.rectOverlayRef]) {
      expect(ref.current).toEqual({ width: 10, height: 10 });
    }
    expect(mocks.commitDirtyTool).not.toHaveBeenCalled();
    expect(mocks.createLayerFromBitmap).not.toHaveBeenCalled();
  });

  it('opens the PSD after its warnings are accepted', async () => {
    const { document, dispatch } = setup(['Text is rasterized']);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await useApp().setImageFromUpload({ fileName: 'design.psd', document });
    expect(dispatch.mock.calls[0][0].type).toBe('REPLACE_DOCUMENT');
    expect(dispatch.mock.calls[0][0].payload.updates.layers).toEqual(document.layers);
  });

  it('closes every newly materialized raster when any layer conversion fails', async () => {
    const { document, dispatch, adoptLayerBitmaps } = setup();
    const canvases = Object.values(document.layers).map(() => ({ width: 20, height: 30 }) as OffscreenCanvas);
    Object.values(document.layers).forEach((layer, index) => {
      layer.bitmap = canvases[index] as unknown as ImageBitmap;
      (layer.source as ImageLayerSource).bitmap = canvases[index] as unknown as ImageBitmap;
    });
    const materialized = { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap;
    const conversionError = new Error('raster conversion failed');
    const createImageBitmap = vi.fn().mockResolvedValueOnce(materialized).mockRejectedValueOnce(conversionError);
    vi.stubGlobal('createImageBitmap', createImageBitmap);

    await expect(useApp().setImageFromUpload({ fileName: 'design.psd', document })).rejects.toBe(conversionError);

    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(materialized.close).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(adoptLayerBitmaps).not.toHaveBeenCalled();
  });

  it('discards an older PSD import that finishes after a newer import', async () => {
    const olderStore = setup();
    const olderApp = useApp();
    const makeMutable = (document: PsdDocument) => {
      const canvases = Object.values(document.layers).map(() => ({ width: 20, height: 30 }) as OffscreenCanvas);
      Object.values(document.layers).forEach((layer, index) => {
        layer.bitmap = canvases[index] as unknown as ImageBitmap;
        (layer.source as ImageLayerSource).bitmap = canvases[index] as unknown as ImageBitmap;
      });
      return canvases;
    };
    const olderCanvases = makeMutable(olderStore.document);
    let resolveOlderTop!: (bitmap: ImageBitmap) => void;
    let resolveOlderBottom!: (bitmap: ImageBitmap) => void;
    const olderTopPromise = new Promise<ImageBitmap>((resolve) => {
      resolveOlderTop = resolve;
    });
    const olderBottomPromise = new Promise<ImageBitmap>((resolve) => {
      resolveOlderBottom = resolve;
    });
    const olderRasters = [
      { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
      { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
    ];
    const newerRasters = [
      { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
      { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
    ];
    const newerStore = setup();
    const newerApp = useApp();
    const newerCanvases = makeMutable(newerStore.document);
    const conversions = new Map<OffscreenCanvas, Promise<ImageBitmap>>([
      [olderCanvases[0], olderTopPromise],
      [olderCanvases[1], olderBottomPromise],
      ...newerCanvases.map((canvas, index) => [canvas, Promise.resolve(newerRasters[index])] as const),
    ]);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((canvas: OffscreenCanvas) => conversions.get(canvas)!)
    );

    const olderImport = olderApp.setImageFromUpload({ fileName: 'older.psd', document: olderStore.document });
    await newerApp.setImageFromUpload({ fileName: 'newer.psd', document: newerStore.document });
    resolveOlderTop(olderRasters[0]);
    resolveOlderBottom(olderRasters[1]);
    await olderImport;

    expect(olderStore.dispatch).not.toHaveBeenCalled();
    expect(newerStore.dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        payload: expect.objectContaining({ updates: expect.objectContaining({ fileName: 'newer.psd' }) }),
      })
    );
    expect(olderRasters[0].close).toHaveBeenCalledOnce();
    expect(olderRasters[1].close).toHaveBeenCalledOnce();
    expect(newerRasters[0].close).not.toHaveBeenCalled();
    expect(newerRasters[1].close).not.toHaveBeenCalled();
  });

  it('retains the raster upload path rather than creating a PSD baseline', async () => {
    const { dispatch } = setup();
    mocks.createLayerFromBitmap.mockResolvedValue(true);
    const image = {
      width: 80,
      height: 40,
      src: '',
      complete: true,
      naturalWidth: 80,
      naturalHeight: 40,
    } as HTMLImageElement;
    await useApp().setImageFromUpload({ fileName: 'photo.png', image });
    expect(mocks.createLayerFromBitmap).toHaveBeenCalledExactlyOnceWith(
      {
        bitmap: image,
        name: 'photo.png',
        size: { width: 80, height: 40 },
        isBedrock: true,
      },
      true,
      expect.any(Function)
    );
    expect(mocks.createLayerFromBitmap.mock.calls[0][2]?.()).toBe(true);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_FILE_NAME', payload: 'photo.png' });
    expect(dispatch.mock.calls.every(([action]) => !action.payload?.history)).toBe(true);
  });

  it('does not resize or rename the document when a raster replacement is stale', async () => {
    const { document, state, dispatch } = setup();
    const app = useApp();
    let resolveRasterMaterialization!: (materialized: boolean) => void;
    const rasterMaterialization = new Promise<boolean>((resolve) => {
      resolveRasterMaterialization = resolve;
    });
    mocks.createLayerFromBitmap.mockImplementation(async (_params, _replaceDocument, isCurrentRequest) => {
      const materialized = await rasterMaterialization;
      return materialized && (isCurrentRequest?.() ?? true);
    });
    const image = {
      width: 80,
      height: 40,
      src: '',
      complete: true,
      naturalWidth: 80,
      naturalHeight: 40,
    } as HTMLImageElement;

    const staleRasterUpload = app.setImageFromUpload({ fileName: 'stale.png', image });
    await app.setImageFromUpload({ fileName: 'newer.psd', document });

    expect(mocks.createLayerFromBitmap.mock.calls[0][2]?.()).toBe(false);
    resolveRasterMaterialization(true);
    await staleRasterUpload;

    expect(state.canvasRef.current).toEqual({ width: 320, height: 180 });
    expect(state.toolOverlayRef.current).toEqual({ width: 320, height: 180 });
    expect(state.rectOverlayRef.current).toEqual({ width: 320, height: 180 });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'REPLACE_DOCUMENT',
        payload: expect.objectContaining({ updates: expect.objectContaining({ fileName: 'newer.psd' }) }),
      })
    );
  });

  it('clears the active selection and records the clear in history when switching tools', () => {
    const state = {
      ...createMockStoreData(),
      currentArgs: {
        current: { toolName: 'draw', alpha: 0.9, lineWidth: 10, color: '#000000', points: [], penType: 'pen' },
      },
      layers: {},
      deletedLayers: {},
      history: [],
      historyIndex: 0,
      selections: [{ id: 'selection-1', isActive: true, points: [], pos: { x: 0, y: 0, width: 5, height: 5 } }],
      activeSelectionId: 'selection-1',
      toolName: 'draw',
      hasUnsavedChanges: false,
      selectionDraft: { status: 'idle' as const },
      selectionCleared: null,
      selectionClipboard: null,
    };
    const dispatch = vi.fn();
    mocks.useStore.mockReturnValue([state, dispatch]);

    useApp().goToTool('blur');

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          historyItem: expect.objectContaining({
            actionName: 'selection',
            args: expect.objectContaining({
              previousSelectionState: expect.objectContaining({ activeSelectionId: 'selection-1' }),
              nextSelectionState: expect.objectContaining({ activeSelectionId: null }),
            }),
          }),
        }),
      })
    );
  });
});
