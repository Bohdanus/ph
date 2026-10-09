import { describe, expect, it, vi } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { legacyHistoryToDurable, operationForTool } from '../history-adapter.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const size = { width: 400, height: 300 };
const frame = { x: 0, y: 0, width: 400, height: 300 };

function layer(): Layer {
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

function history(noOp: HistoryItem): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: { layers: { [layerId]: layer() }, size, frame },
    },
    noOp,
  ];
}

function dependencies(applyRasterTool: HistoryReplayDependencies['applyRasterTool']): HistoryReplayDependencies {
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
    applyRasterTool,
  };
}

describe('durable tool-action invariant', () => {
  it('leaves a geometry tool with no patch untouched on both replay paths', () => {
    const noOp: HistoryItem = {
      id: 'reposition-without-patch',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'reposition' },
    };
    const timeline = history(noOp);
    const before = structuredClone(noOp);
    const converted = legacyHistoryToDurable(timeline, { documentId: 'tool-action-invariant' });
    const applyRasterTool = vi.fn((currentLayer: Layer) => currentLayer);
    const legacy = replayHistory(timeline, 1, size, dependencies(applyRasterTool), frame);
    const durableCursor = converted.legacyCursorToDurableCursor[1];
    const durable = replayDurableDocument(converted.document, durableCursor);

    expect(operationForTool(noOp, converted.document.baseline.layers[0]!)).toBeNull();
    expect(noOp).toEqual(before);
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1]);
    expect(legacy.layers[layerId]?.pos).toEqual({ x: 20, y: 30, width: 120, height: 80 });
    expect(durable.layers[layerId]?.snapshot.pos).toEqual(legacy.layers[layerId]?.pos);
    expect(applyRasterTool).not.toHaveBeenCalled();
  });
});
