import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { AutoSaveProvider, useAutoSave } from '../AutoSaveContext.tsx';
import type { AutosaveMetadata, AutosaveRecord } from '../autosave-storage.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { Size } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { ToolName } from '../tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';

const TOTAL_SIZE: Size = { width: 800, height: 600 };
const DOCUMENT_FRAME: DocumentFrame = { x: 0, y: 0, width: 800, height: 600 };
const DOCUMENT_ID = 'test-doc-id';

const baseMetadata: AutosaveMetadata = {
  fileName: 'test.psd',
  documentId: DOCUMENT_ID,
  documentRevision: 1,
  branchRevision: 0,
  historyIndex: 0,
  toolName: 'reposition' as ToolName,
  color: '#000000',
  backgroundColor: '#ffffff',
  totalSize: TOTAL_SIZE,
  documentFrame: DOCUMENT_FRAME,
  savedAt: Date.now(),
};

function createTextLayer(args: TextToolArgs, pos: Layer['pos']): Layer {
  return {
    id: 'text-layer-1',
    name: 'Text',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    presentationBounds: null,
    source: { kind: 'tool', args, pos },
    operations: [],
  };
}

const {
  storeState,
  savePsdMock,
  loadPsdMock,
  saveAutosaveMock,
  loadAutosaveMock,
  clearAutosaveMock,
  isAutosaveAvailableMock,
  commitDirtyToolMock,
  getLayersForAutosaveMock,
  currentToolState,
  setImageFromUploadMock,
} = vi.hoisted(() => ({
  storeState: {
    hasImage: true,
    hasUnsavedChanges: false,
    fileName: 'test.psd',
    totalSize: { width: 800, height: 600 } as Size,
    documentFrame: { x: 0, y: 0, width: 800, height: 600 } as DocumentFrame,
    documentId: 'test-doc-id',
    documentRevision: 1,
    branchRevision: 0,
    historyIndex: 0,
    toolName: 'reposition' as ToolName,
    color: '#000000',
    backgroundColor: '#ffffff',
    layers: {} as LayersRecord,
  },
  savePsdMock: vi.fn(),
  loadPsdMock: vi.fn(),
  saveAutosaveMock: vi.fn(),
  loadAutosaveMock: vi.fn(),
  clearAutosaveMock: vi.fn(),
  isAutosaveAvailableMock: vi.fn(),
  commitDirtyToolMock: vi.fn(),
  getLayersForAutosaveMock: vi.fn(),
  currentToolState: { toolArgs: { toolName: 'reposition' } as Record<string, unknown> },
  setImageFromUploadMock: vi.fn(),
}));

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [
    {
      hasImage: storeState.hasImage,
      hasUnsavedChanges: storeState.hasUnsavedChanges,
      fileName: storeState.fileName,
      totalSize: storeState.totalSize,
      documentFrame: storeState.documentFrame,
      documentId: storeState.documentId,
      documentRevision: storeState.documentRevision,
      branchRevision: storeState.branchRevision,
      historyIndex: storeState.historyIndex,
      toolName: storeState.toolName,
      color: storeState.color,
      backgroundColor: storeState.backgroundColor,
      layers: storeState.layers,
    },
    vi.fn(),
  ],
}));

vi.mock('../useLayer.ts', () => ({
  useLayers: () => ({ commitDirtyTool: commitDirtyToolMock, getLayersForAutosave: getLayersForAutosaveMock }),
}));

vi.mock('../useCurrentTool.tsx', () => ({
  useCurrentTool: () => currentToolState,
}));

vi.mock('../../hooks/useApp.ts', () => ({
  useApp: () => ({ setImageFromUpload: setImageFromUploadMock }),
}));

vi.mock('../psd-utils.ts', () => ({
  savePsd: savePsdMock,
  loadPsd: loadPsdMock,
}));

vi.mock('../autosave-storage.ts', () => ({
  loadAutosave: loadAutosaveMock,
  saveAutosave: saveAutosaveMock,
  clearAutosave: clearAutosaveMock,
  isAutosaveAvailable: isAutosaveAvailableMock,
}));

vi.mock('../../components/AutoSaveRecoveryBanner/AutoSaveRecoveryBanner.tsx', () => ({
  default: ({ metadata }: { metadata: AutosaveMetadata }) => (
    <div data-testid="mock-banner" data-filename={metadata.fileName} />
  ),
}));

type Api = ReturnType<typeof useAutoSave>;

const Probe = ({ onReady }: { onReady: (api: Api) => void }) => {
  onReady(useAutoSave());
  return null;
};

function resetState() {
  storeState.hasImage = true;
  storeState.hasUnsavedChanges = false;
  storeState.fileName = 'test.psd';
  storeState.totalSize = { width: 800, height: 600 };
  storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
  storeState.documentId = DOCUMENT_ID;
  storeState.documentRevision = 1;
  storeState.branchRevision = 0;
  storeState.historyIndex = 0;
  storeState.toolName = 'reposition';
  storeState.color = '#000000';
  storeState.backgroundColor = '#ffffff';
  storeState.layers = {};
  currentToolState.toolArgs = { toolName: 'reposition' };
}

function setupCommonMocks() {
  isAutosaveAvailableMock.mockReturnValue(true);
  commitDirtyToolMock.mockReturnValue({});
  getLayersForAutosaveMock.mockReturnValue({});
  savePsdMock.mockResolvedValue(new ArrayBuffer(8));
  saveAutosaveMock.mockResolvedValue(undefined);
  clearAutosaveMock.mockResolvedValue(undefined);
  setImageFromUploadMock.mockResolvedValue(undefined);
  loadPsdMock.mockResolvedValue({ size: TOTAL_SIZE, layers: {}, warnings: [] });
  loadAutosaveMock.mockResolvedValue(null);
}

interface MountResult {
  api: Api;
  rerender: () => void;
}

function mount(setup?: () => void): MountResult {
  resetState();
  setup?.();
  const api = {} as Api;
  const onReady = (value: Api) => {
    Object.assign(api, value);
  };
  const element = () => createElement(AutoSaveProvider, null, createElement(Probe, { onReady }));
  const { rerender: rawRerender } = render(element());
  return { api, rerender: () => rawRerender(element()) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AutoSaveProvider: context value', () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it('exposes isAutosaveAvailable from the storage module', () => {
    const { api } = mount();
    expect(api.isAutosaveAvailable).toBe(true);
  });

  it('exposes false when IndexedDB is unavailable', () => {
    isAutosaveAvailableMock.mockReturnValue(false);
    const { api } = mount();
    expect(api.isAutosaveAvailable).toBe(false);
  });

  it('starts with no autosave metadata and pendingAutosave false', () => {
    loadAutosaveMock.mockResolvedValue(null);
    const { api } = mount();
    expect(api.autosaveMetadata).toBe(null);
    expect(api.pendingAutosave).toBe(false);
  });
});

describe('AutoSaveProvider: initial load', () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it('loads existing autosave metadata on mount', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    const { api } = mount();
    await waitFor(() => expect(api.autosaveMetadata).toEqual(baseMetadata));
  });

  it('does not load autosave when IndexedDB is unavailable', () => {
    isAutosaveAvailableMock.mockReturnValue(false);
    mount();
    expect(loadAutosaveMock).not.toHaveBeenCalled();
  });
});

describe('AutoSaveProvider: save trigger', () => {
  beforeEach(() => {
    setupCommonMocks();
    vi.useFakeTimers();
  });

  it('debounces saves for 1 second', async () => {
    mount(() => {
      storeState.hasUnsavedChanges = true;
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(saveAutosaveMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it('debounces and saves active text drafts without a committed document change', async () => {
    const { rerender } = mount(() => {
      storeState.toolName = 'text';
      currentToolState.toolArgs = {
        toolName: 'text',
        text: 'first',
        rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(getLayersForAutosaveMock).not.toHaveBeenCalled();

    currentToolState.toolArgs = {
      toolName: 'text',
      text: 'latest',
      rect: { x1: 0, y1: 0, x2: 120, y2: 40 },
    };
    await act(async () => {
      rerender();
    });
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(getLayersForAutosaveMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getLayersForAutosaveMock).toHaveBeenCalledTimes(1);
    expect(savePsdMock).toHaveBeenCalledTimes(1);
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it('does not autosave an untouched text placeholder', async () => {
    mount(() => {
      storeState.toolName = 'text';
      currentToolState.toolArgs = {
        toolName: 'text',
        text: 'Lorem ipsum',
        placeholderUntouched: true,
        rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(getLayersForAutosaveMock).not.toHaveBeenCalled();
    expect(saveAutosaveMock).not.toHaveBeenCalled();
    expect(clearAutosaveMock).not.toHaveBeenCalled();
  });

  it('does not autosave an unchanged existing text edit', async () => {
    const sourceArgs: TextToolArgs = {
      toolName: 'text',
      text: 'Original',
      rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      align: 'left',
      bold: false,
      color: '#000000',
      fontFamily: 'Arial',
      fontSize: 32,
      italic: false,
      lineHeight: 1,
    };
    const pos = { x: 120, y: 75, width: 100, height: 40 };
    const layer = createTextLayer(sourceArgs, pos);

    mount(() => {
      storeState.toolName = 'text';
      storeState.layers = { [layer.id]: layer };
      currentToolState.toolArgs = {
        ...sourceArgs,
        editingLayerId: layer.id,
        rect: { x1: 120, y1: 75, x2: 220, y2: 115 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(getLayersForAutosaveMock).not.toHaveBeenCalled();
    expect(saveAutosaveMock).not.toHaveBeenCalled();
    expect(clearAutosaveMock).not.toHaveBeenCalled();
  });

  it('autosaves geometry-only edits to an existing text layer', async () => {
    const sourceArgs: TextToolArgs = {
      toolName: 'text',
      text: 'Original',
      rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      align: 'left',
      bold: false,
      color: '#000000',
      fontFamily: 'Arial',
      fontSize: 32,
      italic: false,
      lineHeight: 1,
    };
    const pos = { x: 120, y: 75, width: 100, height: 40 };
    const layer = createTextLayer(sourceArgs, pos);

    mount(() => {
      storeState.toolName = 'text';
      storeState.layers = { [layer.id]: layer };
      currentToolState.toolArgs = {
        ...sourceArgs,
        editingLayerId: layer.id,
        rect: { x1: 130, y1: 85, x2: 230, y2: 125 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(getLayersForAutosaveMock).toHaveBeenCalledTimes(1);
    expect(savePsdMock).toHaveBeenCalledTimes(1);
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it('clears an autosave when an uncommitted text draft is cancelled', async () => {
    const { rerender } = mount(() => {
      storeState.toolName = 'text';
      currentToolState.toolArgs = {
        toolName: 'text',
        text: 'draft',
        rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);

    currentToolState.toolArgs = { toolName: 'text', text: '', rect: null };
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it('does not persist a text draft when it is cancelled during serialization', async () => {
    let finishSerialization: (buffer: ArrayBuffer) => void = () => {
      throw new Error('Serialization did not start');
    };
    savePsdMock.mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finishSerialization = resolve;
        })
    );
    const { rerender } = mount(() => {
      storeState.toolName = 'text';
      currentToolState.toolArgs = {
        toolName: 'text',
        text: 'draft',
        rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(savePsdMock).toHaveBeenCalledTimes(1);

    currentToolState.toolArgs = { toolName: 'text', text: '', rect: null };
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishSerialization(new ArrayBuffer(8));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveAutosaveMock).not.toHaveBeenCalled();
  });

  it('clears autosave after a storage write already in progress', async () => {
    let finishStorageWrite: () => void = () => {
      throw new Error('Storage write did not start');
    };
    saveAutosaveMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishStorageWrite = resolve;
        })
    );
    const { rerender } = mount(() => {
      storeState.toolName = 'text';
      currentToolState.toolArgs = {
        toolName: 'text',
        text: 'draft',
        rect: { x1: 0, y1: 0, x2: 100, y2: 40 },
      };
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);

    currentToolState.toolArgs = { toolName: 'text', text: '', rect: null };
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(clearAutosaveMock).not.toHaveBeenCalled();

    await act(async () => {
      finishStorageWrite();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it('saves the dirty version again when an invalidated write finishes before a queued clear', async () => {
    let finishStorageWrite: () => void = () => {
      throw new Error('Storage write did not start');
    };
    let finishClear: () => void = () => {
      throw new Error('Autosave clear did not start');
    };
    let storedHistoryIndex: number | null = null;
    saveAutosaveMock
      .mockImplementationOnce(
        ({ metadata }: AutosaveRecord) =>
          new Promise<void>((resolve) => {
            finishStorageWrite = () => {
              storedHistoryIndex = metadata.historyIndex;
              resolve();
            };
          })
      )
      .mockImplementationOnce(async ({ metadata }: AutosaveRecord) => {
        storedHistoryIndex = metadata.historyIndex;
      });
    clearAutosaveMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishClear = resolve;
        })
    );

    const { rerender } = mount(() => {
      storeState.hasUnsavedChanges = true;
      storeState.historyIndex = 0;
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);

    storeState.hasUnsavedChanges = false;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(clearAutosaveMock).not.toHaveBeenCalled();

    await act(async () => {
      finishStorageWrite();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(storedHistoryIndex).toBe(0);
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);

    storeState.hasUnsavedChanges = true;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishClear();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(saveAutosaveMock).toHaveBeenCalledTimes(2);
    expect(storedHistoryIndex).toBe(0);
  });

  it('restores the current snapshot when a stale write finishes after reverting to a saved version', async () => {
    let storedHistoryIndex: number | null = null;
    let finishStorageWrite: () => void = () => {
      throw new Error('Storage write did not start');
    };
    saveAutosaveMock
      .mockImplementationOnce(async ({ metadata }: AutosaveRecord) => {
        storedHistoryIndex = metadata.historyIndex;
      })
      .mockImplementationOnce(
        ({ metadata }: AutosaveRecord) =>
          new Promise<void>((resolve) => {
            finishStorageWrite = () => {
              storedHistoryIndex = metadata.historyIndex;
              resolve();
            };
          })
      )
      .mockImplementationOnce(async ({ metadata }: AutosaveRecord) => {
        storedHistoryIndex = metadata.historyIndex;
      });

    const { rerender } = mount(() => {
      storeState.hasUnsavedChanges = true;
      storeState.historyIndex = 0;
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(storedHistoryIndex).toBe(0);

    storeState.historyIndex = 1;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(11_000);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(saveAutosaveMock).toHaveBeenCalledTimes(2);

    storeState.historyIndex = 0;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(storedHistoryIndex).toBe(0);

    await act(async () => {
      finishStorageWrite();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(saveAutosaveMock).toHaveBeenCalledTimes(3);
    expect(storedHistoryIndex).toBe(0);
  });

  it('does not save when hasImage is false', () => {
    mount(() => {
      storeState.hasImage = false;
      storeState.hasUnsavedChanges = true;
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(saveAutosaveMock).not.toHaveBeenCalled();
  });

  it('does not save when hasUnsavedChanges is false', () => {
    mount();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(saveAutosaveMock).not.toHaveBeenCalled();
  });

  it('clears autosave and resets metadata when saved', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    vi.useFakeTimers();
    const { api, rerender } = mount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toEqual(baseMetadata);

    storeState.hasUnsavedChanges = true;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toBe(null);

    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    await act(async () => {
      await Promise.resolve();
    });

    storeState.hasUnsavedChanges = false;
    await act(async () => {
      rerender();
      vi.advanceTimersByTime(10);
    });
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
    expect(api.autosaveMetadata).toBe(null);
  });

  it('does not clear autosave on initial mount', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    const { api } = mount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toEqual(baseMetadata);
    expect(clearAutosaveMock).not.toHaveBeenCalled();
  });

  it('dismisses banner when user starts editing', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    vi.useFakeTimers();
    const { api, rerender } = mount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toEqual(baseMetadata);

    storeState.hasUnsavedChanges = true;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toBe(null);
    expect(screen.queryByTestId('mock-banner')).not.toBeInTheDocument();
  });

  it('dismisses banner when document is replaced (new documentId)', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    const { api, rerender } = mount(() => {
      storeState.hasImage = false;
      storeState.documentId = 'old-doc';
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toEqual(baseMetadata);

    clearAutosaveMock.mockClear();

    storeState.hasImage = true;
    storeState.hasUnsavedChanges = false;
    storeState.documentId = 'new-doc';
    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
    expect(api.autosaveMetadata).toBe(null);
  });

  it('skips autosave when recovery is in progress', async () => {
    vi.useFakeTimers();

    const pendingPromise = new Promise<unknown>(() => {});
    loadAutosaveMock
      .mockResolvedValueOnce({ metadata: baseMetadata, buffer: new ArrayBuffer(8) } as AutosaveRecord)
      .mockReturnValueOnce(pendingPromise as unknown as AutosaveRecord | null);

    const { api, rerender } = mount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(api.autosaveMetadata).toEqual(baseMetadata);

    clearAutosaveMock.mockClear();
    saveAutosaveMock.mockClear();

    act(() => {
      api.recoverFromAutosave();
    });

    storeState.hasUnsavedChanges = true;
    await act(async () => {
      rerender();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saveAutosaveMock).not.toHaveBeenCalled();
  });

  it('sets pendingAutosave true during save, false after', async () => {
    const { api } = mount(() => {
      storeState.hasUnsavedChanges = true;
    });

    let resolveSave: () => void = () => {};
    saveAutosaveMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.pendingAutosave).toBe(true);

    await act(async () => {
      resolveSave();
    });
    expect(api.pendingAutosave).toBe(false);
  });
});

describe('AutoSaveProvider: recoverFromAutosave', () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it('loads, restores, and clears autosave on recovery', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    const { api } = mount(() => {
      storeState.hasImage = false;
    });

    await waitFor(() => expect(api.autosaveMetadata).toEqual(baseMetadata));

    const psdLayers: LayersRecord = {
      'layer-1': { id: 'layer-1', name: 'Layer 1' } as unknown as Layer,
    };
    loadPsdMock.mockResolvedValue({ size: TOTAL_SIZE, layers: psdLayers, warnings: [] });

    await act(async () => {
      await api.recoverFromAutosave();
    });

    expect(loadPsdMock).toHaveBeenCalledWith(new ArrayBuffer(8));
    expect(setImageFromUploadMock).toHaveBeenCalledWith({
      fileName: baseMetadata.fileName,
      document: { size: TOTAL_SIZE, layers: psdLayers, warnings: [] },
    });
    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
    expect(api.autosaveMetadata).toBe(null);
  });

  it('does nothing when no metadata exists', async () => {
    loadAutosaveMock.mockResolvedValue(null);
    const { api } = mount();
    await waitFor(() => expect(api.autosaveMetadata).toBe(null));

    await act(async () => {
      await api.recoverFromAutosave();
    });

    expect(loadPsdMock).not.toHaveBeenCalled();
    expect(setImageFromUploadMock).not.toHaveBeenCalled();
  });
});

describe('AutoSaveProvider: dismissAutosave', () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it('clears autosave and resets metadata', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    const { api } = mount();
    await waitFor(() => expect(api.autosaveMetadata).toEqual(baseMetadata));

    clearAutosaveMock.mockClear();
    await act(async () => {
      await api.dismissAutosave();
    });

    expect(clearAutosaveMock).toHaveBeenCalledTimes(1);
    expect(api.autosaveMetadata).toBe(null);
  });
});

describe('AutoSaveProvider: recovery banner', () => {
  beforeEach(() => {
    setupCommonMocks();
  });

  it('renders the banner when autosaveMetadata exists', async () => {
    loadAutosaveMock.mockResolvedValue({ metadata: baseMetadata, buffer: new ArrayBuffer(8) });
    mount();
    const banner = await screen.findByTestId('mock-banner');
    expect(banner).toHaveAttribute('data-filename', 'test.psd');
  });

  it('does not render the banner when autosaveMetadata is null', () => {
    loadAutosaveMock.mockResolvedValue(null);
    mount();
    expect(screen.queryByTestId('mock-banner')).not.toBeInTheDocument();
  });
});
