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

function expectSameCursor(left: number, right: number): void {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    expect(Number.isNaN(left)).toBe(true);
    expect(Number.isNaN(right)).toBe(true);
    return;
  }
  expect(Object.is(left, right)).toBe(true);
}

describe('durable cursor clamp drift', () => {
  it('keeps freeze and replay totalized over every invalid cursor class', () => {
    const document = documentForClamp();
    const inputs = [-Infinity, -5, -1.5, -0.5, 0.5, 1.5, 99, Infinity, Number.NaN];

    for (const input of inputs) {
      const frozen = freezeDurableDocument({ ...document, cursor: input });
      const replayed = replayDurableDocument(document, input);
      expectSameCursor(frozen.cursor, replayed.cursor);
      if (!Number.isInteger(input)) expect(replayed.cursor).toBe(-1);
      if (input === -Infinity || input < -1) expect(replayed.cursor).toBe(-1);
      if (Number.isInteger(input) && input > document.history.length - 1) {
        expect(replayed.cursor).toBe(document.history.length - 1);
      }
    }
  });

  it('keeps the refusal API distinct from the replay/freeze clamp', () => {
    const document = documentForClamp();
    expect(setDurableCursor(document, Number.NaN)).toBe(document);
    expect(setDurableCursor(document, 0.5)).toBe(document);
    expect(setDurableCursor(document, -2)).toBe(document);
    expect(setDurableCursor(document, document.history.length)).toBe(document);
  });
});
