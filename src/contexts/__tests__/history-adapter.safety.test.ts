import { describe, expect, it, vi } from 'vitest';

import { createSelectionHistoryItem } from '../../__tests__/fixtures/history.ts';
import { AssetRegistry } from '../asset-registry.ts';
import {
  convertLegacyHistorySafely,
  deriveSetSelectionEntry,
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

/**
 * `plainValue` (`history-adapter.ts:113`) treats `undefined` as ABSENCE in the
 * object branch, and after the fix as absence PRESERVED AS A HOLE in the array
 * branch. The two branches disagreeing WAS the defect: an array element of
 * `undefined` fell through to the non-plain throw, the throw became an `error`
 * diagnostic, and `convertLegacyHistorySafely` withholds the WHOLE durable
 * shadow on the first one — so a single holey tool-arg array was enough to lose
 * the document, which is a far worse outcome than the object branch's own
 * handling of the very same value.
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
  it('an explicit undefined element in a tool-arg array does not void the document', () => {
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
    expect(result.document?.history).not.toHaveLength(0);
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

  it('converts an array arg that carries an absent element instead of withholding the whole shadow', () => {
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
    // eslint-disable-next-line no-sparse-arrays -- the hole IS the subject under test: a history arg carrying an absent element is the input §93 is about, and a dense literal could not express it
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
