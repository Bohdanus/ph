import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { DocumentFrame } from '../document-frame.ts';
import {
  UnsupportedHistoryFeatureError,
  convertLegacyHistorySafely,
  legacyHistoryToDurable,
  toggleDurableEntry,
} from '../history-adapter.ts';
import {
  collectDurableAssetIds,
  freezeDurableDocument,
  type AssetId,
  type DurableDocument,
  type DurableOperation,
} from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';
import type { LayerSource } from '../layer-types.ts';
import {
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

const layerId = 'layer-1';
const documentId = 'diagnostics-doc';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

function blankLayer(id = layerId) {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as GlobalCompositeOperation,
    order: 0,
    pos: { x: 0, y: 0, width: 100, height: 80 },
    source: {
      kind: 'blank' as const,
      color: '#ffffff',
      opacity: 1,
      isBedrock: false as const,
      pos: { x: 0, y: 0, width: 100, height: 80 },
    },
    operations: [],
  };
}

function baselineHistory(id = 'baseline'): HistoryItem[] {
  return [
    {
      id,
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: {
        layers: { [layerId]: blankLayer() },
        size: initialSize,
        frame: baselineFrame,
      },
    },
  ];
}

function blurItem(id = 'blur-edit'): HistoryItem {
  return { id, actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } };
}

function colorItem(id = 'color-edit'): HistoryItem {
  return { id, actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } };
}

function convert(items: HistoryItem[], registry: AssetRegistry) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], { documentId, registry });
}

function convertSafely(items: HistoryItem[], registry: AssetRegistry) {
  return convertLegacyHistorySafely([...baselineHistory(), ...items], { documentId, registry });
}

function createOwnedBitmap(width = 1, height = 1) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

function imageLayerItem(id: string, bitmap: ImageBitmap): HistoryItem {
  const source: LayerSource = {
    kind: 'image',
    bitmap,
    isBedrock: false,
    pos: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
  };
  return { id, actionName: NEW_LAYER_ACTION, layerId: 'image-layer', layerSource: source };
}

function baselineItemWithImage(bitmap: ImageBitmap): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: 'image-layer',
    documentSource: {
      layers: {
        'image-layer': {
          ...blankLayer('image-layer'),
          bitmap,
          source: {
            kind: 'image' as const,
            bitmap,
            isBedrock: false as const,
            pos: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
          },
        },
      },
      size: initialSize,
      frame: baselineFrame,
    },
  } as unknown as HistoryItem;
}

/** Production raises non-Error values from data accessors; keep the shape local. */
function raise(value: unknown): never {
  throw value;
}

function itemThrowingOnLayerSource(id: string, value: unknown): HistoryItem {
  const item = { id, actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } } as HistoryItem;
  Object.defineProperty(item, 'layerSource', {
    configurable: true,
    get() {
      return raise(value);
    },
  });
  return item;
}

describe('MigrationDiagnostic code mapping', () => {
  it('maps an unsupported legacy action to code unsupported-history-feature with the offending item identity', () => {
    const registry = new AssetRegistry();
    const result = convert([{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }], registry);

    expect(result.diagnostics).toEqual([
      {
        historyId: 'pen-tool',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: expect.stringContaining('Tool pen cannot be replayed durably'),
      },
    ]);
    expect(result.diagnostics[0]?.message).not.toContain('undefined');
  });

  it('maps an unknown processor to code unsupported-history-feature', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [{ id: 'unknown-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'nonexistent-tool' as never } }],
      registry
    );

    expect(result.diagnostics).toEqual([
      {
        historyId: 'unknown-tool',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: expect.stringContaining('Unknown processor nonexistent-tool'),
      },
    ]);
  });

  it('maps a non-UnsupportedHistoryFeatureError entry failure to code invalid-history-entry', () => {
    const registry = new AssetRegistry();
    class FakeClass {
      foo = 'bar';
    }
    const result = convert(
      [
        {
          id: 'malformed',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'blur', radius: new FakeClass() as never },
        },
      ],
      registry
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual({
      historyId: 'malformed',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
      message: expect.stringContaining('Non-plain'),
    });
  });

  it('maps a document replacement inside a history to code document-replacement with action and history ids', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem(), { ...baselineHistory('replacement')[0] }, colorItem('color-after')], registry);

    expect(result.diagnostics).toEqual([
      {
        historyId: 'replacement',
        actionName: OPEN_DOCUMENT_ACTION,
        severity: 'error',
        code: 'document-replacement',
        message: 'Document replacement must create a new durable document and cannot appear inside a document history.',
      },
    ]);
    // The replacement produces no durable operation and maps to the preceding entry.
    expect(result.document.history.map((entry) => entry.id)).toEqual(['blur-edit', 'color-after']);
    expect(result.legacyCursorToDurableCursor[2]).toBe(0);
  });

  it('maps a whole-conversion failure to code conversion-failed without history or action keys', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    // A baseline snapshot is converted before the per-entry loop, so a failing
    // baseline escapes every per-entry guard and reaches the outer catch.
    vi.spyOn(registry, 'registerBaseline').mockImplementation(() => {
      raise(new Error('registry refused the baseline'));
    });

    const result = convertLegacyHistorySafely([baselineItemWithImage(createOwnedBitmap().bitmap)], {
      documentId,
      registry,
    });

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.legacyCursorToDurableCursor).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic).toEqual({
      severity: 'error',
      code: 'conversion-failed',
      message: 'registry refused the baseline',
    });
    expect(diagnostic && 'historyId' in diagnostic).toBe(false);
    expect(diagnostic && 'actionName' in diagnostic).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error thrown value into the per-entry diagnostic message', () => {
    const registry = new AssetRegistry();
    const result = convert([itemThrowingOnLayerSource('thrown-string', 'legacy entry exploded')], registry);

    expect(result.diagnostics).toEqual([
      {
        historyId: 'thrown-string',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'invalid-history-entry',
        message: 'legacy entry exploded',
      },
    ]);
  });

  it('stringifies a thrown plain object per entry and keeps the entry identity', () => {
    const registry = new AssetRegistry();
    const thrown = { toString: () => 'raster source vanished' };
    const result = convert([itemThrowingOnLayerSource('thrown-object', thrown)], registry);

    expect(result.diagnostics[0]?.message).toBe('raster source vanished');
    expect(result.diagnostics[0]).toMatchObject({ historyId: 'thrown-object', code: 'invalid-history-entry' });
  });

  it('reports an UnsupportedHistoryFeatureError raised outside the per-entry loop as unsupported-history-feature', () => {
    const registry = new AssetRegistry();
    const baseline = {
      ...baselineHistory()[0],
      documentSource: {
        layers: { [layerId]: { ...blankLayer(), source: undefined, bitmap: null } },
        size: initialSize,
        frame: baselineFrame,
      },
    } as unknown as HistoryItem;

    const result = convertLegacyHistorySafely([baseline], { documentId, registry });

    expect(result.status).toBe('unavailable');
    expect(result.diagnostics).toHaveLength(1);
    // The code follows the error class, not the throw site, so a baseline-level
    // failure keeps the unsupported-history-feature code without an entry id.
    expect(result.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0] && 'historyId' in result.diagnostics[0]).toBe(false);
    expect(result.diagnostics[0]?.message).toBe(`Layer ${layerId} has no durable source or raster materialization`);
  });

  it('produces error severity for every diagnostic code in a single conversion', () => {
    const registry = new AssetRegistry();
    class FakeClass {
      value = 'not-plain';
    }
    const result = convert(
      [
        blurItem(),
        { ...baselineHistory('replacement')[0] },
        { id: 'unknown-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'nonexistent-tool' as never } },
        {
          id: 'malformed',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'blur', radius: new FakeClass() as never },
        },
      ],
      registry
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'document-replacement',
      'unsupported-history-feature',
      'invalid-history-entry',
    ]);
    // The whole array, not `every(diagnostic => typeof … === 'string')`: that
    // predicate is satisfied by ANY string, so it could not tell a diagnostic
    // that names the offending entry and the rule that fired from one carrying
    // the wrong entry's id or another rule's message. Severity is pinned per
    // diagnostic here for the same reason the `every` check cannot be trusted —
    // it passes over an empty array.
    expect(result.diagnostics).toEqual([
      {
        historyId: 'replacement',
        actionName: OPEN_DOCUMENT_ACTION,
        severity: 'error',
        code: 'document-replacement',
        message: 'Document replacement must create a new durable document and cannot appear inside a document history.',
      },
      {
        historyId: 'unknown-tool',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Unknown processor nonexistent-tool',
      },
      {
        historyId: 'malformed',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'invalid-history-entry',
        message: 'Non-plain value at history:malformed.args.radius',
      },
    ]);
  });
});

describe('convertLegacyHistorySafely asset reconciliation', () => {
  it('reconciles the reachable asset set exactly once after a successful conversion', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');

    const result = convertSafely([imageLayerItem('image-layer', createOwnedBitmap(8, 6).bitmap), blurItem()], registry);

    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(documentId, collectDurableAssetIds(result.document!));
    const reachable = reconcile.mock.calls[0]?.[1] as ReadonlySet<AssetId>;
    expect(reachable).toBeInstanceOf(Set);
    expect(reachable.size).toBe(1);
    const source = result.document!.history[0]?.operation;
    expect(source?.kind).toBe('create-layer');
    expect(source?.kind === 'create-layer' && source.layer.source.kind).toBe('raster');
    expect(
      source?.kind === 'create-layer' &&
        source.layer.source.kind === 'raster' &&
        reachable.has(source.layer.source.assetId)
    ).toBe(true);
  });

  it('does not reconcile assets for a conversion rejected by an error diagnostic', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');

    const result = convertSafely(
      [
        imageLayerItem('image-layer', createOwnedBitmap().bitmap),
        { id: 'pen-tool', actionName: TOOL_ACTION, layerId: 'image-layer', args: { toolName: 'pen' } },
      ],
      registry
    );

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('rolls back assets registered by a failed conversion without losing pre-existing baselines', async () => {
    const registry = new AssetRegistry();
    const existing = createOwnedBitmap(4, 4);
    const existingId = registry.registerBaseline(documentId, existing.bitmap, { ownership: 'adopt' });
    const stray = createOwnedBitmap(6, 6);
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    const register = vi.spyOn(registry, 'registerBaseline');

    const result = convertSafely(
      [
        imageLayerItem('image-layer', stray.bitmap),
        { id: 'pen-tool', actionName: TOOL_ACTION, layerId: 'image-layer', args: { toolName: 'pen' } },
      ],
      registry
    );

    expect(result.status).toBe('unavailable');
    const registeredIds = register.mock.results.map((call) => call.value as AssetId).filter((id) => id !== existingId);
    expect(registeredIds).toHaveLength(1);
    // The transaction rolled the asset registered by the failed conversion back...
    expect(registry.getRecord(registeredIds[0]!)).toBeUndefined();
    // ...while leaving the baseline the caller owned before the conversion intact.
    expect(registry.getRecord(existingId)).toBeDefined();
    const lease = await registry.resolve(existingId);
    expect(lease.bitmap).toBe(existing.bitmap);
    lease.release();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('toggleDurableEntry immutability', () => {
  function twoEntryDocument(registry: AssetRegistry): DurableDocument {
    const result = legacyHistoryToDurable([...baselineHistory(), blurItem(), colorItem()], { documentId, registry });
    expect(result.diagnostics).toEqual([]);
    expect(result.document.history).toHaveLength(2);
    return result.document;
  }

  it('toggles an entry without mutating the source document in place', () => {
    const registry = new AssetRegistry();
    const document = twoEntryDocument(registry);
    const originalHistory = document.history;
    const firstBefore = document.history[0];
    const secondBefore = document.history[1];

    const toggled = toggleDurableEntry(document, 'blur-edit');

    // The source document keeps its array and entry identities, so no in-place
    // mutation leaked back into the caller's document.
    expect(document.history).toBe(originalHistory);
    expect(document.history[0]).toBe(firstBefore);
    expect(document.history[1]).toBe(secondBefore);
    expect(document.history[0]?.enabled).toBe(true);
    expect(document.history[1]?.enabled).toBe(true);

    // The result is a frozen document holding a new frozen array.
    expect(toggled).not.toBe(document);
    expect(Object.isFrozen(toggled)).toBe(true);
    expect(toggled.history).not.toBe(originalHistory);
    expect(Object.isFrozen(toggled.history)).toBe(true);
    expect(Object.isFrozen(toggled.history[0])).toBe(true);
    expect(Object.isFrozen(toggled.history[1])).toBe(true);
  });

  it('flips only the toggled entry and preserves the remaining entries and document fields', () => {
    const registry = new AssetRegistry();
    const document = twoEntryDocument(registry);
    const secondBefore = document.history[1];

    const toggled = toggleDurableEntry(document, 'blur-edit');

    expect(toggled.history.map((entry) => entry.id)).toEqual(['blur-edit', 'color-edit']);
    expect(toggled.history[0]?.enabled).toBe(false);
    expect(toggled.history[1]?.enabled).toBe(true);
    expect(toggled.history[1]).toEqual(secondBefore);
    expect(toggled.history[1]).not.toBe(toggled.history[0]);
    expect(toggled.history[0]?.operation).toEqual(document.history[0]?.operation);

    expect(toggled.documentId).toBe(document.documentId);
    expect(toggled.documentRevision).toBe(document.documentRevision);
    expect(toggled.cursor).toBe(document.cursor);
    expect(toggled.durableRevision).toBe(document.durableRevision + 1);
    expect(toggled.baseline).toEqual(document.baseline);
    // Only the revision counters move; every other non-history field survives.
    expect(toggled.branchRevision).toBe(document.branchRevision + 1);
  });

  it('advances the branch and durable revisions for a toggled entry', () => {
    const registry = new AssetRegistry();
    const document = twoEntryDocument(registry);

    const toggled = toggleDurableEntry(document, 'blur-edit');

    expect(toggled.branchRevision).toBe(document.branchRevision + 1);
    expect(toggled.durableRevision).toBe(document.durableRevision + 1);
  });

  it('re-enables a previously disabled entry', () => {
    const registry = new AssetRegistry();
    const document = twoEntryDocument(registry);

    const disabled = toggleDurableEntry(document, 'blur-edit');
    const reenabled = toggleDurableEntry(disabled, 'blur-edit');

    expect(disabled.history[0]?.enabled).toBe(false);
    expect(reenabled.history[0]?.enabled).toBe(true);
    // Toggling is cumulative and never mutates the intermediate document.
    expect(disabled.history[0]?.enabled).toBe(false);
  });

  it('returns the same document reference for an unknown entry id', () => {
    const registry = new AssetRegistry();
    const document = twoEntryDocument(registry);
    const historyBefore = document.history;

    const result = toggleDurableEntry(document, 'missing-entry');

    expect(result).toBe(document);
    expect(result.history).toBe(historyBefore);
  });
});

describe('UnsupportedHistoryFeatureError identity', () => {
  it('carries the offending history id and is recognised by the diagnostic mapper', () => {
    const registry = new AssetRegistry();
    const error = new UnsupportedHistoryFeatureError('Unsupported legacy action rename', 'entry-9');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('UnsupportedHistoryFeatureError');
    expect(error.code).toBe('unsupported-history-feature');
    expect(error.historyId).toBe('entry-9');
    expect(convertSafely([blurItem()], registry).status).toBe('current');
  });
});

describe('durable entry id uniqueness', () => {
  /** A rename carrying no readable `name` derives no patch and is dropped silently. */
  function droppedRenameItem(id: string): HistoryItem {
    return { id, actionName: RENAME_LAYER_ACTION, layerId, args: {} };
  }

  function frameItem(id: string, nextFrame: DocumentFrame): HistoryItem {
    return { id, actionName: SET_DOCUMENT_FRAME_ACTION, layerId, args: { nextFrame } };
  }

  function newBlankLayerItem(id: string, newLayerId: string): HistoryItem {
    return {
      id,
      actionName: NEW_LAYER_ACTION,
      layerId: newLayerId,
      layerSource: {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 100, height: 80 },
      },
    };
  }

  function reorderItem(id: string, layerToMoveId: string, afterWhichLayerId: string | null): HistoryItem {
    return { id, actionName: REORDER_ACTION, layerId: layerToMoveId, args: { layerToMoveId, afterWhichLayerId } };
  }

  function filterToolNames(operations: readonly DurableOperation[]): (string | undefined)[] {
    return operations.map((operation) => (operation.kind === 'apply-filter' ? operation.filter.toolName : undefined));
  }

  it('publishes one durable entry for a repeated legacy id and reports the repeat as a warning naming the id', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem('shared-id'), colorItem('shared-id')], registry);

    // The exact ids are the point: the repeat produced no second entry, so no
    // id-keyed lookup over the shadow can resolve to the wrong edit.
    expect(result.document.history.map((entry) => entry.id)).toEqual(['shared-id']);
    expect(result.document.cursor).toBe(0);
    expect(result.document.durableRevision).toBe(1);
    // The surviving entry is the FIRST occurrence — the one already in the
    // document before the repeat arrived, and the one a toggle of that id reaches.
    expect(result.document.history[0]?.operation).toMatchObject({
      kind: 'apply-filter',
      layerId,
      filter: { toolName: 'blur' },
    });
    // The repeat maps to the durable cursor preceding it, so a legacy cursor of 2
    // never resolves to the tip it did not create.
    expect(result.legacyCursorToDurableCursor).toEqual([-1, 0, 0]);

    expect(result.diagnostics).toEqual([
      {
        historyId: 'shared-id',
        actionName: TOOL_ACTION,
        severity: 'warning',
        code: 'invalid-history-entry',
        message: expect.stringContaining('shared-id'),
      },
    ]);
    expect(result.diagnostics[0]?.message).not.toContain('undefined');
  });

  it('keeps the conversion status current for a timeline that repeats an id, so the whole shadow is not withheld', () => {
    const registry = new AssetRegistry();
    const result = convertSafely([blurItem('shared-id'), colorItem('shared-id'), colorItem('after')], registry);

    // A warning, never an error. `convertLegacyHistorySafely` rolls the asset
    // transaction back and returns no document on the first `error`, so an error
    // here would withhold the shadow for EVERY entry in the timeline — including
    // the ones the legacy timeline handles without complaint.
    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    // Spelled out, not `every(...)`: a predicate over an empty array is true, so
    // it would have passed with no diagnostic at all — the one thing this test
    // exists to prevent. The exact array also pins the severity to `warning`,
    // which is the claim under the test, and the length to the single repeat.
    expect(result.diagnostics).toEqual([
      {
        historyId: 'shared-id',
        actionName: TOOL_ACTION,
        severity: 'warning',
        code: 'invalid-history-entry',
        message: expect.stringContaining('shared-id'),
      },
    ]);
    expect(result.document!.history.map((entry) => entry.id)).toEqual(['shared-id', 'after']);
  });

  it('keeps converting the entries after a repeat, so the report is scoped to the duplicate', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem('shared-id'), colorItem('shared-id'), blurItem('later')], registry);

    expect(result.document.history.map((entry) => entry.id)).toEqual(['shared-id', 'later']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.historyId).toBe('shared-id');
  });

  it('leaves an all-unique timeline untouched, with no duplicate diagnostic', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem(), colorItem()], registry);

    // The regression guard against an over-breadth filter: the same two entries
    // under unique ids still produce two durable entries, in order, and an empty
    // diagnostic list. Written as the whole document so any added, dropped or
    // reordered entry — and any field the filter could disturb — fails here.
    expect(result.diagnostics).toEqual([]);
    expect(result.document).toEqual({
      documentId,
      documentRevision: 0,
      branchRevision: 0,
      durableRevision: 2,
      baseline: {
        frame: baselineFrame,
        layers: [
          {
            id: layerId,
            name: 'Layer',
            isBedrock: false,
            visible: true,
            opacity: 1,
            locked: false,
            blendMode: 'source-over',
            order: 0,
            pos: { x: 0, y: 0, width: 100, height: 80 },
            // Provenance: the document source opened the document at `baselineFrame`,
            // and a baseline layer records the frame it was authored against.
            frame: baselineFrame,
            source: {
              kind: 'blank',
              color: '#ffffff',
              opacity: 1,
              isBedrock: false,
              size: { width: 100, height: 80 },
            },
          },
        ],
        selections: { selections: [], activeSelectionId: null },
        activeLayerId: layerId,
      },
      history: [
        {
          id: 'blur-edit',
          schemaVersion: 1,
          enabled: true,
          operation: {
            kind: 'apply-filter',
            layerId,
            filter: { toolName: 'blur', version: 1, args: { toolName: 'blur', radius: 4 } },
          },
        },
        {
          id: 'color-edit',
          schemaVersion: 1,
          enabled: true,
          operation: {
            kind: 'apply-filter',
            layerId,
            filter: { toolName: 'color', version: 1, args: { toolName: 'color', grayscale: 0.5 } },
          },
        },
      ],
      cursor: 1,
    });
    expect(result.legacyCursorToDurableCursor).toEqual([-1, 0, 1]);
  });

  it('does not consume the id of a dropped rename, so a later entry may still claim it', () => {
    const registry = new AssetRegistry();
    // The dropped rename publishes nothing and reports nothing, so its id was
    // never handed out: the later `shared` is a first occurrence, not a repeat.
    const result = convert([blurItem('first'), droppedRenameItem('shared'), colorItem('shared')], registry);

    expect(result.document.history.map((entry) => entry.id)).toEqual(['first', 'shared']);
    expect(result.diagnostics).toEqual([]);
    expect(result.legacyCursorToDurableCursor).toEqual([-1, 0, 0, 1]);
  });

  it('does not consume the id of a tool entry that derives no durable operation', () => {
    const registry = new AssetRegistry();
    // A selection tool records no durable operation at all: it is neither
    // published nor reported, so it cannot shadow a later entry's id either.
    const result = convert(
      [
        blurItem('first'),
        { id: 'shared', actionName: TOOL_ACTION, layerId, args: { toolName: 'rectangular-selection' } },
        colorItem('shared'),
      ],
      registry
    );

    expect(result.document.history.map((entry) => entry.id)).toEqual(['first', 'shared']);
    expect(result.diagnostics).toEqual([]);
  });

  it('maps a skipped repeat to the same durable cursor a dropped entry maps to, never the tip', () => {
    const registry = new AssetRegistry();
    // Both timelines publish three durable entries before the skipped legacy
    // entry, so both map it to index 2.
    const repeated = convert(
      [blurItem('first'), blurItem('second'), colorItem('shared'), colorItem('shared'), blurItem('third')],
      registry
    );
    const dropped = convert(
      [blurItem('first'), blurItem('second'), blurItem('third'), droppedRenameItem('dropped'), blurItem('fifth')],
      registry
    );

    expect(repeated.document.history).toHaveLength(4);
    expect(dropped.document.history).toHaveLength(4);
    expect(repeated.legacyCursorToDurableCursor[4]).toBe(2);
    expect(dropped.legacyCursorToDurableCursor[4]).toBe(2);
    // The tip is index 3 in both. Reaching it would show the user the edit that
    // came AFTER the skipped legacy entry, as though the repeat had undone it.
    expect(repeated.legacyCursorToDurableCursor[4]).not.toBe(repeated.document.history.length - 1);
  });

  it('records exactly one durable cursor per legacy entry, so a later undo cannot fall through to -1', () => {
    const registry = new AssetRegistry();
    const history = [...baselineHistory(), blurItem('shared-id'), colorItem('shared-id'), blurItem('last')];

    const result = legacyHistoryToDurable(history, { documentId, registry });

    // `StoreContext` resolves `legacyCursorToDurableCursor[historyCursor] ?? -1`,
    // so one cursor per legacy entry is load-bearing: a short map makes the NEXT
    // entry after the repeat resolve to -1, which replays the document back to
    // its untouched baseline — every undo after the duplicate losing its history.
    // The exact `toEqual` already pins the length, so no separate length
    // assertion is needed here.
    expect(result.legacyCursorToDurableCursor).toEqual([-1, 0, 0, 1]);
  });

  it('leaves the frame fold advanced, so the next derived frame starts where the skipped repeat ended', () => {
    const registry = new AssetRegistry();
    const first = { x: 0, y: 0, width: 200, height: 150 };
    const second = { x: 0, y: 0, width: 300, height: 250 };
    const third = { x: 10, y: 20, width: 320, height: 260 };

    const result = convert(
      [frameItem('shared-id', first), frameItem('shared-id', second), frameItem('after', third)],
      registry
    );

    expect(result.document.history.map((entry) => entry.id)).toEqual(['shared-id', 'after']);
    // `after` carries no `previousFrame`, so its `previous` is the fold's frame.
    // Rolling the fold back would record `first` here instead, and the append
    // boundary compares this value against the legacy `previousFrame`
    // (`history-append.ts:744-747`) — so a stale fold refuses the user's next crop.
    const after = result.document.history[1]?.operation;
    expect(after?.kind).toBe('set-document-frame');
    expect(after?.kind === 'set-document-frame' && after.previous).toEqual(second);
    expect(after?.kind === 'set-document-frame' && after.next).toEqual(third);
  });

  it('leaves the layer fold advanced, so a reorder after a skipped repeat is not derived from stale order', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        newBlankLayerItem('add-a', 'layer-a'),
        newBlankLayerItem('add-b', 'layer-b'),
        reorderItem('shared-id', 'layer-b', null),
        reorderItem('shared-id', 'layer-a', 'layer-b'),
        reorderItem('last', 'layer-b', layerId),
      ],
      registry
    );

    // The second `shared-id` reorder is withheld, but its fold still ran, so the
    // layer order the LAST reorder derives from is the order the legacy timeline
    // had. Rolling that fold back would rebuild the order from `layer-b, layer-1,
    // layer-a` instead of `layer-b, layer-a, layer-1`, and the shadow's layer
    // order would silently diverge from the order on the canvas.
    expect(result.document.history.map((entry) => entry.id)).toEqual(['add-a', 'add-b', 'shared-id', 'last']);
    const last = result.document.history[3]?.operation;
    expect(last?.kind).toBe('reorder-layers');
    expect(last?.kind === 'reorder-layers' && last.orderByLayerId).toEqual({
      'layer-a': 0,
      [layerId]: 1,
      'layer-b': 2,
    });
    // The user-visible half: replaying the shadow stacks the layers that way.
    const replayed = replayDurableDocument(result.document);
    expect(
      Object.fromEntries(Object.entries(replayed.layers).map(([id, layer]) => [id, layer.snapshot.order]))
    ).toEqual({ 'layer-a': 0, [layerId]: 1, 'layer-b': 2 });
  });

  it('leaves the id-keyed entry lookup resolving exactly one entry, so toggling the id cannot disable another edit', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem('shared-id'), colorItem('shared-id'), colorItem('later')], registry);
    const document = result.document;

    expect(new Set(document.history.map((entry) => entry.id)).size).toBe(document.history.length);
    // `toggleDisabled` resolves the id the History panel holds against the legacy
    // timeline, and the shadow resolves it by the same key. With one entry per id,
    // disabling `shared-id` disables that edit and nothing else.
    const toggled = toggleDurableEntry(document, 'shared-id');
    expect(toggled.history.map((entry) => [entry.id, entry.enabled])).toEqual([
      ['shared-id', false],
      ['later', true],
    ]);
  });

  it('freezes a duplicate id handed straight to the document, so the id guard has to live in conversion', () => {
    // NOT a converter test. It exercises only `freezeDurableDocument` and
    // `toggleDurableEntry` — the document is hand-built from a converted one so
    // that a genuine duplicate id can be handed to the freezer on purpose — and it
    // asserts nothing `legacyHistoryToDurable` decides. It lives in this file
    // because it is the evidence for the guarantee this suite pins: the duplicate
    // `freezeDurableDocument` maps 1:1 over `history` and copies each `id`
    // verbatim, so it is neither the source of a duplicate nor a place that could
    // remove one. That is why the guarantee has to be enforced upstream.
    const registry = new AssetRegistry();
    const converted = legacyHistoryToDurable([...baselineHistory(), blurItem('dup')], { documentId, registry });
    const first = converted.document.history[0]!;
    const withDuplicate: DurableDocument = {
      ...converted.document,
      history: [
        first,
        {
          ...first,
          operation: {
            kind: 'set-selection',
            before: { selections: [], activeSelectionId: null },
            after: { selections: [], activeSelectionId: 'x' },
          },
        },
      ],
      cursor: 1,
    };

    const frozen = freezeDurableDocument(withDuplicate);

    expect(frozen.history).toHaveLength(2);
    expect(frozen.history.map((entry) => entry.id)).toEqual(['dup', 'dup']);
    expect(Object.isFrozen(frozen.history)).toBe(true);
    expect(frozen.history[0]).not.toBe(frozen.history[1]);
    // So an id-keyed lookup on a frozen document really is ambiguous: toggling the
    // id flips the first entry and cannot reach the second. That is the hazard the
    // conversion prevents, not something freeze repairs downstream.
    const toggled = toggleDurableEntry(frozen, 'dup');
    expect(toggled.history.map((entry) => [entry.operation.kind, entry.enabled])).toEqual([
      ['apply-filter', false],
      ['set-selection', true],
    ]);
  });

  it('replays the shadow at the cursor a skipped repeat maps to, so undo stops before the lost edit', () => {
    const registry = new AssetRegistry();
    const result = convert([blurItem('shared-id'), colorItem('shared-id'), colorItem('last')], registry);
    const document = result.document;

    // Undo to the repeat's own legacy cursor maps to the blur alone. Landing on
    // the tip instead would show a colour edit the user never made at that point.
    const atRepeat = replayDurableDocument(document, result.legacyCursorToDurableCursor[2]!);
    expect(atRepeat.cursor).toBe(0);
    expect(filterToolNames(atRepeat.layers[layerId]?.operations ?? [])).toEqual(['blur']);
    // And the entry after the repeat is still reachable, so the timeline continues.
    const atTip = replayDurableDocument(document, result.legacyCursorToDurableCursor[3]!);
    expect(atTip.cursor).toBe(1);
    expect(filterToolNames(atTip.layers[layerId]?.operations ?? [])).toEqual(['blur', 'color']);
  });

  it('reports a later entry that reuses the baseline open-document id', () => {
    // The baseline document-source id is meaningful to the legacy first-match
    // resolver even though the source is not itself a durable history entry.
    // Conversion seeds that id in the duplicate set, so a later edit cannot
    // publish under the same key and make the two resolvers disagree silently.
    const registry = new AssetRegistry();
    const sharedId = 'baseline-id-collision';
    const history = [...baselineHistory(sharedId), blurItem(sharedId)];

    const result = legacyHistoryToDurable(history, { documentId, registry });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        historyId: sharedId,
        actionName: TOOL_ACTION,
        severity: 'warning',
        code: 'invalid-history-entry',
        message: expect.stringContaining('baseline document-source entry'),
      }),
    ]);
    expect(result.document.history).toEqual([]);
    expect(result.legacyCursorToDurableCursor).toEqual([-1, -1]);

    // The LEGACY resolver takes that id to the baseline open-document entry...
    const legacy = updateHistoryTimeline(
      { entries: history, cursor: 1, branchRevision: 0 },
      { type: 'toggle-disabled', entryId: sharedId }
    );
    expect(legacy.entries[0]?.actionName).toBe(OPEN_DOCUMENT_ACTION);
    expect(legacy.entries[0]?.disabled).toBe(true);
    expect(legacy.entries[1]?.disabled).toBeUndefined();

    // The durable resolver has no entry under the colliding id, so the warning
    // does not leave a second edit for the wrong first-match lookup to toggle.
    const durable = toggleDurableEntry(result.document, sharedId);
    expect(durable).toBe(result.document);
  });
});
