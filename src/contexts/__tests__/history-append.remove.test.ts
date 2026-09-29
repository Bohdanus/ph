import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry, getAssetRegistry } from '../asset-registry.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { decideDurableAppend, planHistoryAppend, validatePlannedDurableEntry } from '../history-append.ts';
import {
  convertLegacyHistorySafely,
  deriveRemoveLayerEntry,
  legacyHistoryToDurable,
  type LegacyConversionResult,
} from '../history-adapter.ts';
import { DURABLE_SCHEMA_VERSION, type DurableDocument, type DurableHistoryEntry } from '../history-model.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import {
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

const documentId = 'remove-append-doc';
const initialSize = { width: 400, height: 300 };
const baselineFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };

function blankLayer(id: string, order = 0): Layer {
  const pos = { x: 0, y: 0, width: 100, height: 80 };
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
    pos,
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos },
    operations: [],
  };
}

const defaultLayers: LayersRecord = { 'layer-1': blankLayer('layer-1', 0) };
const pairLayers: LayersRecord = {
  'layer-1': blankLayer('layer-1', 0),
  'layer-2': blankLayer('layer-2', 1),
};

/** The document baseline every conversion starts from: an `OPEN_DOCUMENT` source. */
function baselineItem(layers: LayersRecord = defaultLayers): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: Object.keys(layers)[0]!,
    documentSource: { layers, size: initialSize, frame: baselineFrame },
  };
}

function removeItem(layerId: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
  return { id: `remove-${layerId}`, actionName: REMOVE_ACTION, layerId, args: {}, ...overrides };
}

function reorderItem(id: string, layerToMoveId: string, afterWhichLayerId: string | null): HistoryItem {
  return { id, actionName: REORDER_ACTION, layerId: 'document', args: { layerToMoveId, afterWhichLayerId } };
}

const replayDependencies: HistoryReplayDependencies = {
  createLayer: ({ layerId }) => blankLayer(layerId),
  applyRasterTool: (layer) => layer,
};

/** Full conversion of `[baseline, ...items]` against a caller-supplied registry. */
function convert(
  registry: AssetRegistry,
  items: HistoryItem[],
  layers: LayersRecord = defaultLayers
): LegacyConversionResult {
  return legacyHistoryToDurable([baselineItem(layers), ...items], { documentId, registry });
}

function withRegistry<T>(run: (registry: AssetRegistry) => T): T {
  const registry = new AssetRegistry();
  try {
    return run(registry);
  } finally {
    registry.shutdown();
  }
}

/**
 * The conversion the plan must agree with, reduced to the one entry the removal
 * produced. The baseline carries the layer, so this is the conversion a real
 * removal runs through rather than a hand-built one.
 */
function convertedEntryFor(item: HistoryItem, layers: LayersRecord = defaultLayers): DurableHistoryEntry {
  return withRegistry((registry) => {
    const converted = convert(registry, [item], layers);

    expect(converted.diagnostics).toEqual([]);
    const recorded = converted.document.history.find((candidate) => candidate.id === item.id);
    if (!recorded) throw new Error(`the conversion recorded no entry for ${item.id}`);
    return recorded;
  });
}

function replayedLayerIds(converted: LegacyConversionResult): string[] {
  return Object.keys(replayDurableDocument(converted.document).layers);
}

function legacyReplayedLayerIds(items: HistoryItem[], layers: LayersRecord = defaultLayers): string[] {
  const history = [baselineItem(layers), ...items];
  return Object.keys(replayHistory(history, history.length - 1, initialSize, replayDependencies).layers);
}

function planRemoval(item: HistoryItem, layers: LayersRecord = defaultLayers) {
  return planHistoryAppend({
    item: { layerId: item.layerId, actionName: REMOVE_ACTION, args: item.args },
    timeline: { entries: [baselineItem(layers)], cursor: 0, branchRevision: 0 },
    currentFrame: baselineFrame,
    id: item.id,
  });
}

describe('remove-layer append boundary', () => {
  describe('deriveRemoveLayerEntry', () => {
    it('agrees with the entry the full conversion records for the same item', () => {
      const item = removeItem('layer-1');

      const derived = deriveRemoveLayerEntry(item);

      expect(derived).toEqual(convertedEntryFor(item));
    });

    it('describes the legacy item rather than a value of its own', () => {
      const item = removeItem('layer-1');

      const derived = deriveRemoveLayerEntry(item);

      // Hand-written expected shape. The parity assertion above can only prove the
      // two implementations agree; these values are what "agree" has to mean, so a
      // wrong rule on both sides still fails here.
      expect(derived).toEqual({
        id: 'remove-layer-1',
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'remove-layer', layerId: 'layer-1' },
      });
    });

    it('takes its id from the item rather than minting one', () => {
      const supplied = removeItem('layer-1', { id: 'removal-42' });

      expect(deriveRemoveLayerEntry(supplied)!.id).toBe('removal-42');
    });

    it.each([
      {
        label: 'a document frame change',
        item: {
          id: 'crop-1',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { nextFrame: { x: 0, y: 0, width: 10, height: 10 } },
        } as HistoryItem,
      },
      {
        label: 'a tool action',
        item: { id: 'blur-1', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 4 } },
      },
      { label: 'a reorder', item: reorderItem('reorder-1', 'layer-1', null) },
    ] satisfies ReadonlyArray<{ label: string; item: HistoryItem }>)('derives no entry for $label', ({ item }) => {
      expect(deriveRemoveLayerEntry(item)).toBeNull();
    });

    it('carries exactly the two canonical operation keys, frozen', () => {
      const derived = deriveRemoveLayerEntry(removeItem('layer-1'));

      // Canonical shape is a contract, not a description: the append validator
      // grades it and durable replay defines no third key.
      expect(Object.keys(derived!.operation).sort()).toEqual(['kind', 'layerId']);
      expect(Object.isFrozen(derived!.operation)).toBe(true);
      expect(Object.isFrozen(derived)).toBe(true);
    });

    it('hands out a fresh operation on every call so a publisher cannot rewrite a held entry', () => {
      const item = removeItem('layer-1');

      const first = deriveRemoveLayerEntry(item);
      const second = deriveRemoveLayerEntry(item);

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(first!.operation).not.toBe(second!.operation);
    });
  });

  describe('the enabled gate on the conversion state', () => {
    it('takes the layer out of the conversion state only when the removal is enabled', () => {
      const reorder = reorderItem('reorder-2', 'layer-2', 'layer-1');
      const enabled = removeItem('layer-2');
      const disabled = removeItem('layer-2', { id: 'remove-2-disabled', disabled: true });

      const afterEnabled = withRegistry((registry) => convert(registry, [enabled, reorder], pairLayers));
      const afterDisabled = withRegistry((registry) => convert(registry, [disabled, reorder], pairLayers));

      // Enabled: `layer-2` left the converter's layer set, so the reorder naming it
      // is the no-op `replayHistory` also performs, and the converter records
      // nothing for it.
      expect(afterEnabled.diagnostics).toEqual([]);
      expect(afterEnabled.document.history.map((entry) => entry.operation.kind)).toEqual(['remove-layer']);
      // A skipped legacy entry maps to the preceding durable cursor, never the tip.
      expect(afterEnabled.legacyCursorToDurableCursor).toEqual([-1, 0, 0]);

      // Disabled: the layer is still in the set, so the same reorder is a real
      // placement. `layer-1` is the bottom at 0 and `layer-2` the layer above it,
      // so the map is the stack renumbered — unchanged as a sequence.
      expect(afterDisabled.diagnostics).toEqual([]);
      expect(afterDisabled.document.history.map((entry) => entry.operation.kind)).toEqual([
        'remove-layer',
        'reorder-layers',
      ]);
      expect(afterDisabled.document.history[1]!.operation).toEqual({
        kind: 'reorder-layers',
        orderByLayerId: { 'layer-1': 0, 'layer-2': 1 },
      });
      expect(afterDisabled.legacyCursorToDurableCursor).toEqual([-1, 0, 1]);
    });

    it('derives a disabled entry and leaves the layer in place when the item is disabled', () => {
      const removal = removeItem('layer-1', { id: 'remove-disabled', disabled: true });

      const derived = deriveRemoveLayerEntry(removal);
      expect(derived).not.toBeNull();
      // The operation is the enabled one; the gate is the entry's, not the
      // operation's, so a disabled removal still says what it would have removed.
      expect(derived!.enabled).toBe(false);
      expect(derived!.operation).toEqual({ kind: 'remove-layer', layerId: 'layer-1' });
      expect(derived).toEqual(convertedEntryFor(removal, pairLayers));

      withRegistry((registry) => {
        const converted = convert(registry, [removal], pairLayers);

        expect(converted.diagnostics).toEqual([]);
        expect(converted.document.history).toHaveLength(1);
        expect(converted.document.history[0]).toMatchObject({ id: removal.id, enabled: false });
        // Durable replay skips a disabled entry, so the layer the conversion left in
        // place survives the shadow's own replay.
        expect(replayedLayerIds(converted).sort()).toEqual(['layer-1', 'layer-2']);
      });
      // Legacy replay skips `item.disabled` too, so the two models agree here.
      expect(legacyReplayedLayerIds([removal], pairLayers).sort()).toEqual(['layer-1', 'layer-2']);
    });

    it('derives a disabled entry from args that carry enabled: false', () => {
      const removal = removeItem('layer-1', { id: 'remove-disabled', args: { enabled: false } });

      const derived = deriveRemoveLayerEntry(removal);
      expect(derived).not.toBeNull();
      expect(derived!.enabled).toBe(false);
      expect(derived!.operation).toEqual({ kind: 'remove-layer', layerId: 'layer-1' });
      expect(derived).toEqual(convertedEntryFor(removal, pairLayers));

      withRegistry((registry) => {
        const converted = convert(registry, [removal], pairLayers);

        expect(converted.diagnostics).toEqual([]);
        expect(converted.document.history[0]).toMatchObject({ id: removal.id, enabled: false });
        expect(replayedLayerIds(converted).sort()).toEqual(['layer-1', 'layer-2']);
      });
    });

    it('differs from the enabled case on the entry gate alone', () => {
      const enabled = removeItem('layer-1');
      const disabled = removeItem('layer-1', { id: 'remove-disabled', disabled: true });

      expect(deriveRemoveLayerEntry(disabled)!.operation).toEqual(deriveRemoveLayerEntry(enabled)!.operation);
      expect(deriveRemoveLayerEntry(disabled)!.enabled).toBe(false);
      expect(deriveRemoveLayerEntry(enabled)!.enabled).toBe(true);
    });
  });

  describe('an unknown layer id is not refused', () => {
    it('derives an entry for a layer the document never held', () => {
      const ghost = removeItem('ghost');

      const derived = deriveRemoveLayerEntry(ghost);

      expect(derived).not.toBeNull();
      expect(derived!.operation).toEqual({ kind: 'remove-layer', layerId: 'ghost' });
      expect(derived).toEqual(convertedEntryFor(ghost));
    });

    it('retains it in the durable history rather than dropping the entry', () => {
      const ghost = removeItem('ghost');

      withRegistry((registry) => {
        const converted = convert(registry, [ghost]);

        expect(converted.diagnostics).toEqual([]);
        expect(converted.document.history).toHaveLength(1);
        expect(converted.document.history[0]).toMatchObject({
          id: ghost.id,
          enabled: true,
          operation: { kind: 'remove-layer', layerId: 'ghost' },
        });
        // Retained, so the legacy cursor maps onto it rather than lingering on the
        // baseline: a dropped entry would be an edit the shadow cannot undo.
        expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0]);
      });
    });

    it('is a no-op in durable replay, against the same document without the entry', () => {
      const ghost = removeItem('ghost');

      withRegistry((registry) => {
        const baselineOnly = convert(registry, []);
        const withRemoval = convert(registry, [ghost]);

        expect(replayDurableDocument(withRemoval.document).layers).toEqual(
          replayDurableDocument(baselineOnly.document).layers
        );
        expect(replayedLayerIds(withRemoval)).toEqual(['layer-1']);
      });
    });

    it('is a no-op in legacy replay, against the same history without the entry', () => {
      const ghost = removeItem('ghost');

      expect(legacyReplayedLayerIds([ghost])).toEqual(legacyReplayedLayerIds([]));
      expect(legacyReplayedLayerIds([ghost])).toEqual(['layer-1']);
    });

    it('plans and validates it exactly like a removal of a layer the document holds', () => {
      const ghost = removeItem('ghost');

      const plan = planRemoval(ghost);

      expect(plan.diagnostics).toEqual([]);
      expect(plan.durableEntry).not.toBeNull();
      expect(validatePlannedDurableEntry(plan.entry, plan.durableEntry!)).toBeNull();
    });
  });

  describe('planHistoryAppend', () => {
    it('translates a removal into the entry the adapter itself derives, with no diagnostics', () => {
      const result = planRemoval(removeItem('layer-1'));

      // The arm exists: without it this falls through to
      // `unsupported-history-feature` and plans no entry at all.
      expect(result.diagnostics).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('unsupported-history-feature');
      expect(result.durableEntry).not.toBeNull();
      expect(result.durableEntry).toEqual(deriveRemoveLayerEntry(result.entry));
      expect(result.durableEntry).toEqual({
        id: 'remove-layer-1',
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'remove-layer', layerId: 'layer-1' },
      });
      expect(Object.isFrozen(result.durableEntry!.operation)).toBe(true);
      // The legacy edit still stands: the plan is a projection, never a gate.
      expect(result.entry).toMatchObject({ actionName: REMOVE_ACTION, layerId: 'layer-1' });
    });

    it('plans a removal of a layer the document never held', () => {
      const result = planRemoval(removeItem('ghost'));

      expect(result.diagnostics).toEqual([]);
      expect(result.durableEntry).toEqual(deriveRemoveLayerEntry(result.entry));
      expect(result.durableEntry!.operation).toEqual({ kind: 'remove-layer', layerId: 'ghost' });
    });

    it('carries a disabled removal into the plan as disabled', () => {
      // `NewHistoryItem` has no `disabled` field and `createHistoryItem` drops it,
      // so the only way a live writer's plan can be disabled is args, which
      // `isEntryEnabled` reads.
      const result = planRemoval(removeItem('layer-1', { id: 'remove-disabled', args: { enabled: false } }));

      expect(result.diagnostics).toEqual([]);
      expect(result.durableEntry).not.toBeNull();
      expect(result.durableEntry!.enabled).toBe(false);
      expect(result.durableEntry).toEqual(convertedEntryFor(result.entry));
    });
  });

  describe('validatePlannedDurableEntry', () => {
    const item = removeItem('layer-1');
    const planned = deriveRemoveLayerEntry(item)!;
    // Hand-written, so this grades a plan against the contract rather than
    // against a second call to the derivation that produced it.
    const correct = {
      id: 'remove-layer-1',
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'remove-layer', layerId: 'layer-1' },
    } satisfies DurableHistoryEntry;

    it('accepts a correct plan', () => {
      expect(validatePlannedDurableEntry(item, correct)).toBeNull();
      expect(validatePlannedDurableEntry(item, planned)).toBeNull();
    });

    it('reports a remove-layer entry planned for an action that is not a removal', () => {
      const tool: HistoryItem = {
        id: 'remove-layer-1',
        actionName: TOOL_ACTION,
        layerId: 'layer-1',
        args: { toolName: 'blur', radius: 4 },
      };

      const reason = validatePlannedDurableEntry(tool, correct);

      // Every generic check passes first — same id, schema version, and enabled
      // state — so the action is the only thing left that can refuse it.
      expect(reason).toEqual(expect.any(String));
    });

    it('reports an operation of another kind', () => {
      const reason = validatePlannedDurableEntry(item, {
        ...correct,
        operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed' } },
      });

      expect(reason).toEqual(expect.any(String));
    });

    it.each([
      { label: 'a third key', operation: { kind: 'remove-layer', layerId: 'layer-1', extra: true } },
      { label: 'a single key', operation: { kind: 'remove-layer' } },
      { label: 'the layer id renamed away', operation: { kind: 'remove-layer', id: 'layer-1' } },
    ] satisfies ReadonlyArray<{ label: string; operation: object }>)(
      'reports an operation carrying $label rather than the canonical shape',
      ({ operation }) => {
        const reason = validatePlannedDurableEntry(item, { ...correct, operation } as unknown as DurableHistoryEntry);

        expect(reason).toEqual(expect.any(String));
      }
    );

    it('reports a retargeted layer id', () => {
      const reason = validatePlannedDurableEntry(item, {
        ...correct,
        operation: { kind: 'remove-layer', layerId: 'layer-2' },
      });

      expect(reason).toEqual(expect.any(String));
    });

    it('reports a plan that would re-enable a disabled removal', () => {
      const disabled: HistoryItem = { ...removeItem('layer-1', { id: 'remove-disabled' }), disabled: true };
      const reenabled: DurableHistoryEntry = {
        id: 'remove-disabled',
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'remove-layer', layerId: 'layer-1' },
      };

      const reason = validatePlannedDurableEntry(disabled, reenabled);

      expect(reason).toEqual(expect.any(String));
    });

    it('reports a plan that would disable an enabled removal', () => {
      const reason = validatePlannedDurableEntry(item, { ...correct, enabled: false });

      expect(reason).toEqual(expect.any(String));
    });
  });

  /**
   * The derivation's doc comment rests on two claims nothing else proves: a
   * removal needs no asset transaction, and publishing one does no registry work
   * at all. Both are read off the module singleton the conversion and the store
   * actually reach, with a control that proves the spies are live.
   */
  describe('asset-registry work', () => {
    it('does none when a removal plans and publishes', () => {
      const registry = getAssetRegistry();
      const begin = vi.spyOn(registry, 'beginDocumentAssetTransaction');
      const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
      try {
        const plan = planRemoval(removeItem('layer-1'));
        const base: DurableDocument = withRegistry(
          (privateRegistry) =>
            legacyHistoryToDurable([baselineItem()], { documentId, registry: privateRegistry }).document
        );

        const decision = decideDurableAppend({
          documentId,
          base,
          prior: { entries: [baselineItem()], cursor: 0, branchRevision: 0 },
          next: { entries: [baselineItem(), plan.entry], cursor: 1, branchRevision: 0 },
          entry: plan.entry,
          planned: plan.durableEntry,
          documentRevision: 0,
        });

        expect(decision.outcome).toBe('published');
        expect(begin).not.toHaveBeenCalled();
        expect(reconcile).not.toHaveBeenCalled();

        // Control: the same spies DO fire on the conversion fallback the store takes
        // when a publication is refused, so the two assertions above are read from a
        // live path rather than from an inert mock.
        const fallback = convertLegacyHistorySafely([baselineItem(), plan.entry], {
          documentId: 'asset-work-control',
        });
        expect(fallback.status).toBe('current');
        expect(begin).toHaveBeenCalled();
        expect(reconcile).toHaveBeenCalled();
        registry.disposeDocument('asset-work-control');
      } finally {
        begin.mockRestore();
        reconcile.mockRestore();
      }
    });
  });
});
