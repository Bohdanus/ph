import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FileContextType, FileProvider, useFile } from '../useFile.tsx';
import { downloadBlob, saveImageToDisk } from '../image-load-save-utils.ts';
import { savePsd } from '../psd-utils.ts';
import { composeDurableDocument, DurableCompositionRefusal, type DurableComposite } from '../durable-compositor.ts';
import { replayDurableAtCursor, type DurableReplayResult } from '../durable-replay.ts';
import { renderExportCanvas } from '../export-canvas.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { Size } from '../general-types.ts';
import type { DurableDocument } from '../history-model.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { StoreData } from '../StoreContext.tsx';

const durableStore = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../StoreContext.tsx', () => ({
  useOptionalStore: () => durableStore.current,
}));

vi.mock('../asset-registry.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../asset-registry.ts')>();
  return { ...actual, getAssetRegistry: () => ({ getDocumentGeneration: () => 1 }) };
});

vi.mock('../durable-compositor.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../durable-compositor.ts')>();
  return { ...actual, composeDurableDocument: vi.fn() };
});

vi.mock('../durable-replay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../durable-replay.ts')>();
  return { ...actual, replayDurableAtCursor: vi.fn() };
});

vi.mock('../export-canvas.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../export-canvas.ts')>();
  return {
    ...actual,
    renderExportCanvas: vi.fn((_: LayersRecord, size: Size, frame?: DocumentFrame) => {
      const canvas = document.createElement('canvas');
      canvas.width = frame?.width ?? size.width;
      canvas.height = frame?.height ?? size.height;
      return canvas;
    }),
  };
});

vi.mock('../image-load-save-utils.ts', () => ({
  downloadBlob: vi.fn(),
  loadDocumentFile: vi.fn(),
  saveImageToDisk: vi.fn(),
}));
vi.mock('../psd-utils.ts', () => ({ savePsd: vi.fn() }));

const filesRef = { current: null as FileContextType | null };

function Consumer() {
  const files = useFile();
  useLayoutEffect(() => {
    filesRef.current = files;
  });
  return null;
}

const frame = { x: 4, y: 5, width: 100, height: 80 };
const size = { width: 100, height: 80 };

function durableFixture() {
  const snapshot = {
    id: 'durable-layer',
    name: 'Durable layer',
    isBedrock: false,
    visible: true,
    opacity: 1,
    fillOpacity: 1,
    locked: false,
    blendMode: 'source-over' as const,
    order: 0,
    pos: { x: 9, y: 10, width: 20, height: 16 },
    source: { kind: 'blank' as const, color: '#ffffff', opacity: 1, size: { width: 20, height: 16 } },
  };
  const durableDocument: DurableDocument = {
    documentId: 'durable-export-document',
    documentRevision: 3,
    branchRevision: 2,
    durableRevision: 7,
    baseline: {
      frame,
      layers: [snapshot],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: snapshot.id,
    },
    history: [],
    cursor: -1,
  };
  const replay: DurableReplayResult = {
    documentId: durableDocument.documentId,
    documentRevision: durableDocument.documentRevision,
    branchRevision: durableDocument.branchRevision,
    durableRevision: durableDocument.durableRevision,
    cursor: durableDocument.cursor,
    frame,
    totalSize: size,
    layers: { [snapshot.id]: { snapshot, operations: [] } },
    selections: { selections: [], activeSelectionId: null },
    activeLayerId: snapshot.id,
  };
  const bitmap = document.createElement('canvas');
  const bounds = { ...snapshot.pos };
  const release = vi.fn();
  const composite = {
    bitmap,
    frame,
    layers: {
      [snapshot.id]: {
        layerId: snapshot.id,
        bitmap,
        bounds,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        lease: { key: snapshot.id, bitmap, byteSize: 1, metadata: bounds, release: vi.fn() },
      },
    },
    takeLayers: () => ({ layers: {}, release: vi.fn() }),
    release,
  } as unknown as DurableComposite;
  const legacyLayers: LayersRecord = {
    [snapshot.id]: {
      id: snapshot.id,
      name: snapshot.name,
      isBedrock: snapshot.isBedrock,
      bitmap: null,
      tmpCanvas: null,
      visible: snapshot.visible,
      opacity: snapshot.opacity,
      locked: snapshot.locked,
      blendMode: snapshot.blendMode,
      order: snapshot.order,
      pos: { ...snapshot.pos },
      presentationBounds: null,
      operations: [],
    } as Layer,
  };
  const store = {
    durableStatus: 'current',
    durableDocument,
    // The opening-document history row is legacy index 0, but it maps to the
    // durable baseline cursor -1. Export must preserve that provenance instead
    // of comparing these two cursor domains directly.
    historyIndex: 0,
    documentId: durableDocument.documentId,
    documentRevision: durableDocument.documentRevision,
    branchRevision: durableDocument.branchRevision,
    layers: legacyLayers,
    totalSize: size,
    documentFrame: frame,
    durablePresentation: { status: 'durable', cursor: durableDocument.cursor, reason: null },
    renderSelector: {
      source: 'durable',
      documentId: durableDocument.documentId,
      documentRevision: durableDocument.documentRevision,
      branchRevision: durableDocument.branchRevision,
      historyCursor: 0,
      frame,
    },
    durableRenderProjection: {
      documentId: durableDocument.documentId,
      documentRevision: durableDocument.documentRevision,
      branchRevision: durableDocument.branchRevision,
      durableRevision: durableDocument.durableRevision,
      historyCursor: durableDocument.cursor,
      frame,
      status: 'durable',
      layers: legacyLayers,
    },
  } as unknown as StoreData;

  return { composite, legacyLayers, release, replay, store };
}

function exposeStore(store: StoreData): StoreData & { getCurrentState: () => StoreData } {
  const exposed: StoreData & { getCurrentState: () => StoreData } = {
    ...store,
    getCurrentState: () => ((durableStore.current as [StoreData, unknown] | null)?.[0] ?? exposed) as StoreData,
  };
  return exposed;
}

function renderWithStore(store: StoreData) {
  durableStore.current = [exposeStore(store), vi.fn()];
  return render(
    <FileProvider>
      <Consumer />
    </FileProvider>
  );
}

function rerenderWithStore(rerender: ReturnType<typeof render>['rerender'], store: StoreData) {
  durableStore.current = [exposeStore(store), vi.fn()];
  rerender(
    <FileProvider>
      <Consumer />
    </FileProvider>
  );
}

function save(format: 'image/png' | 'psd', exportFrame = frame) {
  act(() => {
    void filesRef.current!.openSaveImageDialog({
      fileName: 'drawing.png',
      layers: (durableStore.current as [StoreData])[0].layers,
      size,
      documentFrame: exportFrame,
    });
  });
  fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: format } });
  fireEvent.click(screen.getByTestId('save-dialog-submit-button'));
}

afterEach(() => {
  durableStore.current = null;
  filesRef.current = null;
  vi.clearAllMocks();
});

describe('FileProvider durable export adapter parity', () => {
  it.each([
    ['raster', 'image/png'],
    ['PSD', 'psd'],
  ] as const)(
    'routes a mapped legacy cursor through its current durable presentation for %s export',
    async (_, format) => {
      const { composite, release, replay, store } = durableFixture();
      vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
      vi.mocked(composeDurableDocument).mockResolvedValue(composite);
      vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
      vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
      renderWithStore(store);

      save(format);

      const expectedLayer = expect.objectContaining({
        id: 'durable-layer',
        bitmap: composite.layers['durable-layer']!.bitmap,
        tmpCanvas: null,
        pos: { x: 9, y: 10, width: 20, height: 16 },
      });
      if (format === 'psd') {
        await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
        expect(savePsd).toHaveBeenCalledWith(
          expect.objectContaining({ 'durable-layer': expectedLayer }),
          size,
          frame,
          expect.any(Function)
        );
      } else {
        await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
        expect(renderExportCanvas).toHaveBeenCalledWith(
          expect.objectContaining({ 'durable-layer': expectedLayer }),
          size,
          frame
        );
      }
      expect(replayDurableAtCursor).toHaveBeenCalledWith(store.durableDocument, -1);
      expect(release).toHaveBeenCalledExactlyOnceWith();
    }
  );

  it('keeps the legacy export when the current canvas presentation is not durable', async () => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    renderWithStore({
      ...store,
      durablePresentation: { status: 'legacy-fallback', cursor: -1, reason: 'unsupported-source' },
      renderSelector: { ...store.renderSelector, source: 'legacy' },
      durableRenderProjection: null,
    });

    save('image/png');

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    expect(composeDurableDocument).not.toHaveBeenCalled();
  });

  it('refuses an export when its staged frame differs from the open document frame', async () => {
    const { store } = durableFixture();
    renderWithStore(store);

    save('image/png', { ...frame, x: frame.x + 1 });

    expect(await screen.findByText(/document changed while the Save dialog was open/i)).toBeInTheDocument();
    expect(renderExportCanvas).not.toHaveBeenCalled();
  });

  it('keeps legacy export when the supplied layer map is not the captured durable presentation', async () => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    renderWithStore(store);

    act(() => {
      void filesRef.current!.openSaveImageDialog({
        fileName: 'drawing.png',
        layers: { ...legacyLayers },
        size,
        documentFrame: frame,
      });
    });
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'image/png' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    expect(composeDurableDocument).not.toHaveBeenCalled();
  });

  it('uses live layer records after a presentation-only promotion while the Save dialog is open', async () => {
    const { store } = durableFixture();
    // ImageBitmap-backed durable presentation caches have no getContext method;
    // promotions accept them as a CanvasImageSource too.
    const stagedBitmap = { width: 20, height: 16, close: vi.fn() } as unknown as ImageBitmap;
    const stagedLayer = {
      ...store.layers['durable-layer']!,
      bitmap: null,
      tmpCanvas: stagedBitmap,
    };
    const stagedLayers: LayersRecord = { ...store.layers, 'durable-layer': stagedLayer };
    const openedStore = { ...store, durableStatus: 'stale' as const, layers: stagedLayers };
    const promotedLayer = {
      ...stagedLayer,
      bitmap: { width: 20, height: 16, close: vi.fn() } as unknown as ImageBitmap,
      tmpCanvas: null,
    };
    const promotedLayers: LayersRecord = { ...stagedLayers, 'durable-layer': promotedLayer };
    renderWithStore(openedStore);

    act(() => {
      void filesRef.current!.openSaveImageDialog({
        fileName: 'drawing.png',
        layers: stagedLayers,
        size,
        documentFrame: frame,
      });
    });
    durableStore.current = [exposeStore({ ...openedStore, layers: promotedLayers }), vi.fn()];
    fireEvent.change(screen.getByTestId('save-dialog-format-select'), { target: { value: 'image/png' } });
    fireEvent.click(screen.getByTestId('save-dialog-submit-button'));

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(promotedLayers, size, frame);
    expect(composeDurableDocument).not.toHaveBeenCalled();
  });

  it('rebinds legacy PSD rasterization to live records after cache promotion during encoder import', async () => {
    const { store } = durableFixture();
    const stagedLayer = {
      ...store.layers['durable-layer']!,
      bitmap: null,
      tmpCanvas: { width: 20, height: 16, close: vi.fn() } as unknown as ImageBitmap,
    };
    const stagedLayers: LayersRecord = { ...store.layers, 'durable-layer': stagedLayer };
    const openedStore = { ...store, durableStatus: 'stale' as const, layers: stagedLayers };
    const promotedLayers: LayersRecord = {
      ...stagedLayers,
      'durable-layer': {
        ...stagedLayer,
        bitmap: { width: 20, height: 16, close: vi.fn() } as unknown as ImageBitmap,
        tmpCanvas: null,
      },
    };
    let finishEncoderImport!: () => void;
    let layersAtRasterization: LayersRecord | undefined;
    vi.mocked(savePsd).mockImplementationOnce(
      async (_layers, _size, _frame, beforeRasterize) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          finishEncoderImport = () => {
            try {
              layersAtRasterization = beforeRasterize?.();
              resolve(new ArrayBuffer(8));
            } catch (error) {
              reject(error);
            }
          };
        })
    );
    renderWithStore(openedStore);

    save('psd');
    await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
    durableStore.current = [exposeStore({ ...openedStore, layers: promotedLayers }), vi.fn()];
    await act(async () => finishEncoderImport());

    expect(layersAtRasterization).toBe(promotedLayers);
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'drawing (copy)', 'psd');
    expect(composeDurableDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['raster', 'image/png'],
    ['PSD', 'psd'],
  ] as const)('keeps legacy exports for an affine operation without export parity proof (%s)', async (_, format) => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    const replayWithAffine: DurableReplayResult = {
      ...replay,
      layers: {
        'durable-layer': {
          ...replay.layers['durable-layer']!,
          operations: [
            {
              kind: 'apply-affine-transform',
              layerId: 'durable-layer',
              transform: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 },
            },
          ],
        },
      },
    };
    vi.mocked(replayDurableAtCursor).mockReturnValue(replayWithAffine);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore(store);

    save(format);

    if (format === 'psd') {
      await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
      expect(savePsd).toHaveBeenCalledWith(legacyLayers, size, frame, expect.any(Function));
    } else {
      await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
      expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    }
    expect(composeDurableDocument).not.toHaveBeenCalled();
    expect(composite.release).not.toHaveBeenCalled();
  });

  it('keeps legacy PSD pixels for hidden layers absent from durable materialization', async () => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    const snapshot = replay.layers['durable-layer']!.snapshot;
    const replayWithHiddenLayer: DurableReplayResult = {
      ...replay,
      layers: {
        'durable-layer': {
          ...replay.layers['durable-layer']!,
          snapshot: { ...snapshot, visible: false },
        },
      },
    };
    const hiddenLegacyLayers: LayersRecord = {
      ...legacyLayers,
      'durable-layer': { ...legacyLayers['durable-layer']!, visible: false },
    };
    vi.mocked(replayDurableAtCursor).mockReturnValue(replayWithHiddenLayer);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore({ ...store, layers: hiddenLegacyLayers });

    save('psd');

    await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
    expect(savePsd).toHaveBeenCalledWith(hiddenLegacyLayers, size, frame, expect.any(Function));
    expect(composeDurableDocument).not.toHaveBeenCalled();
    expect(composite.release).not.toHaveBeenCalled();
  });

  it.each([
    ['raster', 'image/png'],
    ['PSD', 'psd'],
  ] as const)('keeps legacy export when the replay omits a legacy layer (%s)', async (_, format) => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    const existingLayer = legacyLayers['durable-layer']!;
    const legacyLayersWithExtra: LayersRecord = {
      ...legacyLayers,
      'legacy-extra': { ...existingLayer, id: 'legacy-extra', name: 'Legacy extra', order: 1 },
    };
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore({ ...store, layers: legacyLayersWithExtra });

    save(format);

    if (format === 'psd') {
      await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
      expect(savePsd).toHaveBeenCalledWith(legacyLayersWithExtra, size, frame, expect.any(Function));
    } else {
      await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
      expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayersWithExtra, size, frame);
    }
    expect(composeDurableDocument).not.toHaveBeenCalled();
    expect(composite.release).not.toHaveBeenCalled();
  });

  it.each([
    ['raster', 'image/png'],
    ['PSD', 'psd'],
  ] as const)('keeps legacy export when replay contains an extra layer (%s)', async (_, format) => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    expect(legacyLayers).not.toHaveProperty('durable-extra');
    const existing = replay.layers['durable-layer']!;
    const replayWithExtraLayer: DurableReplayResult = {
      ...replay,
      layers: {
        ...replay.layers,
        'durable-extra': {
          ...existing,
          snapshot: {
            ...existing.snapshot,
            id: 'durable-extra',
            name: 'Durable extra',
            order: 1,
          },
        },
      },
    };
    vi.mocked(replayDurableAtCursor).mockReturnValue(replayWithExtraLayer);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore(store);

    save(format);

    if (format === 'psd') {
      await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
      expect(savePsd).toHaveBeenCalledWith(legacyLayers, size, frame, expect.any(Function));
      expect(renderExportCanvas).not.toHaveBeenCalled();
      expect(saveImageToDisk).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
      expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
      await waitFor(() => expect(saveImageToDisk).toHaveBeenCalledTimes(1));
      expect(savePsd).not.toHaveBeenCalled();
    }
    expect(composeDurableDocument).not.toHaveBeenCalled();
    expect(composite.release).not.toHaveBeenCalled();
  });

  it.each([
    ['raster', 'image/png'],
    ['PSD', 'psd'],
  ] as const)('keeps legacy export when materialized bounds differ from the legacy layer for %s', async (_, format) => {
    const { composite, legacyLayers, replay, release, store } = durableFixture();
    const layer = composite.layers['durable-layer']!;
    const mismatchedBounds = { ...layer.bounds, x: layer.bounds.x + 1 };
    const mismatchedComposite = {
      ...composite,
      layers: {
        ...composite.layers,
        'durable-layer': { ...layer, bounds: mismatchedBounds },
      },
    } as unknown as DurableComposite;
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(mismatchedComposite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore(store);

    save(format);

    if (format === 'psd') {
      await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
      expect(savePsd).toHaveBeenCalledWith(legacyLayers, size, frame, expect.any(Function));
    } else {
      await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
      expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    }
    expect(composeDurableDocument).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    ['opacity', { opacity: 0.58 }],
    ['blend mode', { blendMode: 'multiply' as const }],
  ])('keeps legacy export when durable %s differs from the legacy layer record', async (_, patch) => {
    const { composite, legacyLayers, replay, store } = durableFixture();
    const replayWithChangedMetadata: DurableReplayResult = {
      ...replay,
      layers: {
        'durable-layer': {
          ...replay.layers['durable-layer']!,
          snapshot: { ...replay.layers['durable-layer']!.snapshot, ...patch },
        },
      },
    };
    vi.mocked(replayDurableAtCursor).mockReturnValue(replayWithChangedMetadata);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    renderWithStore(store);

    save('image/png');

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    expect(composeDurableDocument).not.toHaveBeenCalled();
    expect(composite.release).not.toHaveBeenCalled();
  });

  it('falls back to legacy records when durable composition refuses materialization', async () => {
    const { legacyLayers, replay, store } = durableFixture();
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockRejectedValue(
      new DurableCompositionRefusal('materialization-refused', 'materialization refused')
    );
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    renderWithStore(store);

    save('image/png');

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
  });

  it('falls back after the durable store turns stale and releases its composite exactly once', async () => {
    const { composite, legacyLayers, release, replay, store } = durableFixture();
    let finish!: (value: DurableComposite) => void;
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    const { rerender } = renderWithStore(store);

    save('image/png');
    await waitFor(() => expect(composeDurableDocument).toHaveBeenCalledTimes(1));
    await act(async () => {
      rerenderWithStore(rerender, { ...store, durableStatus: 'stale' });
    });
    await act(async () => {
      finish(composite);
    });

    await waitFor(() => expect(renderExportCanvas).toHaveBeenCalledTimes(1));
    expect(renderExportCanvas).toHaveBeenCalledWith(legacyLayers, size, frame);
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });

  it('refuses export if document identity or layer identity changes during durable composition', async () => {
    const { composite, release, replay, store } = durableFixture();
    const layer = composite.layers['durable-layer']!;
    const mismatchedComposite = {
      ...composite,
      layers: {
        ...composite.layers,
        'durable-layer': { ...layer, bounds: { ...layer.bounds, x: layer.bounds.x + 1 } },
      },
    } as unknown as DurableComposite;
    let finish!: (value: DurableComposite) => void;
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    renderWithStore(store);

    save('image/png');
    await waitFor(() => expect(composeDurableDocument).toHaveBeenCalledTimes(1));
    await act(async () => {
      durableStore.current = [
        exposeStore({
          ...store,
          documentId: 'replacement-document',
          durableDocument: { ...store.durableDocument!, documentId: 'replacement-document' },
          layers: { ...store.layers },
        }),
        vi.fn(),
      ];
      finish(mismatchedComposite);
    });

    expect(await screen.findByText(/document changed while the Save dialog was open/i)).toBeInTheDocument();
    expect(renderExportCanvas).not.toHaveBeenCalled();
    expect(saveImageToDisk).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });

  it('rechecks PSD snapshot freshness after the encoder import and before reading layer sources', async () => {
    const { store } = durableFixture();
    let finishEncoderImport!: () => void;
    vi.mocked(savePsd).mockImplementationOnce(
      async (_layers, _size, _frame, beforeRasterize) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          finishEncoderImport = () => {
            try {
              beforeRasterize?.();
              resolve(new ArrayBuffer(8));
            } catch (error) {
              reject(error);
            }
          };
        })
    );
    renderWithStore({ ...store, durableStatus: 'stale' });

    save('psd');
    await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
    await act(async () => {
      durableStore.current = [
        exposeStore({
          ...store,
          documentId: 'replacement-document',
          durableDocument: { ...store.durableDocument!, documentId: 'replacement-document' },
          layers: { ...store.layers },
        }),
        vi.fn(),
      ];
      finishEncoderImport();
    });

    expect(await screen.findByText(/document changed while the Save dialog was open/i)).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('rechecks durable presentation authority after the PSD encoder import', async () => {
    const { composite, replay, release, store } = durableFixture();
    let finishEncoderImport!: () => void;
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(savePsd).mockImplementationOnce(
      async (_layers, _size, _frame, beforeRasterize) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          finishEncoderImport = () => {
            try {
              beforeRasterize?.();
              resolve(new ArrayBuffer(8));
            } catch (error) {
              reject(error);
            }
          };
        })
    );
    renderWithStore(store);

    save('psd');
    await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
    durableStore.current = [
      exposeStore({
        ...store,
        durablePresentation: { ...store.durablePresentation },
        renderSelector: { ...store.renderSelector },
        durableRenderProjection: { ...store.durableRenderProjection! },
      }),
      vi.fn(),
    ];
    await act(async () => finishEncoderImport());

    expect(await screen.findByText(/document changed while the Save dialog was open/i)).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });
});
