import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  deriveCreateLayerEntry,
  validatePlannedDurableEntry,
  type SourceBackedEntryContext,
} from '../history-append.ts';
import { collectDurableAssetIds, DURABLE_SCHEMA_VERSION, type DurableDocument } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION } from '../../util/constants.ts';

const documentId = 'create-append-doc';
const position = { x: 12, y: 18, width: 40, height: 30 };

function context(registry: AssetRegistry): SourceBackedEntryContext {
  return { documentId, registry, preLayers: new Map() };
}

function createItem(layerId: string, layerSource: LayerSource, id = `create-${layerId}`): HistoryItem {
  return { id, actionName: NEW_LAYER_ACTION, layerId, layerSource };
}

function durableDocument(entry: NonNullable<ReturnType<typeof deriveCreateLayerEntry>>): DurableDocument {
  return {
    documentId,
    documentRevision: 0,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame: { x: 0, y: 0, width: 400, height: 300 },
      layers: [],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history: [entry],
    cursor: 0,
  };
}

describe('history append source-backed create planning', () => {
  it('creates a blank layer without registering an asset', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        pos: position,
      };
      const entry = deriveCreateLayerEntry(createItem('blank-layer', source), context(registry));

      expect(entry).not.toBeNull();
      expect(entry?.operation).toMatchObject({ kind: 'create-layer', layer: { id: 'blank-layer' } });
      expect(entry && [...collectDurableAssetIds(durableDocument(entry))]).toEqual([]);
      expect(validatePlannedDurableEntry(createItem('blank-layer', source), entry!)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('creates an image layer with a registered raster asset', () => {
    const registry = new AssetRegistry();
    try {
      const bitmap = { width: 40, height: 30, close: () => {} } as unknown as ImageBitmap;
      const source: LayerSource = { kind: 'image', bitmap, name: 'Photo', isBedrock: false, pos: position };
      const item = createItem('image-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      expect(entry?.operation.kind).toBe('create-layer');
      if (!entry || entry.operation.kind !== 'create-layer' || entry.operation.layer.source.kind !== 'raster') return;
      expect(registry.getRecord(entry.operation.layer.source.assetId)).toBeDefined();
      expect([...collectDurableAssetIds(durableDocument(entry))]).toEqual([entry.operation.layer.source.assetId]);
      expect(validatePlannedDurableEntry(item, entry)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('refuses a legacy-tool source and names the tool', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'tool',
        args: { toolName: 'pencil' } as never,
        isBedrock: false,
        pos: position,
      };

      expect(() => deriveCreateLayerEntry(createItem('pencil-layer', source), context(registry))).toThrow(
        /Tool pencil/
      );
    } finally {
      registry.shutdown();
    }
  });

  it('keeps the canonical schema and enabled gate on a planned create', () => {
    const registry = new AssetRegistry();
    try {
      const source: LayerSource = {
        kind: 'blank',
        color: '#ff0000',
        opacity: 1,
        isBedrock: false,
        pos: position,
      };
      const item = createItem('blank-layer', source);
      const entry = deriveCreateLayerEntry(item, context(registry));

      expect(entry).toMatchObject({ id: item.id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled: true });
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry?.operation)).toBe(true);
    } finally {
      registry.shutdown();
    }
  });
});
