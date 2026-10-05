import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { deriveReorderLayersEntry, reorderOrderAfterIntent, validatePlannedDurableEntry } from '../history-append.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { DURABLE_SCHEMA_VERSION, type DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import { getSortedLayersArray, reorderLayers } from '../layer-utils.ts';
import type { Layer, LayerId, LayerSource, LayersRecord } from '../layer-types.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, REORDER_ACTION } from '../../util/constants.ts';

const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 10, height: 10 },
};

function blankLayer(id: string, order = 0): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: 0, y: 0, width: 100, height: 80 },
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 0, y: 0, width: 100, height: 80 },
    },
    operations: [],
  };
}

function baselineHistory(): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': blankLayer('layer-1') },
        size: initialSize,
        frame: baselineFrame,
      },
    },
  ];
}

function convert(items: HistoryItem[], registry: AssetRegistry, options: Record<string, unknown> = {}) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
    ...options,
  });
}

/**
 * The stack every matrix case runs against, bottom first. `layer-1` is the
 * baseline and sits at runtime `order` 0; each `NEW_LAYER_ACTION` below takes
 * the next order up, so the converter's layer snapshots and the store's record
 * hold the same sequence, which is the agreement the parity assertions rest on.
 */
const stackIds = ['layer-1', 'layer-b', 'layer-c', 'layer-d'] as const;

/** The runtime record `StoreContext` would hold after the baseline and the new-layer appends. */
function runtimeStack(ids: readonly string[] = stackIds): LayersRecord {
  return Object.fromEntries(ids.map((id, index) => [id, blankLayer(id, index)])) as LayersRecord;
}

/**
 * The runtime record's own order, bottom first, through the SAME helper the
 * store uses. This was a hand-copy of the comparator while the production sort
 * was private, which meant a reversed production sort left this whole file
 * green; it is now `getSortedLayersArray` because the sequence this reads is
 * the feature.
 */
function bottomFirst(layers: LayersRecord): LayerId[] {
  return getSortedLayersArray(layers).map((layer) => layer.id);
}

function newLayerEntries(ids: readonly string[] = stackIds): HistoryItem[] {
  return ids
    .filter((id) => id !== 'layer-1')
    .map((id) => ({ id: `new-${id}`, actionName: NEW_LAYER_ACTION, layerId: id, layerSource: blankSource }));
}

function reorderItem(
  layerToMoveId: LayerId,
  afterWhichLayerId: LayerId | null,
  overrides: Partial<HistoryItem> = {}
): HistoryItem {
  return {
    id: 'reorder',
    actionName: REORDER_ACTION,
    layerId: 'document',
    args: { layerToMoveId, afterWhichLayerId },
    ...overrides,
  };
}

function recordedOrderMap(converted: {
  document: { history: readonly DurableHistoryEntry[] };
}): Record<LayerId, number> {
  const entry = converted.document.history.find((candidate) => candidate.id === 'reorder');
  if (!entry || entry.operation.kind !== 'reorder-layers') {
    throw new Error('the conversion recorded no reorder-layers operation');
  }
  return entry.operation.orderByLayerId;
}

/** A durable reorder entry, narrowed so the operation's map is readable. */
type ReorderOperation = Readonly<{ kind: 'reorder-layers'; orderByLayerId: Readonly<Record<LayerId, number>> }>;
type PlannedReorderEntry = DurableHistoryEntry<ReorderOperation>;

function plannedReorder(item: HistoryItem, preOrder: readonly LayerId[]): PlannedReorderEntry {
  const entry = deriveReorderLayersEntry(item, preOrder);
  if (!entry || entry.operation.kind !== 'reorder-layers') {
    throw new Error(`expected a durable reorder entry for ${item.id}`);
  }
  return entry as PlannedReorderEntry;
}

function withOrderMap(entry: DurableHistoryEntry, orderByLayerId: Record<LayerId, number>): DurableHistoryEntry {
  return { ...entry, operation: { kind: 'reorder-layers', orderByLayerId } };
}

describe('reorderOrderAfterIntent agrees with the converter', () => {
  // Every case below is checked two ways: against `reorderOrderAfterIntent`, which
  // is the independent second implementation, and against the two properties
  // that define the operation at all — a dense 0..n-1 permutation of the stack,
  // and the mover sitting directly above the anchor (or at the bottom).
  it.each([
    { label: 'no anchor: a middle layer goes to the bottom', layerToMoveId: 'layer-c', afterWhichLayerId: null },
    { label: 'no anchor: the bottom layer stays at the bottom', layerToMoveId: 'layer-1', afterWhichLayerId: null },
    { label: 'no anchor: the top layer goes to the bottom', layerToMoveId: 'layer-d', afterWhichLayerId: null },
    {
      label: 'anchor at the first position: the layer above it',
      layerToMoveId: 'layer-b',
      afterWhichLayerId: 'layer-1',
    },
    { label: 'anchor at the first position: the top layer', layerToMoveId: 'layer-d', afterWhichLayerId: 'layer-1' },
    { label: 'anchor at a middle position: the bottom layer', layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-c' },
    { label: 'anchor at a middle position: the top layer', layerToMoveId: 'layer-d', afterWhichLayerId: 'layer-b' },
    { label: 'anchor at the last position: the middle layer', layerToMoveId: 'layer-b', afterWhichLayerId: 'layer-d' },
    { label: 'anchor at the last position: the bottom layer', layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-d' },
  ] satisfies ReadonlyArray<{ label: string; layerToMoveId: LayerId; afterWhichLayerId: LayerId | null }>)(
    '$label',
    ({ layerToMoveId, afterWhichLayerId }) => {
      const registry = new AssetRegistry();
      const preOrder = bottomFirst(runtimeStack());
      const intent = { layerToMoveId, afterWhichLayerId };

      const converted = convert([...newLayerEntries(), reorderItem(layerToMoveId, afterWhichLayerId)], registry);
      const recorded = recordedOrderMap(converted);

      expect(converted.diagnostics).toEqual([]);
      expect(converted.document.history.map((entry) => entry.id)).toEqual([
        'new-layer-b',
        'new-layer-c',
        'new-layer-d',
        'reorder',
      ]);
      expect(recorded).toEqual(reorderOrderAfterIntent(preOrder, intent));
      // The map is a dense permutation of the pre-move stack: every id present
      // exactly once, ranked 0..n-1, so no layer is dropped or duplicated.
      expect(Object.keys(recorded).sort()).toEqual([...preOrder].sort());
      expect(Object.values(recorded).sort((left, right) => left - right)).toEqual(preOrder.map((_, i) => i));
      // The mover lands directly above the anchor, or at the bottom when none is
      // named — the placement the entry's args describe.
      if (afterWhichLayerId) {
        expect(recorded[layerToMoveId]).toBe(recorded[afterWhichLayerId] + 1);
      } else {
        expect(recorded[layerToMoveId]).toBe(0);
      }
      registry.shutdown();
    }
  );

  // Hand-written maps, not derived from either implementation: the point of the
  // drift pin is that a wrong rule on both sides still fails here.
  it.each([
    {
      label: 'a no-anchor move puts the mover at the bottom',
      layerToMoveId: 'layer-c',
      afterWhichLayerId: null,
      expectedOrder: { 'layer-c': 0, 'layer-1': 1, 'layer-b': 2, 'layer-d': 3 },
    },
    {
      label: 'a no-anchor move of the top layer puts it at the bottom',
      layerToMoveId: 'layer-d',
      afterWhichLayerId: null,
      expectedOrder: { 'layer-d': 0, 'layer-1': 1, 'layer-b': 2, 'layer-c': 3 },
    },
    {
      label: 'a move of the bottom layer above the top renumbers the stack',
      layerToMoveId: 'layer-1',
      afterWhichLayerId: 'layer-d',
      expectedOrder: { 'layer-b': 0, 'layer-c': 1, 'layer-d': 2, 'layer-1': 3 },
    },
    {
      // "after" is a higher index, i.e. further up the stack, so anchoring on
      // the layer above the mover moves the mover past it: the pair swaps.
      label: 'a move after the layer immediately above the mover swaps the pair',
      layerToMoveId: 'layer-b',
      afterWhichLayerId: 'layer-c',
      expectedOrder: { 'layer-1': 0, 'layer-c': 1, 'layer-b': 2, 'layer-d': 3 },
    },
    {
      label: 'a move after the layer immediately below the mover preserves the order',
      layerToMoveId: 'layer-b',
      afterWhichLayerId: 'layer-1',
      expectedOrder: { 'layer-1': 0, 'layer-b': 1, 'layer-c': 2, 'layer-d': 3 },
    },
    {
      label: 'a move of the top layer onto the one below it preserves the order',
      layerToMoveId: 'layer-d',
      afterWhichLayerId: 'layer-c',
      expectedOrder: { 'layer-1': 0, 'layer-b': 1, 'layer-c': 2, 'layer-d': 3 },
    },
    {
      label: 'a no-anchor move of the bottom layer preserves the order',
      layerToMoveId: 'layer-1',
      afterWhichLayerId: null,
      expectedOrder: { 'layer-1': 0, 'layer-b': 1, 'layer-c': 2, 'layer-d': 3 },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    layerToMoveId: LayerId;
    afterWhichLayerId: LayerId | null;
    expectedOrder: Record<LayerId, number>;
  }>)('$label', ({ layerToMoveId, afterWhichLayerId, expectedOrder }) => {
    const registry = new AssetRegistry();
    const preOrder = bottomFirst(runtimeStack());

    const converted = convert([...newLayerEntries(), reorderItem(layerToMoveId, afterWhichLayerId)], registry);

    expect(recordedOrderMap(converted)).toEqual(expectedOrder);
    expect(recordedOrderMap(converted)).toEqual(
      reorderOrderAfterIntent(preOrder, { layerToMoveId, afterWhichLayerId })
    );
    registry.shutdown();
  });

  it.each([
    { label: 'a mover the stack does not hold', layerToMoveId: 'ghost', afterWhichLayerId: null },
    { label: 'a named anchor the stack does not hold', layerToMoveId: 'layer-b', afterWhichLayerId: 'ghost' },
    { label: 'a mover that is the empty id', layerToMoveId: '', afterWhichLayerId: 'layer-b' },
  ] satisfies ReadonlyArray<{ label: string; layerToMoveId: LayerId; afterWhichLayerId: LayerId | null }>)(
    'refuses $label',
    ({ layerToMoveId, afterWhichLayerId }) => {
      const preOrder = bottomFirst(runtimeStack());

      expect(reorderOrderAfterIntent(preOrder, { layerToMoveId, afterWhichLayerId })).toBeNull();
    }
  );

  it('refuses exactly what the converter declines to record', () => {
    const registry = new AssetRegistry();
    const preOrder = bottomFirst(runtimeStack());

    const converted = convert([...newLayerEntries(), reorderItem('layer-1', 'ghost')], registry);

    // Legacy replay skips the move, so the shadow records no operation and the
    // boundary must refuse rather than fabricate a map — a `null` here and an
    // absent entry there are the same answer.
    expect(reorderOrderAfterIntent(preOrder, { layerToMoveId: 'layer-1', afterWhichLayerId: 'ghost' })).toBeNull();
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['new-layer-b', 'new-layer-c', 'new-layer-d']);
    expect(converted.document.history.map((entry) => entry.operation.kind)).toEqual([
      'create-layer',
      'create-layer',
      'create-layer',
    ]);
    registry.shutdown();
  });

  it('refuses a self-anchored move, where the document and the converter disagree', () => {
    const registry = new AssetRegistry();
    const preOrder = bottomFirst(runtimeStack());

    // `reorderLayers` anchors on the mover's own order and re-assigns the mover
    // after shifting what was above it, so the visible sequence is unchanged.
    // The converter removes the mover from the list first, so its `indexOf` is
    // -1 and it records a move to the bottom. Measured, not assumed: the
    // runtime call below leaves the sequence alone and the converter's map does
    // not. Recording the disagreement is the point — the fix has to change both
    // implementations together, and until it does the boundary must not become a
    // third opinion that publishes a shadow a reconversion would contradict.
    //
    // The mover is the BOTTOM layer, which is the one stack where the two
    // implementations agree: `layer-c` below is the case the disagreement is
    // actually about.
    const moved = { ...runtimeStack() } as Record<string, Layer>;
    reorderLayers({ layers: moved, layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-1' });
    const runtimeSequence = bottomFirst(moved);
    const converted = convert([...newLayerEntries(), reorderItem('layer-1', 'layer-1')], registry);
    const operation = converted.document.history.at(-1)?.operation;

    expect(runtimeSequence).toEqual(preOrder);
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId['layer-1']).toBe(0);
    expect(reorderOrderAfterIntent(preOrder, { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-1' })).toBeNull();
    registry.shutdown();
  });

  it('refuses a self-anchored move of a middle layer, the stack the two really disagree on', () => {
    const registry = new AssetRegistry();
    const preOrder = bottomFirst(runtimeStack());

    const moved = { ...runtimeStack() } as Record<string, Layer>;
    reorderLayers({ layers: moved, layerToMoveId: 'layer-c', afterWhichLayerId: 'layer-c' });
    const runtimeSequence = bottomFirst(moved);
    const converted = convert([...newLayerEntries(), reorderItem('layer-c', 'layer-c')], registry);
    const operation = converted.document.history.at(-1)?.operation;

    // All three answers, executed: the document does not move the layer at all,
    // the converter records a move to the bottom, and the boundary refuses. The
    // refusal is the load-bearing one — a self-anchored move that published the
    // converter's map would reorder the shadow against a document `reorderLayers`
    // never touched, and the next append's `durableLayerOrder` precondition would
    // be the only thing that noticed.
    expect(runtimeSequence).toEqual(preOrder);
    expect(operation).toEqual({
      kind: 'reorder-layers',
      orderByLayerId: { 'layer-c': 0, 'layer-1': 1, 'layer-b': 2, 'layer-d': 3 },
    });
    expect(reorderOrderAfterIntent(preOrder, { layerToMoveId: 'layer-c', afterWhichLayerId: 'layer-c' })).toBeNull();
    registry.shutdown();
  });
});

/**
 * The runtime order values are a separate concern from the order itself, and
 * they are the values production actually has.
 *
 * `reorderLayers` writes `minOrder - 1` for a move to the bottom and `+= 2` for
 * every layer above an anchor (`layer-utils.ts`), so a real stack's orders are
 * sparse, can be negative, and keep their gaps. Every other case in this file
 * runs against the single dense vector `0,1,2,3`, which the production sort
 * cannot get wrong by accident. These cases vary the VALUES while holding the
 * sequence fixed, which is what actually exercises the sort the store performs.
 */
describe('reorderOrderAfterIntent over real runtime order values', () => {
  const intent = { layerToMoveId: 'layer-b' as LayerId, afterWhichLayerId: 'layer-c' as LayerId };

  const stackWithOrders = (orderValues: readonly number[]): LayersRecord =>
    Object.fromEntries(stackIds.map((id, index) => [id, blankLayer(id, orderValues[index] ?? 0)])) as LayersRecord;

  it.each([
    { label: 'the dense vector every other case uses', values: [0, 1, 2, 3] },
    // A move to the bottom writes `minOrder - 1`; repeated moves keep going
    // down. A later anchored move then leaves the gap behind.
    { label: 'a stack driven negative by repeated moves to the bottom', values: [-6, -3, 0, 2] },
    // `+= 2` above an anchor leaves a permanent gap at the anchor's old value.
    { label: 'the gaps an anchored move leaves behind', values: [0, 1, 9, 11] },
    { label: 'a large offset from a document scaled up', values: [100, 102, 104, 900] },
    // Every layer ties. The sort must be stable for the sequence to survive, and
    // the sequence is the only thing the whole feature is derived from.
    { label: 'every order tied, where only a stable sort keeps the sequence', values: [0, 0, 0, 0] },
  ] as const)('$label', ({ values }) => {
    const preOrder = bottomFirst(stackWithOrders(values));

    // The order values moved; the sequence did not, so every map below is the
    // one the dense matrix already pins.
    expect(preOrder).toEqual([...stackIds]);
    expect(reorderOrderAfterIntent(preOrder, intent)).toEqual({
      'layer-1': 0,
      'layer-b': 2,
      'layer-c': 1,
      'layer-d': 3,
    });
  });

  it('reads the sequence out of order values that do not follow the layer ids', () => {
    // A negative value in the middle of the stack is a real outcome, and it
    // means the runtime sequence is NOT the declaration order. Everything
    // downstream is derived from the sequence, so a derivation that trusted the
    // ids or the insertion order instead of the values would be wrong here.
    const preOrder = bottomFirst(stackWithOrders([-4, 0, -2, 3]));

    expect(preOrder).toEqual(['layer-1', 'layer-c', 'layer-b', 'layer-d']);
    // `layer-b` moves to just above `layer-c`, which is now the second from the
    // bottom — so it lands at index 2, not at index 1.
    expect(reorderOrderAfterIntent(preOrder, intent)).toEqual({
      'layer-1': 0,
      'layer-c': 1,
      'layer-b': 2,
      'layer-d': 3,
    });
  });

  it.each([
    { label: 'moves to the bottom', intent: { layerToMoveId: 'layer-b' as LayerId, afterWhichLayerId: null } },
    { label: 'moves to the bottom with no anchor at all', intent: { layerToMoveId: 'layer-b' as LayerId } },
  ])('holds the dense map for a negative-order stack that $label', ({ intent: thisIntent }) => {
    const preOrder = bottomFirst(stackWithOrders([-6, -3, 0, 2]));

    expect(reorderOrderAfterIntent(preOrder, thisIntent)).toEqual({
      'layer-b': 0,
      'layer-1': 1,
      'layer-c': 2,
      'layer-d': 3,
    });
  });
});

/**
 * Every other matrix in this file runs against one four-layer stack, where a
 * dense permutation has room to be dense. These are the stacks that cannot
 * express the shapes the rule has to keep: one layer (the mover is also the
 * anchor's only neighbour), two layers (every move is either a swap or nothing),
 * and none at all. `preOrder` is hand-written rather than read off a record, so
 * the expectations are the rule and not the two implementations agreeing.
 */
describe('reorderOrderAfterIntent over the shortest stacks', () => {
  it.each([
    {
      label: 'a mover an empty stack does not hold',
      preOrder: [],
      layerToMoveId: 'a',
      afterWhichLayerId: null,
      expected: null,
    },
    {
      label: 'an anchor an empty stack does not hold',
      preOrder: [],
      layerToMoveId: 'a',
      afterWhichLayerId: 'a',
      expected: null,
    },
    {
      label: 'the only layer to the bottom',
      preOrder: ['a'],
      layerToMoveId: 'a',
      afterWhichLayerId: null,
      expected: { a: 0 },
    },
    {
      label: 'the only layer self-anchored',
      preOrder: ['a'],
      layerToMoveId: 'a',
      afterWhichLayerId: 'a',
      expected: null,
    },
    {
      label: 'a mover a one-layer stack does not hold',
      preOrder: ['a'],
      layerToMoveId: 'b',
      afterWhichLayerId: null,
      expected: null,
    },
    {
      label: 'the bottom of two above the top',
      preOrder: ['a', 'b'],
      layerToMoveId: 'a',
      afterWhichLayerId: 'b',
      expected: { b: 0, a: 1 },
    },
    {
      // `b` is already directly above `a`, so anchoring there moves it onto its
      // own slot: the map is the pre-move order renumbered onto itself.
      label: 'the top of two above the bottom it already sits above',
      preOrder: ['a', 'b'],
      layerToMoveId: 'b',
      afterWhichLayerId: 'a',
      expected: { a: 0, b: 1 },
    },
    {
      label: 'the top of two to the bottom',
      preOrder: ['a', 'b'],
      layerToMoveId: 'b',
      afterWhichLayerId: null,
      expected: { b: 0, a: 1 },
    },
    {
      label: 'the bottom of two to the bottom',
      preOrder: ['a', 'b'],
      layerToMoveId: 'a',
      afterWhichLayerId: null,
      expected: { a: 0, b: 1 },
    },
    {
      label: 'the top of two self-anchored',
      preOrder: ['a', 'b'],
      layerToMoveId: 'b',
      afterWhichLayerId: 'b',
      expected: null,
    },
    {
      label: 'an anchor a two-layer stack does not hold',
      preOrder: ['a', 'b'],
      layerToMoveId: 'a',
      afterWhichLayerId: 'c',
      expected: null,
    },
    // The anchor is read by truthiness in both implementations, so an empty id is
    // the bottom and not an unknown layer: a refusal here would send the append
    // to a reconversion that records the move the document performs.
    {
      label: 'the empty anchor id',
      preOrder: ['a', 'b'],
      layerToMoveId: 'a',
      afterWhichLayerId: '',
      expected: { a: 0, b: 1 },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    preOrder: readonly LayerId[];
    layerToMoveId: LayerId;
    afterWhichLayerId: LayerId | null;
    expected: Record<LayerId, number> | null;
  }>)('$label', ({ preOrder, layerToMoveId, afterWhichLayerId, expected }) => {
    const order = reorderOrderAfterIntent(preOrder, { layerToMoveId, afterWhichLayerId });

    expect(order).toEqual(expected);

    // The planner reads the same rule through its own guards, and a refusal it
    // does not share becomes a published entry the validator then refuses.
    const entry = deriveReorderLayersEntry(reorderItem(layerToMoveId, afterWhichLayerId), preOrder);
    if (!expected) {
      expect(entry).toBeNull();
    } else {
      expect(entry?.operation.kind === 'reorder-layers' && entry.operation.orderByLayerId).toEqual(expected);
      expect(entry?.id).toBe('reorder');
    }
  });

  it('plans nothing for a reorder over a stack that holds no layer', () => {
    // `[]` is not `null`, so the planner's own guard does not fire and the mover
    // check has to: an empty map published as an order would renumber nothing
    // and durable replay would silently skip every layer it named.
    expect(reorderOrderAfterIntent([], { layerToMoveId: 'a', afterWhichLayerId: null })).toBeNull();
    expect(deriveReorderLayersEntry(reorderItem('a', null), [])).toBeNull();
  });
});

describe('deriveReorderLayersEntry', () => {
  const preOrder = bottomFirst(runtimeStack());

  // `layer-1` starts at the bottom, so this intent genuinely moves it: the
  // anchor takes index 0 and the mover lands directly above it at index 1.
  const item = reorderItem('layer-1', 'layer-b');
  const intentOrder = { 'layer-b': 0, 'layer-1': 1, 'layer-c': 2, 'layer-d': 3 };

  it('returns a frozen entry describing the legacy item', () => {
    const entry = plannedReorder(item, preOrder);

    expect(entry.id).toBe(item.id);
    expect(entry.schemaVersion).toBe(DURABLE_SCHEMA_VERSION);
    expect(entry.enabled).toBe(true);
    expect(entry.operation).toEqual({ kind: 'reorder-layers', orderByLayerId: intentOrder });
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.operation)).toBe(true);
    expect(Object.isFrozen(entry.operation.orderByLayerId)).toBe(true);
  });

  it('takes its id from the item rather than minting one', () => {
    const supplied = reorderItem('layer-c', null, { id: 'reorder-supplied' });

    expect(plannedReorder(supplied, preOrder).id).toBe('reorder-supplied');
  });

  it.each([
    { label: 'the item is disabled', item: reorderItem('layer-1', 'layer-b', { disabled: true }) },
    {
      label: 'the args carry enabled: false',
      item: {
        ...reorderItem('layer-1', 'layer-b'),
        args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-b', enabled: false },
      } as HistoryItem,
    },
  ] satisfies ReadonlyArray<{ label: string; item: HistoryItem }>)(
    'derives a disabled entry when $label',
    ({ item: disabled }) => {
      const entry = plannedReorder(disabled, preOrder);

      expect(entry.enabled).toBe(false);
      // The operation is still the one the enabled move produces; the gate is
      // the entry's, not the map's.
      expect(entry.operation.orderByLayerId).toEqual(intentOrder);
    }
  );

  it.each([
    {
      label: 'a rename rather than a reorder',
      item: {
        id: 'rename',
        actionName: RENAME_LAYER_ACTION,
        layerId: 'layer-1',
        args: { name: 'Other' },
      } as HistoryItem,
      order: preOrder,
    },
    { label: 'a null pre-move order', item: reorderItem('layer-c', null), order: null },
    { label: 'an absent pre-move order', item: reorderItem('layer-c', null), order: undefined },
    {
      label: 'no moving layer in the args',
      item: {
        id: 'reorder',
        actionName: REORDER_ACTION,
        layerId: 'document',
        args: { afterWhichLayerId: 'layer-b' },
      } as HistoryItem,
      order: preOrder,
    },
    { label: 'a mover the pre-move order does not hold', item: reorderItem('ghost', null), order: preOrder },
    { label: 'an anchor the pre-move order does not hold', item: reorderItem('layer-b', 'ghost'), order: preOrder },
  ] satisfies ReadonlyArray<{ label: string; item: HistoryItem; order: readonly LayerId[] | null | undefined }>)(
    'derives no entry for $label',
    ({ item: candidate, order }) => {
      expect(deriveReorderLayersEntry(candidate, order)).toBeNull();
    }
  );

  it('hands out a fresh order map on every call', () => {
    const first = plannedReorder(item, preOrder);
    const second = plannedReorder(item, preOrder);

    expect(first.operation.orderByLayerId).toEqual(second.operation.orderByLayerId);
    expect(first.operation.orderByLayerId).not.toBe(second.operation.orderByLayerId);
    expect(first.operation).not.toBe(second.operation);
  });

  it('reads an undefined and an explicit null anchor as the same move to the bottom', () => {
    const withUndefined = plannedReorder(
      {
        id: 'reorder',
        actionName: REORDER_ACTION,
        layerId: 'document',
        args: { layerToMoveId: 'layer-c' },
      } as HistoryItem,
      preOrder
    );
    const withNull = plannedReorder(
      {
        id: 'reorder',
        actionName: REORDER_ACTION,
        layerId: 'document',
        args: { layerToMoveId: 'layer-c', afterWhichLayerId: null },
      } as HistoryItem,
      preOrder
    );

    expect(withUndefined).toEqual(withNull);
    expect(withUndefined.operation.orderByLayerId).toEqual({ 'layer-c': 0, 'layer-1': 1, 'layer-b': 2, 'layer-d': 3 });
  });
});

describe('validatePlannedDurableEntry on a reorder', () => {
  const preOrder = bottomFirst(runtimeStack());
  // The intent genuinely moves a layer: `layer-1` starts at the bottom, so
  // anchoring it after `layer-b` renumbers the first two entries of the stack.
  const item = reorderItem('layer-1', 'layer-b');
  const planned = plannedReorder(item, preOrder);
  // Hand-written, and the map a correct plan must produce for this intent: the
  // anchor at 0, the mover directly above it, the rest unchanged.
  const correctOrder = { 'layer-b': 0, 'layer-1': 1, 'layer-c': 2, 'layer-d': 3 };

  it('accepts a correct planned entry when the store order is supplied', () => {
    expect(planned.operation.orderByLayerId).toEqual(correctOrder);
    expect(validatePlannedDurableEntry(item, planned, preOrder)).toBeNull();
  });

  it('reports a renamed index in the planned map', () => {
    const reason = validatePlannedDurableEntry(
      item,
      withOrderMap(planned, { 'layer-b': 0, 'layer-1': 2, 'layer-c': 1, 'layer-d': 3 }),
      preOrder
    );

    expect(reason).toBe('the durable layer order does not match the store order');
  });

  it('reports a layer missing from the planned map', () => {
    const short = { 'layer-b': 0, 'layer-1': 1, 'layer-c': 2 };

    const reason = validatePlannedDurableEntry(item, withOrderMap(planned, short), preOrder);

    // The map comparison, not the intent check: the args name two layers the
    // store does hold, so a refusal here can only be about the map's membership.
    expect(reason).toBe('the durable layer order does not match the store order');
  });

  it('reports an extra layer in the planned map', () => {
    const reason = validatePlannedDurableEntry(
      item,
      withOrderMap(planned, { ...correctOrder, 'layer-x': 4 }),
      preOrder
    );

    expect(reason).toBe('the durable layer order does not match the store order');
  });

  it('reports a layer-property operation planned for a reorder', () => {
    const reason = validatePlannedDurableEntry(
      item,
      { ...planned, operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Other' } } },
      preOrder
    );

    expect(reason).toBe('a layer reorder produced a "set-layer-properties" operation');
  });

  it('reports a reorder whose args name no moving layer', () => {
    const bare = {
      id: 'reorder',
      actionName: REORDER_ACTION,
      layerId: 'document',
      args: { afterWhichLayerId: 'layer-b' },
    } as HistoryItem;
    const reason = validatePlannedDurableEntry(bare, withOrderMap(planned, correctOrder), preOrder);

    expect(reason).toBe('a layer reorder has no moving layer id');
  });

  it.each([
    { label: 'no store order at all', order: undefined },
    { label: 'an explicit null store order', order: null },
  ] satisfies ReadonlyArray<{ label: string; order: readonly LayerId[] | null | undefined }>)(
    'refuses to pass a reorder checked with $label',
    ({ order }) => {
      const reason = validatePlannedDurableEntry(item, planned, order);

      expect(reason).toBe('a layer reorder was checked without the store layer order it was planned against');
    }
  );

  it.each([
    { label: 'a mover the store order does not hold', item: reorderItem('ghost', 'layer-b') },
    { label: 'an anchor the store order does not hold', item: reorderItem('layer-b', 'ghost') },
  ] satisfies ReadonlyArray<{ label: string; item: HistoryItem }>)(
    'refuses to pass a reorder naming $label',
    ({ item: derailed }) => {
      // `decideDurableAppend` sends these down the preconditions path before
      // validation, so the validator must not grade the refusal as a valid
      // placement either.
      const reason = validatePlannedDurableEntry(derailed, withOrderMap(planned, correctOrder), preOrder);

      expect(reason).toBe('the layer reorder names a layer the document does not hold');
    }
  );
});
