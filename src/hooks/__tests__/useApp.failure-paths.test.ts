import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp, type UseAppType } from '../useApp.ts';
import { createMockImageBitmap } from '@/__tests__/fixtures/canvas.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';
import { SELECTION_ACTION } from '../../util/constants.ts';
import type { Selection } from '../../contexts/general-types.ts';
import type { ImageLayerSource, Layer } from '../../contexts/layer-types.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import type { ImageUploadResponse } from '../../contexts/useFile.tsx';

/**
 * Failure paths and rejection surface of `useApp`: the paths where an async
 * import or a tool switch can fail, and whether a failure that the caller
 * ignores escapes as an unhandled rejection instead of being swallowed.
 */
const harness = vi.hoisted(() => ({
  state: {
    canvasRef: { current: null as HTMLCanvasElement | null },
    toolOverlayRef: { current: null as HTMLCanvasElement | null },
    rectOverlayRef: { current: null as HTMLCanvasElement | null },
    currentArgs: { current: {} as Record<string, unknown> },
    toolName: 'reposition' as ToolName,
    activeSelectionId: null as string | null,
    selections: [] as Selection[],
    selectionCleared: null as { status: string; version: number } | null,
    clearPreviewLayers: vi.fn(),
  },
  dispatch: vi.fn(),
  adoptLayerBitmaps: vi.fn(),
  layerMocks: {
    createBlankLayer: vi.fn(),
    createLayerFromBitmap: vi.fn(),
    commitDirtyTool: vi.fn(),
  },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ ...harness.state, adoptLayerBitmaps: harness.adoptLayerBitmaps }, harness.dispatch],
}));

vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => harness.layerMocks }));

function createImage(width: number, height: number): HTMLImageElement {
  const image = document.createElement('img');
  image.width = width;
  image.height = height;
  return image;
}

/** A PSD whose only layer carries a mutable (closable) raster source. */
function createMutablePsdDocument(): PsdDocument {
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 30;
  const source: ImageLayerSource = {
    kind: 'image',
    bitmap: canvas,
    isBedrock: true,
    size: { width: 20, height: 30 },
  };
  const layer: Layer = createMockLayer({
    id: 'top',
    order: 1,
    pos: { x: 0, y: 0, width: 20, height: 30 },
    bitmap: canvas,
    source,
  });

  return { size: { width: 20, height: 30 }, warnings: [], layers: { top: layer } };
}

/** A PSD whose only layer already owns a closable (immutable) raster source. */
function createPsdDocument(): PsdDocument {
  const layer = createMockLayer({
    id: 'top',
    order: 1,
    pos: { x: 0, y: 0, width: 20, height: 30 },
    bitmap: createMockImageBitmap(20, 30),
  });

  return { size: { width: 20, height: 30 }, warnings: [], layers: { top: layer } };
}

function useUploadPsd(): Promise<void> {
  return useApp().setImageFromUpload({ fileName: 'design.psd', document: createMutablePsdDocument() });
}

describe('useApp failure paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.canvasRef.current = null;
    harness.state.toolOverlayRef.current = null;
    harness.state.rectOverlayRef.current = null;
    harness.state.currentArgs.current = {};
    harness.state.toolName = 'reposition';
    harness.state.activeSelectionId = null;
    harness.state.selections = [];
    harness.state.selectionCleared = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a blank layer even when there is no canvas to resize', () => {
    const params: Parameters<UseAppType['setBlankImage']>[0] = {
      color: '#ff0000',
      opacity: 1,
      size: { width: 10, height: 20 },
      isBedrock: true,
    };

    useApp().setBlankImage(params);

    expect(harness.layerMocks.createBlankLayer).toHaveBeenCalledExactlyOnceWith({ ...params }, true);
  });

  it('resizes every owned canvas and clears the tool state before replacing the document', async () => {
    const canvas = document.createElement('canvas');
    const toolOverlay = document.createElement('canvas');
    const rectOverlay = document.createElement('canvas');
    harness.state.canvasRef.current = canvas;
    harness.state.toolOverlayRef.current = toolOverlay;
    harness.state.rectOverlayRef.current = rectOverlay;
    harness.state.currentArgs.current = { toolName: 'leftover' };

    await useApp().setImageFromUpload({ fileName: 'design.psd', document: createPsdDocument() });

    expect([canvas.width, canvas.height]).toEqual([20, 30]);
    expect([toolOverlay.width, toolOverlay.height]).toEqual([20, 30]);
    expect([rectOverlay.width, rectOverlay.height]).toEqual([20, 30]);
    expect(harness.state.currentArgs.current).toEqual({});
    expect(harness.state.clearPreviewLayers).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLACE_DOCUMENT',
        payload: expect.objectContaining({
          updates: expect.objectContaining({
            fileName: 'design.psd',
            hasImage: true,
            hasUnsavedChanges: false,
            toolName: 'reposition',
            selections: [],
          }),
        }),
      })
    );
    // The rasters the import built are adopted AFTER the replacement that names them: the
    // presentation scope is keyed by the owning document, so a registration published before
    // the replacement would be filed under the outgoing document id and closed by its release.
    expect(harness.dispatch.mock.calls.map((call) => call[0].type)).toEqual(['REPLACE_DOCUMENT']);
    expect(harness.adoptLayerBitmaps).toHaveBeenCalledOnce();
    expect(harness.dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      harness.adoptLayerBitmaps.mock.invocationCallOrder[0]
    );
  });

  it('marks the document as saved through a batched update', () => {
    useApp().handleImageSave({ fileName: 'out.png', format: 'image/png' });

    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'BATCH_UPDATES',
      payload: { fileName: 'out.png', hasUnsavedChanges: false },
    });
  });

  it('clears the active selection when a dirty tool is committed on the way to another tool', () => {
    harness.state.toolName = 'draw';
    harness.state.activeSelectionId = 'sel-1';
    harness.state.selections = [];

    useApp().goToTool('reposition');

    expect(harness.layerMocks.commitDirtyTool).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          updates: expect.objectContaining({
            selections: [],
            activeSelectionId: null,
            selectionCleared: { status: 'cleared', version: 1 },
          }),
          historyItem: expect.objectContaining({ actionName: SELECTION_ACTION }),
        }),
      })
    );
    expect(harness.dispatch).toHaveBeenLastCalledWith({ type: 'SET_TOOL_NAME', payload: 'reposition' });
  });

  it('does not clear the selection when the target tool is already active', () => {
    harness.state.toolName = 'reposition';
    harness.state.activeSelectionId = 'sel-1';

    useApp().goToTool('reposition');

    expect(harness.layerMocks.commitDirtyTool).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'SET_TOOL_NAME',
      payload: 'reposition',
    });
  });

  it('bumps the cleared version of an already-cleared selection', () => {
    harness.state.toolName = 'draw';
    harness.state.activeSelectionId = 'sel-1';
    harness.state.selectionCleared = { status: 'cleared', version: 4 };

    useApp().goToTool('reposition');

    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          updates: expect.objectContaining({ selectionCleared: { status: 'cleared', version: 5 } }),
        }),
      })
    );
  });

  it('rejects a PSD import whose mutable raster cannot be made immutable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);

    await expect(useUploadPsd()).rejects.toThrow('createImageBitmap is required to import a mutable raster source');

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.state.currentArgs.current).toEqual({});
  });

  it('rejects a PSD import when rasterising a mutable source fails, without replacing the document', async () => {
    const failure = new Error('decode failed');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(failure))
    );

    await expect(useUploadPsd()).rejects.toBe(failure);

    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a failed layer upload without renaming the document', async () => {
    const failure = new Error('bitmap upload failed');
    harness.layerMocks.createLayerFromBitmap.mockRejectedValue(failure);
    const upload: ImageUploadResponse = { fileName: 'photo.png', image: createImage(8, 4) };

    const pending = useApp().setImageFromUpload(upload);
    // Handled on the next macrotask, not immediately: the failure has to
    // survive a turn of the event loop before the caller sees it.
    const observed = expect(pending).rejects.toBe(failure);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    await observed;

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.state.clearPreviewLayers).not.toHaveBeenCalled();
  });
});
