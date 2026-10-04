import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { durableSourceKindForTool, legacyHistoryToDurable } from '../history-adapter.ts';
import type { DurableOperation } from '../history-model.ts';
import { replayHistory, type HistoryReplayDependencies, type HistoryReplayResult } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayerOperation, LayerSource } from '../layer-types.ts';
import type { DurableReplayResult } from '../durable-replay.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';

// The twelve scenarios live in `history-replay.scenarios.ts` because the pixel differential
// reads the SAME twelve: two suites describing two corpora would make "the two models agree" a
// statement about neither.
import {
  parityFrame as frame,
  paritySize as size,
  replayParityScenarios as cases,
} from './history-replay.scenarios.ts';

function replayDependencies(): HistoryReplayDependencies {
  return {
    createLayer: ({ layerId, layers, source }) => ({
      id: layerId,
      name:
        source.kind === 'tool' ? source.args.toolName : source.kind === 'image' ? (source.name ?? layerId) : 'Blank',
      isBedrock: Boolean(source.isBedrock),
      tmpCanvas: null,
      bitmap: source.kind === 'image' ? source.bitmap : null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: Object.values(layers).length,
      pos: 'pos' in source ? { ...source.pos } : { x: 0, y: 0, width: source.size.width, height: source.size.height },
      source,
      operations: [],
    }),
    applyRasterTool: (layer) => layer,
  };
}

function sourceKind(source: LayerSource | undefined): string {
  if (!source) return 'materialized';
  if (source.kind === 'image') return 'raster';
  if (source.kind === 'tool') return durableSourceKindForTool(source.args.toolName) ?? 'legacy-tool';
  return source.kind;
}

function durableSourceKind(source: DurableReplayResult['layers'][string]['snapshot']['source']): string {
  return source.kind;
}

type ComparableOperationKind = NonNullable<LayerOperation['kind']> | DurableOperation['kind'] | 'unknown';

function operationKind(kind: LayerOperation['kind'], operation: LayerOperation): ComparableOperationKind {
  if (kind === 'filter') return 'apply-filter';
  if (kind === 'affine-transform') return 'apply-affine-transform';
  if (kind === undefined && 'args' in operation && typeof operation.args.toolName === 'string') {
    return 'apply-filter';
  }
  return 'unknown';
}

function normalizeLegacy(result: HistoryReplayResult) {
  return {
    frame: result.documentFrame,
    totalSize: result.totalSize,
    layers: Object.values(result.layers)
      .sort((left, right) => left.order - right.order)
      .map((layer, order) => ({
        id: layer.id,
        order,
        name: layer.name,
        visible: layer.visible ?? true,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        pos: layer.pos,
        sourceKind: sourceKind(layer.source),
        operationKinds: layer.operations.map((operation) => operationKind(operation.kind, operation)),
      })),
    selections: result.selections,
    activeSelectionId: result.activeSelectionId,
  };
}

function normalizeDurable(result: DurableReplayResult) {
  return {
    frame: result.frame,
    totalSize: result.totalSize,
    layers: Object.values(result.layers)
      .sort((left, right) => left.snapshot.order - right.snapshot.order)
      .map(({ snapshot, operations }, order) => ({
        id: snapshot.id,
        order,
        name: snapshot.name,
        visible: snapshot.visible ?? true,
        locked: snapshot.locked,
        opacity: snapshot.opacity,
        blendMode: snapshot.blendMode,
        pos: snapshot.pos,
        sourceKind: durableSourceKind(snapshot.source),
        operationKinds: operations.map((operation) => operation.kind),
      })),
    selections: result.selections.selections,
    activeSelectionId: result.selections.activeSelectionId,
  };
}

function convert(history: readonly HistoryItem[], name: string) {
  return legacyHistoryToDurable(history, { documentId: `parity-${name}` });
}

describe('legacy/durable logical replay parity', () => {
  beforeAll(() => overrideCanvasFilterSupport(true));
  afterAll(() => overrideCanvasFilterSupport(null));

  it.each(cases)('matches at every reachable cursor: $name', ({ name, history, expectedTipFrame }) => {
    const converted = convert(history, name);
    expect(converted.diagnostics).toEqual([]);

    for (let cursor = 0; cursor < history.length; cursor += 1) {
      const legacy = replayHistory(history, cursor, size, replayDependencies(), frame);
      const durableCursor = converted.legacyCursorToDurableCursor[cursor];
      expect(durableCursor, `${name} legacy cursor ${cursor} must map`).toEqual(expect.any(Number));
      const durable = replayDurableDocument(converted.document, durableCursor);
      expect(normalizeDurable(durable), `${name} at cursor ${cursor}`).toEqual(normalizeLegacy(legacy));

      // Parity alone cannot see an origin clamp: a model that floored the frame at 0 would
      // still agree with the other one, and the extent of these cases would not show it
      // either. So a case that declares a tip frame is held to that frame on BOTH sides,
      // sign included, at the only cursor that applied it.
      if (expectedTipFrame && cursor === history.length - 1) {
        expect(legacy.documentFrame, `${name} legacy frame at the tip`).toEqual(expectedTipFrame);
        expect(durable.frame, `${name} durable frame at the tip`).toEqual(expectedTipFrame);
        expect(Math.sign(legacy.documentFrame.x), `${name} legacy origin x sign`).toBe(Math.sign(expectedTipFrame.x));
        expect(Math.sign(durable.frame.x), `${name} durable origin x sign`).toBe(Math.sign(expectedTipFrame.x));
        expect(Math.sign(legacy.documentFrame.y), `${name} legacy origin y sign`).toBe(Math.sign(expectedTipFrame.y));
        expect(Math.sign(durable.frame.y), `${name} durable origin y sign`).toBe(Math.sign(expectedTipFrame.y));
      }
    }
  });

  it('keeps invalid cursor behavior outside the parity oracle', () => {
    const history = cases[0]!.history;
    const converted = convert(history, 'invalid-cursor');
    const legacy = replayHistory(history, -1, size, replayDependencies(), frame);
    const durable = replayDurableDocument(converted.document, -1);

    expect(Object.keys(legacy.layers)).toHaveLength(0);
    expect(Object.keys(durable.layers)).toHaveLength(1);
    expect(durable.cursor).toBe(-1);

    const nanLegacy = replayHistory(history, Number.NaN, size, replayDependencies(), frame);
    const nanDurable = replayDurableDocument(converted.document, Number.NaN);
    expect(Object.keys(nanLegacy.layers)).toHaveLength(0);
    expect(Object.keys(nanDurable.layers)).toHaveLength(1);
    expect(nanDurable.cursor).toBe(-1);
  });
});
