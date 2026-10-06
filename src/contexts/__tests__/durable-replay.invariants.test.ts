import { describe, expect, it } from 'vitest';

import { legacyHistoryToDurable, appendDurableEntry } from '../history-adapter.ts';
import { replayDurableDocument, replayDurableAtCursor } from '../durable-replay.ts';
import { freezeDurableDocument, cloneDurableDocument, type DurableDocument } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import {
  OPEN_DOCUMENT_ACTION,
  TOOL_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SELECTION_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  SHOW_LAYER_ACTION,
} from '../../util/constants.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: initialSize.width, height: initialSize.height };

function createBaselineLayer(): Layer {
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
    pos: { x: 20, y: 30, width: 120, height: 80 },
    source: {
      kind: 'blank' as const,
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 20, y: 30, width: 120, height: 80 },
    },
    operations: [],
  };
}

function convert(...items: HistoryItem[]): {
  document: DurableDocument;
  diagnostics: readonly { historyId?: string; severity: 'warning' | 'error'; message: string }[];
} {
  const result = legacyHistoryToDurable(
    [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: createBaselineLayer() },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      ...items,
    ],
    { documentId: 'test-document' }
  );
  return { document: result.document, diagnostics: result.diagnostics };
}

const rawTransform: TransformToolArgs = {
  toolName: 'transform',
  rotate: 17,
  mirrorH: true,
  mirrorV: false,
  skewX: 8,
  skewY: -4,
  trapezoid: 0,
  resizeX: 125,
  resizeY: 85,
};

describe('replayDurableDocument invariants (P1.7)', () => {
  it('never mutates the input document — baseline is preserved across cursors', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const baselineBefore = JSON.stringify(document.baseline);

    replayDurableDocument(document, 0);
    replayDurableDocument(document, 1);
    replayDurableDocument(document, -1);

    expect(JSON.stringify(document.baseline)).toBe(baselineBefore);
    expect(document.history[0]?.operation).toEqual(freezeDurableDocument(document).history[0]?.operation);
  });

  it('produces an empty operation set at cursor -1', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const replay = replayDurableDocument(document, -1);
    expect(replay.layers[layerId]?.operations).toHaveLength(0);
    expect(replay.cursor).toBe(-1);
    expect(replay.frame).toEqual(baselineFrame);
  });

  it('produces first operation at cursor 0', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const replay = replayDurableDocument(document, 0);
    expect(replay.layers[layerId]?.operations).toHaveLength(1);
    expect(replay.cursor).toBe(0);
  });

  it('produces middle operations at a middle cursor', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
      { id: 'op3', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } }
    );

    const replay = replayDurableDocument(document, 1);
    expect(replay.layers[layerId]?.operations).toHaveLength(2);
    expect(replay.cursor).toBe(1);
  });

  it('produces all operations at the tip cursor', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const replay = replayDurableDocument(document, document.history.length - 1);
    expect(replay.layers[layerId]?.operations).toHaveLength(2);
  });

  it('clamps out-of-range cursors to the valid range', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: rawTransform },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const aboveTip = replayDurableDocument(document, 999);
    expect(aboveTip.cursor).toBe(document.history.length - 1);
    expect(aboveTip.layers[layerId]?.operations).toHaveLength(2);

    const belowMinusOne = replayDurableDocument(document, -5);
    expect(belowMinusOne.cursor).toBe(-1);
    expect(belowMinusOne.layers[layerId]?.operations).toHaveLength(0);
  });

  it('skips disabled entries in the replay result but retains them in history', () => {
    const { document } = convert(
      { id: 'enabled', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
      { id: 'disabled', actionName: TOOL_ACTION, layerId, disabled: true, args: { toolName: 'color', grayscale: 0.8 } },
      { id: 'enabled2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 8 } }
    );

    // Disabled entries are retained in history but marked.
    expect(document.history.map((entry) => entry.enabled)).toEqual([true, false, true]);

    const replay = replayDurableDocument(document, document.history.length - 1);
    // Only enabled entries contribute operations.
    expect(replay.layers[layerId]?.operations).toHaveLength(2);
  });

  it('produces equivalent replays for full history at cursor N and truncated history at cursor N', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } },
      { id: 'op3', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }
    );

    const fullReplay = replayDurableDocument(document, 1);

    const truncated = freezeDurableDocument({
      ...document,
      history: document.history.slice(0, 2),
      cursor: 1,
    });
    const truncatedReplay = replayDurableDocument(truncated, 1);

    expect(fullReplay.layers[layerId]?.operations).toEqual(truncatedReplay.layers[layerId]?.operations);
    expect(fullReplay.frame).toEqual(truncatedReplay.frame);
  });

  it('replayDurableAtCursor clones the document before replay', () => {
    // This test used to call `replayDurableDocument` — the entry point that does
    // NOT clone — and discard the result, so the name described a guarantee the
    // body never exercised and `cloneDurableDocument` inside `replayDurableAtCursor`
    // (`durable-replay.ts:170`) was invisible to the suite.
    //
    // Assertions (b) and (c) are both load-bearing for the clone, and (c) is the
    // one that regresses if `replayDurableAtCursor` ever becomes a bare
    // delegation. The reducer pushes `entry.operation` BY REFERENCE
    // (`durable-replay.ts:119`), so a direct `replayDurableDocument` hands back
    // the source document's own operation object. `replayDurableAtCursor` only
    // returns a different object because it cloned first, and the
    // `directOperation` identity assertion in (c) makes that premise explicit:
    // it proves the two replays differ because of the clone, and not because the
    // reducer copies.
    const { document } = convert({
      id: 'op1',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'blur', radius: 2 },
    });

    const beforeReplay = JSON.stringify(document);
    const sourceOperation = document.history[0]?.operation;

    const atCursor = replayDurableAtCursor(document, 0);
    const atCursorOperation = atCursor.layers[layerId]?.operations[0];
    const directOperation = replayDurableDocument(document, 0).layers[layerId]?.operations[0];

    // (a) The source document is untouched by the clone-and-replay path.
    expect(JSON.stringify(document)).toBe(beforeReplay);

    // (b) The operation the cursor replay carries is not the source's object.
    expect(atCursorOperation).toBeDefined();
    expect(sourceOperation).toBeDefined();
    expect(atCursorOperation).not.toBe(sourceOperation);

    // (c) Nor is it the object a non-cloning replay hands back — the one that
    // regresses if `replayDurableAtCursor` ever becomes a bare delegation.
    expect(directOperation).toBe(sourceOperation);
    expect(atCursorOperation).not.toBe(directOperation);

    // The clone is faithful: equal in value, different in identity.
    expect(atCursor).toEqual(replayDurableDocument(document, 0));
  });
});

describe('durable document immutability boundary (P1.9)', () => {
  it('freezing prevents mutation of baseline layers', () => {
    const { document } = convert({
      id: 'op1',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'blur', radius: 2 },
    });

    const firstLayer = document.baseline.layers[0]!;
    expect(Object.isFrozen(firstLayer)).toBe(true);
    expect(Object.isFrozen(firstLayer.source)).toBe(true);
    expect(Object.isFrozen(firstLayer.pos)).toBe(true);

    expect(() => {
      'use strict';
      Object.defineProperty(firstLayer.pos, 'x', { value: 999 });
    }).toThrow(TypeError);
  });

  it('mutating input history items after conversion does not affect the durable document', () => {
    const items: HistoryItem[] = [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: createBaselineLayer() },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
    ];

    const result = legacyHistoryToDurable(items, { documentId: 'test-doc' });
    const snapshot = JSON.stringify(result.document);

    // Mutate the input objects after conversion.
    (items[1] as { args: { toolName: string; radius: number } }).args.radius = 999;
    (items[0] as { documentSource: { frame: { x: number } } }).documentSource.frame.x = 999;

    // The already-converted document must be unaffected by later input mutation.
    expect(JSON.stringify(result.document)).toBe(snapshot);
  });

  it('cloneDurableDocument produces an independent deep copy', () => {
    const { document } = convert(
      { id: 'op1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
      { id: 'op2', actionName: TOOL_ACTION, layerId, args: { toolName: 'color', grayscale: 0.5 } }
    );

    const cloned = cloneDurableDocument(document);
    expect(cloned).not.toBe(document);
    expect(cloned.baseline).not.toBe(document.baseline);
    expect(cloned.history).not.toBe(document.history);
    expect(cloned.history[0]).not.toBe(document.history[0]);
    expect(cloned.history[0]?.operation).not.toBe(document.history[0]?.operation);

    // Deep equality for structure.
    expect(cloned).toEqual(document);
  });

  it('appendDurableEntry does not mutate the source document', () => {
    const { document } = convert({
      id: 'op1',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'blur', radius: 2 },
    });

    const before = JSON.stringify(document);
    const newEntry = {
      id: 'op2',
      schemaVersion: 1,
      enabled: true,
      operation: {
        kind: 'apply-filter' as const,
        layerId,
        filter: { toolName: 'blur' as const, version: 1, args: { radius: 3 } },
      },
    };

    const appended = appendDurableEntry(document, newEntry);

    // Source document unchanged.
    expect(JSON.stringify(document)).toBe(before);
    // New document has one more history entry.
    expect(appended.history).toHaveLength(2);
    expect(appended.cursor).toBe(1);
  });
});

describe('replayDurableDocument switch arm and edge-case coverage', () => {
  const layer2Id = 'layer-2';
  const layer3Id = 'layer-3';

  function createLayer(id: string, order: number): Layer {
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
      pos: { x: 20, y: 30, width: 120, height: 80 },
      source: {
        kind: 'blank' as const,
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        pos: { x: 20, y: 30, width: 120, height: 80 },
      },
      operations: [],
    };
  }

  function buildDocument(layers: Layer[], history: HistoryItem[]): DurableDocument {
    const result = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: layers[0]?.id ?? 'layer-1',
          documentSource: {
            layers: Object.fromEntries(layers.map((l) => [l.id, l])),
            size: initialSize,
            frame: baselineFrame,
          },
        },
        ...history,
      ],
      { documentId: 'edge-case-test' }
    );
    return result.document;
  }

  it('remove-layer on active layer selects next highest-order layer', () => {
    const layer1 = createLayer(layerId, 0);
    const layer2 = createLayer(layer2Id, 1);

    // Create layer3 via NEW_LAYER_ACTION so it becomes activeLayerId in replay,
    // then remove it to trigger the activeLayerId === operation.layerId branch.
    const document = buildDocument(
      [layer1, layer2],
      [
        {
          id: 'create-layer3',
          actionName: NEW_LAYER_ACTION,
          layerId: layer3Id,
          layerSource: {
            kind: 'blank' as const,
            color: '#ffffff',
            opacity: 1,
            isBedrock: false,
            pos: { x: 20, y: 30, width: 120, height: 80 },
          },
        },
        { id: 'remove-active', actionName: REMOVE_ACTION, layerId: layer3Id },
      ]
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layer3Id]).toBeUndefined();
    expect(replay.activeLayerId).toBe(layer2Id);
  });

  it('remove-layer on active layer with single layer results in null activeLayerId', () => {
    const document = buildDocument(
      [createLayer(layerId, 0)],
      [{ id: 'remove-only', actionName: REMOVE_ACTION, layerId }]
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]).toBeUndefined();
    expect(replay.activeLayerId).toBeNull();
  });

  it('activeLayerId fallback when tracked id not in final layerRecord', () => {
    const layer1 = createLayer(layerId, 0);
    const layer2 = createLayer(layer2Id, 1);

    const document = buildDocument(
      [layer1, layer2],
      [
        { id: 'remove-layer-1', actionName: REMOVE_ACTION, layerId: layerId },
        { id: 'remove-layer-2', actionName: REMOVE_ACTION, layerId: layer2Id },
      ]
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]).toBeUndefined();
    expect(replay.layers[layer2Id]).toBeUndefined();
    expect(replay.activeLayerId).toBeNull();
  });

  it('set-layer-properties on non-existent layer is a no-op', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'set-props-missing',
          actionName: SHOW_LAYER_ACTION,
          layerId: 'non-existent',
        },
      ],
      { documentId: 'edge-case-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.snapshot.visible).toBe(true);
    expect(replay.layers[layerId]?.snapshot.name).toBe(layerId);
  });

  it('reposition-layer on non-existent layer is a no-op', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'repos-missing',
          actionName: TOOL_ACTION,
          layerId: 'non-existent',
          args: { toolName: 'reposition', move: { x: 100, y: 100 }, resize: { width: 500, height: 500 } },
        },
      ],
      { documentId: 'edge-case-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.snapshot.pos).toEqual({ x: 20, y: 30, width: 120, height: 80 });
  });

  it('reorder-layers skips non-existent layer ids', () => {
    const layer1 = createLayer(layerId, 0);
    const layer2 = createLayer(layer2Id, 1);

    const document = buildDocument(
      [layer1, layer2],
      [
        {
          id: 'reorder-with-missing',
          actionName: REORDER_ACTION,
          layerId: layerId,
          args: { layerToMoveId: layerId, afterWhichLayerId: layer2Id },
        },
      ]
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.snapshot.order).toBe(1);
    expect(replay.layers[layer2Id]?.snapshot.order).toBe(0);
  });

  it('apply-filter on non-existent layer is a no-op', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'filter-missing',
          actionName: TOOL_ACTION,
          layerId: 'non-existent',
          args: { toolName: 'blur', radius: 5 },
        },
      ],
      { documentId: 'edge-case-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.operations).toHaveLength(0);
  });

  it('apply-affine-transform on non-existent layer is a no-op', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'affine-missing',
          actionName: TOOL_ACTION,
          layerId: 'non-existent',
          args: {
            toolName: 'transform',
            rotate: 45,
            mirrorH: false,
            mirrorV: false,
            skewX: 0,
            skewY: 0,
            trapezoid: 0,
            resizeX: 100,
            resizeY: 100,
          },
        },
      ],
      { documentId: 'edge-case-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.operations).toHaveLength(0);
  });

  it('apply-raster-processor on non-existent layer is a no-op', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'raster-missing',
          actionName: TOOL_ACTION,
          layerId: 'non-existent',
          args: { toolName: 'color', grayscale: 0.5 },
        },
      ],
      { documentId: 'edge-case-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layerId]?.operations).toHaveLength(0);
  });

  it('create-layer then remove-layer at same cursor leaves layer absent', () => {
    const document = buildDocument(
      [createLayer(layerId, 0)],
      [
        {
          id: 'create-new',
          actionName: NEW_LAYER_ACTION,
          layerId: layer2Id,
          layerSource: {
            kind: 'blank' as const,
            color: '#ffffff',
            opacity: 1,
            isBedrock: false,
            pos: { x: 20, y: 30, width: 120, height: 80 },
          },
        },
        { id: 'remove-new', actionName: REMOVE_ACTION, layerId: layer2Id },
      ]
    );

    const replay = replayDurableDocument(document);
    expect(replay.layers[layer2Id]).toBeUndefined();
    expect(replay.activeLayerId).toBe(layerId);
  });

  it('merge-document with non-existent removedLayerIds does not crash', () => {
    const layer1 = createLayer(layerId, 0);
    const layer2 = createLayer(layer2Id, 1);

    const document = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: layer1, [layer2Id]: layer2 },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'merge-op',
          actionName: MERGE_ACTION,
          layerId: layerId,
          layerSource: {
            kind: 'blank' as const,
            color: '#ffffff',
            opacity: 1,
            isBedrock: false,
            pos: { x: 20, y: 30, width: 120, height: 80 },
          },
        },
      ],
      { documentId: 'merge-test' }
    ).document;

    const replay = replayDurableDocument(document);
    expect(replay.layers[layer2Id]).toBeUndefined();
    expect(replay.layers[layerId]).toBeDefined();
    expect(replay.activeLayerId).toBe(layerId);
  });

  // This used to be titled `rasterize-layer on non-existent layer is a no-op`, and it
  // was vacuous: the tool action named an absent layer, so the converter threw at
  // `history-adapter.ts:787` and never produced an operation at all. The `rasterized`
  // assertion named a layer id the fixture never contained, so it could not fail. The
  // subject is the converter's refusal to invent a layer, which is what it does.
  it('drops a tool action on an absent layer and keeps the baseline intact', () => {
    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'tool-missing-layer',
          actionName: TOOL_ACTION,
          layerId: 'non-existent',
          args: { toolName: 'blur', radius: 2 },
        },
      ],
      { documentId: 'edge-case-test' }
    );

    expect(converted.diagnostics).toEqual([
      {
        historyId: 'tool-missing-layer',
        actionName: TOOL_ACTION,
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Layer non-existent is unavailable',
      },
    ]);
    // No operation was produced, so there is nothing for replay to apply.
    expect(converted.document.history).toHaveLength(0);

    const replay = replayDurableDocument(converted.document);
    expect(Object.keys(replay.layers)).toEqual([layerId]);
  });

  it('set-document-frame updates frame without affecting layers', () => {
    const nextFrame = { x: 50, y: 60, width: 300, height: 200 };
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'crop',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame },
        },
      ],
      { documentId: 'frame-test' }
    );

    const replay = replayDurableDocument(document);
    expect(replay.frame).toEqual(nextFrame);
    expect(replay.layers[layerId]?.snapshot.pos).toEqual({ x: 20, y: 30, width: 120, height: 80 });
  });

  it('set-selection replaces selections entirely', () => {
    const selection1 = {
      id: 'sel-1',
      points: [{ x: 1, y: 2 }],
      isActive: true,
      pos: { x: 1, y: 2, width: 10, height: 12 },
    };
    const selection2 = {
      id: 'sel-2',
      points: [{ x: 5, y: 6 }],
      isActive: true,
      pos: { x: 5, y: 6, width: 20, height: 30 },
    };

    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        {
          id: 'sel-1',
          actionName: SELECTION_ACTION,
          layerId,
          args: {
            previousSelectionState: { selections: [], activeSelectionId: null },
            nextSelectionState: { selections: [selection1], activeSelectionId: 'sel-1' },
          },
        },
        {
          id: 'sel-2',
          actionName: SELECTION_ACTION,
          layerId,
          args: {
            previousSelectionState: { selections: [selection1], activeSelectionId: 'sel-1' },
            nextSelectionState: { selections: [selection2], activeSelectionId: 'sel-2' },
          },
        },
      ],
      { documentId: 'selection-test' }
    );

    const atFirst = replayDurableDocument(document, 0);
    expect(atFirst.selections.selections).toHaveLength(1);
    expect(atFirst.selections.activeSelectionId).toBe('sel-1');

    const atSecond = replayDurableDocument(document, 1);
    expect(atSecond.selections.selections).toHaveLength(1);
    expect(atSecond.selections.activeSelectionId).toBe('sel-2');
    expect(atSecond.selections.selections[0].id).toBe('sel-2');
  });

  it('replayDurableAtCursor produces independent result from replayDurableDocument', () => {
    const { document } = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId,
          documentSource: {
            layers: { [layerId]: createLayer(layerId, 0) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'op1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
      ],
      { documentId: 'cursor-test' }
    );

    const replay1 = replayDurableDocument(document, 0);
    const replay2 = replayDurableAtCursor(document, 0);

    expect(replay1).toEqual(replay2);
    expect(replay1).not.toBe(replay2);
  });

  it('activeLayerId fallback with truthy but non-existent id covers final ternary false branch', () => {
    // Build a baseline with a known layer, then construct a document with
    // baseline.activeLayerId set to a non-existent id. This forces the final
    // ternary's false branch (line 164) with a truthy activeLayerId.
    const baselineLayer = createLayer(layerId, 0);
    const frozenLayer = Object.freeze({
      ...baselineLayer,
      pos: Object.freeze({ ...baselineLayer.pos }),
      source: Object.freeze({
        kind: 'blank' as const,
        color: '#ffffff',
        opacity: 1,
        size: { width: baselineLayer.pos.width, height: baselineLayer.pos.height },
        isBedrock: false,
      }),
    });
    const baseline = Object.freeze({
      frame: Object.freeze({ ...baselineFrame }),
      layers: Object.freeze([frozenLayer]),
      selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
      activeLayerId: 'non-existent-layer',
    });

    const document: DurableDocument = Object.freeze({
      documentId: 'fallback-test',
      documentRevision: 0,
      branchRevision: 0,
      durableRevision: 0,
      baseline,
      history: Object.freeze([]),
      cursor: -1,
    });

    const replay = replayDurableDocument(document);
    expect(replay.activeLayerId).toBe(layerId); // Falls back to highest-order layer
  });
});
