import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FileContextType, FileProvider, useFile } from '../useFile.tsx';
import { saveImageToDisk } from '../image-load-save-utils.ts';
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
  const bounds = { x: 12, y: 13, width: 20, height: 16 };
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
    legacy: {
      id: 'legacy',
      name: 'Legacy layer',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 0, y: 0, width: 100, height: 80 },
      presentationBounds: null,
      operations: [],
    } as Layer,
  };
  const store = {
    durableStatus: 'current',
    durableDocument,
    historyIndex: durableDocument.cursor,
    documentId: durableDocument.documentId,
    documentRevision: durableDocument.documentRevision,
    branchRevision: durableDocument.branchRevision,
    layers: legacyLayers,
    totalSize: size,
    documentFrame: frame,
  } as unknown as StoreData;

  return { composite, legacyLayers, release, replay, store };
}

function renderWithStore(store: StoreData) {
  durableStore.current = [store, vi.fn()];
  return render(
    <FileProvider>
      <Consumer />
    </FileProvider>
  );
}

function rerenderWithStore(rerender: ReturnType<typeof render>['rerender'], store: StoreData) {
  durableStore.current = [store, vi.fn()];
  rerender(
    <FileProvider>
      <Consumer />
    </FileProvider>
  );
}

function save(format: 'image/png' | 'psd') {
  act(() => {
    void filesRef.current!.openSaveImageDialog({
      fileName: 'drawing.png',
      layers: (durableStore.current as [StoreData])[0].layers,
      size,
      documentFrame: frame,
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
  ] as const)('routes a current durable document through durableExportRecords for %s export', async (_, format) => {
    const { composite, release, replay, store } = durableFixture();
    vi.mocked(replayDurableAtCursor).mockReturnValue(replay);
    vi.mocked(composeDurableDocument).mockResolvedValue(composite);
    vi.mocked(saveImageToDisk).mockResolvedValue(undefined);
    vi.mocked(savePsd).mockResolvedValue(new ArrayBuffer(8));
    renderWithStore(store);

    save(format);

    const expectedLayer = expect.objectContaining({
      id: 'durable-layer',
      tmpCanvas: composite.layers['durable-layer']!.bitmap,
      pos: { x: 12, y: 13, width: 20, height: 16 },
    });
    if (format === 'psd') {
      await waitFor(() => expect(savePsd).toHaveBeenCalledTimes(1));
      expect(savePsd).toHaveBeenCalledWith(expect.objectContaining({ 'durable-layer': expectedLayer }), size, frame);
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
});
