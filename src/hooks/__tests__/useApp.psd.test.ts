import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import type { StoreData } from '../../contexts/StoreContext.tsx';
import { OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';

function createMockStoreData(): StoreData {
  return {
    canvasRef: { current: null },
    toolOverlayRef: { current: null },
    rectOverlayRef: { current: null },
    containerRef: { current: null },
    textareaRef: { current: null },
    canvasCtxRef: { current: null },
    currentArgs: {
      current: { toolName: 'draw', alpha: 0.9, lineWidth: 10, color: '#000000', points: [], penType: 'pen' },
    } as { current: ToolArgs },
    clearPreviewLayers: vi.fn(),
    previewLayers: { current: {} },
    replayCoordinator: { current: null },
    presentationMaterialization: { current: null },
    getReplayRevisionToken: vi.fn(),
    hasImage: true,
    hasUnsavedChanges: false,
    fileName: '',
    totalSize: { width: 100, height: 100 },
    documentFrame: { x: 0, y: 0, width: 100, height: 100 },
    toolName: 'draw',
    isToolDirty: false,
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
}));
vi.mock('../../contexts/StoreContext.tsx', () => ({ useStore: mocks.useStore }));
vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => mocks }));

function setup(warnings: string[] = []) {
  const layer = {
    id: 'top',
    name: 'Imported top',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 20, height: 30, close: vi.fn() } as ImageBitmap,
    visible: false,
    opacity: 0.4,
    locked: true,
    blendMode: 'multiply' as const,
    order: 9,
    pos: { x: -3, y: 7, width: 20, height: 30 },
    operations: [],
  };
  const document: PsdDocument = {
    size: { width: 320, height: 180 },
    warnings,
    layers: { top: layer, bottom: { ...layer, id: 'bottom', order: 2, pos: { ...layer.pos } } },
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
  mocks.useStore.mockReturnValue([state, dispatch]);
  return { document, state, dispatch };
}

describe('useApp PSD replacement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('replaces the document atomically with an independent, metadata-preserving history baseline', async () => {
    const { document, state, dispatch } = setup();
    const confirm = vi.spyOn(window, 'confirm');
    await useApp().setImageFromUpload({ fileName: 'design.psd', document });

    expect(confirm).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
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
          isToolDirty: false,
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
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].payload.updates.layers).toEqual(document.layers);
  });

  it('retains the raster upload path rather than creating a PSD baseline', () => {
    const { dispatch } = setup();
    const image = {
      width: 80,
      height: 40,
      src: '',
      complete: true,
      naturalWidth: 80,
      naturalHeight: 40,
    } as HTMLImageElement;
    useApp().setImageFromUpload({ fileName: 'photo.png', image });
    expect(mocks.createLayerFromBitmap).toHaveBeenCalledExactlyOnceWith(
      {
        bitmap: image,
        name: 'photo.png',
        size: { width: 80, height: 40 },
        isBedrock: true,
      },
      true
    );
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FILE_NAME', payload: 'photo.png' });
    expect(dispatch.mock.calls.every(([action]) => !action.payload?.history)).toBe(true);
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
