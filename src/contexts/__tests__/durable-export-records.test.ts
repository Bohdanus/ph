import { describe, expect, it, vi } from 'vitest';

import type { BitmapSource, Pos } from '../general-types.ts';
import type { DurableReplayResult } from '../durable-replay.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type {
  AssetId,
  DurableDocument,
  DurableHistoryEntry,
  DurableLayerSnapshot,
  DurableLayerSource,
} from '../history-model.ts';
import type { MaterializedLayer } from '../materialization.ts';
import { durableExportRecords } from '../export-canvas.ts';
import type { DurableComposite } from '../durable-compositor.ts';

const bitmap = {} as BitmapSource;
const frame = { x: 4, y: 5, width: 100, height: 80 };

function snapshot(id: string, visible: boolean, order: number, source?: DurableLayerSource) {
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
    source: source ?? { kind: 'blank' as const, color: '#fff', opacity: 1, size: { width: 20, height: 10 } },
  };
}

function replayFrom(
  layers: readonly DurableLayerSnapshot[],
  history: readonly DurableHistoryEntry[] = []
): DurableReplayResult {
  const document: DurableDocument = {
    documentId: 'export-test',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame,
      layers,
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: layers.find((layer) => layer.visible)?.id ?? null,
    },
    history,
    cursor: history.length > 0 ? history.length - 1 : -1,
  };
  return replayDurableDocument(document);
}

function replay() {
  return replayFrom([snapshot('visible', true, 0), snapshot('hidden', false, 1)]);
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

function materializedFor(id: string, layerBitmap: BitmapSource, bounds: Pos, visible: boolean): MaterializedLayer {
  return {
    layerId: id,
    bitmap: layerBitmap,
    bounds,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    lease: { key: id, bitmap: layerBitmap, byteSize: 1, metadata: bounds, release: vi.fn() },
  };
}

const RASTER_ASSET = 'raster-asset' as unknown as AssetId;

function rasterSource(name: string): DurableLayerSource {
  return {
    kind: 'raster',
    assetId: RASTER_ASSET,
    width: 20,
    height: 10,
    name,
  };
}

function vectorSource(): DurableLayerSource {
  return {
    kind: 'vector',
    toolName: 'shape',
    args: { toolName: 'shape', figure: 'oval' },
    size: { width: 20, height: 10 },
    sourcePos: { x: 0, y: 0, width: 20, height: 10 },
  };
}

function paintSource(): DurableLayerSource {
  return {
    kind: 'paint',
    toolName: 'brush',
    args: { toolName: 'brush', size: 5 },
    size: { width: 20, height: 10 },
    sourcePos: { x: 0, y: 0, width: 20, height: 10 },
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
      pos: { x: 1, y: 1, width: 20, height: 10 },
      operations: [],
    });
  });

  it('bakes a vector source with a retained affine transform into tmpCanvas', () => {
    const bakedBitmap = {} as BitmapSource;
    const bakedBounds = { x: 4, y: 5, width: 20, height: 10 };

    const replay = replayFrom(
      [snapshot('vector', true, 0, vectorSource())],
      [
        {
          id: 'affine-1',
          schemaVersion: 1,
          enabled: true,
          operation: {
            kind: 'apply-affine-transform',
            layerId: 'vector',
            transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 3 },
          },
        },
      ]
    );

    expect(replay.layers.vector.operations).toHaveLength(1);

    const records = durableExportRecords(replay, {
      bitmap,
      frame,
      layers: { vector: materializedFor('vector', bakedBitmap, bakedBounds, true) },
      takeLayers: () => {
        throw new Error('not used');
      },
      release: vi.fn(),
    } satisfies DurableComposite);

    expect(records.layers.vector).toMatchObject({
      bitmap: bakedBitmap,
      tmpCanvas: null,
      pos: bakedBounds,
      presentationBounds: null,
      operations: [],
      visible: true,
      id: 'vector',
      name: 'vector',
      isBedrock: false,
      order: 0,
    });
  });

  it('bakes a paint source processor output into tmpCanvas, dropping the raster-processor operation', () => {
    const processedBitmap = {} as BitmapSource;
    const processedBounds = { x: 6, y: 7, width: 20, height: 10 };

    const replay = replayFrom(
      [snapshot('paint', true, 0, paintSource())],
      [
        {
          id: 'raster-1',
          schemaVersion: 1,
          enabled: true,
          operation: {
            kind: 'apply-raster-processor',
            layerId: 'paint',
            processorId: 'sharpen',
            version: 1,
            args: {},
          },
        },
      ]
    );

    expect(replay.layers.paint.operations).toHaveLength(1);
    expect(replay.layers.paint.operations[0]!.kind).toBe('apply-raster-processor');

    const records = durableExportRecords(replay, {
      bitmap,
      frame,
      layers: { paint: materializedFor('paint', processedBitmap, processedBounds, true) },
      takeLayers: () => {
        throw new Error('not used');
      },
      release: vi.fn(),
    } satisfies DurableComposite);

    expect(records.layers.paint).toMatchObject({
      bitmap: processedBitmap,
      tmpCanvas: null,
      pos: processedBounds,
      presentationBounds: null,
      operations: [],
      visible: true,
      id: 'paint',
      name: 'paint',
    });
  });

  it('preserves visibility and metadata across mixed raster, vector and paint layers', () => {
    const rasterBitmap = {} as BitmapSource;
    const vectorBitmap = {} as BitmapSource;
    const paintBitmap = {} as BitmapSource;

    const replay = replayFrom([
      {
        ...snapshot('raster-visible', true, 0, rasterSource('raster')),
        opacity: 0.5,
        blendMode: 'multiply' as const,
        isBedrock: true,
      },
      { ...snapshot('vector-visible', true, 1, vectorSource()), blendMode: 'screen' as const },
      { ...snapshot('paint-visible', true, 2, paintSource()), locked: true, opacity: 0.6 },
      {
        ...snapshot('raster-hidden', false, 3, rasterSource('hidden-raster')),
        opacity: 0.3,
        blendMode: 'overlay' as const,
      },
      { ...snapshot('vector-hidden', false, 4, vectorSource()), isBedrock: true },
      { ...snapshot('paint-hidden', false, 5, paintSource()), locked: true, blendMode: 'hard-light' as const },
    ]);

    const records = durableExportRecords(replay, {
      bitmap,
      frame,
      layers: {
        'raster-visible': materializedFor('raster-visible', rasterBitmap, { x: 4, y: 5, width: 20, height: 10 }, true),
        'vector-visible': materializedFor('vector-visible', vectorBitmap, { x: 5, y: 6, width: 20, height: 10 }, true),
        'paint-visible': materializedFor('paint-visible', paintBitmap, { x: 6, y: 7, width: 20, height: 10 }, true),
      },
      takeLayers: () => {
        throw new Error('not used');
      },
      release: vi.fn(),
    } satisfies DurableComposite);

    expect(records.size).toEqual({ width: 100, height: 80 });
    expect(records.frame).toEqual(frame);

    expect(records.layers['raster-visible']).toMatchObject({
      bitmap: rasterBitmap,
      tmpCanvas: null,
      pos: { x: 4, y: 5, width: 20, height: 10 },
      visible: true,
      opacity: 0.5,
      blendMode: 'multiply',
      isBedrock: true,
      order: 0,
      presentationBounds: null,
      operations: [],
    });

    expect(records.layers['vector-visible']).toMatchObject({
      bitmap: vectorBitmap,
      tmpCanvas: null,
      pos: { x: 5, y: 6, width: 20, height: 10 },
      visible: true,
      blendMode: 'screen',
      order: 1,
      presentationBounds: null,
      operations: [],
    });

    expect(records.layers['paint-visible']).toMatchObject({
      bitmap: paintBitmap,
      tmpCanvas: null,
      pos: { x: 6, y: 7, width: 20, height: 10 },
      visible: true,
      locked: true,
      opacity: 0.6,
      order: 2,
      presentationBounds: null,
      operations: [],
    });

    expect(records.layers['raster-hidden']).toMatchObject({
      tmpCanvas: null,
      visible: false,
      opacity: 0.3,
      blendMode: 'overlay',
      pos: { x: 3, y: 3, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    });

    expect(records.layers['vector-hidden']).toMatchObject({
      tmpCanvas: null,
      visible: false,
      isBedrock: true,
      pos: { x: 4, y: 4, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    });

    expect(records.layers['paint-hidden']).toMatchObject({
      tmpCanvas: null,
      visible: false,
      locked: true,
      blendMode: 'hard-light',
      pos: { x: 5, y: 5, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    });
  });
});
