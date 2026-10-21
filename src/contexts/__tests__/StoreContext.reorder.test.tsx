import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { convertLegacyHistorySafely, deriveSetLayerPropertiesEntry } from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { freezeDurableDocument, type DurableHistoryEntry } from '../history-model.ts';
import type { LayersRecord } from '../layer-types.ts';
import type { HistoryItem } from '../history-types.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';
import { getSortedLayersArray } from '../layer-utils.ts';
import { OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, REORDER_ACTION } from '../../util/constants.ts';

/**
 * `buildDurableDocument` is the store's only conversion call, and a published
 * document is byte-identical to a full conversion BY DESIGN — that equivalence
 * is what the oracle below checks. So the document cannot say which path a
 * reorder took, and counting that call is the read. The spy delegates to the
 * real converter, so the oracle is a real conversion and every durable
 * assertion in this file is about production behaviour, not a stubbed result.
 */
const { conversions } = vi.hoisted(() => ({ conversions: vi.fn() }));

vi.mock('../history-adapter.ts', async (importActual) => {
  const actual = await importActual<typeof import('../history-adapter.ts')>();
  return {
    ...actual,
    convertLegacyHistorySafely: (
      history: Parameters<typeof actual.convertLegacyHistorySafely>[0],
      options?: Parameters<typeof actual.convertLegacyHistorySafely>[1]
    ) => {
      conversions();
      return actual.convertLegacyHistorySafely(history, options);
    },
  };
});

const documentSize = { width: 400, height: 300 };

function makeLayers(): LayersRecord {
  return Object.fromEntries(
    ['bottom', 'middle', 'top'].map((id, order) => [
      id,
      createMockLayer({
        id,
        name: id,
        order,
        source: { kind: 'blank', color: '#ffffff', opacity: 1, pos: { x: 0, y: 0, width: 100, height: 100 } },
      }),
    ])
  ) as LayersRecord;
}

/** A layer the store record holds and no durable baseline ever names. */
function runtimeOnlyLayer() {
  return createMockLayer({
    id: 'extra',
    name: 'extra',
    order: 3,
    source: { kind: 'blank', color: '#ffffff', opacity: 1, pos: { x: 0, y: 0, width: 100, height: 100 } },
  });
}

function useHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function setup(layers = makeLayers()) {
  const { result } = renderHook(useHarness, { wrapper: StoreProvider });
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
  return result;
}

/**
 * An open document with a baseline entry, which is the only state where the
 * append boundary has a durable document it could extend: an empty timeline is
 * never at its tip, so nothing is ever published from one.
 *
 * `sourceLayers` is the baseline the durable conversion reads, kept separate
 * from the store record `layers` so a test can hold the two apart. Production
 * passes the same record to both.
 */
function setupWithDocument(
  layers: LayersRecord = makeLayers(),
  sourceLayers: LayersRecord = layers,
  documentId = 'reorder-durable-append'
) {
  const result = setup(layers);
  const frame = documentFrameFromSize(documentSize);
  act(() => {
    result.current.dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId,
        history: [
          {
            id: 'baseline',
            actionName: OPEN_DOCUMENT_ACTION,
            layerId: Object.keys(sourceLayers)[0]!,
            documentSource: { layers: sourceLayers, size: documentSize, frame },
          },
        ],
        historyIndex: 0,
        updates: { layers, totalSize: documentSize, documentFrame: frame, hasImage: true },
      },
    });
  });
  return result;
}

function reorder(dispatch: StoreDispatch, layerToMoveId: string, afterWhichLayerId?: string | null) {
  act(() => {
    dispatch({ type: 'REORDER_LAYERS', payload: { layerToMoveId, afterWhichLayerId } });
  });
}

function orders(layers: LayersRecord) {
  return Object.fromEntries(Object.entries(layers).map(([id, layer]) => [id, layer.order]));
}

function orderMap(store: StoreData) {
  const operation = store.durableDocument!.history.at(-1)!.operation;
  return operation.kind === 'reorder-layers' ? operation.orderByLayerId : null;
}

/** The layer ids bottom first, through the same helper the store uses. */
function sequence(layers: LayersRecord) {
  return getSortedLayersArray(layers).map((layer) => layer.id);
}

/** The same sequence, as the durable document itself orders its layers. */
function durableSequence(store: StoreData) {
  const replayed = replayDurableDocument(store.durableDocument!, store.durableDocument!.cursor);
  return Object.values(replayed.layers)
    .sort((left, right) => left.snapshot.order - right.snapshot.order)
    .map((layer) => layer.snapshot.id);
}

/**
 * What a FULL conversion of the store's final legacy history produces, from the
 * same converter `buildDurableDocument` itself calls, over the same six inputs.
 *
 * `durableRevision` is an argument rather than read off the shadow under test,
 * so the oracle cannot inherit the one value it is meant to check. Everything
 * else — the baseline, the entry ids, the operation kinds, the order maps, the
 * cursor, and the `enabled` flags — comes from the conversion.
 *
 * ORDERING HAZARD, load-bearing: `convertLegacyHistorySafely` is the mocked spy
 * at the top of this file, and this function calls it, so the oracle increments
 * the same counter the tests count. Every `expect(conversions).toHaveBeenCalled…`
 * must therefore be asserted BEFORE the `conversionOracle` call in its test, and
 * each test that counts ends with a `toHaveBeenCalledTimes(n)` that is a
 * positive control — it would fail if the mock were dead or the store stopped
 * converting. The refusal tests are those controls; if one of them ever passes
 * without a conversion having happened, the count assertion is not doing its job.
 */
function conversionOracle(store: StoreData, durableRevision: number) {
  const converted = convertLegacyHistorySafely(store.history, {
    documentId: store.documentId,
    documentRevision: store.documentRevision,
    branchRevision: store.branchRevision,
    durableRevision,
    initialSize: store.totalSize,
    initialFrame: store.documentFrame,
  });
  if (!converted.document) {
    throw new Error(`The oracle conversion is not current: ${JSON.stringify(converted.diagnostics)}`);
  }
  return freezeDurableDocument({
    ...converted.document,
    cursor: converted.legacyCursorToDurableCursor[store.historyIndex] ?? -1,
  });
}

/**
 * A commit whose plan disagrees with its own legacy entry, so the store reports
 * `durable-append-mismatch` and rebuilds. A publication carries that diagnostic
 * into the next commit and a reconversion replaces it, so its survival after
 * the reorder is a direct read of which path the reorder took.
 */
function plantMismatch(result: ReturnType<typeof setupWithDocument>, id = 'rename-1') {
  const entry: HistoryItem = {
    id,
    actionName: RENAME_LAYER_ACTION,
    layerId: 'bottom',
    args: { name: 'Renamed' },
  };
  act(() => {
    result.current.dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: {
            ...result.current.store.layers,
            bottom: { ...result.current.store.layers.bottom, name: 'Renamed' },
          },
        },
        historyItem: entry,
        durableEntry: {
          ...(deriveSetLayerPropertiesEntry(entry) as DurableHistoryEntry),
          operation: { kind: 'set-layer-properties', layerId: 'bottom', patch: { name: 'Somewhere else' } },
        },
      },
    });
  });
  return entry;
}

describe('StoreContext REORDER_LAYERS', () => {
  it('moves a layer to the bottom from the current store layers', () => {
    const result = setup();

    reorder(result.current.dispatch, 'top');

    expect(orders(result.current.store.layers)).toEqual({ bottom: 0, middle: 1, top: -1 });
    expect(result.current.store.hasUnsavedChanges).toBe(true);
  });

  it('moves a layer after the requested anchor using the current store layers', () => {
    const result = setup();

    reorder(result.current.dispatch, 'bottom', 'middle');

    expect(orders(result.current.store.layers)).toEqual({ bottom: 2, middle: 1, top: 4 });
  });

  it('shares one id between the appended legacy and converted reorder entries', () => {
    const layers = makeLayers();
    const result = setupWithDocument(layers, layers, 'reorder-id-sharing');

    reorder(result.current.dispatch, 'bottom', 'top');

    const legacyEntry = result.current.store.history.at(-1)!;
    expect(legacyEntry).toMatchObject({
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'bottom', afterWhichLayerId: 'top' },
    });
    expect(result.current.store.durableDocument?.history.at(-1)?.id).toBe(legacyEntry.id);
  });

  it('keeps same-batch reorders equivalent to separately flushed dispatches', () => {
    const batched = setup();
    const flushed = setup();

    act(() => {
      batched.current.dispatch({
        type: 'REORDER_LAYERS',
        payload: { layerToMoveId: 'top', afterWhichLayerId: 'bottom' },
      });
      batched.current.dispatch({
        type: 'REORDER_LAYERS',
        payload: { layerToMoveId: 'bottom', afterWhichLayerId: 'middle' },
      });
    });
    reorder(flushed.current.dispatch, 'top', 'bottom');
    reorder(flushed.current.dispatch, 'bottom', 'middle');

    expect(orders(batched.current.store.layers)).toEqual(orders(flushed.current.store.layers));
    expect(batched.current.store.history.map(({ actionName, args }) => ({ actionName, args }))).toEqual(
      flushed.current.store.history.map(({ actionName, args }) => ({ actionName, args }))
    );
  });

  it.each([
    { layerToMoveId: 'bottom', afterWhichLayerId: 'missing-anchor' },
    { layerToMoveId: 'missing-mover', afterWhichLayerId: 'middle' },
  ])('keeps layers unchanged when the $layerToMoveId or anchor is missing', (intent) => {
    const result = setup();
    const before = result.current.store.layers;
    const beforeOrders = orders(before);

    reorder(result.current.dispatch, intent.layerToMoveId, intent.afterWhichLayerId);

    expect(result.current.store.layers).toBe(before);
    expect(orders(result.current.store.layers)).toEqual(beforeOrders);
    expect(result.current.store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: intent.layerToMoveId,
      args: intent,
    });
  });

  it('does not let a stale hook closure revert a rename that landed before reorder dispatch', () => {
    const result = setup();
    const staleMove = result.current.layers.moveLayerAfter;
    const renamedLayers = {
      ...result.current.store.layers,
      bottom: { ...result.current.store.layers.bottom, name: 'Renamed' },
    } as LayersRecord;
    const rename: HistoryItem = {
      id: 'rename-before-reorder',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'bottom',
      args: { name: 'Renamed' },
    };

    act(() => {
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: { updates: { layers: renamedLayers }, historyItem: rename },
      });
    });
    act(() => {
      staleMove('bottom', 'top');
    });

    expect(result.current.store.layers.bottom.name).toBe('Renamed');
    expect(result.current.store.layers.bottom.order).toBe(3);
    expect(result.current.store.history.map((item) => item.actionName)).toEqual([RENAME_LAYER_ACTION, REORDER_ACTION]);
    expect(result.current.store.history.at(-1)?.args).toEqual({
      layerToMoveId: 'bottom',
      afterWhichLayerId: 'top',
    });
  });
});

describe('StoreContext REORDER_LAYERS through the append boundary', () => {
  it('publishes a document identical to the full conversion of the same history', () => {
    const result = setupWithDocument();
    const base = result.current.store.durableDocument!;
    // A document baseline is not a history entry, so the exact shadow starts empty.
    expect(base.history).toEqual([]);
    expect(base.cursor).toBe(-1);
    conversions.mockClear();

    reorder(result.current.dispatch, 'top', 'bottom');

    // FAILS WITHOUT THE CHANGE: the boundary is what skips the reconversion, and
    // the published document is otherwise identical to the converted one, so this
    // count is the only statement that the fast path ran.
    expect(conversions).not.toHaveBeenCalled();

    const store = result.current.store;
    const published = store.durableDocument!;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    // The shadow grew by exactly the one entry the legacy append made, one
    // revision, and one cursor step — never ahead of the legacy cursor.
    expect(published.durableRevision).toBe(base.durableRevision + 1);
    expect(published.history).toHaveLength(base.history.length + 1);
    expect(published.cursor).toBe(base.cursor + 1);
    expect(published.cursor).toBeLessThanOrEqual(store.historyIndex);
    expect(published.history.at(-1)).toMatchObject({
      id: store.history.at(-1)!.id,
      enabled: true,
      operation: { kind: 'reorder-layers', orderByLayerId: { bottom: 0, top: 1, middle: 2 } },
    });

    // THE ORACLE: the whole document, against a real conversion of the same
    // legacy history — ids, kinds, order maps, cursor and `enabled` included.
    expect(published).toEqual(conversionOracle(store, base.durableRevision + 1));
  });

  it('publishes a second reorder onto the first', () => {
    const result = setupWithDocument();
    reorder(result.current.dispatch, 'top', 'bottom');
    const base = result.current.store.durableDocument!;
    conversions.mockClear();

    // FAILS WITHOUT THE CHANGE: the second append would reconvert the timeline.
    reorder(result.current.dispatch, 'bottom', 'top');

    expect(conversions).not.toHaveBeenCalled();
    const store = result.current.store;
    const published = store.durableDocument!;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    // Both appends published, and the second was planned against the order the
    // first one published, so composing is not just "the first worked".
    expect(published.history.map((entry) => entry.id)).toEqual([store.history[1]!.id, store.history[2]!.id]);
    expect(published.history.map((entry) => entry.operation.kind)).toEqual(['reorder-layers', 'reorder-layers']);
    expect(published.history[0]!.operation).toEqual({
      kind: 'reorder-layers',
      orderByLayerId: { bottom: 0, top: 1, middle: 2 },
    });
    expect(published.history[1]!.operation).toEqual({
      kind: 'reorder-layers',
      orderByLayerId: { top: 0, bottom: 1, middle: 2 },
    });
    expect(published.cursor).toBe(1);
    expect(published.durableRevision).toBe(base.durableRevision + 1);
    expect(published).toEqual(conversionOracle(store, base.durableRevision + 1));
  });

  it.each([
    { layerToMoveId: 'bottom', afterWhichLayerId: 'missing-anchor' },
    { layerToMoveId: 'missing-mover', afterWhichLayerId: 'middle' },
  ])('converts rather than publishing a $layerToMoveId after $afterWhichLayerId', (intent) => {
    const result = setupWithDocument();
    const base = result.current.store.durableDocument!;
    conversions.mockClear();

    reorder(result.current.dispatch, intent.layerToMoveId, intent.afterWhichLayerId);

    // The derivation refuses a move that names a layer the document does not
    // hold, and a refusal is a precondition rather than a writer defect: the
    // store converts the timeline and reports nothing. Without the boundary this
    // conversion ran too, so the case pins the refusal SHAPE, not the routing —
    // what it forbids is the store publishing a fabricated order map for a move
    // legacy replay never performs.
    expect(conversions).toHaveBeenCalledTimes(1);
    const store = result.current.store;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.code)).not.toContain('durable-append-mismatch');
    // The legacy timeline keeps the no-op entry as the replay authority; the
    // shadow records no move for it and its cursor stays on the baseline.
    expect(store.history.at(-1)).toMatchObject({
      actionName: REORDER_ACTION,
      layerId: intent.layerToMoveId,
      args: intent,
    });
    expect(store.durableDocument!.history).toEqual([]);
    expect(store.durableDocument!.cursor).toBe(-1);
    expect(store.durableDocument).toEqual(conversionOracle(store, base.durableRevision + 1));
  });

  it('refuses a reorder while the durable layer set and the store record disagree', () => {
    const durable = makeLayers();
    const result = setupWithDocument({ ...durable, extra: runtimeOnlyLayer() }, durable);
    expect(result.current.store.durableStatus).toBe('current');
    conversions.mockClear();

    // Mover and anchor are in BOTH layer sets, so the derivation has an order map
    // to publish and only the order precondition can refuse it. The store record
    // holds a fourth layer the shadow cannot name.
    reorder(result.current.dispatch, 'top', 'bottom');

    // The store cannot answer the question, which is a precondition and not a
    // writer defect: it converts and reports nothing. As with the two refusals
    // above, the conversion ran before the change too, so what this pins is that
    // no map keyed on the divergent record is ever published.
    expect(conversions).toHaveBeenCalledTimes(1);
    const store = result.current.store;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.code)).not.toContain('durable-append-mismatch');
    // The runtime record is still reordered — a refused publication never rejects
    // a legacy-valid edit — while the shadow's map is keyed on the layer set the
    // shadow itself holds. A published map would name the runtime-only layer and
    // renumber the three layers the two models do agree on.
    expect(orders(store.layers)).toEqual({ bottom: 0, top: 1, middle: 3, extra: 5 });
    expect(orderMap(store)).toEqual({ bottom: 0, top: 1, middle: 2 });
  });

  // FAILS WITHOUT THE CHANGE: the durable projection would omit the runtime-only layer.
  it('does not publish durable presentation when a reorder leaves a runtime-only layer', async () => {
    const result = setupWithDocument({ ...makeLayers(), extra: runtimeOnlyLayer() }, makeLayers());

    reorder(result.current.dispatch, 'top', 'bottom');
    await vi.waitFor(() => {
      expect(result.current.store.durablePresentation.status).toBe('legacy-fallback');
    });

    const store = result.current.store;
    expect(store.renderSelector.source).toBe('legacy');
    expect(store.durablePresentation).toMatchObject({ status: 'legacy-fallback', reason: 'renderer-incompatible' });
    expect(store.durableRenderProjection).toBeNull();
  });

  // FAILS WITHOUT THE CHANGE: navigation would accept a projection with the wrong order.
  it('rejects durable navigation when the runtime layer order differs from replay', async () => {
    const durable = makeLayers();
    const runtime = Object.fromEntries(
      Object.entries(durable).map(([id, layer], index) => [id, { ...layer, order: (index + 1) % 3 }])
    ) as LayersRecord;
    const result = setupWithDocument(runtime, durable);

    const before = result.current.store;
    act(() => {
      result.current.dispatch({
        type: 'APPLY_HISTORY_REPLAY',
        payload: {
          updates: { layers: runtime, deletedLayers: {}, activeLayerId: null },
          timeline: {
            entries: before.history,
            cursor: before.historyIndex,
            branchRevision: before.branchRevision,
          },
        },
      });
    });

    let outcome: Awaited<ReturnType<StoreData['publishDurableNavigationPresentation']>>;
    await act(async () => {
      outcome = await result.current.store.publishDurableNavigationPresentation();
    });

    expect(outcome!).toMatchObject({ status: 'legacy-fallback', reason: 'renderer-incompatible' });
    expect(result.current.store.durablePresentation).toMatchObject({
      status: 'legacy-fallback',
      reason: 'renderer-incompatible',
    });
    expect(result.current.store.renderSelector.source).toBe('legacy');
    expect(result.current.store.durableRenderProjection).toBeNull();
  });

  it('publishes a self-anchored reorder without desynchronizing the next append', () => {
    const result = setupWithDocument();
    const before = result.current.store.durableDocument!;
    const documentSequenceBefore = sequence(result.current.store.layers);
    conversions.mockClear();

    reorder(result.current.dispatch, 'top', 'top');
    const afterSelfAnchor = result.current.store;
    expect(conversions).not.toHaveBeenCalled();
    expect(sequence(afterSelfAnchor.layers)).toEqual(documentSequenceBefore);
    expect(durableSequence(afterSelfAnchor)).toEqual(documentSequenceBefore);
    expect(afterSelfAnchor.durableDiagnostics).toEqual([]);
    expect(afterSelfAnchor.durableDocument).toEqual(conversionOracle(afterSelfAnchor, before.durableRevision + 1));
    expect(conversions).toHaveBeenCalledTimes(1);
    conversions.mockClear();

    reorder(result.current.dispatch, 'bottom', 'middle');

    expect(conversions).not.toHaveBeenCalled();
    const store = result.current.store;
    expect(store.durableStatus).toBe('current');
    expect(store.durableDiagnostics).toEqual([]);
    expect(durableSequence(store)).toEqual(sequence(store.layers));
    expect(store.durableDocument).toEqual(conversionOracle(store, before.durableRevision + 2));
    expect(conversions).toHaveBeenCalledTimes(1);
  });

  it('carries an earlier durable-append-mismatch into a published reorder', () => {
    const result = setupWithDocument();
    const planted = plantMismatch(result);
    expect(result.current.store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'durable-append-mismatch',
    ]);
    const base = result.current.store.durableDocument!;
    conversions.mockClear();

    reorder(result.current.dispatch, 'top', 'bottom');

    // FAILS WITHOUT THE CHANGE: a publication carries the store's diagnostics
    // forward and a whole-timeline reconversion replaces them with the
    // converter's own — which is empty, because the timeline converts cleanly.
    expect(conversions).not.toHaveBeenCalled();
    const store = result.current.store;
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(store.durableDiagnostics.map((diagnostic) => diagnostic.historyId)).toEqual([planted.id]);
    expect(store.durableStatus).toBe('current');
    const published = store.durableDocument!;
    expect(published.history.map((entry) => entry.id)).toEqual([planted.id, store.history.at(-1)!.id]);
    expect(published.history.at(-1)).toMatchObject({
      enabled: true,
      operation: { kind: 'reorder-layers', orderByLayerId: { bottom: 0, top: 1, middle: 2 } },
    });
    expect(published.cursor).toBe(1);
    expect(published.durableRevision).toBe(base.durableRevision + 1);
  });
});
