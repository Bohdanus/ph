import { describe, expect, it, vi } from 'vitest';

import type { BitmapSource } from '../general-types.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { DurableDocument } from '../history-model.ts';
import type { MaterializedLayer } from '../materialization.ts';
import { durableExportRecords } from '../export-canvas.ts';
import type { DurableComposite } from '../durable-compositor.ts';

const bitmap = {} as BitmapSource;
const frame = { x: 4, y: 5, width: 100, height: 80 };

function snapshot(id: string, visible: boolean, order: number) {
  return {
    id,
    name: id,
    isBedrock: false,
    visible,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as const,
    order,
    pos: { x: order, y: order, width: 20, height: 10 },
    source: { kind: 'blank' as const, color: '#fff', opacity: 1, size: { width: 20, height: 10 } },
  };
}

function replay() {
  const document: DurableDocument = {
    documentId: 'export-test',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame,
      layers: [snapshot('visible', true, 0), snapshot('hidden', false, 1)],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: 'visible',
    },
    history: [],
    cursor: -1,
  };
  return replayDurableDocument(document);
}

function visibleMaterialized(): MaterializedLayer {
  const bounds = { x: 8, y: 9, width: 20, height: 10 };
  return {
    layerId: 'visible',
    bitmap,
    bounds,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    lease: { key: 'visible', bitmap, byteSize: 1, metadata: bounds, release: vi.fn() },
  };
}

describe('durableExportRecords', () => {
  it('projects visible pixels and hidden metadata into the shared export shape', () => {
    const records = durableExportRecords(replay(), {
      bitmap,
      frame,
      layers: { visible: visibleMaterialized() },
      takeLayers: () => {
        throw new Error('not used');
      },
      release: vi.fn(),
    } satisfies DurableComposite);

    expect(records.size).toEqual({ width: 100, height: 80 });
    expect(records.frame).toEqual(frame);
    expect(records.layers.visible).toMatchObject({ tmpCanvas: bitmap, pos: { x: 8, y: 9 }, operations: [] });
    expect(records.layers.hidden).toMatchObject({
      visible: false,
      tmpCanvas: null,
      pos: { x: 1, y: 1 },
      operations: [],
    });
  });
});
