import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { convertLegacyHistorySafely, legacyHistoryToDurable } from '../history-adapter.ts';
import { collectDurableAssetIds, type AssetId } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const layerId = 'layer-1';
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
