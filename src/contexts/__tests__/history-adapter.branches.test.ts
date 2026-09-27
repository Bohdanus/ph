import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  UnsupportedHistoryFeatureError,
  appendDurableEntry,
  convertLegacyHistory,
  convertLegacyHistorySafely,
  createDurableDocument,
  legacyHistoryToDurable,
  setDurableCursor,
  toggleDurableEntry,
} from '../history-adapter.ts';
import { DURABLE_SCHEMA_VERSION, collectDurableAssetIds, type DurableDocument } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';
import type { ActionType } from '../../util/constants.ts';

const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 10, height: 10 },
};

function blankLayer(id: string, order = 0): Layer {
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

function baselineHistory(): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': blankLayer('layer-1') },
        size: initialSize,
        frame: baselineFrame,
      },
    },
  ];
}

function convert(items: HistoryItem[], registry: AssetRegistry, options: Record<string, unknown> = {}) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
    ...options,
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

describe('legacyHistoryToDurable baseline derivation', () => {
  it('falls back to a 1x1 document when the first entry carries no document source', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable([{ id: 'a', actionName: TOOL_ACTION, layerId: 'x', args: {} }], {
      documentId: 'test-doc',
      registry,
    });

    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(converted.document.baseline.layers).toEqual([]);
    expect(converted.document.baseline.activeLayerId).toBeNull();
    registry.shutdown();
  });

  it('prefers the explicit initial frame over a derived size when the first entry has no document source', () => {
    const registry = new AssetRegistry();
    const initialFrame = { x: -5, y: -6, width: 111, height: 222 };
    const history: HistoryItem[] = [{ id: 'a', actionName: REMOVE_ACTION, layerId: 'layer-1' }];

    const fromFrame = legacyHistoryToDurable(history, { documentId: 'test-doc', registry, initialFrame });
    const fromSize = legacyHistoryToDurable(history, {
      documentId: 'test-doc',
      registry,
      initialSize: { width: 7, height: 8 },
    });
    const fromSource = convert([], registry);

    expect(fromFrame.document.baseline.frame).toEqual(initialFrame);
    expect(fromSize.document.baseline.frame).toEqual({ x: 0, y: 0, width: 7, height: 8 });
    // A first entry with a document source always wins over both options.
    expect(fromSource.document.baseline.frame).toEqual(baselineFrame);
    registry.shutdown();
  });

  it('derives the baseline frame from the document source size when it carries no frame', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: { layers: { 'layer-1': blankLayer('layer-1') }, size: { width: 640, height: 480 } },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    registry.shutdown();
  });

  it('falls back to the topmost baseline layer when the first entry targets no known layer', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'ghost',
          documentSource: {
            layers: { 'layer-a': blankLayer('layer-a', 0), 'layer-b': blankLayer('layer-b', 1) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.activeLayerId).toBe('layer-b');
    registry.shutdown();
  });

  it('treats a leading document source on a non-open action as the baseline', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-a',
          documentSource: {
            layers: { 'layer-a': blankLayer('layer-a') },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'tool', actionName: TOOL_ACTION, layerId: 'layer-a', args: { toolName: 'blur', radius: 2 } },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['tool']);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0]);
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable per-action option branches', () => {
  it('drops a rename whose name is not a string and records one for an unknown layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'rename-number', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 42 } },
        { id: 'rename-missing-arg', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1' },
        { id: 'rename-ghost', actionName: RENAME_LAYER_ACTION, layerId: 'ghost', args: { name: 'Ghost' } },
        { id: 'rename-ok', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Named' } },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    // A non-string name produces no entry at all. A rename for a layer the
    // conversion does not know is still recorded, so replaying the durable
    // document stays a faithful projection of the legacy history.
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['rename-ghost', 'rename-ok']);
    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'set-layer-properties',
      layerId: 'ghost',
      patch: { name: 'Ghost' },
    });
    // A dropped entry maps to the preceding durable cursor, never the tip.
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1, -1, 0, 1]);
    registry.shutdown();
  });

  it('ignores a reorder that names a layer outside the converted layer set', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'reorder-ghost', actionName: REORDER_ACTION, layerId: 'document', args: { layerToMoveId: 'ghost' } },
        { id: 'reorder-no-args', actionName: REORDER_ACTION, layerId: 'document' },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('moves a reordered layer to the top of the durable order when no anchor is named', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: null },
        },
      ],
      registry
    );

    const operation = converted.document.history[1]?.operation;
    expect(operation).toMatchObject({ kind: 'reorder-layers' });
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId).toEqual({ 'layer-1': 0, 'layer-b': 1 });
    registry.shutdown();
  });

  it('records a disabled reorder entry without applying it to the converted layers', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          disabled: true,
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: null },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].order).toBe(0);
    registry.shutdown();
  });

  it('keeps a disabled remove entry in history without removing the layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'remove', actionName: REMOVE_ACTION, layerId: 'layer-1', disabled: true }],
      registry
    );

    expect(converted.document.history[0]).toMatchObject({ enabled: false });
    expect(converted.document.history[0]?.operation).toEqual({ kind: 'remove-layer', layerId: 'layer-1' });
    registry.shutdown();
  });

  it('drops a document frame action that carries no next frame', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'frame',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame },
        },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('defaults the previous frame of a document frame action to the current frame', () => {
    const registry = new AssetRegistry();
    const nextFrame = { x: 10, y: 10, width: 200, height: 150 };

    const converted = convert(
      [{ id: 'frame', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame } }],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation).toEqual({ kind: 'set-document-frame', previous: baselineFrame, next: nextFrame });
    registry.shutdown();
  });

  it('keeps a disabled document frame entry without advancing the converted frame', () => {
    const registry = new AssetRegistry();
    const nextFrame = { x: 10, y: 10, width: 200, height: 150 };

    const converted = convert(
      [
        {
          id: 'frame',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          disabled: true,
          args: { nextFrame },
        },
        { id: 'frame-2', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame } },
      ],
      registry
    );

    expect(converted.document.history.map((entry) => entry.enabled)).toEqual([false, true]);
    // The second frame operation's `previous` is still the untouched frame.
    expect(converted.document.history[1]?.operation).toMatchObject({ previous: baselineFrame });
    registry.shutdown();
  });

  it('defaults the before and after selection snapshots of a bare selection action', () => {
    const registry = new AssetRegistry();
    const nextSelection = {
      selections: [
        {
          id: 'sel',
          points: [{ x: 1, y: 2 }],
          isActive: true,
          pos: { x: 1, y: 2, width: 3, height: 4 },
          metadata: { featherRadius: 2 },
        },
      ],
      activeSelectionId: 'sel',
    };

    const converted = convert(
      [
        { id: 'sel-1', actionName: SELECTION_ACTION, layerId: 'layer-1', args: { nextSelectionState: nextSelection } },
        { id: 'sel-2', actionName: SELECTION_ACTION, layerId: 'layer-1' },
      ],
      registry
    );

    const [first, second] = converted.document.history.map((entry) => entry.operation);
    expect(first).toMatchObject({ kind: 'set-selection', before: { selections: [], activeSelectionId: null } });
    expect(first?.kind === 'set-selection' && first.after.selections[0].metadata).toEqual({ featherRadius: 2 });
    expect(second?.kind === 'set-selection' && second.before.selections[0].id).toBe('sel');
    expect(second).toMatchObject({ after: { selections: [], activeSelectionId: null } });
    registry.shutdown();
  });

  it('records a disabled selection action without changing the converted selection state', () => {
    const registry = new AssetRegistry();
    const nextSelection = {
      selections: [{ id: 'sel', points: [{ x: 0, y: 0 }], isActive: true, pos: { x: 0, y: 0, width: 1, height: 1 } }],
      activeSelectionId: 'sel',
    };

    const converted = convert(
      [
        {
          id: 'sel',
          actionName: SELECTION_ACTION,
          layerId: 'layer-1',
          disabled: true,
          args: { nextSelectionState: nextSelection },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.selections.selections).toEqual([]);
    registry.shutdown();
  });

  it('keeps a disabled merge entry without collapsing the converted layer set', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'merge', actionName: MERGE_ACTION, layerId: 'merged', layerSource: source, disabled: true },
      ],
      registry
    );

    const operation = converted.document.history[1]?.operation;
    expect(converted.document.history[1]?.enabled).toBe(false);
    expect(operation?.kind === 'merge-document' && operation.removedLayerIds).toEqual(['layer-1', 'layer-b']);
    registry.shutdown();
  });

  it('keeps a disabled reposition entry without moving the converted layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'move',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          disabled: true,
          args: { toolName: 'reposition', move: { x: 90, y: 90 } },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].pos).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable argument conversion branches', () => {
  it('rejects tool arguments that are an array carrying a tool name', () => {
    const registry = new AssetRegistry();
    const args = Object.assign([], { toolName: 'blur', radius: 2 });

    const converted = convert([{ id: 'array-args', actionName: TOOL_ACTION, layerId: 'layer-1', args }], registry);

    expect(converted.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-history-entry', historyId: 'array-args' }),
    ]);
    expect(converted.diagnostics[0]?.message).toBe('Expected object at history:array-args.args');
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('unwraps tool arguments nested under an args property', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'nested',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'blur', args: { toolName: 'levels', brightness: 1, contrast: 2 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[0]?.operation).toMatchObject({
      kind: 'apply-filter',
      filter: { toolName: 'levels' },
    });
    registry.shutdown();
  });

  it('keeps nested array arguments in a durable filter payload', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'dash',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'levels', brightness: 1, contrast: 2, stops: [0, 0.5, 1] },
        },
      ],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation?.kind === 'apply-filter' && operation.filter.args.stops).toEqual([0, 0.5, 1]);
    registry.shutdown();
  });

  it('rejects a non-finite value nested inside an array argument', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'non-finite',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'levels', brightness: 1, contrast: 2, stops: [0, Number.POSITIVE_INFINITY] },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch(/Non-finite value at/);
    registry.shutdown();
  });

  it('drops a non-object tool argument rather than recording a no-op entry', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'primitive', actionName: TOOL_ACTION, layerId: 'layer-1', args: 42 } as unknown as HistoryItem],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('rejects a transform that combines a trapezoid with retained affine values', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'both',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'transform', trapezoid: 20, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch('A transform cannot combine trapezoid and affine values');
    registry.shutdown();
  });

  it('rejects a retained transform whose values are not finite', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'bad-matrix',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: Number.NaN, f: 0 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(converted.diagnostics[0]?.message).toMatch(/invalid or extreme values/);
    registry.shutdown();
  });

  it('rejects a raw trapezoid transform that also carries affine values', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'mixed', actionName: TOOL_ACTION, layerId: 'layer-1', args: transformArgs({ trapezoid: 20, rotate: 5 }) }],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch('Mixed trapezoid and affine transform is unsupported');
    registry.shutdown();
  });

  it('rejects a raster transform whose processor replay version no longer matches', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'trapezoid', actionName: TOOL_ACTION, layerId: 'layer-1', args: transformArgs({ trapezoid: 20 }) }],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[0]?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      processorId: 'transform',
      version: 1,
    });
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable source helpers', () => {
  it('rejects a legacy source whose kind is not a known layer source', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'odd-source',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-2',
          args: { kind: 'vector', toolName: 'shape' },
        },
      ],
      registry
    );

    // The unknown kind is not treated as a layer source, so the action is an
    // unsupported legacy action rather than a create-layer.
    expect(converted.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(converted.diagnostics[0]?.message).toMatch('Unsupported legacy action');
    registry.shutdown();
  });

  it.each([
    {
      label: 'a non-bedrock image source carried in args',
      args: {
        kind: 'image',
        bitmap: { width: 12, height: 9 },
        name: 'In-args',
        isBedrock: false,
        pos: { x: 1, y: 2, width: 12, height: 9 },
      },
      expectedSource: { kind: 'raster', width: 12, height: 9, isBedrock: false, name: 'In-args' },
    },
    {
      label: 'a bedrock image source carried in args',
      args: {
        kind: 'image',
        bitmap: { width: 12, height: 9 },
        isBedrock: true,
        size: { width: 12, height: 9 },
      },
      expectedSource: { kind: 'raster', width: 12, height: 9, isBedrock: true },
    },
  ])('creates a layer from $label', ({ args, expectedSource }) => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'image-source', actionName: NEW_LAYER_ACTION, layerId: 'layer-2', args } as unknown as HistoryItem],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(converted.diagnostics).toEqual([]);
    expect(operation).toMatchObject({ kind: 'create-layer', layer: { id: 'layer-2' } });
    expect(operation?.kind === 'create-layer' && operation.layer.source).toMatchObject(expectedSource);
    registry.shutdown();
  });

  it('derives a bedrock tool source size from the recorded size rather than the position', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'bedrock-tool',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-bedrock',
          layerSource: {
            kind: 'tool',
            args: { toolName: 'shape', figure: 'rectangle' },
            isBedrock: true,
            size: { width: 320, height: 240 },
          },
        } as unknown as HistoryItem,
      ],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation?.kind === 'create-layer' && operation.layer.source).toMatchObject({
      kind: 'vector',
      size: { width: 320, height: 240 },
      isBedrock: true,
    });
    expect(operation?.kind === 'create-layer' && operation.layer.pos).toEqual({ x: 0, y: 0, width: 320, height: 240 });
    registry.shutdown();
  });
});

describe('conversion entry points', () => {
  it('passes a durable document straight through without re-converting it', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const converted = convertLegacyHistory(document, { registry });

    expect(converted.diagnostics).toEqual([]);
    expect(converted.legacyCursorToDurableCursor).toEqual([]);
    expect(converted.document).toEqual(document);
    expect(converted.document).not.toBe(document);
    registry.shutdown();
  });

  it('accepts a durable document through the safe conversion entry point', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const attempt = convertLegacyHistorySafely(document, { registry });

    expect(attempt.status).toBe('current');
    expect(attempt.document?.documentId).toBe('test-doc');
    registry.shutdown();
  });

  it('honours the document id of a durable document when none is supplied', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const attempt = convertLegacyHistorySafely(document, { registry });

    expect(attempt.document?.documentId).toBe('test-doc');
    expect(attempt.legacyCursorToDurableCursor).toEqual([]);
    registry.shutdown();
  });

  it('exposes legacyHistoryToDurable under the compatibility alias', () => {
    const registry = new AssetRegistry();

    expect(convertLegacyHistory).toBe(legacyHistoryToDurable);
    expect(convertLegacyHistory(baselineHistory(), { documentId: 'test-doc', registry }).document.documentId).toBe(
      'test-doc'
    );
    registry.shutdown();
  });

  it('does not reconcile assets for a durable document that was handed in directly', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    convertLegacyHistorySafely(document, { registry });

    expect(reconcile).toHaveBeenCalledOnce();
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable layer bookkeeping actions', () => {
  it.each([
    { label: 'show', actionName: SHOW_LAYER_ACTION, expectedVisible: true },
    { label: 'hide', actionName: HIDE_LAYER_ACTION, expectedVisible: false },
  ] satisfies ReadonlyArray<{ label: string; actionName: ActionType; expectedVisible: boolean }>)(
    'records a $label action as a durable visibility patch',
    ({ actionName, expectedVisible }) => {
      const registry = new AssetRegistry();

      const converted = convert(
        [
          { id: 'ghost', actionName, layerId: 'ghost' },
          { id: 'layer-1', actionName, layerId: 'layer-1' },
        ],
        registry
      );

      expect(converted.diagnostics).toEqual([]);
      expect(converted.document.history.map((entry) => entry.operation)).toEqual([
        { kind: 'set-layer-properties', layerId: 'ghost', patch: { visible: expectedVisible } },
        { kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: expectedVisible } },
      ]);
      registry.shutdown();
    }
  );

  it('keeps a disabled visibility patch from changing the converted layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1', disabled: true }],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].visible).toBe(true);
    registry.shutdown();
  });

  it('reorders a layer after an explicit anchor', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'new-c', actionName: NEW_LAYER_ACTION, layerId: 'layer-c', layerSource: source },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-c' },
        },
      ],
      registry
    );

    const operation = converted.document.history[2]?.operation;
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId).toEqual({
      'layer-b': 0,
      'layer-c': 1,
      'layer-1': 2,
    });
    registry.shutdown();
  });

  it('collapses the converted layer set for an enabled merge', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'merge', actionName: MERGE_ACTION, layerId: 'merged', layerSource: source },
        { id: 'after-merge', actionName: TOOL_ACTION, layerId: 'layer-b', args: { toolName: 'blur', radius: 1 } },
      ],
      registry
    );

    const merge = converted.document.history[1]?.operation;
    expect(merge).toMatchObject({ kind: 'merge-document', removedLayerIds: ['layer-1', 'layer-b'] });
    // `layer-b` was folded into the merge, so a later tool action for it is
    // rejected rather than silently retargeted.
    expect(converted.diagnostics.at(-1)?.message).toMatch('Layer layer-b is unavailable');
    registry.shutdown();
  });

  it('applies an enabled reposition to the converted layer position', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'move',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'reposition', move: { x: 7, y: 9 } },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'reposition-layer',
      layerId: 'layer-1',
      move: { x: 7, y: 9 },
    });
    expect(converted.diagnostics).toEqual([]);
    registry.shutdown();
  });

  it('records a resize-only reposition without a move key', () => {
    const registry = new AssetRegistry();
    const resize = { x: 1, y: 2, width: 30, height: 20 };

    const converted = convert(
      [{ id: 'resize', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'reposition', resize } }],
      registry
    );

    expect(converted.document.history[0]?.operation).toEqual({ kind: 'reposition-layer', layerId: 'layer-1', resize });
    expect(converted.diagnostics).toEqual([]);
    registry.shutdown();
  });

  it.each([
    { label: 'an empty reposition', args: { toolName: 'reposition' } },
    {
      label: 'a reposition with no move or resize',
      args: { toolName: 'reposition', move: undefined, resize: undefined },
    },
  ])('drops $label instead of recording a no-op entry', ({ args }) => {
    const registry = new AssetRegistry();

    const converted = convert([{ id: 'noop', actionName: TOOL_ACTION, layerId: 'layer-1', args }], registry);

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('derives a degenerate baseline frame from a document source that has neither frame nor size', () => {
    const registry = new AssetRegistry();
    const initialFrame = { x: 1, y: 2, width: 33, height: 44 };

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: { 'layer-1': blankLayer('layer-1') },
            size: undefined as unknown as { width: number; height: number },
          },
        },
      ],
      { documentId: 'test-doc', registry, initialFrame }
    );

    // A leading document source is always authoritative: the caller-supplied
    // `initialFrame` and `initialSize` never reach the baseline derivation, so a
    // document source without a frame and without a size yields a 0x0 frame.
    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    registry.shutdown();
  });

  it('records a null baseline active layer for a document source with no layers', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: { layers: {}, size: initialSize, frame: baselineFrame },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.activeLayerId).toBeNull();
    expect(converted.document.baseline.layers).toEqual([]);
    registry.shutdown();
  });
});

describe('durable document editing helpers', () => {
  function baseDocument(): DurableDocument {
    const registry = new AssetRegistry();
    const document = createDurableDocument({
      documentId: 'test-doc',
      documentRevision: 0,
      branchRevision: 0,
      baseline: {
        frame: baselineFrame,
        layers: [],
        selections: { selections: [], activeSelectionId: null },
        activeLayerId: null,
      },
      history: [],
      cursor: -1,
    });
    registry.shutdown();
    return document;
  }

  it('defaults the durable revision to zero', () => {
    expect(
      createDurableDocument({
        documentId: 'test-doc',
        documentRevision: 0,
        branchRevision: 0,
        baseline: {
          frame: baselineFrame,
          layers: [],
          selections: { selections: [], activeSelectionId: null },
          activeLayerId: null,
        },
        history: [],
        cursor: -1,
      }).durableRevision
    ).toBe(0);
  });

  it('keeps an explicit durable revision', () => {
    const document = baseDocument();
    expect(createDurableDocument({ ...document, durableRevision: 12 }).durableRevision).toBe(12);
  });

  it('appends an entry, truncating the redo tail and advancing both revisions', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );
    const undone = setDurableCursor(converted.document, 0);

    const appended = appendDurableEntry(undone, {
      id: 'c',
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'remove-layer', layerId: 'layer-1' },
    });

    expect(appended.history.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(appended.cursor).toBe(1);
    expect(appended.branchRevision).toBe(undone.branchRevision + 1);
    expect(appended.durableRevision).toBe(undone.durableRevision + 1);
    expect(undone.history.map((entry) => entry.id)).toEqual(['a', 'b']);
    registry.shutdown();
  });

  it.each([
    { label: 'a negative cursor below the empty position', cursor: -2 },
    { label: 'a cursor past the tip', cursor: 5 },
    { label: 'a non-integer cursor', cursor: 1.5 },
    { label: 'a non-finite cursor', cursor: Number.NaN },
  ])('returns the same document for $label', ({ cursor }) => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    expect(setDurableCursor(converted.document, cursor)).toBe(converted.document);
    registry.shutdown();
  });

  it('returns the same document for the cursor it already points at', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    expect(setDurableCursor(converted.document, converted.document.cursor)).toBe(converted.document);
    registry.shutdown();
  });

  it('moves the cursor without disturbing the entry list and advances the durable revision', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );

    const moved = setDurableCursor(converted.document, 0);

    expect(moved.cursor).toBe(0);
    expect(moved.branchRevision).toBe(converted.document.branchRevision);
    expect(moved.durableRevision).toBe(converted.document.durableRevision + 1);
    expect(moved.history).toHaveLength(2);
    registry.shutdown();
  });

  it('leaves the branch revision alone when only the cursor moves', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );

    expect(toggleDurableEntry(converted.document, converted.document.history[0].id).branchRevision).toBe(
      converted.document.branchRevision + 1
    );
    expect(setDurableCursor(converted.document, 0).branchRevision).toBe(converted.document.branchRevision);
    registry.shutdown();
  });
});

describe('UnsupportedHistoryFeatureError construction', () => {
  it('keeps a stable code and name with an optional history id', () => {
    const withId = new UnsupportedHistoryFeatureError('nope', 'entry-1');
    const withoutId = new UnsupportedHistoryFeatureError('nope');

    expect(withId.code).toBe('unsupported-history-feature');
    expect(withId.name).toBe('UnsupportedHistoryFeatureError');
    expect(withId.historyId).toBe('entry-1');
    expect(withoutId.historyId).toBeUndefined();
    expect(withId).toBeInstanceOf(Error);
  });
});

describe('asset reachability of a rejected conversion', () => {
  it('leaves no asset registered for a conversion that never produced a durable document', () => {
    const registry = new AssetRegistry();
    const attempt = convertLegacyHistorySafely(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: {
              'layer-1': { ...blankLayer('layer-1'), source: undefined, bitmap: null },
            },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(attempt.status).toBe('unavailable');
    expect(attempt.document).toBeNull();
    expect(attempt.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(attempt.legacyCursorToDurableCursor).toEqual([]);
    registry.shutdown();
  });

  it('registers exactly one asset per distinct source bitmap in a committed conversion', () => {
    const registry = new AssetRegistry();
    const bitmap = { width: 8, height: 8 } as unknown as ImageBitmap;
    const attempt = convertLegacyHistorySafely(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: {
              'layer-1': {
                ...blankLayer('layer-1'),
                source: {
                  kind: 'image',
                  bitmap,
                  name: 'Shared',
                  isBedrock: false,
                  pos: { x: 0, y: 0, width: 8, height: 8 },
                },
              },
              'layer-2': {
                ...blankLayer('layer-2'),
                source: {
                  kind: 'image',
                  bitmap,
                  name: 'Shared',
                  isBedrock: false,
                  pos: { x: 0, y: 0, width: 8, height: 8 },
                },
              },
            },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    const assetIds = [...collectDurableAssetIds(attempt.document as DurableDocument)];
    expect(attempt.status).toBe('current');
    expect(assetIds).toHaveLength(1);
    registry.shutdown();
  });
});
