import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  convertLegacyHistorySafely,
  legacyHistoryToDurable,
  UnsupportedHistoryFeatureError,
} from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ImageLayerSource, Layer, ToolLayerSource } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import {
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  RENAME_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: initialSize.width, height: initialSize.height };
const layerPos = { x: 20, y: 30, width: 120, height: 80 };

function blankBaselineLayer(): Layer {
  return {
    id: layerId,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...layerPos },
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { ...layerPos },
    },
    operations: [],
  };
}

function toolSource(toolName: string, args: ToolArgs = { toolName } as unknown as ToolArgs): ToolLayerSource {
  return { kind: 'tool', args, isBedrock: false, pos: { ...layerPos } };
}

function convert(registry: AssetRegistry, ...items: HistoryItem[]) {
  return legacyHistoryToDurable(
    [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: blankBaselineLayer() },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      ...items,
    ],
    { documentId: 'tool-conversion', registry }
  );
}

function createBorrowedBitmap(width: number, height: number) {
  const close = vi.fn();
  return { bitmap: { width, height, close } as unknown as ImageBitmap, close };
}

/** Production raises non-Error values from data accessors; keep the shape local. */
function raise(value: unknown): never {
  throw value;
}

describe('tool layer source conversion', () => {
  it.each([
    ['text', 'text'],
    ['shape', 'vector'],
    ['rectangle', 'vector'],
    ['ellipse', 'vector'],
    ['triangle', 'vector'],
    ['polygon', 'vector'],
    ['line', 'vector'],
  ] as const)('classifies a %s tool layer source as the durable %s kind', (toolName, durableKind) => {
    const registry = new AssetRegistry();
    const args = { toolName, color: '#ff0000' } as unknown as ToolArgs;

    const { document, diagnostics } = convert(registry, {
      id: `create-${toolName}`,
      actionName: NEW_LAYER_ACTION,
      layerId: `tool-${toolName}`,
      layerSource: toolSource(toolName, args),
    });

    expect(diagnostics).toEqual([]);
    const created = document.history[0]?.operation;
    if (created?.kind !== 'create-layer') throw new Error(`expected a create-layer operation, got ${created?.kind}`);
    // Only vector and text sources carry the placement the tool drew into.
    expect(created.layer.source.kind).toBe(durableKind);
    if (created.layer.source.kind === 'legacy-tool') throw new Error('unexpected legacy-tool classification');
    expect(created.layer.source).toMatchObject({
      kind: durableKind,
      toolName,
      args: { toolName, color: '#ff0000' },
      size: { width: layerPos.width, height: layerPos.height },
      isBedrock: false,
    });
    expect(created.layer.source).toHaveProperty('sourcePos', { ...layerPos });
    // The durable tool source must own its args copy, not alias the history entry.
    expect((created.layer.source as { args: unknown }).args).not.toBe(args);
  });

  it('converts a creator paint source with its placement', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'create-pencil',
      actionName: NEW_LAYER_ACTION,
      layerId: 'tool-pencil',
      layerSource: toolSource('pencil', { toolName: 'pencil', color: '#00ff00' } as unknown as ToolArgs),
    });

    expect(diagnostics).toEqual([]);
    const created = document.history[0]?.operation;
    if (created?.kind !== 'create-layer') throw new Error('expected a create-layer operation');
    expect(created.layer.source).toStrictEqual({
      kind: 'paint',
      toolName: 'pencil',
      args: { toolName: 'pencil', color: '#00ff00' },
      size: { width: layerPos.width, height: layerPos.height },
      sourcePos: { ...layerPos },
      isBedrock: false,
    });
    expect(replayDurableDocument(document).layers['tool-pencil']?.snapshot.source.kind).toBe('paint');
  });

  it('derives a bedrock tool source size from the recorded size instead of the position', () => {
    const registry = new AssetRegistry();

    const { document } = convert(registry, {
      id: 'create-bedrock-tool',
      actionName: NEW_LAYER_ACTION,
      layerId: 'tool-bedrock',
      layerSource: {
        kind: 'tool',
        args: { toolName: 'shape' } as unknown as ToolArgs,
        isBedrock: true,
        size: { width: 640, height: 480 },
      } satisfies ToolLayerSource,
    });

    const created = document.history[0]?.operation;
    if (created?.kind !== 'create-layer') throw new Error('expected a create-layer operation');
    expect(created.layer.source).toMatchObject({ size: { width: 640, height: 480 }, isBedrock: true });
  });

  it('rejects a tool layer source whose args are not a plain object', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'create-hostile-args',
      actionName: NEW_LAYER_ACTION,
      layerId: 'tool-hostile',
      layerSource: {
        kind: 'tool',
        args: new Map([['toolName', 'shape']]) as unknown as ToolArgs,
        isBedrock: false,
        pos: { ...layerPos },
      } satisfies ToolLayerSource,
    });

    // A non-plain args object is a per-entry failure: the entry is dropped and
    // the conversion still returns a document.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      historyId: 'create-hostile-args',
      actionName: NEW_LAYER_ACTION,
      severity: 'error',
      code: 'invalid-history-entry',
    });
    expect(diagnostics[0]?.message).toMatch(/Non-plain value at layer:tool-hostile\.source\.args/);
    expect(document.history).toEqual([]);
    expect(document.cursor).toBe(-1);
  });
});

describe('action entries that carry a layer source', () => {
  it('publishes a create-layer for a tool action carrying a tool source, not a tool operation', () => {
    const registry = new AssetRegistry();
    const args = { toolName: 'shape', color: '#ff0000' } as unknown as ToolArgs;

    const { document, diagnostics, legacyCursorToDurableCursor } = convert(registry, {
      id: 'shape-tool',
      actionName: TOOL_ACTION,
      layerId: 'shape-layer',
      layerSource: toolSource('shape', args),
    });

    // The create-layer arm (`history-adapter.ts:674`) is reached through the
    // `TOOL_ACTION && source` half of its condition. The entry carries no `args` at
    // all, so if that half were dropped `operationForTool` would find no
    // `toolName`, return null and the entry would publish NOTHING: a
    // tool-created layer missing from the shadow with no diagnostic to say so,
    // while legacy replay — whose matching arm is `history-replay.ts:127` —
    // keeps the layer. Every assertion below is about the entry surviving.
    expect(diagnostics).toEqual([]);
    expect(document.history.map((entry) => entry.id)).toEqual(['shape-tool']);
    expect(legacyCursorToDurableCursor).toEqual([-1, 0]);
    expect(document.cursor).toBe(0);

    const created = document.history[0]?.operation;
    if (created?.kind !== 'create-layer') throw new Error(`expected a create-layer operation, got ${created?.kind}`);
    expect(created.layer.id).toBe('shape-layer');
    // The snapshot name comes from `sourceToRuntimeLayer`, so it is derived from the
    // tool name and never 'Blank'. `deriveLayerNameAndOrder` then appends the order it
    // just derived, so the name and the order below come from ONE number and cannot
    // disagree: the name is asserted as that pair rather than as a bare literal,
    // because a name written without its suffix is what this assertion used to pin
    // and it stopped matching the moment the suffix rule landed.
    expect(created.layer.order).toBe(1);
    expect(created.layer.name).toBe(`shape ${created.layer.order}`);
    expect(created.layer.pos).toEqual({ ...layerPos });
    expect(created.layer.source).toMatchObject({
      kind: 'vector',
      toolName: 'shape',
      isBedrock: false,
      size: { width: layerPos.width, height: layerPos.height },
    });

    // The user-visible half: the shadow replays the new layer AND keeps the
    // baseline layer, which is what separates a create from a merge.
    const replayed = replayDurableDocument(document);
    expect(replayed.layers['shape-layer']?.snapshot.name).toBe(
      `shape ${replayed.layers['shape-layer']?.snapshot.order}`
    );
    expect(replayed.layers[layerId]?.snapshot.id).toBe(layerId);
  });

  it('reads a merge source out of args, the field mergeAllLayers writes, and collapses the layer set', () => {
    const registry = new AssetRegistry();
    const { bitmap } = createBorrowedBitmap(40, 30);

    const { document, diagnostics, legacyCursorToDurableCursor } = convert(registry, {
      id: 'merge-args',
      actionName: MERGE_ACTION,
      layerId: 'merged-layer',
      args: {
        kind: 'image',
        bitmap,
        name: 'Merged Layer',
        pos: { x: 0, y: 0, ...initialSize },
        isBedrock: false,
      } satisfies ImageLayerSource,
    });

    // `mergeAllLayers` retains the merged `LayerSource` in the entry's `args`
    // (`useLayer.ts:838-842`), so THIS is the shape every real merge takes — no
    // `layerSource` is written. If `asLegacyLayerSource(item.args)`
    // (`history-adapter.ts:673`) stopped reading `args`, the merge arm would miss
    // its `&& source` guard and fall through to the unknown-action throw: an
    // ERROR diagnostic, which `convertLegacyHistorySafely` answers by withholding
    // the whole shadow for every document the user has ever merged in.
    expect(diagnostics).toEqual([]);
    expect(document.history.map((entry) => entry.id)).toEqual(['merge-args']);
    expect(legacyCursorToDurableCursor).toEqual([-1, 0]);

    const merged = document.history[0]?.operation;
    if (merged?.kind !== 'merge-document') throw new Error(`expected a merge-document operation, got ${merged?.kind}`);
    // Every other converted layer is named as removed, which is the half a
    // create-layer entry never carries.
    expect(merged.removedLayerIds).toEqual([layerId]);
    expect(merged.result.id).toBe('merged-layer');
    // The name keeps the label the merge source carried, suffixed with the derived
    // order by the same `deriveLayerNameAndOrder` rule the create-layer arm above
    // exercises. Asserted as the pair so the label and the suffix cannot drift apart.
    expect(merged.result.name).toBe(`Merged Layer ${merged.result.order}`);
    expect(merged.result.pos).toEqual({ x: 0, y: 0, ...initialSize });
    // The raster is derived from the args source: its size is the BITMAP's, and
    // the layer keeps the name the source carried.
    expect(merged.result.source).toMatchObject({
      kind: 'raster',
      width: 40,
      height: 30,
      name: 'Merged Layer',
      isBedrock: false,
    });

    const replayed = replayDurableDocument(document);
    expect(replayed.layers['merged-layer']?.snapshot.name).toBe(
      `Merged Layer ${replayed.layers['merged-layer']?.snapshot.order}`
    );
    expect(replayed.layers[layerId]).toBeUndefined();
  });
});

describe('raster tool conversion', () => {
  it('converts a raster-commit tool into a retained apply-raster-processor operation', () => {
    const registry = new AssetRegistry();
    const args = { toolName: 'brush', color: '#123456', size: 4 } as unknown as ToolArgs;

    const { document, diagnostics } = convert(registry, { id: 'brush', actionName: TOOL_ACTION, layerId, args });

    expect(diagnostics).toEqual([]);
    const entry = document.history[0];
    expect(entry?.id).toBe('brush');
    expect(entry?.enabled).toBe(true);
    expect(entry?.operation).toStrictEqual({
      kind: 'apply-raster-processor',
      layerId,
      processorId: 'brush',
      version: 1,
      args: { toolName: 'brush', color: '#123456', size: 4 },
    });

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.operations).toHaveLength(1);
    expect(replay.layers[layerId]?.operations[0]).toMatchObject({
      kind: 'apply-raster-processor',
      processorId: 'brush',
    });
  });

  it('records no durable entry for a document-operation tool because the frame comes from its own action', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'crop-tool',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'crop' } as unknown as ToolArgs,
    });

    expect(diagnostics).toEqual([]);
    expect(document.history).toEqual([]);
    expect(document.cursor).toBe(-1);
  });

  it('records no durable entry for a selection tool because the selection comes from its own action', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'wand',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'magic-wand' } as unknown as ToolArgs,
    });

    expect(diagnostics).toEqual([]);
    expect(document.history).toEqual([]);
  });

  it('rejects an unimplemented tool with an unsupported-history-feature diagnostic', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'pen',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'pen' } as unknown as ToolArgs,
    });

    expect(diagnostics).toStrictEqual([
      {
        historyId: 'pen',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Tool pen cannot be replayed durably',
      },
    ]);
    expect(document.history).toEqual([]);
  });

  it('rejects a transform that carries both a trapezoid and retained affine values', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'trap-and-affine',
      actionName: TOOL_ACTION,
      layerId,
      args: {
        toolName: 'transform',
        trapezoid: 20,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      } as unknown as ToolArgs,
    });

    expect(diagnostics).toStrictEqual([
      {
        historyId: 'trap-and-affine',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'A transform cannot combine trapezoid and affine values',
      },
    ]);
    expect(document.history).toEqual([]);
  });

  it('keeps a trapezoid-only transform as a raster processor bound to the transform replay version', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'trap-only',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'transform', trapezoid: 20 } as unknown as ToolArgs,
    });

    expect(diagnostics).toEqual([]);
    expect(document.history[0]?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      layerId,
      processorId: 'transform',
      version: 1,
    });
  });

  it('reports a retained-transform accessor that throws a non-Error as an unsupported transform', () => {
    const registry = new AssetRegistry();
    // `getTransformFromHistoryArgs` reads `candidate.transform` off the legacy
    // args, and legacy args are unvalidated data — a hostile or corrupt entry can
    // raise a non-Error there. `trapezoid` is absent so the truthiness guard at
    // `history-adapter.ts:492` is skipped and the read happens inside the try.
    const args: Record<string, unknown> = { toolName: 'transform' };
    Object.defineProperty(args, 'transform', {
      configurable: true,
      get() {
        return raise('legacy transform accessor exploded');
      },
    });

    const { document, diagnostics, legacyCursorToDurableCursor } = convert(registry, {
      id: 'corrupt-transform',
      actionName: TOOL_ACTION,
      layerId,
      args,
    });

    // The catch's non-Error arm names the failure instead of forwarding the raw
    // throw. Two mutants die here: dropping that arm would report the literal
    // thrown text (or `undefined`, via `error.message`) as the message, and
    // dropping the catch would let the raw string escape to the per-entry
    // diagnostic, which classifies a non-`UnsupportedHistoryFeatureError` as
    // `invalid-history-entry` — the wrong code for an unreadable transform.
    expect(diagnostics).toStrictEqual([
      {
        historyId: 'corrupt-transform',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Invalid retained transform',
      },
    ]);
    expect(document.history).toEqual([]);
    // A refused entry consumes no durable index, so it maps to the preceding
    // cursor rather than to the tip a later entry would create.
    expect(legacyCursorToDurableCursor).toEqual([-1, -1]);
  });

  it('drops an unresolvable tool action without a toolName instead of recording a no-op entry', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'nameless',
      actionName: TOOL_ACTION,
      layerId,
      args: { radius: 2 },
    });

    expect(diagnostics).toEqual([]);
    expect(document.history).toEqual([]);
    expect(document.cursor).toBe(-1);
  });

  it('rejects a tool action whose layer is not in the converted layer set', () => {
    const registry = new AssetRegistry();

    const { document, diagnostics } = convert(registry, {
      id: 'orphan-brush',
      actionName: TOOL_ACTION,
      layerId: 'missing-layer',
      args: { toolName: 'brush' } as unknown as ToolArgs,
    });

    expect(diagnostics).toStrictEqual([
      {
        historyId: 'orphan-brush',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Layer missing-layer is unavailable',
      },
    ]);
    expect(document.history).toEqual([]);
  });
});

describe('unsupported legacy actions', () => {
  it('rejects an action name that matches no durable operation', () => {
    const registry = new AssetRegistry();

    // The per-entry chain has no arm for an action outside the known set, so
    // the entry must be reported rather than silently dropped.
    const { document, diagnostics } = convert(registry, {
      id: 'mystery',
      actionName: 'mystery-action' as unknown as HistoryItem['actionName'],
      layerId,
    });

    expect(diagnostics).toStrictEqual([
      {
        historyId: 'mystery',
        actionName: 'mystery-action',
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Unsupported legacy action mystery-action',
      },
    ]);
    expect(document.history).toEqual([]);
    expect(document.cursor).toBe(-1);
  });

  it('leaves an unsupported action out of the durable history while keeping its cursor mapping', () => {
    const registry = new AssetRegistry();

    const { document, legacyCursorToDurableCursor } = convert(
      registry,
      { id: 'mystery', actionName: 'mystery-action' as unknown as HistoryItem['actionName'], layerId },
      { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId, args: { name: 'Kept' } }
    );

    // The baseline maps to -1, the skipped entry maps to the preceding durable
    // cursor (-1, nothing had been recorded yet) and never to the tip, and the
    // later valid entry is recorded at 0.
    expect(legacyCursorToDurableCursor).toEqual([-1, -1, 0]);
    expect(document.history.map((entry) => entry.id)).toEqual(['rename']);
  });
});

describe('baseline layer materialization', () => {
  it('converts a source-less baseline layer that still has pixels into a borrowed raster source', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createBorrowedBitmap(64, 32);
    const materializationPending: Layer = { ...blankBaselineLayer(), source: undefined, bitmap };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: { layers: { [layerId]: materializationPending }, size: initialSize, frame: baselineFrame },
      },
    ];

    const { document, diagnostics } = legacyHistoryToDurable(history, { documentId: 'pending', registry });

    expect(diagnostics).toEqual([]);
    const snapshot = document.baseline.layers[0];
    expect(snapshot?.source).toMatchObject({ kind: 'raster', width: 64, height: 32, isBedrock: false });
    expect(snapshot?.name).toBe('Layer');
    // The legacy runtime still owns the pixels, so conversion must not close them.
    expect(close).not.toHaveBeenCalled();
  });

  it('fails the whole conversion when a baseline layer has neither a source nor pixels', () => {
    const registry = new AssetRegistry();
    const unmaterialized: Layer = { ...blankBaselineLayer(), source: undefined, bitmap: null };
    const history: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: { layers: { [layerId]: unmaterialized }, size: initialSize, frame: baselineFrame },
      },
    ];

    // The baseline is converted outside the per-entry try/catch, so the error
    // escapes legacyHistoryToDurable instead of becoming a per-entry diagnostic.
    expect(() => legacyHistoryToDurable(history, { documentId: 'unmaterialized', registry })).toThrow(
      UnsupportedHistoryFeatureError
    );

    const attempt = convertLegacyHistorySafely(history, { registry });
    expect(attempt.status).toBe('unavailable');
    expect(attempt.document).toBeNull();
    expect(attempt.diagnostics).toStrictEqual([
      {
        severity: 'error',
        code: 'unsupported-history-feature',
        message: `Layer ${layerId} has no durable source or raster materialization`,
      },
    ]);
    expect(attempt.legacyCursorToDurableCursor).toEqual([]);
  });
});
