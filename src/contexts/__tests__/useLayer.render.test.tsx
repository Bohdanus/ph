import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as durableCompositor from '../durable-compositor.ts';
import type { DurableComposite } from '../durable-compositor.ts';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { MaterializedLayer } from '../materialization.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { Pos } from '../general-types.ts';

// drawAllLayers owns the composition contract only: the renderer stages and
// publishes. Assert the delegation instead of re-testing drawLayersToCanvas —
// and note what the return value is NOT: `useLayer` discards it, so a refused
// publication is invisible from here. The refusal itself is decided inside
// `layer-renderer.ts`, which keeps the visible canvas intact when it returns
// `false`; what is pinned below is that the refusal reaches no caller of
// `useLayers` at all.
type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const size = { width: 800, height: 600 };

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
  layers,
  canvas = document.createElement('canvas'),
}: {
  layers: LayersRecord;
  canvas?: HTMLCanvasElement | null;
}) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });

  act(() => {
    result.current.store.canvasRef.current = canvas;
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId: Object.keys(layers)[0] ?? null,
        totalSize: { ...size },
        documentFrame: documentFrameFromSize(size),
        hasImage: true,
      },
    });
  });

  return { result };
}

function drawnLayers(callIndex = 0): readonly Layer[] {
  return drawLayersToCanvas.mock.calls[callIndex][1];
}

function drawnFrame(callIndex = 0): DocumentFrame {
  return drawLayersToCanvas.mock.calls[callIndex][2];
}

function makeComposite(pos: Pos, id = 'layer-1', frame: DocumentFrame): DurableComposite {
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
      key: 'render-all-layers-test',
      bitmap: materializedBitmap,
      byteSize: pos.width * pos.height * 4,
      metadata: pos,
      release: releaseMaterialized,
    },
  };
  const layers = { [id]: materialized };
  const releaseDetached = vi.fn(() => releaseMaterialized());
  const releaseComposite = vi.fn(() => releaseMaterialized());
  return {
    bitmap: materializedBitmap,
    frame,
    layers,
    takeLayers: () => ({ layers, release: releaseDetached }),
    release: releaseComposite,
  };
}

function createBlankLayerSource(pos: Pos) {
  return { kind: 'blank' as const, color: '#ffffff', opacity: 1, isBedrock: false, pos } as const;
}

describe('useLayers drawAllLayers', () => {
  beforeEach(() => {
    drawLayersToCanvas.mockClear();
  });

  afterEach(() => {
    drawLayersToCanvas.mockReset();
    vi.restoreAllMocks();
  });

  it('delegates publication to the renderer with the mounted canvas, sorted layers, and document frame', () => {
    const layers: LayersRecord = {
      top: makeLayer('top', 4),
      bottom: makeLayer('bottom', 1),
    };
    const canvas = document.createElement('canvas');
    const { result } = setup({ layers, canvas });
    const untouched = { width: canvas.width, height: canvas.height };

    act(() => {
      result.current.layers.drawAllLayers();
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
    const [target, , frame] = drawLayersToCanvas.mock.calls[0];
    expect(target).toBe(canvas);
    expect(frame).toEqual(documentFrameFromSize(size));
    expect(drawnFrame()).toEqual(documentFrameFromSize(size));
    expect(drawnLayers().map((layer) => layer.id)).toEqual(['bottom', 'top']);
    // The renderer owns the resize; drawAllLayers must not touch the canvas size.
    expect({ width: canvas.width, height: canvas.height }).toEqual(untouched);
    expect(untouched).not.toEqual({ width: size.width, height: size.height });
  });

  it('renders the layer set in draw order rather than raw record key order', () => {
    const layers: LayersRecord = {
      zeta: makeLayer('zeta', 9),
      alpha: makeLayer('alpha', 2),
      middle: makeLayer('middle', 5),
    };
    const { result } = setup({ layers });

    act(() => {
      result.current.layers.drawAllLayers();
    });

    expect(Object.keys(result.current.store.layers)).toEqual(['zeta', 'alpha', 'middle']);
    expect(drawnLayers().map((layer) => layer.id)).toEqual(['alpha', 'middle', 'zeta']);
    expect(drawnLayers().map((layer) => layer.order)).toEqual([2, 5, 9]);
  });

  it('renders previews in place of the same-id committed layers and keeps the merged set in draw order', () => {
    const committed = makeLayer('edited', 3);
    const untouchedLayer = makeLayer('background', 1);
    const { result } = setup({ layers: { edited: committed, background: untouchedLayer } });
    const preview = makeLayer('edited', 3, { tmpCanvas: { width: 12, height: 8 } as unknown as Layer['tmpCanvas'] });
    const previewOnly = makeLayer('draft', 2);

    act(() => {
      result.current.store.previewLayers.current = {
        edited: { layer: preview },
        draft: { layer: previewOnly, toolArgs: { toolName: 'blur', radius: 4 } },
      };
      result.current.layers.drawAllLayers();
    });

    const rendered = drawnLayers();
    expect(rendered).toContain(preview);
    expect(rendered).not.toContain(committed);
    expect(rendered).toContain(untouchedLayer);
    expect(rendered).toContain(previewOnly);
    expect(rendered.map((layer) => layer.id)).toEqual(['background', 'draft', 'edited']);
  });

  it('keeps drawing committed layers again after the preview is cancelled', () => {
    const committed = makeLayer('edited', 3);
    const { result } = setup({ layers: { edited: committed } });
    const preview = makeLayer('edited', 3, { tmpCanvas: { width: 12, height: 8 } as unknown as Layer['tmpCanvas'] });

    act(() => {
      result.current.store.previewLayers.current = { edited: { layer: preview } };
      result.current.layers.drawAllLayers();
    });
    expect(drawnLayers()).toEqual([preview]);

    act(() => {
      result.current.store.previewLayers.current = {};
      result.current.layers.drawAllLayers();
    });
    expect(drawnLayers(1)).toEqual([committed]);
  });

  it('does nothing and does not throw when no canvas is mounted', () => {
    const { result } = setup({ layers: { edited: makeLayer('edited', 1) }, canvas: null });

    act(() => {
      expect(() => result.current.layers.drawAllLayers()).not.toThrow();
    });

    expect(drawLayersToCanvas).not.toHaveBeenCalled();
  });

  it('swallows a refused publication: one attempt, no throw, no retry, no result', () => {
    // The record of what `useLayers` does with a `false`, established rather than
    // assumed. `drawAllLayers` calls `drawLayersToCanvas` and drops the boolean
    // (`useLayer.ts:773`: the call is a statement, not an assignment), so a
    // refusal never reaches a caller: there is no throw, no retry, and
    // `drawAllLayers` returns `undefined` on success and on refusal alike. The one
    // channel a refusal DOES have is `console.error` — `useLayer.ts:774` reports
    // `'Unable to publish runtime layer presentation'`, and the sibling test below
    // is what asserts it. A future caller reading that boolean has to change this
    // file, and this is the assertion that will then be wrong.
    const { result } = setup({ layers: { edited: makeLayer('edited', 1) } });
    drawLayersToCanvas.mockReturnValueOnce(false);

    let returned: unknown = 'unset';
    act(() => {
      expect(() => {
        returned = result.current.layers.drawAllLayers();
      }).not.toThrow();
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
    expect(returned).toBeUndefined();
  });

  it('refuses a publication only once per call, so a later draw still runs', () => {
    // The control for the case above: the `false` was consumed by the single
    // call, so a second draw reaches the renderer again. Without this, "swallows
    // a refused publication" would also be satisfied by a stub stuck on `false`
    // or by an implementation that stopped drawing after one refusal.
    const { result } = setup({ layers: { edited: makeLayer('edited', 1) } });
    drawLayersToCanvas.mockReturnValueOnce(false);

    act(() => {
      result.current.layers.drawAllLayers();
    });
    act(() => {
      result.current.layers.drawAllLayers();
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(2);
  });

  it('reports a renderer publish failure without throwing through the pointer-move path', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    drawLayersToCanvas.mockReturnValue(false);
    const { result } = setup({ layers: { edited: makeLayer('edited', 1) } });

    act(() => {
      expect(() => result.current.layers.drawAllLayers()).not.toThrow();
    });

    expect(consoleError).toHaveBeenCalledWith('Unable to publish runtime layer presentation');
    consoleError.mockRestore();
  });

  it('renders legacy layers with preview overlays, then switches to the durable projection after the preview clears and a durable render is selected', async () => {
    const layerId = 'layer-1';
    const layerPos = { x: 0, y: 0, width: 40, height: 20 };
    const docSize = { width: 800, height: 600 };
    const docFrame = documentFrameFromSize(docSize);

    const blankSource = createBlankLayerSource(layerPos);
    const committedLayer = makeLayer(layerId, 1, { source: blankSource });
    const layerWithSource: LayersRecord = { [layerId]: committedLayer };

    const baseline: HistoryItem = {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: { layers: layerWithSource, size: docSize, frame: docFrame },
    };

    const canvas = document.createElement('canvas');
    const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });

    act(() => {
      result.current.store.canvasRef.current = canvas;
      result.current.store.previewLayers.current = {};
      result.current.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'doc-1',
          history: [baseline],
          historyIndex: 0,
          updates: {
            layers: layerWithSource,
            activeLayerId: layerId,
            totalSize: { ...docSize },
            documentFrame: docFrame,
            hasImage: true,
          },
        },
      });
    });

    expect(result.current.store.renderSelector.source).toBe('legacy');

    const previewLayer = makeLayer(layerId, 1, {
      tmpCanvas: { width: 12, height: 8 } as unknown as Layer['tmpCanvas'],
    });

    act(() => {
      result.current.store.previewLayers.current = {
        [layerId]: { layer: previewLayer },
      };
      result.current.layers.drawAllLayers();
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(1);
    const phase1Rendered = drawnLayers(0);
    expect(phase1Rendered.map((layer) => layer.id)).toEqual([layerId]);
    expect(phase1Rendered[0]).toBe(previewLayer);

    act(() => {
      result.current.store.previewLayers.current = {};
      result.current.dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { layers: layerWithSource, activeLayerId: layerId },
          timeline: { entries: [baseline], cursor: 0, branchRevision: 0 },
        },
      });
    });

    expect(result.current.store.renderSelector.source).toBe('pending');

    const composite = makeComposite(layerPos, layerId, docFrame);
    vi.spyOn(durableCompositor, 'composeDurableDocument').mockResolvedValue(composite);

    await act(async () => {
      await result.current.store.publishDurableNavigationPresentation();
      await Promise.resolve();
    });

    expect(result.current.store.renderSelector.source).toBe('durable');
    expect(result.current.store.durableRenderProjection).not.toBeNull();
    expect(result.current.store.durablePresentation.status).toBe('durable');

    act(() => {
      result.current.layers.drawAllLayers();
    });

    expect(drawLayersToCanvas).toHaveBeenCalledTimes(2);
    const phase2Rendered = drawnLayers(1);
    expect(phase2Rendered.map((layer) => layer.id)).toEqual([layerId]);
    expect(phase2Rendered[0].operations).toEqual([]);
    expect(phase2Rendered[0].tmpCanvas).toBeNull();
  });
});
