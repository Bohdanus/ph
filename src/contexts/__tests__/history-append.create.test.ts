import { beforeEach, describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  decideDurableAppend,
  deriveCreateLayerEntry,
  validatePlannedDurableEntry,
  type DurableAppendInput,
  type SourceBackedEntryContext,
} from '../history-append.ts';
import {
  collectDurableAssetIds,
  DURABLE_SCHEMA_VERSION,
  type AssetId,
  type DurableDocument,
  type DurableHistoryEntry,
} from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION } from '../../util/constants.ts';

const documentId = 'create-append-doc';
const position = { x: 12, y: 18, width: 40, height: 30 };

function context(
  registry: AssetRegistry,
  preLayers: SourceBackedEntryContext['preLayers'] = new Map()
): SourceBackedEntryContext {
  return { documentId, registry, preLayers };
}

function createItem(layerId: string, layerSource: LayerSource, id = `create-${layerId}`): HistoryItem {
  return { id, actionName: NEW_LAYER_ACTION, layerId, layerSource };
}

function durableDocument(entry: NonNullable<ReturnType<typeof deriveCreateLayerEntry>>): DurableDocument {
  return {
    documentId,
    documentRevision: 0,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame: { x: 0, y: 0, width: 400, height: 300 },
      layers: [],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history: [entry],
    cursor: 0,
  };
}

describe('history append source-backed create planning', () => {
  it('creates a blank layer without registering an asset', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        pos: position,
      };
      const entry = deriveCreateLayerEntry(createItem('blank-layer', source), context(registry));

      expect(entry).not.toBeNull();
      expect(entry?.operation).toMatchObject({ kind: 'create-layer', layer: { id: 'blank-layer' } });
      expect(entry && [...collectDurableAssetIds(durableDocument(entry))]).toEqual([]);
      expect(validatePlannedDurableEntry(createItem('blank-layer', source), entry!)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('creates an image layer with a registered raster asset', () => {
    const registry = new AssetRegistry();
    try {
      const bitmap = { width: 40, height: 30, close: () => {} } as unknown as ImageBitmap;
      const source: LayerSource = { kind: 'image', bitmap, name: 'Photo', isBedrock: false, pos: position };
      const item = createItem('image-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      expect(entry?.operation.kind).toBe('create-layer');
      if (!entry || entry.operation.kind !== 'create-layer' || entry.operation.layer.source.kind !== 'raster') return;
      expect(registry.getRecord(entry.operation.layer.source.assetId)).toBeDefined();
      expect([...collectDurableAssetIds(durableDocument(entry))]).toEqual([entry.operation.layer.source.assetId]);
      expect(validatePlannedDurableEntry(item, entry, null, null, registry, documentId)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a create plan whose stacking order differs from the canonical pre-state order', () => {
    const registry = new AssetRegistry();
    try {
      const existing = deriveCreateLayerEntry(
        createItem('existing-layer', {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          isBedrock: false,
          pos: position,
        }),
        context(registry)
      );
      if (!existing || existing.operation.kind !== 'create-layer') throw new Error('expected a canonical base layer');
      const baseLayer = existing.operation.layer;
      const preLayers = new Map([
        ['existing-low', { ...baseLayer, id: 'existing-low', name: 'Existing low', order: -10 }],
        ['existing-middle', { ...baseLayer, id: 'existing-middle', name: 'Existing middle', order: 5 }],
        ['existing-high', { ...baseLayer, id: 'existing-high', name: 'Existing high', order: 900 }],
      ]);
      const item = createItem('next-layer', {
        kind: 'blank',
        color: '#ff0000',
        opacity: 1,
        isBedrock: false,
        pos: position,
      });
      const planned = deriveCreateLayerEntry(item, context(registry, preLayers));
      if (!planned || planned.operation.kind !== 'create-layer') throw new Error('expected a planned layer');
      expect(planned.operation.layer.order).toBe(901);

      const substitutedOrder: DurableHistoryEntry = {
        ...planned,
        operation: {
          ...planned.operation,
          layer: { ...planned.operation.layer, order: 77 },
        },
      };

      expect(validatePlannedDurableEntry(item, substitutedOrder, null, preLayers, registry, documentId)).toBe(
        'the durable layer order does not match the legacy source'
      );
    } finally {
      registry.shutdown();
    }
  });

  it('publishes a paint source for a pencil layer', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'tool',
        args: { toolName: 'pencil' } as never,
        isBedrock: false,
        pos: position,
      };

      const entry = deriveCreateLayerEntry(createItem('pencil-layer', source), context(registry));
      expect(entry?.operation.kind).toBe('create-layer');
      if (!entry || entry.operation.kind !== 'create-layer') return;
      expect(entry.operation.layer.source).toMatchObject({ kind: 'paint', toolName: 'pencil', sourcePos: position });
    } finally {
      registry.shutdown();
    }
  });

  it('keeps the canonical schema and enabled gate on a planned create', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'blank',
        color: '#ff0000',
        opacity: 1,
        isBedrock: false,
        pos: position,
      };
      const item = createItem('blank-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      expect(entry).toMatchObject({ id: item.id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled: true });
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry?.operation)).toBe(true);
    } finally {
      registry.shutdown();
    }
  });
});

/**
 * The raster liveness question, which the message this block replaces claimed to
 * be asked and which nothing on `main` asked. A plan naming an asset the registry
 * never issued, or one it has since disposed, used to validate clean here and
 * publish a durable document whose raster threw at materialization time.
 */
describe('history append raster asset liveness', () => {
  const imageSource = (): LayerSource => ({
    kind: 'image',
    bitmap: { width: 40, height: 30, close: () => {} } as unknown as ImageBitmap,
    name: 'Photo',
    isBedrock: false,
    pos: position,
  });

  /** The same plan with its raster asset id pointed somewhere else. */
  function withAssetId(entry: DurableHistoryEntry, assetId: AssetId): DurableHistoryEntry {
    if (entry.operation.kind !== 'create-layer' || entry.operation.layer.source.kind !== 'raster') {
      throw new Error('the plan under test is not a raster create');
    }
    return {
      ...entry,
      operation: {
        ...entry.operation,
        layer: { ...entry.operation.layer, source: { ...entry.operation.layer.source, assetId } },
      },
    };
  }

  it('accepts a plan whose asset the registry can still resolve', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const entry = deriveCreateLayerEntry(item, context(registry))!;

      expect(validatePlannedDurableEntry(item, entry, null, null, registry, documentId)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('does not validate a raster asset when no registry can verify its source identity', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const entry = deriveCreateLayerEntry(item, context(registry))!;

      expect(validatePlannedDurableEntry(item, entry, null, null, null, documentId)).toMatch(
        /cannot be verified without the asset registry/
      );
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a plan naming an asset the registry never issued', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const entry = withAssetId(deriveCreateLayerEntry(item, context(registry))!, 'never-registered' as AssetId);

      expect(validatePlannedDurableEntry(item, entry, null, null, registry, documentId)).toBe(
        'the durable raster layer source names asset never-registered, which the asset registry cannot resolve'
      );
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a live same-sized asset registered from a different source bitmap', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const planned = deriveCreateLayerEntry(item, context(registry))!;
      const otherBitmap = { width: 40, height: 30, close: () => {} } as unknown as ImageBitmap;
      const otherAssetId = registry.registerBaseline(documentId, otherBitmap, { ownership: 'adopt' });
      const substituted = withAssetId(planned, otherAssetId);

      expect(registry.getRecord(otherAssetId)).toBeDefined();
      expect(validatePlannedDurableEntry(item, substituted, null, null, registry, documentId)).toBe(
        `the durable raster layer source names asset ${otherAssetId}, which is not owned by this document and registered from the legacy source bitmap`
      );
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a plan whose asset the registry has disposed', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const entry = deriveCreateLayerEntry(item, context(registry))!;
      const assetId =
        entry.operation.kind === 'create-layer' && entry.operation.layer.source.kind === 'raster'
          ? entry.operation.layer.source.assetId
          : null;
      expect(assetId).not.toBeNull();
      // A disposed entry is deleted from the registry's map, so `getRecord` answers
      // `undefined` for it exactly as it does for an id it never issued. That is the
      // case a `Set` of issued ids would have answered `true` to.
      registry.disposeDocument(documentId);

      expect(registry.getRecord(assetId as AssetId)).toBeUndefined();
      expect(validatePlannedDurableEntry(item, entry, null, null, registry, documentId)).toBe(
        `the durable raster layer source names asset ${assetId}, which the asset registry cannot resolve`
      );
    } finally {
      registry.shutdown();
    }
  });

  describe('decideDurableAppend: a store that cannot see the registry', () => {
    let lastPlan: ReturnType<typeof deriveCreateLayerEntry> | null = null;
    let lastEntry: HistoryItem | null = null;
    beforeEach(() => {
      lastPlan = null;
      lastEntry = null;
    });
    /**
     * `registry: null` is the explicit "this store cannot answer", which is why the
     * planner still needs a real one: withholding the decision's copy must not
     * change what the plan names. `replan: false` reuses the plan a previous call
     * built, so a decision can be taken about an asset the registry has since lost.
     */
    function decide(
      planner: AssetRegistry,
      supplied: AssetRegistry | null,
      options: Readonly<{ replan?: boolean; substituteWith?: AssetId }> = {}
    ) {
      const entry: HistoryItem =
        options.replan === false && lastEntry
          ? lastEntry
          : {
              id: 'create-1',
              actionName: NEW_LAYER_ACTION,
              layerId: 'image-layer',
              layerSource: imageSource(),
            };
      lastEntry = entry;
      const derived =
        options.replan === false
          ? lastPlan
          : deriveCreateLayerEntry(entry, { documentId, registry: planner, preLayers: new Map() });
      const planned = derived && options.substituteWith ? withAssetId(derived, options.substituteWith) : derived;
      lastPlan = planned;
      const base = {
        documentId,
        documentRevision: 0,
        branchRevision: 0,
        durableRevision: 0,
        baseline: {
          frame: { x: 0, y: 0, width: 400, height: 300 },
          layers: [],
          selections: { selections: [], activeSelectionId: null },
          activeLayerId: null,
        },
        history: [],
        cursor: -1,
      } as unknown as DurableDocument;
      const input: DurableAppendInput = {
        documentId,
        base,
        prior: { entries: [], cursor: -1, branchRevision: 0 },
        next: { entries: [entry], cursor: 0, branchRevision: 0 },
        entry,
        planned,
        documentRevision: 0,
        registry: supplied,
      };
      return decideDurableAppend(input);
    }

    it('reports a precondition rather than a writer defect when the store withholds it', () => {
      const registry = new AssetRegistry();
      try {
        const decision = decide(registry, null);

        expect(decision.outcome).toBe('preconditions');
        if (decision.outcome !== 'preconditions') return;
        expect(decision.reason).toMatch(/cannot be verified without the asset registry/);
      } finally {
        registry.shutdown();
      }
    });

    it('publishes the same plan once the store supplies the registry', () => {
      const registry = new AssetRegistry();
      try {
        expect(decide(registry, registry).outcome).toBe('published');
      } finally {
        registry.shutdown();
      }
    });

    it('falls back when a supplied plan substitutes another live same-sized asset', () => {
      const registry = new AssetRegistry();
      try {
        const unrelatedBitmap = { width: 40, height: 30, close: () => {} } as unknown as ImageBitmap;
        const unrelatedAssetId = registry.registerBaseline(documentId, unrelatedBitmap, { ownership: 'adopt' });

        const decision = decide(registry, registry, { substituteWith: unrelatedAssetId });

        expect(decision.outcome).toBe('mismatch');
        if (decision.outcome !== 'mismatch') return;
        expect(decision.reason).toContain('not owned by this document and registered from the legacy source bitmap');
        expect(decision).not.toHaveProperty('document');
      } finally {
        registry.shutdown();
      }
    });

    it('refuses the same plan after the registry disposes its asset', () => {
      const registry = new AssetRegistry();
      try {
        expect(decide(registry, registry).outcome).toBe('published');

        registry.disposeDocument(documentId);
        const decision = decide(registry, registry, { replan: false });

        expect(decision.outcome).toBe('mismatch');
        if (decision.outcome !== 'mismatch') return;
        expect(decision.reason).toMatch(/which the asset registry cannot resolve$/);
      } finally {
        registry.shutdown();
      }
    });

    it('refuses publication after document disposal even while a lease keeps the asset live', async () => {
      const registry = new AssetRegistry();
      try {
        expect(decide(registry, registry).outcome).toBe('published');
        const planned = lastPlan;
        if (!planned || planned.operation.kind !== 'create-layer' || planned.operation.layer.source.kind !== 'raster') {
          throw new Error('expected a planned raster layer');
        }

        const lease = await registry.resolve(planned.operation.layer.source.assetId);
        registry.disposeDocument(documentId);
        expect(registry.getRecord(planned.operation.layer.source.assetId)).toBeDefined();

        const decision = decide(registry, registry, { replan: false });

        expect(decision.outcome).toBe('mismatch');
        if (decision.outcome !== 'mismatch') return;
        expect(decision.reason).toContain('not owned by this document');

        lease.release();
        expect(registry.getRecord(planned.operation.layer.source.assetId)).toBeUndefined();
      } finally {
        registry.shutdown();
      }
    });
  });
});
