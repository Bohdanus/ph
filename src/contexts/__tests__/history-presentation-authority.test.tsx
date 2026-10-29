import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as durableCompositor from '../durable-compositor.ts';
import type { DurableComposite } from '../durable-compositor.ts';
import {
  type DurableNavigationPresentationOutcome,
  type StoreData,
  type StoreDispatch,
  StoreProvider,
  useStore,
} from '../StoreContext.tsx';
import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ImageLayerSource, Layer, LayersRecord } from '../layer-types.ts';
import type { MaterializedLayer } from '../materialization.ts';
import type { BitmapSource } from '../general-types.ts';
import { OPEN_DOCUMENT_ACTION, SET_LAYER_OPACITY_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame = { x: 0, y: 0, width: 400, height: 300 };

function canvas(width = 100, height = 80): BitmapSource {
  return createMockOffscreenCanvas(width, height) as unknown as BitmapSource;
}

function baselineItem(layers: LayersRecord, id = 'baseline'): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers, size: initialSize, frame: defaultFrame },
  };
}

function renderWithProbe() {
  const probeRef: { current: { store: StoreData; dispatch: StoreDispatch } | null } = { current: null };
  const Probe = () => {
    const [store, dispatch] = useStore();
    useEffect(() => {
      probeRef.current = { store, dispatch };
    }, [store, dispatch]);
    return null;
  };
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return {
    unmount,
    store: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.store;
    },
    dispatch: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.dispatch;
    },
  };
}

function replaceDocument(dispatch: StoreDispatch, layers: LayersRecord, documentId = 'doc-1') {
  act(() => {
    dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId,
        history: [baselineItem(layers)],
        historyIndex: 0,
        updates: { layers, totalSize: initialSize, documentFrame: defaultFrame },
      },
    });
  });
}

function replayTo(dispatch: StoreDispatch, layers: LayersRecord, deletedLayers: LayersRecord, cursor = 0) {
  act(() => {
    dispatch({
      type: 'APPLY_HISTORY_REPLAY',
      payload: {
        updates: { layers, deletedLayers, activeLayerId: null },
        timeline: { entries: [baselineItem(layers, 'baseline')], cursor, branchRevision: 0 },
      },
    });
  });
}

function rasterLayer(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): Layer {
  const bitmap = createMockImageBitmap(pos.width, pos.height);
  const source: ImageLayerSource = { kind: 'image', bitmap, isBedrock: false, pos };
  return { ...createMockLayer({ id, pos }), bitmap, source };
}

function blankLayer(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): Layer {
  return {
    ...createMockLayer({ id, pos }),
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos },
  };
}

function legacyToolLayer(id = layerId): Layer {
  return {
    ...createMockLayer({ id, pos: { x: 0, y: 0, width: 100, height: 80 } }),
    source: {
      kind: 'tool',
      args: { toolName: 'pen' } as never,
      pos: { x: 0, y: 0, width: 100, height: 80 },
      isBedrock: false,
    },
  };
}

function makeComposite(id = layerId, pos = { x: 0, y: 0, width: 100, height: 80 }): DurableComposite {
  const materializedBitmap = createMockImageBitmap(pos.width, pos.height);
  const releaseMaterialized = vi.fn();
  const materialized: MaterializedLayer = {
    layerId: id,
    bitmap: materializedBitmap,
    bounds: pos,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    lease: {
      key: 'authority-test',
      bitmap: materializedBitmap,
      byteSize: pos.width * pos.height * 4,
      metadata: pos,
      release: releaseMaterialized,
    },
  };
  const layers = { [id]: materialized };
  const releaseDetached = vi.fn();
  const releaseComposite = vi.fn();
  return {
    bitmap: materializedBitmap,
    frame: defaultFrame,
    layers,
    takeLayers: () => ({ layers, release: releaseDetached }),
    release: releaseComposite,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('publishDurablePresentation authority boundaries', () => {
  it('rejects navigation with a legacy selector and unsupported source, without composing', async () => {
    const compose = vi.spyOn(durableCompositor, 'composeDurableDocument');
    const layer = legacyToolLayer();
    const { store, dispatch } = renderWithProbe();
    replaceDocument(dispatch(), { [layerId]: layer });

    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durableStatus).toBe('current');

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(compose).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'stale', reason: 'stale', cursor: -1 });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durablePresentation.status).toBe('unpublished');
    expect(store().durableRenderProjection).toBeNull();
  });

  it('keeps imported raster baselines on legacy presentation while durable conversion stays current', async () => {
    const compose = vi.spyOn(durableCompositor, 'composeDurableDocument');
    const { store, dispatch } = renderWithProbe();
    const importedLayers = { [layerId]: rasterLayer() };
    replaceDocument(dispatch(), importedLayers);
    replayTo(dispatch(), importedLayers, {});

    expect(store().durableStatus).toBe('current');
    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      outcome = await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(compose).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'legacy-fallback', reason: 'ownership-unproven', cursor: -1 });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durablePresentation).toMatchObject({
      status: 'legacy-fallback',
      reason: 'ownership-unproven',
      cursor: -1,
    });
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durableStatus).toBe('current');
  });

  it('releases the composite in finally when a navigation composition becomes stale', async () => {
    const composite = makeComposite();
    let resolveComposition!: () => void;
    const composition = new Promise<void>((resolve) => {
      resolveComposition = resolve;
    });
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockImplementation(async () => {
      await composition;
      return composite;
    });

    const { store, dispatch } = renderWithProbe();
    const layer = blankLayer();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});
    expect(store().renderSelector.source).toBe('pending');

    const publication = store().publishDurableNavigationPresentation();
    expect(store().renderSelector.source).toBe('pending');

    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 500, height: 400 } });
    });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durableStatus).toBe('stale');

    let outcome: DurableNavigationPresentationOutcome | undefined;
    await act(async () => {
      resolveComposition();
      outcome = await publication;
      await Promise.resolve();
    });

    expect(outcome?.status).toBe('stale');
    expect(composite.release).toHaveBeenCalledTimes(1);
  });

  it('preserves a runtime preview canvas through a stale background append refusal', async () => {
    const firstComposite = makeComposite();
    const appendComposite = makeComposite();
    let resolveAppendComposition!: (composite: DurableComposite) => void;
    const appendComposition = new Promise<DurableComposite>((resolve) => {
      resolveAppendComposition = resolve;
    });
    vi.spyOn(durableCompositor, 'composeDurableDocument')
      .mockResolvedValueOnce(firstComposite)
      .mockReturnValue(appendComposition);

    const { store, dispatch } = renderWithProbe();
    const layer = blankLayer();
    replaceDocument(dispatch(), { [layerId]: layer });
    replayTo(dispatch(), { [layerId]: layer }, {});

    await act(async () => {
      await store().publishDurableNavigationPresentation();
      await Promise.resolve();
    });
    expect(store().renderSelector.source).toBe('durable');

    const previewCanvas = canvas(100, 80);
    const currentLayer = store().layers[layerId];
    const previewLayer = { ...currentLayer, tmpCanvas: previewCanvas };
    act(() => {
      store().publishRuntimePresentation({ [layerId]: previewLayer });
    });
    expect(store().layers[layerId].tmpCanvas).toBe(previewCanvas);

    act(() => {
      dispatch()({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: { layers: { [layerId]: { ...store().layers[layerId], opacity: 0.5 } } },
          historyItem: {
            id: 'opacity-edit',
            actionName: SET_LAYER_OPACITY_ACTION,
            layerId,
            args: { opacity: 0.5 },
          },
        },
      });
    });
    expect(store().renderSelector.source).toBe('legacy');
    expect(store().durableRenderProjection).toBeNull();

    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 500, height: 400 } });
    });
    expect(store().durableStatus).toBe('stale');

    await act(async () => {
      resolveAppendComposition(appendComposite);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store().layers[layerId].tmpCanvas).toBe(previewCanvas);
    expect(store().durableRenderProjection).toBeNull();
    expect(store().durablePresentation.status).toBe('unpublished');
    expect(store().durableStatus).toBe('stale');
  });
});
