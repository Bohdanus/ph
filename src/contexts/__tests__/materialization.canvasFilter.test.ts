import { afterEach, describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { materializeLayer } from '../materialization.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import type { AssetId } from '../history-model.ts';
import type { DurableLayerSnapshot, DurableLayerSource, DurableOperation } from '../history-model.ts';
import type { DurableReplayLayer } from '../durable-replay.ts';
import type { MaterializationRequest } from '../materialization.ts';

const FILTER_TOOL_NAMES = ['blur', 'color', 'levels'] as const;

function makeFilteredLayer(toolName: (typeof FILTER_TOOL_NAMES)[number]): DurableReplayLayer {
  const args: Record<string, Record<string, string | number>> = {
    blur: { toolName: 'blur', radius: 3 },
    color: { toolName: 'color', grayscale: 50, sepia: 0, saturation: 0 },
    levels: { toolName: 'levels', brightness: 10, contrast: 0 },
  };
  const source: DurableLayerSource = Object.freeze({
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    size: { width: 40, height: 40 },
    isBedrock: false,
  });
  const snapshot: DurableLayerSnapshot = Object.freeze({
    id: 'layer-1',
    name: 'Layer 1',
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as GlobalCompositeOperation,
    order: 0,
    pos: { x: 0, y: 0, width: 40, height: 40 },
    source,
  });
  const operation: DurableOperation = Object.freeze({
    kind: 'apply-filter' as const,
    layerId: 'layer-1',
    filter: Object.freeze({
      toolName,
      version: 1,
      args: Object.freeze(args[toolName]),
    }),
  });
  return Object.freeze({ snapshot, operations: Object.freeze([operation]) });
}

const makeRequest = (registry: AssetRegistry): MaterializationRequest => ({
  documentId: 'test-doc',
  baselineAssetGeneration: registry.getDocumentGeneration('test-doc'),
  operationSetRevision: 0,
  assetRegistry: registry,
});

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('materialization rejects the durable branch rather than replaying an unhonorable filter', () => {
  it.each(FILTER_TOOL_NAMES)('rejects for %s when ctx.filter is unavailable', async (toolName) => {
    overrideCanvasFilterSupport(false);
    const registry = new AssetRegistry();

    await expect(materializeLayer(makeFilteredLayer(toolName), makeRequest(registry))).rejects.toThrow(
      /CanvasRenderingContext2D\.filter/
    );
    registry.shutdown();
  });

  it.each(FILTER_TOOL_NAMES)('resolves for %s when ctx.filter is available', async (toolName) => {
    overrideCanvasFilterSupport(true);
    const registry = new AssetRegistry();

    const materialized = await materializeLayer(makeFilteredLayer(toolName), makeRequest(registry));

    expect(materialized.bitmap).toBeDefined();
    materialized.lease.release();
    registry.shutdown();
  });

  it('caches nothing for a refused filter, so the refusal repeats rather than silently succeeding', async () => {
    overrideCanvasFilterSupport(false);
    const registry = new AssetRegistry();
    const request = makeRequest(registry);
    const layer = makeFilteredLayer('blur');

    await expect(materializeLayer(layer, request)).rejects.toThrow(/CanvasRenderingContext2D\.filter/);
    // `AssetRegistry.materialize` deletes a failed pending promise instead of caching it. If the
    // refusal cached a bitmap, the second call would hand back an unfiltered presentation and the
    // failure would be recorded exactly once, invisibly.
    await expect(materializeLayer(layer, request)).rejects.toThrow(/CanvasRenderingContext2D\.filter/);

    overrideCanvasFilterSupport(true);
    const recovered = await materializeLayer(layer, request);
    expect(recovered.bitmap).toBeDefined();
    recovered.lease.release();
    registry.shutdown();
  });

  it('a raster source with an unknown asset still rejects for its own reason', async () => {
    overrideCanvasFilterSupport(false);
    const registry = new AssetRegistry();
    const layer: DurableReplayLayer = Object.freeze({
      snapshot: Object.freeze({
        id: 'layer-1',
        name: 'Layer 1',
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over' as GlobalCompositeOperation,
        order: 0,
        pos: { x: 0, y: 0, width: 10, height: 10 },
        source: Object.freeze({
          kind: 'raster' as const,
          assetId: 'missing' as AssetId,
          width: 10,
          height: 10,
          isBedrock: false,
        }),
      }),
      operations: Object.freeze([]),
    });

    await expect(materializeLayer(layer, makeRequest(registry))).rejects.toThrow(/Unknown or disposed asset/);
    registry.shutdown();
  });
});
