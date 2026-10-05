import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import {
  decideDurableAppend,
  deriveMergeDocumentEntry,
  validatePlannedDurableEntry,
  type SourceBackedEntryContext,
} from '../history-append.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { DURABLE_SCHEMA_VERSION, type DurableHistoryEntry, type DurableLayerSnapshot } from '../history-model.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerId, LayerSource, LayersRecord } from '../layer-types.ts';
import { MERGE_ACTION, NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION, REMOVE_ACTION } from '../../util/constants.ts';

const documentId = 'merge-append-doc';
const frame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
const source: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 100, height: 80 },
};

/**
 * Hand-written: the result snapshot is the only field of a merge entry with a
 * payload, and an expectation read back off the planner would only ever compare
 * the planner with itself.
 */
const expectedResult = (id: string, order: number): DurableLayerSnapshot => ({
  id,
  // Written out rather than derived from `deriveLayerNameAndOrder`, so this expectation
  // can still catch THAT rule changing: a derived name would agree with the planner by
  // construction and assert nothing. The suffix is the rule's output, and the order
  // below is the same number it derives from.
  name: `Blank ${order}`,
  isBedrock: false,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order,
  pos: { x: 0, y: 0, width: 100, height: 80 },
  source: { kind: 'blank', color: '#ffffff', opacity: 1, size: { width: 100, height: 80 }, isBedrock: false },
});

function blankLayer(id: string, order: number): Layer {
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

function baseline(layers: Record<string, Layer>): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: Object.keys(layers)[0]!,
    documentSource: { layers, size: { width: frame.width, height: frame.height }, frame },
  };
}

function mergeItem(layerId: string, id = 'merge'): HistoryItem {
  return { id, actionName: MERGE_ACTION, layerId, layerSource: source };
}

function preLayers(document: ReturnType<typeof legacyHistoryToDurable>['document']) {
  return new Map(
    Object.entries(replayDurableDocument(document).layers).map(([id, replayLayer]) => [id, replayLayer.snapshot])
  );
}

function mergeContext(
  registry: AssetRegistry,
  layers: ReturnType<typeof preLayers>,
  liveLayers?: LayersRecord
): SourceBackedEntryContext {
  return { documentId, registry, preLayers: layers, ...(liveLayers ? { liveLayers } : {}) };
}

/** The pair the store supplies: a converted baseline plus one new layer on top. */
function convertedPair() {
  const registry = new AssetRegistry();
  const layerRecord = { 'layer-1': blankLayer('layer-1', 0), 'layer-2': blankLayer('layer-2', 1) };
  const added: HistoryItem = {
    id: 'new-layer-2',
    actionName: NEW_LAYER_ACTION,
    layerId: 'layer-2',
    layerSource: source,
  };
  const history = [baseline(layerRecord), added];
  const converted = legacyHistoryToDurable(history, { documentId, registry });
  return { registry, history, document: converted.document, preLayers: preLayers(converted.document) };
}

describe('history append atomic merge planning', () => {
  it('names every pre-append layer except the merge result', () => {
    const { registry, document, preLayers: before } = convertedPair();
    try {
      const item = mergeItem('merged');
      const entry = deriveMergeDocumentEntry(item, mergeContext(registry, before));
      if (!entry) throw new Error('expected a planned merge entry');

      expect(entry).toEqual({
        id: item.id,
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: {
          kind: 'merge-document',
          // Above both pre-append layers: the merged layer is the whole document
          // now, and the runtime puts it on top.
          result: expectedResult('merged', 3),
          removedLayerIds: ['layer-1', 'layer-2'],
        },
      });
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.operation)).toBe(true);
      expect(Object.isFrozen(entry.operation.kind === 'merge-document' ? entry.operation.removedLayerIds : null)).toBe(
        true
      );
      expect(validatePlannedDurableEntry(item, entry, undefined, before)).toBeNull();
      expect(replayDurableDocument(document).layers['merged']).toBeUndefined();
    } finally {
      registry.shutdown();
    }
  });

  it('takes the removal set from the runtime record when the store supplies one', () => {
    const { registry, preLayers: before } = convertedPair();
    try {
      // The two records are built independently — `durableLayersAtCursor` replays
      // the shadow, `state.layers` is the runtime record — so their key orders
      // agree only by accident. Here they disagree, which is the whole test.
      const liveLayers = { 'layer-2': blankLayer('layer-2', 2), 'layer-1': blankLayer('layer-1', 0) };
      const item = mergeItem('merged');

      const entry = deriveMergeDocumentEntry(item, mergeContext(registry, before, liveLayers));

      expect([...before.keys()]).toEqual(['layer-1', 'layer-2']);
      expect(Object.keys(liveLayers)).toEqual(['layer-2', 'layer-1']);
      expect(entry?.operation.kind === 'merge-document' && entry.operation.removedLayerIds).toEqual([
        'layer-2',
        'layer-1',
      ]);
    } finally {
      registry.shutdown();
    }
  });

  it('plans an empty removal set for a merge over a document holding no layer', () => {
    const registry = new AssetRegistry();
    try {
      const empty = new Map<LayerId, DurableLayerSnapshot>();
      const item = mergeItem('merged', 'merge-empty');

      const entry = deriveMergeDocumentEntry(item, mergeContext(registry, empty));
      const decision = decideDurableAppend({
        documentId,
        base: legacyHistoryToDurable([], { documentId, registry }).document,
        prior: { entries: [], cursor: -1, branchRevision: 0 },
        next: { entries: [item], cursor: 0, branchRevision: 1 },
        entry: item,
        planned: entry,
        documentRevision: 0,
        preLayers: empty,
      });

      // Zero removals is a real answer, not a refusal: durable replay deletes nothing and
      // installs the result, which is what merging a single layer into an empty
      // document means. The result's own order is NOT zero — `deriveLayerNameAndOrder`
      // derives name and order from `maxLayerOrder(preLayers) + 1`, and an empty layer
      // set yields 1, which is what puts the first layer of a document at order 1
      // rather than 0.
      expect(entry?.operation).toEqual({
        kind: 'merge-document',
        result: expectedResult('merged', 1),
        removedLayerIds: [],
      });
      expect(validatePlannedDurableEntry(item, entry!, undefined, empty)).toBeNull();
      expect(decision.outcome).toBe('published');
    } finally {
      registry.shutdown();
    }
  });

  it('publishes exactly one merge entry onto a branch the append moved', () => {
    const { registry, history, document, preLayers: before } = convertedPair();
    try {
      const item = mergeItem('merged');
      const planned = deriveMergeDocumentEntry(item, mergeContext(registry, before));
      const decision = decideDurableAppend({
        documentId,
        base: document,
        prior: { entries: history, cursor: 1, branchRevision: 0 },
        // `updateHistoryTimeline` moves the branch on every append, and the
        // document the store hands over was built on the PREVIOUS one.
        next: { entries: [...history, item], cursor: 2, branchRevision: 1 },
        entry: item,
        planned,
        documentRevision: 0,
        preLayers: before,
      });

      expect(decision.outcome).toBe('published');
      if (decision.outcome !== 'published') return;
      // The branch the append produced, not the one the base was built on: a
      // shadow that kept the old revision would fail
      // `base.branchRevision !== prior.branchRevision` on the very next append
      // and send every later publication to a full reconversion.
      expect(decision.document.branchRevision).toBe(1);
      expect(document.branchRevision).toBe(0);
      expect(decision.document.history).toHaveLength(document.history.length + 1);
      expect(decision.document.history.at(-1)?.operation.kind).toBe('merge-document');
      expect(decision.document.history.at(-1)).toEqual(planned);
      expect(decision.document.durableRevision).toBe(document.durableRevision + 1);
      expect(decision.document.cursor).toBe(decision.document.history.length - 1);
      expect(replayDurableDocument(decision.document).activeLayerId).toBe('merged');
      expect(Object.keys(replayDurableDocument(decision.document).layers)).toEqual(['merged']);
    } finally {
      registry.shutdown();
    }
  });

  it('publishes a single-layer merge with an empty removal set as one operation', () => {
    const registry = new AssetRegistry();
    try {
      const layerRecord = { 'layer-1': blankLayer('layer-1', 0) };
      const history = [baseline(layerRecord)];
      const converted = legacyHistoryToDurable(history, { documentId, registry });
      const before = preLayers(converted.document);
      const item = mergeItem('layer-1', 'merge-single');
      const planned = deriveMergeDocumentEntry(item, mergeContext(registry, before));

      expect(planned?.operation).toMatchObject({ kind: 'merge-document', removedLayerIds: [] });
      const decision = decideDurableAppend({
        documentId,
        base: converted.document,
        prior: { entries: history, cursor: 0, branchRevision: 0 },
        next: { entries: [...history, item], cursor: 1, branchRevision: 0 },
        entry: item,
        planned,
        documentRevision: 0,
        preLayers: before,
      });

      expect(decision.outcome).toBe('published');
    } finally {
      registry.shutdown();
    }
  });

  it('plans no entry for an action that is not a merge, or a merge with no source', () => {
    const { registry, preLayers: before } = convertedPair();
    try {
      const removal: HistoryItem = { id: 'remove-1', actionName: REMOVE_ACTION, layerId: 'layer-1', args: {} };
      const bare = { id: 'merge-bare', actionName: MERGE_ACTION, layerId: 'merged' } satisfies HistoryItem;
      const argsOnly = {
        id: 'merge-args',
        actionName: MERGE_ACTION,
        layerId: 'merged',
        args: { toolName: 'blur', radius: 4 },
      } as unknown as HistoryItem;

      expect(deriveMergeDocumentEntry(removal, mergeContext(registry, before))).toBeNull();
      expect(deriveMergeDocumentEntry(bare, mergeContext(registry, before))).toBeNull();
      expect(deriveMergeDocumentEntry(argsOnly, mergeContext(registry, before))).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('throws for a legacy-tool merge source rather than planning an unpublishable one', () => {
    const { registry, preLayers: before } = convertedPair();
    try {
      // `blur`, not `pencil`. This assertion used to name `pencil`, which stopped being
      // a refusal when `durableSourceKindForTool` began typing it as a `paint` source —
      // a tool that gained a durable representation cannot witness the unrepresentable
      // case any more. `blur` is outside `text`/`vector`/`paint` and still is one, so
      // the contract below is witnessed by a tool that still has no representation.
      const blur: HistoryItem = {
        id: 'merge-blur',
        actionName: MERGE_ACTION,
        layerId: 'merged',
        layerSource: { kind: 'tool', args: { toolName: 'blur' } as never, isBedrock: false, pos: source.pos },
      };

      // The store wraps this call in an asset transaction and rolls it back, so a
      // throw is the contract: planning a result whose source is `legacy-tool`
      // would publish an entry the validator refuses and no conversion reproduces.
      expect(() => deriveMergeDocumentEntry(blur, mergeContext(registry, before))).toThrow(
        'Tool blur has no durable source representation'
      );
    } finally {
      registry.shutdown();
    }
  });

  describe('the removal set the validator grades', () => {
    const graded = () => {
      const { registry, preLayers: before } = convertedPair();
      const item = mergeItem('merged');
      const planned = deriveMergeDocumentEntry(item, mergeContext(registry, before));
      if (!planned || planned.operation.kind !== 'merge-document') {
        registry.shutdown();
        throw new Error('expected a merge-document entry');
      }
      return { registry, item, before, planned };
    };

    const withRemovalSet = (planned: DurableHistoryEntry, removedLayerIds: readonly LayerId[]): DurableHistoryEntry =>
      planned.operation.kind === 'merge-document'
        ? { ...planned, operation: { ...planned.operation, removedLayerIds } }
        : planned;

    it.each([
      {
        label: 'removes its own result layer',
        removedLayerIds: ['merged'],
        reason: 'the durable merge-document removal set removes its result layer',
      },
      {
        label: 'names a layer twice',
        removedLayerIds: ['layer-1', 'layer-1'],
        reason: 'the durable merge-document removal set contains duplicate layer ids',
      },
      {
        label: 'drops a pre-append layer',
        removedLayerIds: ['layer-1'],
        reason: 'the durable merge-document removal set does not match the pre-append layer set',
      },
      {
        label: 'adds a layer the document never held',
        removedLayerIds: ['layer-1', 'layer-2', 'ghost'],
        reason: 'the durable merge-document removal set does not match the pre-append layer set',
      },
      {
        label: 'lists the same layers in another order',
        removedLayerIds: ['layer-2', 'layer-1'],
        reason: 'the durable merge-document removal set does not match the pre-append layer set',
      },
    ] satisfies ReadonlyArray<{ label: string; removedLayerIds: LayerId[]; reason: string }>)(
      'refuses a removal set that $label',
      ({ removedLayerIds, reason }) => {
        const { registry, item, before, planned } = graded();
        try {
          expect(validatePlannedDurableEntry(item, withRemovalSet(planned, removedLayerIds), undefined, before)).toBe(
            reason
          );
          // The control: the set the planner produced itself passes, so each
          // refusal above is attributable to the set and not to some other field.
          expect(validatePlannedDurableEntry(item, planned, undefined, before)).toBeNull();
        } finally {
          registry.shutdown();
        }
      }
    );

    /**
     * Retargets the planned result's NAME to what an empty pre-append set derives.
     *
     * With `preLayers` null the validator re-derives the result through
     * `sourceToRuntimeLayer(entry.layerId, source, new Map(preLayers ?? []))` — an
     * EMPTY layer set — and grades the runtime name against the planned one BEFORE it
     * looks at the removal set. A plan whose name was derived from the real
     * three-layer set is therefore refused on the name, and the removal-set refusals
     * below are unreachable without this. (`order` is not graded at all: the store's
     * pre-append set owns that number, which is why only the name is retargeted.)
     */
    const withEmptySetName = (planned: DurableHistoryEntry): DurableHistoryEntry =>
      planned.operation.kind === 'merge-document'
        ? {
            ...planned,
            operation: { ...planned.operation, result: { ...planned.operation.result, name: 'Blank 1' } },
          }
        : planned;

    it('grades the removal set on its own when no pre-append map is supplied', () => {
      const { registry, item, planned } = graded();
      try {
        // The store supplies the map, so this is the module's own contract for a
        // caller that cannot: the two structural refusals still hold. The name is
        // retargeted first because that check now runs ahead of them — asserted
        // directly below, so the retarget is load-bearing rather than incidental.
        expect(
          validatePlannedDurableEntry(item, withRemovalSet(withEmptySetName(planned), ['merged']), undefined, null)
        ).toBe('the durable merge-document removal set removes its result layer');
        expect(
          validatePlannedDurableEntry(
            item,
            withRemovalSet(withEmptySetName(planned), ['layer-1', 'layer-1']),
            undefined,
            null
          )
        ).toBe('the durable merge-document removal set contains duplicate layer ids');
        // The control: once the name agrees, a removal set naming no real layer is
        // ACCEPTED, because without a pre-append map the validator has no set to
        // compare against — only the two structural rules above are left.
        expect(
          validatePlannedDurableEntry(item, withRemovalSet(withEmptySetName(planned), ['ghost']), undefined, null)
        ).toBeNull();
        // And the reason the retarget is needed, pinned: the untampered plan is
        // refused on the NAME first, so this path cannot reach the removal set at all
        // unless the result's name matches an empty layer set.
        expect(validatePlannedDurableEntry(item, withRemovalSet(planned, ['merged']), undefined, null)).toBe(
          'the durable layer name does not match the legacy source'
        );
      } finally {
        registry.shutdown();
      }
    });
  });
});
