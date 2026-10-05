import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  type DurableLayerSnapshot,
} from '../history-model.ts';
import type { HistoryItem, NewHistoryItem } from '../history-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { LayerId, LayerSource } from '../layer-types.ts';
import { MERGE_ACTION, NEW_LAYER_ACTION, REMOVE_ACTION, REORDER_ACTION, TOOL_ACTION } from '../../util/constants.ts';
const documentId = 'create-append-doc';
const position = { x: 12, y: 18, width: 40, height: 30 };
/**
 * The frame every plan in this file is made against, and the one every expected
 * snapshot records as its provenance. Non-default on purpose: a fixture frame equal
 * to the zero frame would make a planner that recorded no frame at all
 * indistinguishable from one that recorded this one.
 */
const documentFrame = { x: 4, y: 6, width: 200, height: 150 };

function context(registry: AssetRegistry, preLayers: ReadonlyMap<LayerId, DurableLayerSnapshot> = new Map()) {
  return { documentId, registry, preLayers, documentFrame } satisfies SourceBackedEntryContext;
}

function createItem(layerId: string, layerSource: LayerSource, id = `create-${layerId}`): HistoryItem {
  return { id, actionName: NEW_LAYER_ACTION, layerId, layerSource };
}

/**
 * Hand-written, because the planner's own output is the only other candidate and
 * an expectation derived from it can only ever catch a hand-supplied value. Every
 * field is the rule `sourceToRuntimeLayer` + `convertSource` own: the id and the
 * source come from the item, and the runtime layer's own defaults do the rest.
 *
 * `name` and `order` are written out rather than derived, and they are what a document
 * with NO layers produces: `deriveLayerNameAndOrder` is `maxLayerOrder(layers) + 1`,
 * and `maxLayerOrder({})` is 0 — so the first layer of a document is `"<name> 1"` at
 * order 1, not `"<name>"` at order 0. Building these two fields by calling the
 * production rule would make the expectation incapable of catching the rule changing.
 */
function snapshotFor(
  id: string,
  overrides: Partial<DurableLayerSnapshot> = {},
  source: DurableLayerSnapshot['source'] = {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    size: { width: position.width, height: position.height },
    isBedrock: false,
  }
): DurableLayerSnapshot {
  return {
    id,
    name: 'Blank 1',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    pos: { ...position },
    frame: { ...documentFrame },
    source,
    ...overrides,
  };
}

/**
 * A snapshot the planner reads but never writes: a layer already in the document.
 *
 * `deriveLayerNameAndOrder` reads `order` out of a layer set and nothing else, so the
 * `name` left at the default here is never consulted; it is not spelled out rather
 * than invented, because no rule fixes it for a layer created under other conditions.
 */
function existingSnapshot(id: string, order: number): DurableLayerSnapshot {
  return snapshotFor(id, { order, pos: { x: 0, y: 0, width: 10, height: 10 } });
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
      const item = createItem('blank-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));
      if (!entry) throw new Error('expected a planned create entry');

      // The whole entry, hand-written. A name, an order or a blend mode the
      // planner invented would survive every other assertion in this file: none
      // of them reads a field of the snapshot.
      expect(entry).toEqual({
        id: item.id,
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'create-layer', layer: snapshotFor('blank-layer') },
      });
      expect([...collectDurableAssetIds(durableDocument(entry))]).toEqual([]);
      expect(validatePlannedDurableEntry(item, entry)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it("registers an image layer's bitmap under the document and borrows it", () => {
    const registry = new AssetRegistry();
    // A bitmap whose dimensions disagree with `position`, so the raster size can
    // only come from the bitmap: the layer's position is where the layer sits,
    // not how many pixels it has.
    const bitmap = { width: 64, height: 48, close: () => {} } as unknown as ImageBitmap;
    const close = vi.spyOn(bitmap as unknown as { close: () => void }, 'close');
    try {
      const source: LayerSource = { kind: 'image', bitmap, name: 'Photo', isBedrock: false, pos: position };
      const item = createItem('image-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      // Narrowing rather than a bail-out: the assertions below are the test, and
      // an `if (...) return` would turn a wrongly-derived source into a pass.
      expect(entry?.operation.kind).toBe('create-layer');
      if (entry?.operation.kind !== 'create-layer') throw new Error('expected a create-layer operation');
      const layer = entry.operation.layer;
      if (layer.source.kind !== 'raster') throw new Error('expected a raster durable source');

      expect(layer).toEqual(
        snapshotFor(
          'image-layer',
          { name: 'Photo 1' },
          { kind: 'raster', assetId: layer.source.assetId, width: 64, height: 48, name: 'Photo', isBedrock: false }
        )
      );
      // The asset id is the registry's, not a minted string: a fabricated id
      // resolves to nothing and a re-registration of the same bitmap under the
      // same document resolves to the id the entry already names.
      expect(registry.getRecord(layer.source.assetId)).toMatchObject({
        id: layer.source.assetId,
        documentId,
        width: 64,
        height: 48,
        sourceType: 'image-bitmap',
        ownership: 'borrow',
        disposed: false,
      });
      expect(registry.registerBaseline(documentId, bitmap)).toBe(layer.source.assetId);
      expect([...collectDurableAssetIds(durableDocument(entry))]).toEqual([layer.source.assetId]);
      expect(validatePlannedDurableEntry(item, entry)).toBeNull();
    } finally {
      // The durable shadow is a projection of the legacy history, which still
      // owns its bitmaps: an adopted asset would be closed by the very next
      // reconcile or shutdown, taking the legacy runtime's pixels with it.
      registry.shutdown();
      expect(close).not.toHaveBeenCalled();
      close.mockRestore();
    }
  });

  it('anchors a bedrock source at the document origin and sizes it from the source', () => {
    const registry = new AssetRegistry();
    try {
      // `File > New`: a bedrock source carries a `size` and no `pos` at all.
      const source: LayerSource = {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: true,
        size: { width: 800, height: 600 },
      };
      const item = createItem('bedrock-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      expect(entry).toEqual({
        id: item.id,
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: {
          kind: 'create-layer',
          layer: snapshotFor(
            'bedrock-layer',
            { isBedrock: true, pos: { x: 0, y: 0, width: 800, height: 600 } },
            { kind: 'blank', color: '#ffffff', opacity: 1, size: { width: 800, height: 600 }, isBedrock: true }
          ),
        },
      });
      expect(validatePlannedDurableEntry(item, entry!)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('stacks a new layer above the highest pre-append order without touching that map', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos: position };
      const preLayers = new Map<LayerId, DurableLayerSnapshot>([
        ['layer-1', existingSnapshot('layer-1', 0)],
        ['layer-2', existingSnapshot('layer-2', 3)],
      ]);
      const before = [...preLayers.entries()];

      const entry = deriveCreateLayerEntry(createItem('new-layer', source), context(registry, preLayers));

      // One above the highest order, not zero and not the layer count: a sparse
      // stack (reorder writes `minOrder - 1` and `+= 2`) makes both wrong, and
      // the runtime puts the new layer on top of the document.
      expect(entry?.operation.kind === 'create-layer' && entry.operation.layer.order).toBe(4);
      // The store's own shadow map, read by every later merge removal set.
      expect([...preLayers.entries()]).toEqual(before);
      expect(entry?.operation.kind === 'create-layer' && entry.operation.layer.id).not.toBe('layer-2');
    } finally {
      registry.shutdown();
    }
  });

  it('plans no entry for an action that creates no layer', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos: position };
      const items = [
        { id: 'other-1', actionName: REMOVE_ACTION, layerId: 'layer-1', args: {} },
        { id: 'other-2', actionName: MERGE_ACTION, layerId: 'layer-1', layerSource: source },
        {
          id: 'other-3',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: null },
        },
        { id: 'other-4', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 4 } },
      ] satisfies ReadonlyArray<HistoryItem>;

      for (const item of items) {
        expect(deriveCreateLayerEntry(item, context(registry))).toBeNull();
      }
    } finally {
      registry.shutdown();
    }
  });

  it('plans no entry for a create that carries no usable layer source', () => {
    const registry = new AssetRegistry();
    try {
      // `sourceFromEntry` reads `layerSource ?? args` and accepts only a plain
      // object whose `kind` is blank/image/tool.
      const bare: HistoryItem = { id: 'create-bare', actionName: NEW_LAYER_ACTION, layerId: 'layer-1' };
      const fromArgs = {
        id: 'create-args',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-1',
        args: { toolName: 'blur', radius: 4 },
      } as unknown as HistoryItem;
      const asArray = {
        id: 'create-array',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-1',
        layerSource: [{ kind: 'blank' }] as unknown as LayerSource,
      } satisfies HistoryItem;

      expect(deriveCreateLayerEntry(bare, context(registry))).toBeNull();
      expect(deriveCreateLayerEntry(fromArgs, context(registry))).toBeNull();
      expect(deriveCreateLayerEntry(asArray, context(registry))).toBeNull();
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

  /**
   * The refusal this case used to pin is still the planner's behaviour; only the tool it named is
   * wrong. It asserted that a `pencil` source is refused by name, because `pencil` was then one of
   * the tools with no durable source. `durableSourceKindForTool` has since mapped the painting
   * tools — `draw`, `brush`, `pencil` — to a `paint` source, so the pencil case above now plans an
   * entry instead. `blur` is still outside every durable kind (`text`, `vector`, `paint`), which is
   * what makes it the refusal's real witness: `convertToolSource` falls back to `legacy-tool` and
   * `durableLayerForSource` throws rather than publish an entry that `materialization` would then
   * reject. The message names the offending tool, so a refusal cannot be mistaken for a null.
   */
  it('refuses a legacy-tool source and names the tool', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'tool',
        args: { toolName: 'blur' } as never,
        isBedrock: false,
        pos: position,
      };

      expect(() => deriveCreateLayerEntry(createItem('blur-layer', source), context(registry))).toThrow(
        'Tool blur has no durable source representation'
      );
    } finally {
      registry.shutdown();
    }
  });

  it('hands out a fresh snapshot on every call, so a publisher cannot rewrite a held entry', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos: position };
      const item = createItem('blank-layer', source);

      const first = deriveCreateLayerEntry(item, context(registry));
      const second = deriveCreateLayerEntry(item, context(registry));

      expect(first).toEqual(second);
      expect(first?.operation).not.toBe(second?.operation);
      expect(first?.operation.kind === 'create-layer' && first.operation.layer).not.toBe(
        second?.operation.kind === 'create-layer' && second.operation.layer
      );
      expect(first?.operation.kind === 'create-layer' && first.operation.layer.source).not.toBe(
        second?.operation.kind === 'create-layer' && second.operation.layer.source
      );
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
      expect(Object.isFrozen(entry?.operation.kind === 'create-layer' ? entry.operation.layer : null)).toBe(true);
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

      expect(validatePlannedDurableEntry(item, entry, null, null, registry)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a plan naming an asset the registry never issued', () => {
    const registry = new AssetRegistry();
    try {
      const item = createItem('image-layer', imageSource());
      const entry = withAssetId(deriveCreateLayerEntry(item, context(registry))!, 'never-registered' as AssetId);

      expect(validatePlannedDurableEntry(item, entry, null, null, registry)).toBe(
        'the durable raster layer source names asset never-registered, which the asset registry cannot resolve'
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
      expect(validatePlannedDurableEntry(item, entry, null, null, registry)).toBe(
        `the durable raster layer source names asset ${assetId}, which the asset registry cannot resolve`
      );
    } finally {
      registry.shutdown();
    }
  });

  describe('decideDurableAppend: a store that cannot see the registry', () => {
    let lastPlan: ReturnType<typeof deriveCreateLayerEntry> | null = null;
    beforeEach(() => {
      lastPlan = null;
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
      options: Readonly<{ replan?: boolean }> = {}
    ) {
      const newItem: NewHistoryItem = {
        actionName: NEW_LAYER_ACTION,
        layerId: 'image-layer',
        layerSource: imageSource(),
      };
      const entry: HistoryItem = { id: 'create-1', ...newItem };
      const planned =
        options.replan === false
          ? lastPlan
          : deriveCreateLayerEntry(entry, {
              documentId,
              registry: planner,
              preLayers: new Map(),
              documentFrame,
            });
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
  });

  /**
   * The rebase gate. A plan's snapshot names the frame its geometry was measured
   * in, so the boundary can refuse a plan whose frame the store no longer has —
   * the durable half of a crop that happened between planning and publishing.
   */
  describe('a plan authored against another document frame', () => {
    function decideAgainstFrame(input: DurableAppendInput, frame: DocumentFrame) {
      return decideDurableAppend({ ...input, documentFrame: frame });
    }

    /** A valid create plan, plus the inputs the decision needs to get past every earlier check. */
    function createPlan(registry: AssetRegistry) {
      const entry: HistoryItem = {
        id: 'create-1',
        actionName: NEW_LAYER_ACTION,
        layerId: 'image-layer',
        layerSource: {
          kind: 'image',
          bitmap: { width: 64, height: 48, close: () => {} } as unknown as ImageBitmap,
          name: 'Photo',
          isBedrock: false,
          pos: position,
        },
      };
      const planned = deriveCreateLayerEntry(entry, {
        documentId,
        registry,
        preLayers: new Map(),
        documentFrame,
      });
      const input: DurableAppendInput = {
        documentId,
        base: {
          documentId,
          documentRevision: 0,
          branchRevision: 0,
          durableRevision: 0,
          baseline: {
            frame: { ...documentFrame },
            layers: [],
            selections: { selections: [], activeSelectionId: null },
            activeLayerId: null,
          },
          history: [],
          cursor: -1,
        },
        prior: { entries: [], cursor: -1, branchRevision: 0 },
        next: { entries: [entry], cursor: 0, branchRevision: 0 },
        entry,
        planned,
        documentRevision: 0,
        registry,
      };
      return { entry, input };
    }

    it('publishes when the store frame is the one the snapshot names', () => {
      const registry = new AssetRegistry();
      try {
        const { input } = createPlan(registry);
        // A structurally equal but distinct object, so this passes on VALUES: a
        // check that compared identity would pass this and fail the store, which
        // clones the frame it supplies.
        expect(decideAgainstFrame(input, { ...documentFrame }).outcome).toBe('published');
      } finally {
        registry.shutdown();
      }
    });

    it('refuses a plan whose snapshot was authored against a frame the store has moved past', () => {
      const registry = new AssetRegistry();
      try {
        const { input } = createPlan(registry);

        // The store cropped since the plan was made, so the layer's `pos` and a
        // source's `sourcePos` are numbers measured in the old frame. Publishing
        // them would put geometry in the document that no longer has the frame it
        // was measured in, and nothing downstream could detect it.
        const decision = decideAgainstFrame(input, { ...documentFrame, x: 40, width: 120 });

        expect(decision.outcome).toBe('mismatch');
        if (decision.outcome !== 'mismatch') return;
        expect(decision.reason).toMatch(/authored against another document frame/);
        // No document: the refusal carries nothing to publish, so no shadow can
        // come into existence describing a layer in a frame the document lacks.
        expect(decision).not.toHaveProperty('document');
      } finally {
        registry.shutdown();
      }
    });

    it('does not check the frame when the store does not say which frame it is on', () => {
      const registry = new AssetRegistry();
      try {
        const { input } = createPlan(registry);

        // Omitted is "this store cannot answer", the same contract `preLayers`
        // and `registry` use: the boundary reports what it can prove and says
        // nothing about what it cannot. Refusing here would report a writer
        // defect for a store that simply withheld the comparison.
        expect(decideDurableAppend(input).outcome).toBe('published');
      } finally {
        registry.shutdown();
      }
    });
  });
});
