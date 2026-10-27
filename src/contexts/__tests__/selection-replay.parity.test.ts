import { describe, expect, it } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { deriveSelectionBaseline, selectionSnapshot } from '../selection-baseline.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import type { Point, Selection } from '../general-types.ts';
import { OPEN_DOCUMENT_ACTION, SELECTION_ACTION } from '../../util/constants.ts';
import { encodeRasterSelectionMask } from '../../util/selection-mask.ts';

const layerId = 'layer-1';
const size = { width: 400, height: 300 };
const frame = { x: 0, y: 0, width: 400, height: 300 };

function blankLayer(): Layer {
  const pos = { x: 20, y: 30, width: 120, height: 80 };
  const source: Extract<LayerSource, { kind: 'blank' }> = {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    isBedrock: false,
    pos,
  };
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
    pos,
    presentationBounds: null,
    source,
    operations: [],
  };
}

function baseline(): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers: { [layerId]: blankLayer() }, size, frame },
  };
}

function selection(id: string, x: number, y: number, active = true): Selection {
  return {
    id,
    points: [
      [
        { x, y },
        { x: x + 20, y },
        { x: x + 20, y: y + 20 },
      ],
    ],
    isActive: active,
    pos: { x, y, width: 20, height: 20 },
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    metadata: { movedAtVersion: x + y },
  };
}

function selectionItem(
  id: string,
  previousSelectionState: ReturnType<typeof selectionSnapshot> | undefined,
  nextSelectionState: ReturnType<typeof selectionSnapshot>,
  disabled = false
): HistoryItem {
  return {
    id,
    actionName: SELECTION_ACTION,
    layerId: 'selection',
    ...(disabled ? { disabled: true } : {}),
    args: {
      ...(previousSelectionState ? { previousSelectionState } : {}),
      nextSelectionState,
    },
  };
}

const selectionA = selection('selection-a', 10, 20);
const selectionAMoved = selection('selection-a', 30, 40);
const selectionB = selection('selection-b', 50, 60);
const rasterMask = encodeRasterSelectionMask(Uint8Array.from([1, 0, 1, 0, 1, 0]), 3, 2, {
  x: 0,
  y: 0,
  width: 3,
  height: 2,
})!;
const rasterSelection: Selection = {
  ...selection('raster-selection', 4, 6),
  sourceTool: 'magic-wand',
  points: [],
  pos: { x: 4, y: 6, width: 3, height: 2 },
  rasterMask,
};
const movedRasterSelection: Selection = { ...rasterSelection, pos: { ...rasterSelection.pos, x: 12 } };

const shapes: ReadonlyArray<{ name: string; history: readonly HistoryItem[] }> = [
  {
    name: 'empty timeline',
    history: [baseline()],
  },
  {
    name: 'create selection',
    history: [baseline(), selectionItem('create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id))],
  },
  {
    name: 'move chain',
    history: [
      baseline(),
      selectionItem('create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id)),
      selectionItem(
        'move',
        selectionSnapshot([selectionA], selectionA.id),
        selectionSnapshot([selectionAMoved], selectionAMoved.id)
      ),
    ],
  },
  {
    name: 'clear chain',
    history: [
      baseline(),
      selectionItem('create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id)),
      selectionItem('clear', selectionSnapshot([selectionA], selectionA.id), selectionSnapshot()),
    ],
  },
  {
    name: 'raster create, move, and clear chain',
    history: [
      baseline(),
      selectionItem('raster-create', selectionSnapshot(), selectionSnapshot([rasterSelection], rasterSelection.id)),
      selectionItem(
        'raster-move',
        selectionSnapshot([rasterSelection], rasterSelection.id),
        selectionSnapshot([movedRasterSelection], movedRasterSelection.id)
      ),
      selectionItem(
        'raster-clear',
        selectionSnapshot([movedRasterSelection], movedRasterSelection.id),
        selectionSnapshot()
      ),
    ],
  },
  {
    name: 'multiple selection active-id change',
    history: [
      baseline(),
      selectionItem('create-a', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id)),
      selectionItem(
        'create-b',
        selectionSnapshot([selectionA], selectionA.id),
        selectionSnapshot([{ ...selectionA, isActive: false }, selectionB], selectionB.id)
      ),
    ],
  },
  {
    name: 'disabled first and omitted before fallback',
    history: [
      baseline(),
      selectionItem('disabled', selectionSnapshot(), selectionSnapshot([selectionB], selectionB.id), true),
      selectionItem('fallback-create', undefined, selectionSnapshot([selectionA], selectionA.id)),
      selectionItem('clear', selectionSnapshot([selectionA], selectionA.id), selectionSnapshot()),
    ],
  },
];

function replayDependencies(): HistoryReplayDependencies {
  return {
    createLayer: ({ layerId: id, layers, source }) => ({
      id,
      name: id,
      isBedrock: Boolean(source.isBedrock),
      tmpCanvas: null,
      bitmap: source.kind === 'image' ? source.bitmap : null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: Object.values(layers).length,
      pos: 'pos' in source ? { ...source.pos } : { x: 0, y: 0, width: source.size.width, height: source.size.height },
      presentationBounds: null,
      source,
      operations: [],
    }),
    applyRasterTool: (layer) => layer,
  };
}

function normalizeLegacy(result: ReturnType<typeof replayHistory>) {
  return { selections: result.selections, activeSelectionId: result.activeSelectionId };
}

function normalizeDurable(result: ReturnType<typeof replayDurableDocument>) {
  return { selections: result.selections.selections, activeSelectionId: result.selections.activeSelectionId };
}

describe('selection replay chain and baseline parity', () => {
  it.each(shapes)('matches legacy and durable selection state at every cursor: $name', ({ history }) => {
    const converted = legacyHistoryToDurable(history, { documentId: 'selection-parity' });
    expect(converted.diagnostics).toEqual([]);

    for (let cursor = 0; cursor < history.length; cursor += 1) {
      const legacy = replayHistory(history, cursor, size, replayDependencies(), frame);
      const durableCursor = converted.legacyCursorToDurableCursor[cursor];
      const durable = replayDurableDocument(converted.document, durableCursor);
      expect(normalizeDurable(durable), `cursor ${cursor}`).toEqual(normalizeLegacy(legacy));
    }

    const durableSelectionEntries = converted.document.history.filter(
      (entry) => entry.enabled && entry.operation.kind === 'set-selection'
    );
    for (let index = 1; index < durableSelectionEntries.length; index += 1) {
      const previous = durableSelectionEntries[index - 1];
      const current = durableSelectionEntries[index];
      if (previous?.operation.kind !== 'set-selection' || current?.operation.kind !== 'set-selection') continue;
      expect(current.operation.before).toEqual(previous.operation.after);
    }

    const baselineSelection = deriveSelectionBaseline(history);
    const firstSelection = durableSelectionEntries[0];
    if (firstSelection?.operation.kind === 'set-selection') {
      expect(converted.document.baseline.selections).toEqual(firstSelection.operation.before);
    }
    expect(baselineSelection).toEqual(converted.document.baseline.selections);
  });

  it('does not seed an earlier cursor from a disabled creation that a later move snapshots', () => {
    const history = [
      baseline(),
      selectionItem('create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id), true),
      selectionItem(
        'move',
        selectionSnapshot([selectionA], selectionA.id),
        selectionSnapshot([selectionAMoved], selectionAMoved.id)
      ),
    ];
    const converted = legacyHistoryToDurable(history, { documentId: 'disabled-selection-create' });
    expect(converted.diagnostics).toEqual([]);

    const legacyAtDisabledCreate = replayHistory(history, 1, size, replayDependencies(), frame);
    const durableAtDisabledCreate = replayDurableDocument(
      converted.document,
      converted.legacyCursorToDurableCursor[1]!
    );
    expect(normalizeLegacy(legacyAtDisabledCreate)).toEqual({ selections: [], activeSelectionId: null });
    expect(normalizeDurable(durableAtDisabledCreate)).toEqual({ selections: [], activeSelectionId: null });

    const legacyAfterMove = replayHistory(history, 2, size, replayDependencies(), frame);
    const durableAfterMove = replayDurableDocument(converted.document, converted.legacyCursorToDurableCursor[2]!);
    expect(normalizeLegacy(legacyAfterMove)).toEqual({
      selections: [selectionAMoved],
      activeSelectionId: selectionAMoved.id,
    });
    expect(normalizeDurable(durableAfterMove)).toEqual({
      selections: [selectionAMoved],
      activeSelectionId: selectionAMoved.id,
    });
  });

  it('rewinds a continuous chain of disabled selection transitions', () => {
    const history = [
      baseline(),
      selectionItem('create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id), true),
      selectionItem(
        'move',
        selectionSnapshot([selectionA], selectionA.id),
        selectionSnapshot([selectionAMoved], selectionAMoved.id),
        true
      ),
      selectionItem('clear', selectionSnapshot([selectionAMoved], selectionAMoved.id), selectionSnapshot()),
    ];
    const converted = legacyHistoryToDurable(history, { documentId: 'disabled-selection-chain' });
    expect(converted.diagnostics).toEqual([]);

    const legacy = replayHistory(history, 2, size, replayDependencies(), frame);
    const durable = replayDurableDocument(converted.document, converted.legacyCursorToDurableCursor[2]!);
    expect(normalizeLegacy(legacy)).toEqual({ selections: [], activeSelectionId: null });
    expect(normalizeDurable(durable)).toEqual({ selections: [], activeSelectionId: null });
  });

  it('preserves a selection recorded before a sole disabled clear', () => {
    const history = [
      baseline(),
      selectionItem('disabled-clear', selectionSnapshot([selectionA], selectionA.id), selectionSnapshot(), true),
    ];
    const converted = legacyHistoryToDurable(history, { documentId: 'disabled-only-selection-clear' });
    expect(converted.diagnostics).toEqual([]);
    expect(deriveSelectionBaseline(history)).toEqual({
      selections: [selectionA],
      activeSelectionId: selectionA.id,
    });
    expect(converted.document.baseline.selections).toEqual({
      selections: [selectionA],
      activeSelectionId: selectionA.id,
    });

    for (const cursor of [0, 1]) {
      const legacy = replayHistory(history, cursor, size, replayDependencies(), frame);
      const durable = replayDurableDocument(converted.document, converted.legacyCursorToDurableCursor[cursor]!);

      expect(normalizeLegacy(legacy)).toEqual({ selections: [selectionA], activeSelectionId: selectionA.id });
      expect(normalizeDurable(durable)).toEqual({ selections: [selectionA], activeSelectionId: selectionA.id });
    }
  });

  it('does not rewind across a disabled selection row when its snapshot does not match', () => {
    const laterSelection = selection('selection-c', 70, 80);
    const history = [
      baseline(),
      selectionItem('disabled-create', selectionSnapshot(), selectionSnapshot([selectionA], selectionA.id), true),
      selectionItem(
        'enabled-change',
        selectionSnapshot([selectionB], selectionB.id),
        selectionSnapshot([laterSelection], laterSelection.id)
      ),
    ];
    const converted = legacyHistoryToDurable(history, { documentId: 'disabled-selection-mismatch' });

    expect(converted.diagnostics).toEqual([]);
    expect(deriveSelectionBaseline(history)).toEqual(selectionSnapshot([selectionB], selectionB.id));

    const legacy = replayHistory(history, 1, size, replayDependencies(), frame);
    const durable = replayDurableDocument(converted.document, converted.legacyCursorToDurableCursor[1]!);
    expect(normalizeLegacy(legacy)).toEqual({ selections: [selectionB], activeSelectionId: selectionB.id });
    expect(normalizeDurable(durable)).toEqual({ selections: [selectionB], activeSelectionId: selectionB.id });
  });

  it('detects a mutation of an expected after snapshot', () => {
    const history = shapes[2]!.history;
    const converted = legacyHistoryToDurable(history, { documentId: 'selection-negative-control' });
    const cursor = history.length - 1;
    const legacy = replayHistory(history, cursor, size, replayDependencies(), frame);
    const durable = replayDurableDocument(converted.document, converted.legacyCursorToDurableCursor[cursor]);
    const mutated = JSON.parse(JSON.stringify(normalizeDurable(durable))) as ReturnType<typeof normalizeDurable>;
    mutated.selections[0]!.pos.x += 1;

    expect(mutated).not.toEqual(normalizeLegacy(legacy));
  });

  it('keeps legacy replay results detached from vector and raster history payloads', () => {
    const vector = {
      ...selection('vector', 10, 20),
      metadata: {
        movedAtVersion: 4,
        magneticLasso: {
          width: 12,
          contrast: 22,
          frequency: 7,
          snapStrength: 9,
          smoothing: 5,
          antiAlias: true,
          pathPointCount: 4,
        },
      },
    } satisfies Selection;
    const raster = { ...rasterSelection, id: 'raster-detached', isActive: false };
    const next = selectionSnapshot([vector, raster], vector.id);
    const history = [baseline(), selectionItem('create', selectionSnapshot(), next)];
    const first = replayHistory(history, 1, size, replayDependencies(), frame);

    const vectorPoints = first.selections[0]!.points as Point[][];
    vectorPoints[0]![0]!.x = 99;
    first.selections[0]!.pos.x = 99;
    first.selections[0]!.metadata!.magneticLasso!.smoothing = 99;
    first.selections[1]!.rasterMask!.data = 'Ag==';

    const recordedNext = (history[1]!.args as { nextSelectionState: ReturnType<typeof selectionSnapshot> })
      .nextSelectionState;
    const recordedPoints = recordedNext.selections[0]!.points as Point[][];
    expect(recordedPoints[0]![0]!.x).toBe(10);
    expect(recordedNext.selections[0]!.pos.x).toBe(10);
    expect(recordedNext.selections[0]!.metadata!.magneticLasso!.smoothing).toBe(5);
    expect(recordedNext.selections[1]!.rasterMask!.data).toBe(rasterMask.data);

    const second = replayHistory(history, 1, size, replayDependencies(), frame);
    expect(second.selections).toEqual(recordedNext.selections);
  });
});
