import { describe, expect, it, vi } from 'vitest';

import { createSelectionHistoryItem } from '../../__tests__/fixtures/history.ts';
import { AssetRegistry } from '../asset-registry.ts';
import { convertLegacyHistorySafely, deriveSetSelectionEntry, legacyHistoryToDurable } from '../history-adapter.ts';
import {
  collectDurableAssetIds,
  DURABLE_SCHEMA_VERSION,
  type AssetId,
  type SelectionSnapshot,
} from '../history-model.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, SELECTION_ACTION, TOOL_ACTION } from '../../util/constants.ts';
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
  });

  it('does not register raster assets for a baseline that only uses blank sources', () => {
    const registry = new AssetRegistry();
    const result = convert([], registry);

    expect(result.document.history).toHaveLength(0);
    expect(result.document.baseline.layers).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe('convertLegacyHistorySafely boundary (P0.1)', () => {
  it('returns unavailable status with a diagnostic and null document for an unsupported tool entry', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }],
      registry
    );

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'pen-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
  });

  it('returns unavailable status for an unknown processor entry', () => {
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

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'unknown-tool',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
  });

  it('returns unavailable status for non-finite transform values', () => {
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

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'nan-transform',
      actionName: TOOL_ACTION,
      severity: 'error',
      code: 'unsupported-history-feature',
    });
  });

  it('rolls back asset registration when conversion fails, leaving no dangling assets', () => {
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

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it('a later valid edit recovers durable conversion after a prior failure', () => {
    const registry = new AssetRegistry();

    const badResult = convertSafely(
      [{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }],
      registry
    );
    expect(badResult.status).toBe('unavailable');
    expect(badResult.document).toBeNull();

    const goodResult = convertSafely(
      [{ id: 'blur-edit', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }],
      registry
    );
    expect(goodResult.status).toBe('current');
    expect(goodResult.document).not.toBeNull();
    expect(goodResult.diagnostics).toHaveLength(0);
    expect(goodResult.document?.history).toHaveLength(1);
    expect(goodResult.document?.history[0]?.id).toBe('blur-edit');
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
    expect(reconcile).toHaveBeenCalledExactlyOnceWith('test-doc', collectDurableAssetIds(result.document!));
    const reachable = reconcile.mock.calls[0]?.[1] as ReadonlySet<AssetId>;
    expect(reachable.size).toBe(1);
    // The reconciled baseline is still resolvable through the registry.
    const lease = await registry.resolve([...reachable][0]!);
    expect(lease.bitmap).toBe(bitmap);
    lease.release();
  });

  it('rolls back the asset transaction and skips reconciliation for a rejected conversion', () => {
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

    expect(result.status).toBe('unavailable');
    expect(reconcile).not.toHaveBeenCalled();
    const registeredIds = register.mock.results.map((call) => call.value as AssetId);
    expect(registeredIds).toHaveLength(1);
    expect(registry.getRecord(registeredIds[0]!)).toBeUndefined();
    expect(close).not.toHaveBeenCalled();
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
  });
});

function createOwnedBitmap(width = 1, height = 1) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

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
    }
  );

  it.each(UNUSABLE_NEXT_STATES)('voids the document for %s next selection state', (_label, next) => {
    const registry = new AssetRegistry();
    const result = convertSafely([createSelectionHistoryItem(selectionState(), next)], registry);

    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'selection-clear',
      actionName: SELECTION_ACTION,
      severity: 'error',
    });
  });

  it('names the offending entry id in the diagnostic message', () => {
    const registry = new AssetRegistry();
    const result = convertSafely(
      [createSelectionHistoryItem(selectionState(), {}, { id: 'unreadable-selection' })],
      registry
    );

    expect(result.status).toBe('unavailable');
    expect(result.diagnostics[0]?.message).toContain('unreadable-selection');
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
