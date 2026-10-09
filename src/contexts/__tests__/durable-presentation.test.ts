import { describe, expect, it, vi } from 'vitest';

import type { BitmapSource } from '../general-types.ts';
import type { DurableDocument, DurableLayerSnapshot } from '../history-model.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { MaterializedLayer } from '../materialization.ts';
import { buildDurablePresentationProjection, DurablePresentationProjectionRefusal } from '../durable-presentation.ts';

const frame = { x: 0, y: 0, width: 100, height: 80 };
const bitmap = {} as BitmapSource;

function snapshot(id: string, visible: boolean, order: number): DurableLayerSnapshot {
  return {
    id,
    name: id,
    isBedrock: false,
    visible,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: order, y: order, width: 40, height: 30 },
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      size: { width: 40, height: 30 },
    },
  };
}

function replay() {
  const document: DurableDocument = {
    documentId: 'presentation-test',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame,
      layers: [snapshot('visible-layer', true, 0), snapshot('hidden-layer', false, 1)],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: 'visible-layer',
    },
    history: [],
    cursor: -1,
  };
  return replayDurableDocument(document);
}

function materializedVisibleLayer(): MaterializedLayer {
  const bounds = { x: 2, y: 3, width: 40, height: 30 };
  return {
    layerId: 'visible-layer',
    bitmap,
    bounds,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    lease: {
      key: 'visible-layer',
      bitmap,
      byteSize: 1,
      metadata: bounds,
      release: vi.fn(),
    },
  };
}

describe('buildDurablePresentationProjection', () => {
  it('keeps hidden metadata without acquiring a hidden bitmap lease', () => {
    const projection = buildDurablePresentationProjection(replay(), {
      'visible-layer': materializedVisibleLayer(),
    });

    expect(projection.visibleLayerIds).toEqual(['visible-layer']);
    expect(projection.hiddenLayerIds).toEqual(['hidden-layer']);
    expect(projection.layers['visible-layer']).toMatchObject({ bitmap, layerId: 'visible-layer' });
    expect(projection.layers['hidden-layer']).toMatchObject({ bitmap: null, lease: null, layerId: 'hidden-layer' });
    expect(projection.layers['hidden-layer']?.snapshot.name).toBe('hidden-layer');
  });

  it('refuses a visible layer coverage mismatch before publication', () => {
    expect(() => buildDurablePresentationProjection(replay(), {})).toThrow(DurablePresentationProjectionRefusal);
    try {
      buildDurablePresentationProjection(replay(), {});
    } catch (error) {
      expect(error).toMatchObject({ missingLayerIds: ['visible-layer'], unexpectedLayerIds: [] });
    }
  });
});
