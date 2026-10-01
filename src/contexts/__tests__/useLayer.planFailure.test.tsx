import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { getAssetRegistry } from '../asset-registry.ts';
import { useLayers } from '../useLayer.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import { documentFrameFromSize, type DocumentFrame } from '../document-frame.ts';
import { OPEN_DOCUMENT_ACTION, REMOVE_ACTION } from '../../util/constants.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';

type DrawLayersToCanvas = (canvas: HTMLCanvasElement, layers: readonly Layer[], frame: DocumentFrame) => boolean;

const drawLayersToCanvas = vi.hoisted(() => vi.fn<DrawLayersToCanvas>(() => true));

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

/**
 * The append boundary is the only thing that can turn a removal into a durable
 * entry, so the failure this file exercises is made at the boundary itself. The
 * spy delegates to the real boundary everywhere except the one call under test,
 * which is why every durable assertion below is about production behaviour and
 * not about a stubbed return value.
 */
const planHistoryAppend = vi.hoisted(() => vi.fn());

vi.mock('../history-append.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../history-append.ts')>();
  return { ...actual, planHistoryAppend };
});

let realPlanHistoryAppend: typeof import('../history-append.ts').planHistoryAppend;

const documentSize = { width: 800, height: 600 };

/** A layer the durable model can convert, so an append is decided against a real shadow. */
function documentLayer(id: string, order: number): Layer {
  return {
    ...createMockLayer({
      id,
      name: id,
      order,
      isBedrock: true,
      pos: { x: 0, y: 0, width: 800, height: 600 },
    }),
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: true,
      size: { width: 800, height: 600 },
    },
  } as Layer;
}

function useLayerHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

/**
 * An open document with a baseline entry, which is the only state where the
 * append gate has a durable document it could extend: an empty timeline is
 * never at its tip, so nothing published from one.
 */
function setupWithDocument(layers: LayersRecord = { [documentLayer('layer-1', 0).id]: documentLayer('layer-1', 0) }) {
  const { result } = renderHook(useLayerHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        layers,
        activeLayerId: Object.keys(layers)[0] ?? null,
        totalSize: documentSize,
        documentFrame: documentFrameFromSize(documentSize),
        hasImage: true,
      },
    });
  });
  act(() => {
    result.current.dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: 'doc-plan-failure',
        history: [
          {
            id: 'baseline',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: Object.keys(layers)[0]!,
            documentSource: { layers, size: documentSize, frame: documentFrameFromSize(documentSize) },
          },
        ],
        historyIndex: 0,
        updates: {
          layers,
          totalSize: documentSize,
          documentFrame: documentFrameFromSize(documentSize),
          hasImage: true,
        },
      },
    });
  });
  return result;
}

beforeAll(async () => {
  ({ planHistoryAppend: realPlanHistoryAppend } =
    await vi.importActual<typeof import('../history-append.ts')>('../history-append.ts'));
});

beforeEach(() => {
  drawLayersToCanvas.mockClear();
  planHistoryAppend.mockClear();
  planHistoryAppend.mockImplementation(realPlanHistoryAppend);
});

afterEach(() => {
  drawLayersToCanvas.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLayers removeLayer reports a failed plan', () => {
  it('reports the failure once, passing the thrown error itself so its stack survives', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;
    // The very object the boundary threw, not a message read off it: the console
    // is the whole error channel (HANDOFF.md §98), and a stringified or
    // template-literal report flattens the stack out of the one place it can be
    // read. `toBe` is the assertion that survives that mutation — an
    // `objectContaining({ message })` would pass a re-thrown equal-message Error,
    // and a `toHaveBeenCalledWith` deep equality would pass one outright.
    const thrown = new Error('the durable projection failed');
    planHistoryAppend.mockImplementationOnce(() => {
      throw thrown;
    });

    act(() => {
      result.current.layers.removeLayer(id);
    });

    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(thrown);
    expect(errorSpy.mock.calls[0]![0]).toBe(thrown);
  });

  it('reports nothing on the removal path when the boundary does not throw', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;
    expect(planHistoryAppend).not.toHaveBeenCalled();

    act(() => {
      result.current.layers.removeLayer(id);
    });

    // A report on a successful removal would make the console unreadable and
    // would prove nothing about the failure path, so the single call above is
    // attributable to the throw rather than to the removal.
    expect(errorSpy).not.toHaveBeenCalled();
    expect(result.current.store.durableStatus).toBe('current');
  });
});

describe('useLayers removeLayer recovers from a failed plan', () => {
  it('still removes the layer and appends its legacy entry', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = setupWithDocument();
    const id = Object.keys(result.current.store.layers)[0]!;
    // A shadow projection that throws must not reject a valid removal, exactly as
    // the selection writers' `catch` re-dispatch says. Nothing has been appended
    // and no layer has left the record when the plan runs, so the catch path is
    // the whole edit rather than a repair of it.
    planHistoryAppend.mockImplementationOnce(() => {
      throw new Error('the durable projection failed');
    });

    act(() => {
      result.current.layers.removeLayer(id);
    });

    const store = result.current.store;
    expect(store.layers[id]).toBeUndefined();
    expect(store.deletedLayers[id]).toMatchObject({ id });
    expect(store.history).toHaveLength(2);
    expect(store.history[1]).toMatchObject({ actionName: REMOVE_ACTION, layerId: id, args: {} });
    // The legacy timeline is the replay authority, so the removal is recorded
    // even though the durable branch could not be planned.
    expect(store.durableStatus).toBe('current');
    expect(store.durableDocument!.history.map((entry) => entry.operation.kind)).toEqual(['remove-layer']);
    errorSpy.mockRestore();
  });

  it('recovers with no durableEntry, so the store reconverts rather than publishing a plan', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The discriminator the resulting document cannot provide: a clean removal's
    // published document and its reconverted document are byte-identical by
    // design, so no assertion on the shadow tells the two paths apart. The
    // registry does — a publication never opens an asset transaction and every
    // reconversion does (`convertLegacyHistorySafely`, `history-adapter.ts:864`,
    // reached from `buildDurableDocument`). The fallback dispatch carries no
    // `durableEntry`, so the transaction is opened; a recovery that minted one,
    // or one that dropped the layer instead of re-dispatching, leaves this false.
    const beginTransaction = vi.spyOn(getAssetRegistry(), 'beginDocumentAssetTransaction');
    const result = setupWithDocument();
    // `setupWithDocument` replaces the document, which itself reconverts; only
    // the removal is under test here.
    beginTransaction.mockClear();
    const id = Object.keys(result.current.store.layers)[0]!;

    try {
      planHistoryAppend.mockImplementationOnce(() => {
        throw new Error('the durable projection failed');
      });

      act(() => {
        result.current.layers.removeLayer(id);
      });

      expect(beginTransaction).toHaveBeenCalled();
      // The layer is gone from the record and the timeline grew by the removal,
      // so the re-dispatch is what produced both, not merely a diagnostic.
      expect(result.current.store.layers[id]).toBeUndefined();
      expect(result.current.store.history).toHaveLength(2);
      expect(result.current.store.history[1]).toMatchObject({ actionName: REMOVE_ACTION, layerId: id, args: {} });
    } finally {
      beginTransaction.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
