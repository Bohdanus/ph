import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  UnsupportedHistoryFeatureError,
  convertLegacyHistorySafely,
  legacyHistoryToDurable,
  toggleDurableEntry,
} from '../history-adapter.ts';
import { collectDurableAssetIds, type AssetId, type DurableDocument } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

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
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(result.diagnostics.every((diagnostic) => typeof diagnostic.message === 'string')).toBe(true);
    expect(result.diagnostics.every((diagnostic) => typeof diagnostic.historyId === 'string')).toBe(true);
    expect(result.diagnostics.every((diagnostic) => typeof diagnostic.actionName === 'string')).toBe(true);
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
