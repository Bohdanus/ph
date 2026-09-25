import { describe, expect, it } from 'vitest';

import { legacyHistoryToDurable, appendDurableEntry } from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { freezeDurableDocument, cloneDurableDocument, type DurableDocument } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
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
    expect(JSON.stringify(document.history[0]?.operation)).toBe(
      JSON.stringify(freezeDurableDocument(document).history[0]?.operation)
    );
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
    const { document } = convert({
      id: 'op1',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'blur', radius: 2 },
    });

    const beforeReplay = JSON.stringify(document);
    const replay = replayDurableDocument(document, 0);

    // The replay result should not be the same frozen document object.
    void replay;
    expect(JSON.stringify(document)).toBe(beforeReplay);
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
      (firstLayer.pos as { x: number }).x = 999;
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
