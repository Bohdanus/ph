import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { getAssetRegistry } from '../asset-registry.ts';
import * as compositor from '../durable-compositor.ts';
import type { DurableComposite } from '../durable-compositor.ts';
import type { MaterializedLayer } from '../materialization.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { HistoryItem } from '../history-types.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';

const frame = { x: 10, y: 20, width: 80, height: 60 };

function blank(id = 'base'): Layer {
  return {
    ...createMockLayer({ id, pos: frame, order: 0 }),
    source: { kind: 'blank', pos: frame, color: '#ffffff', opacity: 1, isBedrock: false },
  };
}

function added(kind: 'image' | 'blank', id = 'added', order = 1): Layer {
  const pos = { x: 22, y: 28, width: 24, height: 18 };
  const bitmap = kind === 'image' ? createMockImageBitmap(pos.width, pos.height) : null;
  return {
    ...createMockLayer({ id, pos, order, name: `Layer ${order + 1}` }),
    bitmap,
    source: bitmap
      ? { kind: 'image', bitmap, pos, isBedrock: false }
      : { kind: 'blank', pos, color: '#ff0000', opacity: 1, isBedrock: false },
  };
}

function toolAdded(toolName: 'shape' | 'text' | 'pencil', id = `${toolName}-added`, order = 1): Layer {
  const pos = { x: 22, y: 28, width: 24, height: 18 };
  return {
    ...createMockLayer({ id, pos, order, name: `Layer ${order + 1}` }),
    bitmap: null,
    source: {
      kind: 'tool',
      args: {
        toolName,
        figure: 'rectangle',
        alpha: 1,
        color: '#000000',
        backgroundColor: null,
        lineWidth: 4,
        start: { x: 22, y: 28 },
        end: { x: 46, y: 46 },
      } as never,
      isBedrock: false,
      pos,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function compositeFor(layers: LayersRecord) {
  const records: Record<string, MaterializedLayer> = {};
  for (const layer of Object.values(layers)) {
    const bitmap = createMockImageBitmap(layer.pos.width, layer.pos.height);
    records[layer.id] = {
      layerId: layer.id,
      bitmap,
      bounds: layer.pos,
      visible: true,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      lease: {
        key: layer.id,
        bitmap,
        byteSize: 4 * layer.pos.width * layer.pos.height,
        metadata: layer.pos,
        release: vi.fn(),
      },
    };
  }
  const releaseLayers = vi.fn(() => {
    for (const layer of Object.values(records)) layer.lease.release();
  });
  let detached = false;
  let released = false;
  const composite: DurableComposite = {
    bitmap: createMockImageBitmap(frame.width, frame.height),
    frame,
    layers: records,
    takeLayers: () => {
      detached = true;
      return { layers: records, release: releaseLayers };
    },
    release: vi.fn(() => {
      if (released) return;
      released = true;
      if (!detached) releaseLayers();
    }),
  };
  return { composite, releaseLayers };
}

function mount(sourceBackedBaseline = false) {
  let current!: { store: StoreData; dispatch: StoreDispatch };
  function Probe() {
    const [store, dispatch] = useStore();
    useEffect(() => {
      current = { store, dispatch };
    }, [store, dispatch]);
    return null;
  }
  const view = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  function replace(documentId = 'source-create') {
    const base = blank();
    const history: HistoryItem[] = sourceBackedBaseline
      ? [{ id: 'open', actionName: NEW_LAYER_ACTION, layerId: base.id, layerSource: base.source }]
      : [
          {
            id: 'open',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: base.id,
            documentSource: { layers: { [base.id]: base }, size: { width: frame.width, height: frame.height }, frame },
          },
        ];
    act(() =>
      current.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId,
          history,
          historyIndex: 0,
          updates: { layers: { [base.id]: base }, documentFrame: frame, totalSize: frame },
        },
      })
    );
  }
  function create(layer: Layer) {
    act(() =>
      current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          historyItem: { id: 'create', actionName: NEW_LAYER_ACTION, layerId: layer.id, layerSource: layer.source },
          updates: { layers: { ...current.store.layers, [layer.id]: layer }, activeLayerId: layer.id },
        },
      })
    );
  }
  replace();
  return { store: () => current.store, create, replace, unmount: view.unmount };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('source-backed create presentation', () => {
  it.each(['image', 'blank'] as const)('publishes a complete %s create after ownership is committed', async (kind) => {
    const pending = deferred<DurableComposite>();
    const compose = vi.spyOn(compositor, 'composeDurableDocument').mockReturnValue(pending.promise);
    const probe = mount();
    const layer = added(kind);
    const { composite } = compositeFor({ ...probe.store().layers, [layer.id]: layer });
    const registry = getAssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    probe.create(layer);
    expect(probe.store().durableDiagnostics).toEqual([]);
    expect(compose).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.invocationCallOrder[0]).toBeLessThan(compose.mock.invocationCallOrder[0]);
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().history).toHaveLength(2);
    const entry = probe.store().durableDocument!.history[0];
    expect(entry.operation.kind).toBe('create-layer');
    if (entry.operation.kind !== 'create-layer') throw new Error('Expected create-layer');
    expect(entry.operation.layer.source.kind).toBe(kind === 'image' ? 'raster' : 'blank');
    if (kind === 'image') {
      if (entry.operation.layer.source.kind !== 'raster' || !layer.bitmap) {
        throw new Error('Expected an image create to retain its registered raster source');
      }
      expect(registry.getRecord(entry.operation.layer.source.assetId)).toMatchObject({
        documentId: probe.store().documentId,
        width: layer.pos.width,
        height: layer.pos.height,
        ownership: 'borrow',
        disposed: false,
      });
      expect(
        registry.matchesRegisteredSource(entry.operation.layer.source.assetId, layer.bitmap, probe.store().documentId)
      ).toBe(true);
    } else {
      if (entry.operation.layer.source.kind !== 'blank') throw new Error('Expected a blank create source');
      expect(entry.operation.layer.source).toMatchObject({
        color: '#ff0000',
        opacity: 1,
        size: { width: layer.pos.width, height: layer.pos.height },
      });
    }
    await act(async () => {
      pending.resolve(composite);
      await pending.promise;
    });
    expect(probe.store().renderSelector.source).toBe('durable');
    expect(Object.keys(probe.store().durableRenderProjection!.layers).sort()).toEqual(['added', 'base']);
    expect(probe.store().layers.added.source).toBe(layer.source);
    expect(composite.release).toHaveBeenCalledTimes(1);
    for (const record of Object.values(composite.layers)) expect(record.lease.release).not.toHaveBeenCalled();
    probe.unmount();
    for (const record of Object.values(composite.layers)) expect(record.lease.release).toHaveBeenCalledTimes(1);
    if (layer.bitmap) expect((layer.bitmap as ImageBitmap).close).not.toHaveBeenCalled();
  });

  it('keeps a typed vector create unpublished until its ownership gate is proven', () => {
    const compose = vi.spyOn(compositor, 'composeDurableDocument');
    const probe = mount();
    const layer = toolAdded('shape');

    probe.create(layer);

    expect(probe.store().durableStatus).toBe('current');
    expect(probe.store().durableDiagnostics).toEqual([]);
    const entry = probe.store().durableDocument!.history[0];
    expect(entry?.operation.kind).toBe('create-layer');
    if (entry?.operation.kind !== 'create-layer') throw new Error('Expected a durable vector create entry');
    expect(entry.operation.layer.source).toMatchObject({
      kind: 'vector',
      toolName: 'shape',
      args: layer.source?.kind === 'tool' ? layer.source.args : undefined,
      sourcePos: layer.pos,
    });
    expect(compose).not.toHaveBeenCalled();
    expect(probe.store().durablePresentation.status).toBe('unpublished');
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().history).toHaveLength(2);
    probe.unmount();
  });

  it.each([
    { toolName: 'text', sourceKind: 'text' },
    { toolName: 'pencil', sourceKind: 'paint' },
  ] as const)('keeps the supported $toolName source family gated', ({ toolName, sourceKind }) => {
    const compose = vi.spyOn(compositor, 'composeDurableDocument');
    const probe = mount();
    const layer = toolAdded(toolName);

    probe.create(layer);

    expect(probe.store().durableStatus).toBe('current');
    const entry = probe.store().durableDocument!.history[0];
    expect(entry?.operation.kind).toBe('create-layer');
    if (entry?.operation.kind !== 'create-layer') throw new Error('Expected a durable tool create entry');
    expect(entry.operation.layer.source.kind).toBe(sourceKind);
    expect(compose).not.toHaveBeenCalled();
    expect(probe.store().durablePresentation.status).toBe('unpublished');
    expect(probe.store().renderSelector.source).toBe('legacy');
    probe.unmount();
  });

  it('does not let a later create bypass an earlier source-backed cursor gate', async () => {
    const pending = deferred<DurableComposite>();
    const compose = vi.spyOn(compositor, 'composeDurableDocument').mockReturnValue(pending.promise);
    const probe = mount();
    const first = added('blank');
    const { composite } = compositeFor({ ...probe.store().layers, [first.id]: first });

    probe.create(first);
    expect(compose).toHaveBeenCalledTimes(1);
    probe.create(added('image', 'later', 2));

    expect(compose).toHaveBeenCalledTimes(1);
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().history).toHaveLength(3);
    await act(async () => {
      pending.resolve(composite);
      await pending.promise;
    });
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(composite.release).toHaveBeenCalledTimes(1);
    probe.unmount();
    for (const record of Object.values(composite.layers)) expect(record.lease.release).toHaveBeenCalledTimes(1);
  });

  it('keeps a create behind the gate when the live blank document starts with a source-backed entry', () => {
    const compose = vi.spyOn(compositor, 'composeDurableDocument');
    const probe = mount(true);

    probe.create(added('image'));

    expect(compose).not.toHaveBeenCalled();
    expect(probe.store().durableStatus).toBe('current');
    expect(probe.store().durablePresentation.status).toBe('unpublished');
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().history).toHaveLength(2);
    probe.unmount();
  });

  it('discards a completed create when its document was replaced', async () => {
    const pending = deferred<DurableComposite>();
    vi.spyOn(compositor, 'composeDurableDocument').mockReturnValue(pending.promise);
    const probe = mount();
    const layer = added('image');
    const { composite } = compositeFor({ ...probe.store().layers, [layer.id]: layer });
    probe.create(layer);
    probe.replace('replacement');
    await act(async () => {
      pending.resolve(composite);
      await pending.promise;
    });
    expect(probe.store().documentId).toBe('replacement');
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().durableRenderProjection).toBeNull();
    expect(Object.keys(probe.store().layers)).toEqual(['base']);
    expect(composite.release).toHaveBeenCalledTimes(1);
    for (const record of Object.values(composite.layers)) expect(record.lease.release).toHaveBeenCalledTimes(1);
    probe.unmount();
    expect((layer.bitmap as ImageBitmap).close).not.toHaveBeenCalled();
  });

  it('declines incomplete create materialization without losing the committed layer or source asset', async () => {
    const probe = mount();
    const layer = added('image');
    const { composite, releaseLayers } = compositeFor(probe.store().layers);
    vi.spyOn(compositor, 'composeDurableDocument').mockResolvedValue(composite);
    await act(async () => {
      probe.create(layer);
    });
    expect(probe.store().durablePresentation).toMatchObject({ status: 'legacy-fallback', reason: 'layer-coverage' });
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().durableRenderProjection).toBeNull();
    expect(probe.store().layers.added).toBe(layer);
    expect(probe.store().history).toHaveLength(2);
    expect(releaseLayers).toHaveBeenCalledTimes(1);
    expect(composite.release).toHaveBeenCalledTimes(1);
    probe.unmount();
    expect((layer.bitmap as ImageBitmap).close).not.toHaveBeenCalled();
  });

  it('keeps tool-source creates behind their presentation gate', async () => {
    const compose = vi.spyOn(compositor, 'composeDurableDocument');
    const probe = mount();
    const layer = added('blank');
    layer.source = { kind: 'tool', pos: layer.pos, isBedrock: false, args: { toolName: 'pen' } as never };
    await act(async () => {
      probe.create(layer);
    });
    expect(compose).not.toHaveBeenCalled();
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().durablePresentation.status).toBe('unpublished');
    expect(probe.store().history).toHaveLength(2);
    probe.unmount();
  });

  it('does not compose when create asset finalization fails after the edit commits', async () => {
    const probe = mount();
    const registry = getAssetRegistry();
    const begin = registry.beginDocumentAssetTransaction.bind(registry);
    vi.spyOn(registry, 'beginDocumentAssetTransaction').mockImplementation((documentId) => {
      const transaction = begin(documentId);
      const commit = transaction.commit.bind(transaction);
      vi.spyOn(transaction, 'commit').mockImplementation(() => {
        commit();
        throw new Error('finalization failed');
      });
      return transaction;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const compose = vi.spyOn(compositor, 'composeDurableDocument');
    probe.create(added('image'));
    expect(error).toHaveBeenCalledWith(
      'Unable to finalize a published durable append; the append itself is committed',
      expect.any(Error)
    );
    expect(compose).not.toHaveBeenCalled();
    expect(probe.store().history).toHaveLength(2);
    expect(probe.store().renderSelector.source).toBe('legacy');
    expect(probe.store().layers.added).toBeDefined();
    probe.unmount();
  });
});
