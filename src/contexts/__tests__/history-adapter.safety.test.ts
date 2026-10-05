import { describe, expect, it, vi } from 'vitest';

import { createSelectionHistoryItem } from '../../__tests__/fixtures/history.ts';
import { AssetRegistry } from '../asset-registry.ts';
import {
  convertLegacyHistorySafely,
  deriveSetSelectionEntry,
  isStructurallyValidConversion,
  legacyHistoryToDurable,
  type DurableConversionAttempt,
} from '../history-adapter.ts';
import {
  collectDurableAssetIds,
  DURABLE_SCHEMA_VERSION,
  type AssetId,
  type PlainValue,
  type SelectionSnapshot,
} from '../history-model.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, NEW_LAYER_ACTION, SELECTION_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

/** A selection state the conversion can read: `selections` is a real array. */
function selectionState(id = 'sel'): SelectionSnapshot {
  return {
    selections: [
      {
        id,
        points: [{ x: 1, y: 2 }],
        isActive: true,
        pos: { x: 1, y: 2, width: 3, height: 4 },
      } satisfies Selection,
    ],
    activeSelectionId: id,
  };
}

/**
 * The shapes `replayHistory` crashes on when it reads `next.selections.map(...)`
 * and the durable model must not silently answer "no selection" for instead.
 */
const UNUSABLE_NEXT_STATES: readonly (readonly [string, unknown])[] = [
  ['an empty object', {}],
  ['a null selections array', { selections: null }],
  ['a bare array', []],
  ['a non-array selections value', { selections: { id: 'sel' }, activeSelectionId: 'sel' }],
  ['a string', 'selections'],
  ['a number', 7],
];

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

function baselineHistory(): HistoryItem[] {
  return [
    {
      id: 'baseline',
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

function convert(items: HistoryItem[], registry: AssetRegistry) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
  });
}

function convertSafely(items: HistoryItem[], registry: AssetRegistry) {
  return convertLegacyHistorySafely([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
  });
}

function transformArgs(overrides: Partial<TransformToolArgs>): TransformToolArgs {
  return {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...overrides,
  };
}

describe('legacyHistoryToDurable safety boundary (P0.1)', () => {
  it('records a per-entry diagnostic and skips the entry for an unsupported tool', () => {
    const registry = new AssetRegistry();
    const result = convert([{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }], registry);

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'pen-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(result.diagnostics[0]?.message).toMatch(/cannot be replayed durably/);
    registry.shutdown();
  });

  it('records a per-entry diagnostic and skips the entry for an unknown processor', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        {
          id: 'unknown-tool',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'nonexistent-tool' as never },
        },
      ],
      registry
    );

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'unknown-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(result.diagnostics[0]?.message).toMatch(/Unknown processor/);
    registry.shutdown();
  });

  it('records a per-entry diagnostic and skips the entry for a mixed trapezoid-plus-affine transform', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        {
          id: 'mixed-transform',
          actionName: TOOL_ACTION,
          layerId,
          args: { ...transformArgs({ rotate: 17, trapezoid: 25 }) },
        },
      ],
      registry
    );

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'mixed-transform',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(result.diagnostics[0]?.message).toMatch(/Mixed trapezoid and affine transform is unsupported/);
    registry.shutdown();
  });

  it('produces a per-entry diagnostic and skips the entry for malformed non-plain arguments', () => {
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
          args: { toolName: 'blur', radius: new FakeClass() as unknown as number },
        },
      ],
      registry
    );

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'malformed',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
    });
    expect(result.diagnostics[0]?.message).toMatch(/Non-plain/);
    registry.shutdown();
  });

  it('records a per-entry diagnostic and skips the entry for non-finite transform values', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        {
          id: 'nan-transform',
          actionName: TOOL_ACTION,
          layerId,
          args: transformArgs({ rotate: NaN }),
        },
      ],
      registry
    );

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'nan-transform',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    expect(result.diagnostics[0]?.message).toMatch(/Transform values must be finite/);
    registry.shutdown();
  });

  it('does not register raster assets for a baseline that only uses blank sources', () => {
    const registry = new AssetRegistry();
    const register = vi.spyOn(registry, 'registerBaseline');
    const result = convert([], registry);

    expect(result.document.history).toHaveLength(0);
    expect(result.document.baseline.layers).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
    // The claim in the title, asserted rather than implied by the layer count. A
    // blank source carries no bitmap, so the conversion must reach no
    // `registerRaster` call at all: if `convertSource` grew a registration for the
    // blank arm, or `convertLayer` registered `layer.bitmap` on the no-source
    // path, the baseline would still be one layer and this would still pass.
    expect(register).not.toHaveBeenCalled();
    // And the published document references no asset either, so an asset id
    // cannot have entered the durable model through a route that never registered.
    expect([...collectDurableAssetIds(result.document)]).toEqual([]);
    registry.shutdown();
  });
});

describe('convertLegacyHistorySafely boundary (P0.1)', () => {
  it('publishes the document with the entry omitted for an unsupported tool entry', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }],
      registry
    );

    // The partition. An `error` diagnostic names an entry the document does NOT
    // contain, which is a fact about one entry rather than a verdict on the whole
    // conversion, so the document is published and the entry is absent. What this
    // test asserted before is the defect: one pen entry cost the entire timeline
    // its document and its cursor map.
    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(result.document?.history).toHaveLength(0);
    // The baseline survived, so the shadow still shadows something: the document
    // holds the opening state even though the only edit did not convert.
    expect(result.document?.baseline.layers).toHaveLength(1);
    // The cursor map is the part that is expensive to recompute, and the part the
    // old contract discarded. Neither legacy cursor has a durable entry to name,
    // so both map to -1 rather than to the tip of a document with no entries.
    expect(result.legacyCursorToDurableCursor).toEqual([-1, -1]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'pen-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    registry.shutdown();
  });

  it('publishes the document for an unknown processor entry', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [
        {
          id: 'unknown-tool',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'nonexistent-tool' as never },
        },
      ],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(result.document?.history).toHaveLength(0);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'unknown-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    registry.shutdown();
  });

  it('publishes the document for non-finite transform values', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [
        {
          id: 'nan-transform',
          actionName: TOOL_ACTION,
          layerId,
          args: transformArgs({ rotate: NaN }),
        },
      ],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(result.document?.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'nan-transform',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
    registry.shutdown();
  });

  it('withholds the document when a conversion throws instead of producing one', () => {
    const registry = new AssetRegistry();
    // The whole-conversion half of the partition, and the only reason
    // `status: 'unavailable'` still exists. The opening layer carries neither a
    // source nor a raster, so `snapshotFromDocumentSource` throws BEFORE the
    // per-entry loop — nothing inside the conversion catches it, and the catch in
    // `convertLegacyHistorySafely` is the boundary that reports it. Passed as the
    // only entry, not through `convertSafely`, because the throw happens while the
    // OPENING state is read: as a later entry this same item would be refused by
    // the document-replacement branch and never reach `convertLayer`.
    const opening = {
      ...baselineHistory()[0],
      documentSource: {
        layers: { [layerId]: { ...blankLayer(), source: undefined, bitmap: null } },
        size: initialSize,
        frame: baselineFrame,
      },
    } as unknown as HistoryItem;
    const result = convertLegacyHistorySafely([opening], { documentId: 'test-doc', registry });

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.legacyCursorToDurableCursor).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', code: 'unsupported-history-feature' });
    // A failure that names no entry is not entry-local, so it has no `historyId`
    // to name. That difference is the whole partition.
    expect(result.diagnostics[0]?.historyId).toBeUndefined();
    registry.shutdown();
  });

  it('keeps the asset of a published layer resolvable when a later entry does not convert', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const imageLayer = {
      ...blankLayer('img-layer'),
      source: {
        kind: 'image' as const,
        bitmap,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 10, height: 10 },
      },
      bitmap,
    };

    const result = convertSafely(
      [
        {
          id: 'img-layer-item',
          actionName: 'new layer',
          layerId: 'img-layer',
          layerSource: imageLayer.source as never,
        },
        {
          id: 'unsupported',
          actionName: TOOL_ACTION,
          layerId: 'img-layer',
          args: { toolName: 'pen' },
        },
      ],
      registry
    );

    // The old contract rolled the transaction back, which also discarded the asset
    // the PUBLISHED layer names — a per-entry problem paid for by an entry that
    // converted. The published document keeps that entry, and its asset is still
    // registered.
    expect(result.status).toBe('current');
    expect(result.document?.history.map((entry) => entry.id)).toEqual(['img-layer-item']);
    const operation = result.document!.history[0]?.operation;
    const source = operation?.kind === 'create-layer' ? operation.layer.source : undefined;
    expect(source?.kind).toBe('raster');
    const assetId = source?.kind === 'raster' ? source.assetId : undefined;
    expect(assetId).toBeDefined();
    expect(registry.getRecord(assetId!)).toBeDefined();
    // `registerRaster` records borrowed ownership, so reconciling a REACHABLE
    // asset releases nothing and closes nothing. Legacy replay reads this same
    // bitmap straight off the history item, so closing it would be data loss.
    expect(close).not.toHaveBeenCalled();
    registry.shutdown();
  });

  it('reclaims the asset an unpublished entry registered, rather than leaving it dangling', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap(8, 8);
    const second = createOwnedBitmap(8, 8);
    const imageItem = (id: string, layerId: string, bitmap: ImageBitmap): HistoryItem => ({
      id,
      actionName: NEW_LAYER_ACTION,
      layerId,
      layerSource: {
        kind: 'image',
        bitmap,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 8, height: 8 },
      } as never,
    });
    const registered = vi.spyOn(registry, 'registerBaseline');

    // The leak the new contract has to answer for, and it is REACHABLE rather
    // than hypothetical. A `create-layer` whose id repeats one already published
    // registers its raster on the way through and is then withheld from the
    // document, so the conversion commits and the asset is named by nothing in
    // the document that gets published. `reconcileDocumentAssets` releases by
    // REACHABILITY, which is why the success path reconciles at all; a commit
    // without reconciliation would dangle it until some later conversion.
    const result = convertSafely(
      [imageItem('layer-item', 'first-layer', first.bitmap), imageItem('layer-item', 'second-layer', second.bitmap)],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.document?.history).toHaveLength(1);
    const registeredIds = registered.mock.results.map((call) => call.value as AssetId);
    expect(registeredIds).toHaveLength(2);
    const reachable = [...collectDurableAssetIds(result.document!)];
    expect(reachable).toEqual([registeredIds[0]]);
    expect(registry.getRecord(registeredIds[0]!)).toBeDefined();
    // The withheld entry's asset is gone, and only the withheld one.
    expect(registry.getRecord(registeredIds[1]!)).toBeUndefined();
    registry.shutdown();
  });

  it('a later valid edit converts after an earlier entry did not', () => {
    const registry = new AssetRegistry();

    const badResult = convertSafely(
      [{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }],
      registry
    );
    // Before the partition this was an "unavailable, then recover" pair, and the
    // recovery was the evidence of how much the failure cost. There is no
    // unavailable here to recover from: the pen entry is simply absent from a
    // published document.
    expect(badResult.status).toBe('current');
    expect(badResult.document).not.toBeNull();
    expect(badResult.document?.history).toHaveLength(0);
    expect(badResult.diagnostics[0]).toMatchObject({ historyId: 'pen-tool', severity: 'error' });

    const goodResult = convertSafely(
      [{ id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }],
      registry
    );
    expect(goodResult.status).toBe('current');
    expect(goodResult.document).not.toBeNull();
    expect(goodResult.diagnostics).toHaveLength(0);
    expect(goodResult.document?.history).toHaveLength(1);
    expect(goodResult.document?.history[0]?.id).toBe('blur-edit');
    registry.shutdown();
  });

  it('a valid conversion with no errors returns current status and a populated document', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [
        { id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
        { id: 'color-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } },
      ],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(result.diagnostics).toHaveLength(0);
    expect(result.document?.history).toHaveLength(2);
    registry.shutdown();
  });

  it('commits the asset transaction and reconciles the reachable set for a valid conversion', async () => {
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(10, 10);
    const imageLayer = {
      ...blankLayer('img-layer'),
      source: {
        kind: 'image' as const,
        bitmap,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 10, height: 10 },
      },
      bitmap,
    };
    const transaction = vi.spyOn(registry, 'beginDocumentAssetTransaction');
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');

    const result = convertSafely(
      [
        {
          id: 'img-layer-item',
          actionName: 'new layer',
          layerId: 'img-layer',
          layerSource: imageLayer.source as never,
        },
        { id: 'blur-edit', actionName: TOOL_ACTION, layerId: 'img-layer', args: { toolName: 'blur', radius: 4 } },
      ],
      registry
    );

    expect(result.status).toBe('current');
    expect(transaction).toHaveBeenCalledExactlyOnceWith('test-doc');
    // Hand-derived on purpose. `collectDurableAssetIds(result.document!)` would be
    // the very call the code under test makes on the very document it converted
    // (`collectDurableAssetIds` in `history-adapter.ts`), so it could only ever catch a
    // hand-supplied
    // document, never a defect in the set the adapter reconciles with. The id is
    // read off the published layer instead, and the reconciled set must be exactly
    // that one id: a set carrying a stray id would release an asset the document
    // still references, and `expect.any(Set)` would accept it.
    const operation = result.document!.history[0]?.operation;
    const publishedSource = operation?.kind === 'create-layer' ? operation.layer.source : null;
    expect(publishedSource?.kind).toBe('raster');
    const publishedAssetId = publishedSource?.kind === 'raster' ? publishedSource.assetId : null;
    expect(publishedAssetId).not.toBeNull();
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith('test-doc', new Set([publishedAssetId!]));
    const reachable = reconcile.mock.calls[0]?.[1] as ReadonlySet<AssetId>;
    expect(reachable.size).toBe(1);
    // The reconciled baseline is still resolvable through the registry.
    const lease = await registry.resolve([...reachable][0]!);
    expect(lease.bitmap).toBe(bitmap);
    lease.release();
    registry.shutdown();
  });

  it('reconciles by reachability for a conversion that omitted an entry', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const imageLayer = {
      ...blankLayer('img-layer'),
      source: {
        kind: 'image' as const,
        bitmap,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 10, height: 10 },
      },
      bitmap,
    };
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    const register = vi.spyOn(registry, 'registerBaseline');

    const result = convertSafely(
      [
        {
          id: 'img-layer-item',
          actionName: 'new layer',
          layerId: 'img-layer',
          layerSource: imageLayer.source as never,
        },
        { id: 'unsupported', actionName: TOOL_ACTION, layerId: 'img-layer', args: { toolName: 'pen' } },
      ],
      registry
    );

    // The counterpart of the withheld-document rule: the transaction COMMITS, and
    // reconciliation runs with the set the published document actually names. The
    // image layer is in that document, so its asset survives — where a rollback
    // would have released an asset a published entry still referenced, and where
    // no reconciliation at all would have released nothing.
    expect(result.status).toBe('current');
    expect(reconcile).toHaveBeenCalledOnce();
    const registeredIds = register.mock.results.map((call) => call.value as AssetId);
    expect(registeredIds).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledWith('test-doc', new Set([registeredIds[0]!]));
    expect(registry.getRecord(registeredIds[0]!)).toBeDefined();
    expect(close).not.toHaveBeenCalled();
    registry.shutdown();
  });
});

describe('legacy-to-durable cursor mapping (P0.2)', () => {
  it('maps a skipped no-op entry to the preceding durable cursor, never the tip', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        { id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
        { id: 'noop-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'reposition' } },
        { id: 'color-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } },
      ],
      registry
    );

    // Durable history: [blur-entry(0), color-entry(1)]. The no-op at legacy
    // index 2 is skipped (null operation), so its cursor must map to durable
    // index 0 (the blur), not the tip (index 1).
    expect(result.document.history.map((entry) => entry.id)).toEqual(['blur-edit', 'color-edit']);
    const cursorMap = result.legacyCursorToDurableCursor;
    expect(cursorMap[2]).toBe(0); // no-op → preceding durable entry
    expect(cursorMap[2]).not.toBe(1); // not the tip
    registry.shutdown();
  });

  it('maps an unsupported (error) entry to the preceding durable cursor, never the tip', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        { id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
        { id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } },
        { id: 'color-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } },
      ],
      registry
    );

    // The pen tool throws, is caught, and skipped. Durable history: [blur(0), color(1)].
    expect(result.document.history.map((entry) => entry.id)).toEqual(['blur-edit', 'color-edit']);
    const cursorMap = result.legacyCursorToDurableCursor;
    expect(cursorMap[2]).toBe(0); // unsupported → preceding durable entry
    expect(cursorMap[2]).not.toBe(1); // not the tip
    registry.shutdown();
  });

  it('retains a disabled entry in history and maps the cursor to its durable index', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        { id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
        {
          id: 'color-edit',
          actionName: TOOL_ACTION,
          layerId,
          disabled: true,
          args: { toolName: 'color', grayscale: 0.5 },
        },
        { id: 'blur2-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 8 } },
      ],
      registry
    );

    // Disabled entries are retained (marked enabled=false) but excluded from active replay.
    expect(result.document.history.map((entry) => entry.enabled)).toEqual([true, false, true]);
    const cursorMap = result.legacyCursorToDurableCursor;
    expect(cursorMap[2]).toBe(1); // disabled entry maps to its own index
    registry.shutdown();
  });

  it('never advances the cursor to the tip when the legacy cursor precedes a later valid edit', () => {
    const registry = new AssetRegistry();
    const result = convert(
      [
        { id: 'first-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
        { id: 'second-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.3 } },
      ],
      registry
    );

    const cursorMap = result.legacyCursorToDurableCursor;
    // Legacy cursor at index 1 (before the second edit) maps to durable index 0,
    // not the tip (index 1).
    expect(cursorMap[1]).toBe(0);
    expect(cursorMap[1]).not.toBe(1);
    registry.shutdown();
  });
});

function createOwnedBitmap(width = 1, height = 1) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

/**
 * The fail-closed half of the partition, pinned on hand-built results.
 *
 * No conversion in `history-adapter.ts` produces an out-of-range cursor, so a test
 * that tried to reach this through `convertSafely` would prove nothing: it would
 * pass because the guard never fires, not because the guard is right. The rule
 * itself is the subject, so it is given results the converter cannot build and
 * asked about them directly.
 */
describe('isStructurallyValidConversion', () => {
  const withCursors = (cursors: readonly number[], entryCount = 1) =>
    ({
      document: { history: new Array(entryCount).fill({ id: 'entry' }) },
      diagnostics: [],
      legacyCursorToDurableCursor: cursors,
    }) as unknown as Parameters<typeof isStructurallyValidConversion>[0];

  it('accepts a map whose every value is an index the document holds, or -1', () => {
    // 0 is the only entry a one-entry document has, so 0 and -1 are the whole
    // vocabulary here; anything else is out of range by construction.
    expect(isStructurallyValidConversion(withCursors([0]))).toBe(true);
    expect(isStructurallyValidConversion(withCursors([-1, 0]))).toBe(true);
    expect(isStructurallyValidConversion(withCursors([], 0))).toBe(true);
  });

  it.each([
    ['a cursor past the tip', [1]],
    ['a negative cursor below the baseline', [-2]],
    ['a non-integer cursor', [0.5]],
    ['NaN', [Number.NaN]],
    ['a cursor that is not a number at all', ['0']],
    ['one bad value among good ones', [-1, 0, 2]],
  ])('refuses %s', (_label, cursors) => {
    expect(isStructurallyValidConversion(withCursors(cursors as readonly number[]))).toBe(false);
  });

  it('bounds the accepted range by the document the conversion actually produced', () => {
    // The same cursor, two documents. A three-entry document holds 0..2, so 2 is a
    // real target; a one-entry document does not, so 2 navigates to nothing. A
    // check hard-coded to any single bound would get one of the two wrong.
    expect(isStructurallyValidConversion(withCursors([2], 3))).toBe(true);
    expect(isStructurallyValidConversion(withCursors([2], 1))).toBe(false);
  });
});

describe('legacyHistoryToDurable selection fail-closed boundary', () => {
  it.each(UNUSABLE_NEXT_STATES)(
    'records an error diagnostic naming the entry for %s next selection state',
    (_label, next) => {
      const registry = new AssetRegistry();
      const result = convert([createSelectionHistoryItem(selectionState(), next)], registry);

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        historyId: 'selection-clear',
        actionName: SELECTION_ACTION,
        severity: 'error',
        code: 'invalid-history-entry',
      });
      expect(result.diagnostics[0]?.message).toMatch(/unusable nextSelectionState/);
      // No fabricated entry: an unreadable state never becomes a cleared selection.
      expect(result.document.history).toHaveLength(0);
      registry.shutdown();
    }
  );

  it.each(UNUSABLE_NEXT_STATES)(
    'omits the entry but publishes the document for %s next selection state',
    (_label, next) => {
      const registry = new AssetRegistry();
      const result = convertSafely([createSelectionHistoryItem(selectionState(), next)], registry);

      // The document is no longer withheld, and the entry is no longer INVENTED as a
      // clear. What the throw in the `SELECTION_ACTION` arm buys now is the omission
      // plus the diagnostic: the shadow asserts nothing about a state it cannot read,
      // and `legacy replay` — which crashes on the very same shapes — is not shadowed
      // by an answer it never gave.
      expect(result.status).toBe('current');
      expect(result.document).not.toBeNull();
      expect(result.document?.history).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        historyId: 'selection-clear',
        actionName: SELECTION_ACTION,
        severity: 'error',
      });
      registry.shutdown();
    }
  );

  it('names the offending entry id in the diagnostic message', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [createSelectionHistoryItem(selectionState(), {}, { id: 'unreadable-selection' })],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.diagnostics[0]?.message).toContain('unreadable-selection');
    registry.shutdown();
  });

  it.each([
    ['an absent', undefined],
    ['an explicitly null', null],
  ])('stays current and clears for %s next selection state', (_label, next) => {
    const registry = new AssetRegistry();
    const result = convertSafely([createSelectionHistoryItem(selectionState(), next)], registry);

    // `replayHistory` reads `next?.selections ?? []`, so the shadow has to clear
    // here to stay equal to the legacy replay it shadows.
    expect(result.status).toBe('current');
    expect(result.diagnostics).toEqual([]);
    const operation = result.document?.history[0]?.operation;
    expect(operation).toMatchObject({ kind: 'set-selection', after: { selections: [], activeSelectionId: null } });
    expect(operation?.kind === 'set-selection' && operation.before.selections[0]?.id).toBe('sel');
    registry.shutdown();
  });

  it('separates an absent next state, which clears, from an unreadable one, which only reports', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        createSelectionHistoryItem(selectionState(), undefined, { id: 'absent-selection' }),
        createSelectionHistoryItem(selectionState(), {}, { id: 'unreadable-selection' }),
      ],
      registry
    );

    const [cleared] = converted.document.history;
    expect(cleared?.id).toBe('absent-selection');
    expect(cleared?.operation).toMatchObject({
      kind: 'set-selection',
      after: { selections: [], activeSelectionId: null },
    });
    // Only the unreadable entry is reported, and it contributes no entry at all.
    expect(converted.diagnostics).toHaveLength(1);
    expect(converted.diagnostics[0]).toMatchObject({ historyId: 'unreadable-selection', severity: 'error' });
    registry.shutdown();
  });

  /**
   * `isValidSelectionSnapshot` reads three shapes for `activeSelectionId`:
   * absent, null, or a string. Every unusable-shape
   * table above feeds it an unusable `selections`, which the guard rejects on the
   * FIRST clause — so the third clause is pinned nowhere in the suite, and a
   * snapshot whose `selections` is perfectly readable is the only thing that can
   * reach it.
   */
  it.each([
    ['a number', 7],
    ['a boolean', true],
    ['an object', { id: 'sel' }],
  ])('refuses a next selection state whose activeSelectionId is %s', (_label, activeSelectionId) => {
    const registry = new AssetRegistry();
    const next = { selections: selectionState('next').selections, activeSelectionId };
    const result = convert([createSelectionHistoryItem(selectionState(), next)], registry);

    // Refused, not normalized: an id that cannot be matched to a selection is a
    // state the model cannot read, and a fabricated `null` would assert "no active
    // selection" for a user who has one. If the guard accepted any value here, the
    // entry would be published and these three assertions would all fail.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'selection-clear',
      actionName: SELECTION_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
    });
    expect(result.document.history).toHaveLength(0);
    expect(deriveSetSelectionEntry(createSelectionHistoryItem(selectionState(), next), selectionState())).toBeNull();
    registry.shutdown();
  });

  it('accepts an explicitly null activeSelectionId and publishes it as null', () => {
    const registry = new AssetRegistry();
    const next = { selections: selectionState('next').selections, activeSelectionId: null };
    const result = convert([createSelectionHistoryItem(selectionState(), next)], registry);

    // The accept side of the same three-clause guard, and the common shape: an
    // ordinary select-none carries `activeSelectionId: null` explicitly. A guard
    // tightened to require the key to be absent — or to reject `null` — would void
    // the whole shadow for every ordinary deselect.
    expect(result.diagnostics).toEqual([]);
    const operation = result.document.history[0]?.operation;
    expect(operation).toMatchObject({ kind: 'set-selection', after: { activeSelectionId: null } });
    expect(operation?.kind === 'set-selection' && operation.after.selections.map((entry) => entry.id)).toEqual([
      'next',
    ]);
    registry.shutdown();
  });

  /**
   * The tripwire this replaces — `it('voids the whole conversion for an unreadable
   * previous state on the FIRST selection entry')` — was deleted rather than
   * edited, as its own docblock required. It pinned the asymmetry: the baseline
   * derivation read the first selection entry's `previousSelectionState` with no
   * structural guard, so a malformed one threw outside every per-entry boundary
   * and voided the whole shadow, while the identical value one entry later was
   * tolerated by `deriveSetSelectionEntry`. Below, the same value at the same
   * position is a `warning` on a published document, and the next test proves the
   * two positions now cost the same thing.
   */
  it('tolerates an unreadable previous state on the FIRST selection entry, as it does one entry later', () => {
    const registry = new AssetRegistry();
    const firstEntry = createSelectionHistoryItem({ selections: null }, selectionState('next'), { id: 'first-clear' });
    const result = convertSafely([firstEntry], registry);

    // Not withheld, and not a `conversion-failed` with no id to blame. The entry
    // that carried the unreadable state is named instead.
    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        historyId: 'first-clear',
        actionName: SELECTION_ACTION,
        severity: 'warning',
        code: 'invalid-history-entry',
      }),
    ]);
    // The baseline is the EMPTY selection, which is what `replayHistory` starts
    // from for the same timeline: both callers read the state through
    // `deriveSelectionBaseline`, so the fallback is parity rather than a guess.
    expect(result.document?.baseline.selections).toEqual({ selections: [], activeSelectionId: null });
    expect(result.legacyCursorToDurableCursor).toEqual([-1, 0]);
    registry.shutdown();
  });

  it('gives a malformed previous state the same cost on the first entry as on a later one', () => {
    const registry = new AssetRegistry();
    const malformed = { selections: null };
    const first = convertSafely(
      [createSelectionHistoryItem(malformed, selectionState('next'), { id: 'first-clear' })],
      registry
    );
    const later = convertSafely(
      [
        createSelectionHistoryItem(selectionState('seed'), selectionState('next'), { id: 'seed' }),
        createSelectionHistoryItem(malformed, selectionState('later-next'), { id: 'later-clear' }),
      ],
      registry
    );

    // Position in the timeline decided the blast radius before, and that was the
    // defect. Now both positions publish a document, and the difference between
    // them is only the diagnostic the FIRST one earns for a baseline it had to
    // fabricate: a later entry's `previous` is merely unused, because the tracked
    // selections already hold the answer.
    expect(first.status).toBe('current');
    expect(later.status).toBe('current');
    expect(first.document?.history).toHaveLength(1);
    expect(later.document?.history).toHaveLength(2);
    expect(first.diagnostics).toHaveLength(1);
    expect(later.diagnostics).toEqual([]);
    // And the fabricated baseline is genuinely empty rather than an alias of
    // something, so a reader holding the document cannot mistake it for a state.
    expect(first.document?.baseline.selections.selections).toEqual([]);
    registry.shutdown();
  });
});

describe('deriveSetSelectionEntry', () => {
  const currentSelection = selectionState('current');
  const beforeOf = (derived: ReturnType<typeof deriveSetSelectionEntry>) =>
    derived?.operation.kind === 'set-selection' ? derived.operation.before : null;
  const afterOf = (derived: ReturnType<typeof deriveSetSelectionEntry>) =>
    derived?.operation.kind === 'set-selection' ? derived.operation.after : null;

  it('derives before and after from the legacy item and shares its entry id', () => {
    const previousSelection = selectionState('previous');
    const nextSelection = selectionState('next');

    const derived = deriveSetSelectionEntry(
      createSelectionHistoryItem(previousSelection, nextSelection),
      currentSelection
    );

    expect(derived).toEqual({
      id: 'selection-clear',
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-selection', before: previousSelection, after: nextSelection },
    });
  });

  it('uses the tracked current selections as the before baseline when the item carries none', () => {
    const nextSelection = selectionState('next');

    const derived = deriveSetSelectionEntry(createSelectionHistoryItem(undefined, nextSelection), currentSelection);

    expect(beforeOf(derived)).toEqual(currentSelection);
    expect(afterOf(derived)).toEqual(nextSelection);
  });

  it('uses the tracked current selections when the previous state is present but unreadable', () => {
    const nextSelection = selectionState('next');

    // PRESENT AND MALFORMED is a different input from absent, and the two tests
    // above and here are the two halves of one ternary in `deriveSetSelectionEntry`.
    // A production change that dropped the
    // `isValidSelectionSnapshot(previous)` guard would call
    // `selectionSnapshot(null, undefined)` on this fixture and throw out of the
    // per-entry try, voiding the shadow instead of deriving an entry.
    const derived = deriveSetSelectionEntry(
      createSelectionHistoryItem({ selections: null }, nextSelection),
      currentSelection
    );

    expect(derived).not.toBeNull();
    expect(beforeOf(derived)).toEqual(currentSelection);
    expect(afterOf(derived)).toEqual(nextSelection);
  });

  it.each(UNUSABLE_NEXT_STATES)(
    'returns null for %s next selection state instead of an empty after',
    (_label, next) => {
      expect(deriveSetSelectionEntry(createSelectionHistoryItem(selectionState(), next), currentSelection)).toBeNull();
    }
  );

  it.each([
    ['an absent', undefined],
    ['an explicitly null', null],
  ])('returns null for %s next selection state, the shape only the conversion clears', (_label, next) => {
    expect(deriveSetSelectionEntry(createSelectionHistoryItem(selectionState(), next), currentSelection)).toBeNull();
  });

  it('distinguishes a genuine select-none from a next state it cannot read', () => {
    const cleared = deriveSetSelectionEntry(
      createSelectionHistoryItem(selectionState(), { selections: [], activeSelectionId: null }),
      currentSelection
    );
    const unreadable = deriveSetSelectionEntry(
      createSelectionHistoryItem(selectionState(), { selections: null }),
      currentSelection
    );

    // A real empty snapshot is a real clear and has to survive. The refusal must
    // never be the same answer, or the two become indistinguishable downstream.
    expect(afterOf(cleared)).toEqual({ selections: [], activeSelectionId: null });
    expect(unreadable).toBeNull();
  });

  it('copies the baseline rather than aliasing the tracked current selections', () => {
    const derived = deriveSetSelectionEntry(
      createSelectionHistoryItem(undefined, selectionState('next')),
      currentSelection
    );
    const before = beforeOf(derived);

    expect(before).toEqual(currentSelection);
    expect(before).not.toBe(currentSelection);
    expect(before?.selections).not.toBe(currentSelection.selections);
    expect(before?.selections[0]).not.toBe(currentSelection.selections[0]);
    expect(before?.selections[0]?.points).not.toBe(currentSelection.selections[0]?.points);
    expect(before?.selections[0]?.pos).not.toBe(currentSelection.selections[0]?.pos);
  });

  it('copies the previous state off the legacy item rather than aliasing its args', () => {
    const previousSelection = selectionState('previous');
    const derived = deriveSetSelectionEntry(
      createSelectionHistoryItem(previousSelection, selectionState('next')),
      currentSelection
    );
    const before = beforeOf(derived);

    expect(before).toEqual(previousSelection);
    expect(before).not.toBe(previousSelection);
    expect(before?.selections[0]).not.toBe(previousSelection.selections[0]);
  });

  it('normalizes a key-absent activeSelectionId to null', () => {
    const bare = { selections: selectionState('next').selections };

    const derived = deriveSetSelectionEntry(createSelectionHistoryItem(undefined, bare), currentSelection);
    const after = afterOf(derived);

    expect(after?.activeSelectionId).toBeNull();
    expect(after?.selections.map((selection) => selection.id)).toEqual(['next']);
  });

  it('carries the disabled state of the legacy item', () => {
    const derived = deriveSetSelectionEntry(
      createSelectionHistoryItem(undefined, selectionState('next'), { disabled: true }),
      currentSelection
    );

    expect(derived?.enabled).toBe(false);
  });
});

/**
 * `plainValue` treats `undefined` as ABSENCE in the object branch, and after the
 * fix as absence PRESERVED AS A HOLE in the array branch. The two branches
 * disagreeing WAS the defect: an array element of `undefined` fell through to the
 * non-plain throw, and the throw became an `error` diagnostic naming the whole
 * entry — so a single holey tool-arg array was enough to take that entry out of
 * the durable document and stop navigation descending through it, which is a far
 * worse outcome than the object branch's own handling of the very same value.
 *
 * The array branch KEEPS the absence rather than compacting it away, because
 * legacy replay (`history-replay.ts`) hands the processor the original array and
 * an index IS the meaning: `[0, undefined, 1]` must not become `[0, 1]`. What
 * survives as a divergence is narrower — the durable array is a real hole where
 * legacy's is an explicit `undefined`, so `1 in array` disagrees — and that is
 * reported as an `array-arg-hole-preserved` `warning` rather than adopted
 * silently. The object branch is the opposite rule on purpose: there a key and
 * a key-present-and-undefined are the same OBSERVATION, so the key survives with
 * an undefined value rather than being dropped.
 *
 * The guard rails the fix must not relax: a non-finite number and a non-plain
 * value inside an array are still defects, and `null` is a value the guard
 * explicitly admits at the top of the function, so only `undefined` is absence.
 */
describe('plainValue absence handling (history-adapter)', () => {
  it('an explicit undefined element in a tool-arg array does not cost the entry', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [
        {
          id: 'undefined-element',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'levels', stops: [0, undefined, 1] },
        },
      ],
      registry
    );

    expect(result.status).toBe('current');
    expect(result.document).not.toBeNull();
    // The exact payload, not just "something was published". `.not.toHaveLength(0)`
    // passed for a second entry, for an entry derived from the wrong args, and for
    // an entry whose `stops` had been compacted to `[0, 1]`.
    expect(result.document?.history).toHaveLength(1);
    const operation = result.document?.history[0]?.operation;
    expect(operation?.kind).toBe('apply-filter');
    if (operation?.kind === 'apply-filter') {
      const durableStops = operation.filter.args.stops as readonly unknown[];
      // This array is DENSE, so the only clause of the array walk that can accept
      // its middle element is `value[index] === undefined` in `plainValue`
      // (`history-adapter.ts`). Dropping that clause would call
      // `plainValue(undefined, ...)`, which throws `Non-plain value`, and void the
      // whole document — so the status assertion above is the one that catches it,
      // while these three catch the array being rebuilt shorter or reordered.
      expect(durableStops).toHaveLength(3);
      expect(durableStops[0]).toBe(0);
      expect(durableStops[2]).toBe(1);
      expect(1 in durableStops).toBe(false);
    }
    registry.shutdown();
  });

  it('an explicitly undefined argument property survives conversion', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [
        {
          id: 'undefined-property',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'levels', optional: undefined },
        },
      ],
      registry
    );

    const operation = result.document?.history[0]?.operation;
    expect(result.status).toBe('current');
    expect(operation?.kind).toBe('apply-filter');
    if (operation?.kind === 'apply-filter') {
      expect(Object.hasOwn(operation.filter.args, 'optional')).toBe(true);
      expect(operation.filter.args.optional).toBeUndefined();
    }
    registry.shutdown();
  });

  it('a hole in a tool-arg array stays a hole', () => {
    const registry = new AssetRegistry();
    const holey = new Array<unknown>(3);
    holey[0] = 0;
    holey[2] = 1;
    const result = convertSafely(
      [{ id: 'hole', actionName: TOOL_ACTION, layerId, args: { toolName: 'levels', stops: holey } }],
      registry
    );

    const operation = result.document?.history[0]?.operation;
    expect(result.status).toBe('current');
    expect(operation?.kind).toBe('apply-filter');
    if (operation?.kind === 'apply-filter') {
      const stops = operation.filter.args.stops as readonly unknown[];
      expect(stops).toHaveLength(3);
      expect(1 in stops).toBe(false);
    }
    registry.shutdown();
  });

  /**
   * `levels` commits as `layer-operation`, so `history-adapter.ts` runs its args
   * through `plainObject` and stores them at `operation.filter.args`. The array
   * therefore survives into the durable document, which is what makes the STORED
   * shape assertable rather than only the diagnostic.
   */
  function levelsItem(overrides: Record<string, unknown>, id = 'levels-edit'): HistoryItem {
    return {
      id,
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'levels', brightness: 1, contrast: 2, ...overrides },
    };
  }

  /** The array exactly as the durable document holds it, or `undefined` if the operation is not a filter. */
  function durableStops(document: DurableConversionAttempt['document']): readonly PlainValue[] | undefined {
    const operation = document?.history[0]?.operation;
    if (operation?.kind !== 'apply-filter') return undefined;
    const stops = operation.filter.args.stops;
    return Array.isArray(stops) ? stops : undefined;
  }

  it('converts an array arg that carries an absent element instead of dropping the entry', () => {
    const registry = new AssetRegistry();

    const result = convertSafely([levelsItem({ stops: [0, undefined, 0.5, undefined, 1] })], registry);

    // The defect: the absent elements reached the non-plain throw, the throw
    // became an `error` diagnostic, and the entire document was voided. So the
    // assertion is that NO `error` remains — not that the diagnostics are empty,
    // because the durable hole is not the legacy observation and that divergence
    // is now reported.
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(false);
    // One warning per absent element, so the count is the number of holes: two
    // here, and not one diagnostic per array or one per preserved hole.
    expect(result.diagnostics).toHaveLength(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic).toMatchObject({
        historyId: 'levels-edit',
        actionName: TOOL_ACTION,
        severity: 'warning',
        code: 'array-arg-hole-preserved',
      });
      expect(diagnostic.message).toContain('history:levels-edit.args.stops');
    }
    expect(result.status).toBe('current');
    // The document is USABLE, not merely non-null: the baseline and the tool
    // entry both survived, so the shadow can actually shadow the replay.
    expect(result.document?.baseline.layers).toHaveLength(1);
    expect(result.document?.history).toHaveLength(1);
    expect(result.document?.history[0]?.operation).toMatchObject({
      kind: 'apply-filter',
      layerId,
      filter: { toolName: 'levels' },
    });
    registry.shutdown();
  });

  it('stores the array with its length and holes intact rather than compacting it', () => {
    const registry = new AssetRegistry();
    const sparse = [0, undefined, 0.5, undefined, 1];

    const stops = durableStops(convertSafely([levelsItem({ stops: sparse })], registry).document);

    // Compacting would be the wrong answer here: legacy replay hands the
    // processor the ORIGINAL array, so `[0, undefined, 0.5, undefined, 1]` and
    // `[0, 0.5, 1]` are different arguments and every positional consumer would
    // read a different value. The length is the legacy length.
    expect(stops?.length).toBe(5);
    // Every index the author wrote is still a hole, not a shifted value.
    expect(stops && 1 in stops).toBe(false);
    expect(stops && 3 in stops).toBe(false);
    // And the values that WERE present keep the indices they were written at,
    // which is the whole reason for preserving rather than compacting.
    expect(stops?.[0]).toBe(0);
    expect(stops?.[2]).toBe(0.5);
    expect(stops?.[4]).toBe(1);
    // A new, frozen array: the legacy array is never aliased into the shadow.
    expect(stops).not.toBe(sparse);
    expect(stops && Object.isFrozen(stops)).toBe(true);
    registry.shutdown();
  });

  it('keeps a hole-padded array hole-padded at the same index', () => {
    const registry = new AssetRegistry();
    // eslint-disable-next-line no-sparse-arrays -- the hole IS the subject under test: a history arg carrying an absent element is the input this arm exists for, and a dense literal could not express it
    const holey: unknown[] = [0, , 1];

    const stops = durableStops(convertSafely([levelsItem({ stops: holey })], registry).document);

    expect(stops?.length).toBe(3);
    expect(stops && 1 in stops).toBe(false);
    expect(stops?.[0]).toBe(0);
    expect(stops?.[2]).toBe(1);
    registry.shutdown();
  });

  it('preserves a null inside an array, because null is a value and not an absence', () => {
    const registry = new AssetRegistry();

    const result = convertSafely([levelsItem({ stops: [null, 0.5, null] })], registry);
    const stops = durableStops(result.document);

    // `plainValue` admits `null` as a plain value and the array branch tests on
    // absence rather than falsiness. A filter written against falsiness rather
    // than absence would swallow every `null` here, and three values would
    // silently become one — so this is the likeliest regression the fix could
    // introduce. Nothing is reported either: `null` is the legacy observation.
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe('current');
    expect(stops).toEqual([null, 0.5, null]);
    expect(stops?.length).toBe(3);
    registry.shutdown();
  });

  it('converts an empty array, and reports an array holding nothing but absence', () => {
    const registry = new AssetRegistry();

    const empty = convertSafely([levelsItem({ stops: [] }, 'empty-array')], registry);
    const onlyAbsence = convertSafely([levelsItem({ stops: [undefined] }, 'only-absence')], registry);

    // An empty array is a real argument and is reported as nothing.
    expect(empty.diagnostics).toEqual([]);
    expect(empty.status).toBe('current');
    expect(durableStops(empty.document)).toEqual([]);

    // An array of nothing but absence is a length-1 hole, and it is reported
    // rather than adopted quietly — the shadow and legacy replay disagree about
    // the argument, and `status: 'current'` is not on its own a claim that they
    // agree. Note it is NOT collapsed to the empty array: the index is the
    // meaning.
    expect(onlyAbsence.status).toBe('current');
    expect(durableStops(onlyAbsence.document)?.length).toBe(1);
    expect(0 in (durableStops(onlyAbsence.document) as readonly PlainValue[])).toBe(false);
    expect(onlyAbsence.diagnostics).toHaveLength(1);
    expect(onlyAbsence.diagnostics[0]).toMatchObject({
      historyId: 'only-absence',
      actionName: TOOL_ACTION,
      severity: 'warning',
      code: 'array-arg-hole-preserved',
    });
    expect(onlyAbsence.diagnostics[0]?.message).toContain('history:only-absence.args.stops');
    registry.shutdown();
  });

  it('still rejects a non-plain value nested inside an array and names its index', () => {
    class FakeClass {
      foo = 'bar';
    }
    const registry = new AssetRegistry();

    const result = convert([levelsItem({ stops: [0, new FakeClass()] }, 'hostile-array')], registry);

    // The array branch admits absence; it must not have become a general amnesty
    // for non-plain values inside an array.
    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'hostile-array',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
    });
    // The path is built from the LEGACY array, so the index is where the value
    // sits in the input.
    expect(result.diagnostics[0]?.message).toContain('history:hostile-array.args.stops[1]');
    registry.shutdown();
  });

  it('names the LEGACY index in the path, so a diagnostic points at the array the author wrote', () => {
    class FakeClass {
      foo = 'bar';
    }
    const registry = new AssetRegistry();

    const result = convert([levelsItem({ stops: [undefined, new FakeClass()] }, 'shifted-array')], registry);

    // The absent element at index 0 leaves the hostile value at index 1 in the
    // array the author wrote. The diagnostic is raised while converting the
    // LEGACY input, so it addresses that index: `stops[1]` is where
    // `new FakeClass()` actually is, and it is the only index a reader holding
    // the history item can use to find it.
    expect(result.diagnostics[0]).toMatchObject({ historyId: 'shifted-array', severity: 'error' });
    expect(result.diagnostics[0]?.message).toContain('history:shifted-array.args.stops[1]');
    registry.shutdown();
  });

  it('names the hole a warning reports by its own legacy index', () => {
    const registry = new AssetRegistry();

    const result = convertSafely([levelsItem({ stops: [0, undefined, 0.5, undefined, 1] }, 'indexed-holes')], registry);

    // Each hole is named at the index the LEGACY array uses, so a reader holding
    // the history item can find it. Naming the position among the survivors
    // instead would point at the wrong element entirely.
    const paths = result.diagnostics.map((diagnostic) => diagnostic.message);
    expect(paths.some((message) => message.includes('history:indexed-holes.args.stops[1]'))).toBe(true);
    expect(paths.some((message) => message.includes('history:indexed-holes.args.stops[3]'))).toBe(true);
    registry.shutdown();
  });
});
