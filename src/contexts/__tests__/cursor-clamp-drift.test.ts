import { describe, expect, it } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { freezeDurableDocument, type DurableDocument } from '../history-model.ts';
import { legacyHistoryToDurable, setDurableCursor } from '../history-adapter.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const size = { width: 400, height: 300 };
const frame = { x: 0, y: 0, width: 400, height: 300 };

function documentForClamp(): DurableDocument {
  const layer = {
    id: layerId,
    name: 'Layer',
    isBedrock: false as const,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as const,
    order: 0,
    pos: { x: 0, y: 0, width: 100, height: 80 },
    presentationBounds: null,
    source: {
      kind: 'blank' as const,
      color: '#ffffff',
      opacity: 1,
      isBedrock: false as const,
      pos: { x: 0, y: 0, width: 100, height: 80 },
    },
    operations: [],
  };
  const history: HistoryItem[] = [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: { layers: { [layerId]: layer }, size, frame },
    },
    { id: 'blur-1', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 2 } },
    { id: 'blur-2', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
    { id: 'blur-3', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 8 } },
  ];
  return legacyHistoryToDurable(history, { documentId: 'cursor-clamp' }).document;
}

describe('durable cursor clamp drift', () => {
  it('keeps freeze and replay totalized over invalid cursor classes', () => {
    const document = documentForClamp();
    const invalidCursors = [-Infinity, -5, -1.5, -0.5, 0.5, 1.5, 99, Infinity, Number.NaN];
    const tip = document.history.length - 1;

    for (const cursor of invalidCursors) {
      const expected = Number.isInteger(cursor) ? Math.max(-1, Math.min(cursor, tip)) : -1;
      const frozen = freezeDurableDocument({ ...document, cursor });
      const replayed = replayDurableDocument(document, cursor);

      expect(frozen.cursor).toBe(expected);
      expect(replayed.cursor).toBe(expected);
    }
  });

  it('keeps the refusal API distinct from the replay/freeze clamp', () => {
    const document = documentForClamp();

    for (const cursor of [Number.NaN, 0.5, -2, document.history.length]) {
      expect(setDurableCursor(document, cursor)).toBe(document);
    }
  });

  it('accepts every valid cursor and increments durableRevision only when it changes', () => {
    const original = documentForClamp();
    const document = setDurableCursor(original, -1);

    expect(document).not.toBe(original);
    for (let cursor = -1; cursor < document.history.length; cursor += 1) {
      const result = setDurableCursor(document, cursor);

      if (cursor === -1) {
        expect(result).toBe(document);
        expect(result.durableRevision).toBe(document.durableRevision);
      } else {
        expect(result).not.toBe(document);
        expect(result.cursor).toBe(cursor);
        expect(result.durableRevision).toBe(document.durableRevision + 1);
        expect(result.branchRevision).toBe(document.branchRevision);
        expect(result.history).toBe(document.history);
        expect(result.baseline).toBe(document.baseline);
      }
    }
  });

  it('keeps freeze and replay aligned for every valid cursor', () => {
    const document = documentForClamp();

    for (let cursor = -1; cursor < document.history.length; cursor += 1) {
      expect(freezeDurableDocument({ ...document, cursor }).cursor).toBe(cursor);
      expect(replayDurableDocument(document, cursor).cursor).toBe(cursor);
    }
  });
});
